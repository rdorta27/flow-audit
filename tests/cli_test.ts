// SPDX-License-Identifier: MIT
/** What the CLI says (M5-18): snapshots of a full run, a --check run and three errors. */

import { main } from "../src/cli/main.ts";
import { assert, assertEquals } from "./assert.ts";

const GOLDEN = new URL("./golden/", import.meta.url);

/** Runs the CLI and returns every line it printed, in order, tagged by stream. */
async function run(argv: string[], tmp?: string): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => void lines.push(`out| ${a.join(" ")}`);
  console.error = (...a: unknown[]) => void lines.push(`err| ${a.join(" ")}`);
  let code: number;
  try {
    code = await main(argv);
  } finally {
    console.log = log;
    console.error = error;
  }
  const text = lines.join("\n").replaceAll(tmp ?? "\0", "<tmp>");
  return { code, text: `exit ${code}\n${text}\n` };
}

async function snapshot(name: string, actual: string) {
  const file = new URL(name, GOLDEN);
  if (Deno.env.get("UPDATE_GOLDEN")) await Deno.writeTextFile(file, actual);
  assertEquals(actual, await Deno.readTextFile(file));
  assert(!/\n\s+at |\.ts:\d+:\d+/.test(actual), "a stack trace reached the user");
}

async function demoCopy(edit: Record<string, (t: string) => string> = {}) {
  const dir = await Deno.makeTempDir();
  for (const f of ["oms_orders.csv", "bpm_history.jsonl", "provisioning.jsonl", "catalog.json"]) {
    const text = await Deno.readTextFile(`data/demo/${f}`);
    await Deno.writeTextFile(`${dir}/${f}`, edit[f] ? edit[f](text) : text);
  }
  return dir;
}

Deno.test("a full run says what it read, joined, checked, found and wrote", async () => {
  const out = await Deno.makeTempDir();
  try {
    const r = await run(["--dataset", "data/demo", "--out", out], out);
    assertEquals(r.code, 0);
    await snapshot("cli_full_run.txt", r.text);
    for (const f of ["findings.json", "report.html", "quality.json"]) {
      assert((await Deno.stat(`${out}/${f}`)).isFile, f);
    }
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

Deno.test("--check reads, maps and runs the gate, and nothing else", async () => {
  const out = await Deno.makeTempDir();
  try {
    const r = await run(["--dataset", "data/demo", "--check", "--out", out], out);
    assertEquals(r.code, 0);
    await snapshot("cli_check_run.txt", r.text);
    assertEquals([...Deno.readDirSync(out)].map((e) => e.name), ["quality.json"]);
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

Deno.test("error: a missing file says what, where and what to do", async () => {
  const dir = await demoCopy();
  try {
    await Deno.remove(`${dir}/provisioning.jsonl`);
    const r = await run(["--dataset", dir, "--quiet"], dir);
    assertEquals(r.code, 1);
    await snapshot("cli_error_missing_file.txt", r.text);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("error: an unknown state says which value, which line and how to map it", async () => {
  const dir = await demoCopy({
    "provisioning.jsonl": (t) => t.replace('"state":"succeeded"', '"state":"weird"'),
  });
  try {
    const r = await run(["--dataset", dir, "--quiet"], dir);
    assertEquals(r.code, 1);
    await snapshot("cli_error_unknown_state.txt", r.text);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("error: a gate failure exits 3 with the problems; --force runs anyway", async () => {
  const dir = await demoCopy({
    "provisioning.jsonl": (t) =>
      t.split("\n").filter((l) => l === "" || JSON.parse(l).started_at < "2026-09-21").join("\n"),
  });
  try {
    const r = await run(["--dataset", dir, "--quiet"], dir);
    assertEquals(r.code, 3);
    await snapshot("cli_error_gate_failed.txt", r.text);
    assertEquals((await run(["--dataset", dir, "--quiet", "--force"], dir)).code, 0);
    assertEquals((await run(["--dataset", dir, "--quiet", "--check"], dir)).code, 3);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("--help shows worked examples; --quiet silences the stage lines", async () => {
  const help = await run(["--help"]);
  assert(help.text.includes("Examples:") && help.text.includes("--check"), help.text);
  const quiet = await run(["--dataset", "data/demo", "--quiet"]);
  assert(!quiet.text.includes("err|"), quiet.text);
  assert(quiet.text.includes("out| R04@2 · 20 orders · 30 h"), quiet.text);
});
