// SPDX-License-Identifier: MIT
/** Compare two audits (M5-14). */

import { main as auditMain } from "../src/cli/main.ts";
import { diffLines, main as diffMain } from "../src/cli/diff.ts";
import { diffFindings } from "../src/domain/diff.ts";
import { assert, assertEquals } from "./assert.ts";

async function capture(
  fn: () => Promise<number>,
): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    return { code: await fn(), out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function audit(dir: string, extra: string[] = []) {
  const r = await capture(() =>
    auditMain(["--dataset", "data/demo", "--out", dir, "--quiet", ...extra])
  );
  assertEquals(r.code, 0);
  return JSON.parse(await Deno.readTextFile(`${dir}/findings.json`));
}

Deno.test("two runs of the demo diff to nothing", async () => {
  const [a, b] = [await Deno.makeTempDir(), await Deno.makeTempDir()];
  try {
    await audit(a);
    await audit(b);
    const r = await capture(() => diffMain([`${a}/findings.json`, `${b}/findings.json`]));
    assertEquals(r.code, 0);
    assertEquals(r.out.length, 1);
    assert(r.out[0].startsWith("No differences"), r.out[0]);
  } finally {
    await Deno.remove(a, { recursive: true });
    await Deno.remove(b, { recursive: true });
  }
});

Deno.test("orders that leave come first, then the estimate, then config and versions", async () => {
  const a = JSON.parse(await Deno.readTextFile("tests/golden/findings.demo.json"));
  const b = structuredClone(a);
  const r04 = b.findings.find((f: { id: string }) => f.id === "R04");
  const gone = r04.evidence.shift().order_ref;
  r04.affected_order_refs = r04.affected_order_refs.filter((o: string) => o !== gone);
  r04.affected_orders -= 1;
  r04.cost.hours_month -= 1.5;
  r04.rule_version = "R04@3";
  b.config.rates.cleanup_minutes = 60;
  const diff = diffFindings(a, b);
  assert(!diff.same);
  const lines = diffLines(diff, "a", "b");
  const text = lines.join("\n");
  assert(lines[1].startsWith("R04 (R04@2 -> R04@3)"), text);
  assertEquals(lines[2], `  leave: ${gone}`);
  assert(lines[3].startsWith("  estimate R04"), text);
  assert(text.includes("Rule version R04: R04@2 -> R04@3"), text);
  assert(text.includes("Config rates.cleanup_minutes: 90 -> 60"), text);
  assert(text.indexOf("leave:") < text.indexOf("Config "), text);
});

Deno.test("a run with another rate differs in the estimate and the config, not the orders", async () => {
  const [a, b] = [await Deno.makeTempDir(), await Deno.makeTempDir()];
  try {
    await audit(a);
    const config = JSON.parse(await Deno.readTextFile("data/demo/config.json"));
    config.rates.cleanup_minutes = 60;
    await Deno.writeTextFile(`${b}/config.json`, JSON.stringify(config));
    await audit(b, ["--config", `${b}/config.json`]);
    const r = await capture(() => diffMain([`${a}/findings.json`, `${b}/findings.json`]));
    const text = r.out.join("\n");
    assert(text.includes("Config rates.cleanup_minutes: 90 -> 60"), text);
    assert(text.includes("estimate R04"), text);
    assert(!text.includes("enter:") && !text.includes("leave:"), text);
  } finally {
    await Deno.remove(a, { recursive: true });
    await Deno.remove(b, { recursive: true });
  }
});

Deno.test("errors are plain lines, never a stack trace", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/x.json`, "{}");
    for (
      const argv of [[], ["only-one"], [`${dir}/missing.json`, `${dir}/x.json`], [
        `${dir}/x.json`,
        `${dir}/x.json`,
      ]]
    ) {
      const r = await capture(() => diffMain(argv));
      assert(r.code === 1 || r.code === 2, `${argv}`);
      const text = r.err.join("\n");
      assert(text.includes("flow-audit:") && !/\n\s+at |\.ts:\d+/.test(text), text);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an order outside the old sample of 20 still shows as entered or left (M5-20)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const before = await audit(dir);
    const after = JSON.parse(JSON.stringify(before));
    const r02 = (
      file: { findings: { id: string; affected_orders: number; affected_order_refs: string[] }[] },
    ) => file.findings.find((f) => f.id === "R02")!;
    const refs = r02(after).affected_order_refs;
    const gone = refs[refs.length - 1]; // sorted, so far outside the first 20
    assert(refs.indexOf(gone) > 20, "the test order is outside the old sample");
    r02(after).affected_order_refs = refs.slice(0, -1);
    r02(after).affected_orders -= 1;
    const d = diffFindings(before, after).rules.find((x) => x.rule.startsWith("R02"))!;
    assertEquals(d.left, [gone]);
    assertEquals(d.sampled, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("R05 in findings.csv lists every order and adds up to the finding's hours (M5-20)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await audit(dir);
    const r05 = file.findings.find((f: { id: string }) => f.id === "R05");
    const rows = (await Deno.readTextFile(`${dir}/findings.csv`)).trim().split("\n")
      .filter((l) => l.split(",")[1] === "R05");
    const orders = rows.filter((l) => l.startsWith("order,"));
    assertEquals(orders.length, r05.affected_orders);
    const sum = orders.reduce((a, l) => a + Number(l.split(",")[3]), 0);
    assert(Math.abs(sum - r05.cost.hours_month) < 0.01, `${sum} vs ${r05.cost.hours_month}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
