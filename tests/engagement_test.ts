// SPDX-License-Identifier: MIT
/** Engagement layout (M5-11). */

import { main } from "../src/cli/main.ts";
import { ENGINE_ROOT, resolveEngagement } from "../src/cli/engagement.ts";
import { assert, assertEquals } from "./assert.ts";

async function run(argv: string[], env: Record<string, string> = {}) {
  const lines: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => void lines.push(`out| ${a.join(" ")}`);
  console.error = (...a: unknown[]) => void lines.push(`err| ${a.join(" ")}`);
  try {
    const code = await main(argv, (name) => env[name]);
    return { code, text: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** A client's directory with the demo exports in raw/ and its mapping in mapping/. */
export async function makeEngagement(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "engagement-" });
  await Deno.mkdir(`${dir}/raw`);
  await Deno.mkdir(`${dir}/mapping`);
  await Deno.mkdir(`${dir}/config`);
  for (const f of ["oms_orders.csv", "bpm_history.jsonl", "provisioning.jsonl", "catalog.json"]) {
    await Deno.copyFile(`data/demo/${f}`, `${dir}/raw/${f}`);
  }
  await Deno.copyFile("data/demo/mapping.json", `${dir}/mapping/mapping.json`);
  await Deno.copyFile("data/demo/config.json", `${dir}/config/config.json`);
  return dir;
}

Deno.test("an engagement gives raw/, mapping/, config/ and out/ as defaults", async () => {
  const dir = await makeEngagement();
  try {
    const r = await run(["--engagement", dir, "--quiet"]);
    assertEquals(r.code, 0, r.text);
    const names = [...Deno.readDirSync(`${dir}/out`)].map((e) => e.name).sort();
    assertEquals(names, ["findings.csv", "findings.json", "quality.json", "report.html"]);
    // FLOW_AUDIT_HOME does the same; --check writes only quality.json.
    await Deno.remove(`${dir}/out`, { recursive: true });
    const c = await run(["--check", "--quiet"], { FLOW_AUDIT_HOME: dir });
    assertEquals(c.code, 0, c.text);
    assertEquals([...Deno.readDirSync(`${dir}/out`)].map((e) => e.name), ["quality.json"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the engine refuses an output directory inside raw/", async () => {
  const dir = await makeEngagement();
  try {
    await Deno.mkdir(`${dir}/raw/results`);
    for (const out of [`${dir}/raw`, `${dir}/raw/results`, `${dir}/raw/not-yet`]) {
      const r = await run(["--engagement", dir, "--out", out, "--quiet"]);
      assertEquals(r.code, 2, r.text);
      assert(r.text.includes("inside the input"), r.text);
    }
    // Without an engagement too: the inputs are never written to.
    const plain = await run(["--dataset", `${dir}/raw`, "--out", `${dir}/raw`, "--quiet"]);
    assertEquals(plain.code, 2, plain.text);
    assertEquals([...Deno.readDirSync(`${dir}/raw`)].length, 5);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the engine refuses a repository path as engagement", async () => {
  for (const bad of [ENGINE_ROOT, `${ENGINE_ROOT}/data`]) {
    const r = await run(["--engagement", bad, "--check", "--quiet"]);
    assertEquals(r.code, 2, r.text);
    assert(r.text.includes("inside a repository"), r.text);
  }
  // Any other git repository counts too.
  const other = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${other}/.git`);
    await Deno.mkdir(`${other}/client`);
    const r = await run(["--check", "--quiet"], { FLOW_AUDIT_HOME: `${other}/client` });
    assertEquals(r.code, 2, r.text);
    assert(!/\n\s+at |\.ts:\d+:\d+/.test(r.text), "a stack trace reached the user");
  } finally {
    await Deno.remove(other, { recursive: true });
  }
  assertEquals(resolveEngagement(undefined, () => undefined), null);
});

Deno.test("a missing engagement directory says what to create", async () => {
  const r = await run(["--engagement", "/nonexistent/client-x", "--check", "--quiet"]);
  assertEquals(r.code, 2, r.text);
  assert(r.text.includes("does not exist") && r.text.includes("next:"), r.text);
});
