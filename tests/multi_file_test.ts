// SPDX-License-Identifier: MIT
/** One system, several files (M5-24): a join key declared in the mapping. */

import { main } from "../src/cli/main.ts";
import { assert, assertEquals } from "./assert.ts";

type Row = Record<string, unknown>;

async function run(argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    return { code: await main(argv), out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

const lines = (text: string): Row[] =>
  text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
const jsonl = (rows: Row[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

/** The demo with the process history split in two files; `perActivity` writes one row per activity. */
async function split(perActivity: boolean): Promise<{ dir: string; mapping: string }> {
  const dir = await Deno.makeTempDir();
  for (const f of ["oms_orders.csv", "provisioning.jsonl", "catalog.json"]) {
    await Deno.copyFile(`data/demo/${f}`, `${dir}/${f}`);
  }
  const bpm = lines(await Deno.readTextFile("data/demo/bpm_history.jsonl"));
  const main: Row[] = [];
  const nested: Row[] = [];
  for (const p of bpm) {
    const { activities, ...rest } = p as { activities?: Row[] } & Row;
    main.push(rest);
    if (perActivity) {
      for (const a of activities ?? []) nested.push({ process_id: p.process_id, ...a });
    } else {
      nested.push({ process_id: p.process_id, activities: activities ?? [] });
    }
  }
  await Deno.writeTextFile(`${dir}/bpm_main.jsonl`, jsonl(main));
  await Deno.writeTextFile(`${dir}/bpm_activities.jsonl`, jsonl(nested));
  const mapping = JSON.parse(await Deno.readTextFile("data/demo/mapping.json"));
  mapping.bpm.file = "bpm_main.jsonl";
  mapping.bpm.join = [
    perActivity
      ? { file: "bpm_activities.jsonl", key: "process_id", as: "activities" }
      : { file: "bpm_activities.jsonl", key: "process_id" },
  ];
  await Deno.writeTextFile(`${dir}/mapping.json`, JSON.stringify(mapping));
  return { dir, mapping: `${dir}/mapping.json` };
}

async function findings(argv: string[]) {
  const out = await Deno.makeTempDir();
  try {
    const r = await run([...argv, "--out", out, "--quiet"]);
    assertEquals(r.code, 0, r.err.join("\n"));
    const file = JSON.parse(await Deno.readTextFile(`${out}/findings.json`));
    return file.findings.map((f: { id: string; affected_order_refs: string[] }) => [
      f.id,
      f.affected_order_refs,
    ]);
  } finally {
    await Deno.remove(out, { recursive: true });
  }
}

Deno.test("two process files joined by process id give the same findings as one file (M5-24)", async () => {
  const whole = await findings(["--dataset", "data/demo"]);
  for (const perActivity of [false, true]) {
    const { dir, mapping } = await split(perActivity);
    try {
      assertEquals(await findings(["--dataset", dir, "--mapping", mapping]), whole);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("a join file row without the key, or two rows without `as`, fail with file and line (M5-24)", async () => {
  const { dir, mapping } = await split(false);
  try {
    const rows = lines(await Deno.readTextFile(`${dir}/bpm_activities.jsonl`));
    await Deno.writeTextFile(
      `${dir}/bpm_activities.jsonl`,
      jsonl([...rows, { activities: [] }]),
    );
    const missing = await run(["--dataset", dir, "--mapping", mapping, "--check"]);
    assertEquals(missing.code, 1);
    assert(
      missing.err.join("\n").includes(`bpm_activities.jsonl:${rows.length + 1}`),
      missing.err.join("\n"),
    );
    await Deno.writeTextFile(
      `${dir}/bpm_activities.jsonl`,
      jsonl([...rows, rows[0]]),
    );
    const twice = await run(["--dataset", dir, "--mapping", mapping, "--check"]);
    assertEquals(twice.code, 1);
    assert(twice.err.join("\n").includes('set "as" on the join'), twice.err.join("\n"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the demo mapping has no join and is unchanged (M5-24)", async () => {
  const mapping = JSON.parse(await Deno.readTextFile("data/demo/mapping.json"));
  assertEquals(mapping.bpm.join, undefined);
});
