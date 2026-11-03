// SPDX-License-Identifier: MIT
/** The BPM evidence contract (M2-09): the demo's `bpm_history.jsonl` has the required fields. */

import { assert } from "./assert.ts";

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const text = await Deno.readTextFile(
  new URL("../data/demo/bpm_history.jsonl", import.meta.url),
);
const records = text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Json);

const isStr = (v: unknown) => typeof v === "string" && v !== "";
const isTime = (v: unknown) => isStr(v) && !Number.isNaN(Date.parse(v as string));
const KINDS = ["task", "timer", "gateway"];
const ACTORS = ["human", "system", "partner"];

function problems(r: Json): string[] {
  const out: string[] = [];
  if (!isStr(r.process_id)) out.push("process_id");
  if (!isStr(r.so_ref) && !isStr(r.business_key)) out.push("so_ref or business_key");
  if (!isStr(r.state)) out.push("state");
  if (!isTime(r.started_at)) out.push("started_at");
  if (r.ended_at !== null && !isTime(r.ended_at)) out.push("ended_at (a time or null)");
  if (!Array.isArray(r.activities)) return [...out, "activities"];
  r.activities.forEach((a: Json, i: number) => {
    const p = `activities[${i}].`;
    if (!Number.isInteger(a.sequence) || a.sequence < 1) out.push(p + "sequence");
    if (!KINDS.includes(a.kind)) out.push(p + "kind");
    if (!isStr(a.name)) out.push(p + "name");
    if (!ACTORS.includes(a.actor)) out.push(p + "actor");
    if (!isTime(a.started_at)) out.push(p + "started_at");
    if (a.ended_at !== null && !isTime(a.ended_at)) out.push(p + "ended_at (a time or null)");
    if (a.timer_expired !== undefined && typeof a.timer_expired !== "boolean") {
      out.push(p + "timer_expired (optional boolean)");
    }
  });
  return out;
}

Deno.test("every record of the demo's bpm_history.jsonl has the required fields", () => {
  assert(records.length > 0, "the file is empty");
  const bad = records.map((r) => ({ id: r.process_id, p: problems(r) })).filter((x) =>
    x.p.length > 0
  );
  assert(
    bad.length === 0,
    `${bad.length} records break the contract, first: ${JSON.stringify(bad[0])}`,
  );
});

Deno.test("the shape test catches a record that lacks a required field", () => {
  const r = structuredClone(records[0]);
  delete r.process_id;
  r.activities[0].kind = "event";
  const p = problems(r);
  assert(p.includes("process_id") && p.includes("activities[0].kind"), p.join(","));
});
