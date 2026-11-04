// SPDX-License-Identifier: MIT
/**
 * Fault injection (M6-02). The generator's output is damaged the way a client's export is
 * damaged (rows dropped, rows repeated, a zone mistake, states renamed) and the audit must
 * say so, and must not find more than the clean data does for a reason that is not real.
 */

import { QualityGateError } from "../src/app/run_audit.ts";
import { FileError } from "../src/adapters/ingest/file_common.ts";
import { assert, assertEquals } from "./assert.ts";
import { affected, auditCopy, DEMO, join, split } from "./validation_support.ts";

const base = await auditCopy(DEMO);
const baseline = affected(base);
const warnings = (r: { quality?: { warnings: string[] } }) => r.quality?.warnings ?? [];

Deno.test("the clean demo is the baseline: the gate is silent and the five numbers hold", () => {
  assertEquals(baseline, { R01: 400, R02: 4167, R03: 50, R04: 20, R05: 300 });
  assertEquals(warnings(base), []);
});

Deno.test("10% of PROV rows dropped: the gate warns and no finding grows", async () => {
  const result = await auditCopy(DEMO, {
    "provisioning.jsonl": (t) => {
      const { rows } = split(t);
      return join([], rows.filter((_, i) => i % 10 !== 3));
    },
  });
  assert(warnings(result).some((w) => w.includes("no activation attempt")), "no warning");
  for (const [id, n] of Object.entries(affected(result))) assert(n <= baseline[id], `${id} grew`);
});

Deno.test("dropping succeeded attempts: whatever grows, the gate said rows may be missing", async () => {
  // Every 10th succeeded attempt goes: some were the retry that closed a failure.
  let seen = 0;
  const result = await auditCopy(DEMO, {
    "provisioning.jsonl": (t) =>
      join([], split(t).rows.filter((l) => !(l.includes('"succeeded"') && seen++ % 10 === 0))),
  });
  const grew = Object.entries(affected(result)).filter(([id, n]) => n > baseline[id]);
  const said = warnings(result).some((w) => w.includes("rows may be missing"));
  assert(said, "the gate did not warn");
  assert(grew.length === 0 || said, "a finding grew without a warning");
});

Deno.test("repeated rows are dropped, counted, and change nothing", async () => {
  const twice = (header: boolean) => (t: string) => {
    const { head, rows } = split(t, header);
    return join(head, [...rows, ...rows.filter((_, i) => i % 10 === 0)]);
  };
  const result = await auditCopy(DEMO, {
    "oms_orders.csv": twice(true),
    "provisioning.jsonl": twice(false),
    "bpm_history.jsonl": twice(false),
  });
  assertEquals(affected(result), baseline);
  assertEquals(
    result.findings.map((f) => f.cost.hoursMonth),
    base.findings.map((f) => f.cost.hoursMonth),
  );
  const repeated = warnings(result).filter((w) => w.includes("repeated records dropped"));
  assertEquals(repeated.length, 3);
});

const shift = (hours: number) => (text: string) =>
  text.replace(
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})Z/g,
    (m) => new Date(Date.parse(m) + hours * 3_600_000).toISOString(),
  );

Deno.test("a time-zone mistake that puts attempts before their service order is caught", async () => {
  const result = await auditCopy(DEMO, { "provisioning.jsonl": shift(-5) });
  assert(warnings(result).some((w) => w.includes("before their service order")), "no warning");
  for (const [id, n] of Object.entries(affected(result))) assert(n <= baseline[id], `${id} grew`);
});

Deno.test("known limit: a whole file shifted later is consistent with itself and not seen", async () => {
  const result = await auditCopy(DEMO, { "provisioning.jsonl": shift(5) });
  assertEquals(affected(result), baseline);
  assertEquals(warnings(result), []);
});

const rename = (text: string) =>
  text.replaceAll('"state":"failed"', '"state":"FALLO"').replaceAll(
    '"state":"succeeded"',
    '"state":"OK"',
  );

Deno.test("renamed states stop the run and name the value", async () => {
  try {
    await auditCopy(DEMO, { "provisioning.jsonl": rename });
  } catch (error) {
    assert(error instanceof FileError, String(error));
    assertEquals(error.code, "unknown_state");
    assert(error.message.includes("FALLO"), error.message);
    return;
  }
  throw new Error("expected the unknown state to stop the run");
});

Deno.test("renamed states let through as unmapped fail the gate and are not read as zero", async () => {
  const mapping = (text: string) => {
    const m = JSON.parse(text);
    m.prov.on_unknown_state = "unmapped";
    return JSON.stringify(m);
  };
  const edit = { "provisioning.jsonl": rename };
  try {
    await auditCopy(DEMO, edit, { mapping, force: false });
    throw new Error("expected the gate to fail");
  } catch (error) {
    assert(error instanceof QualityGateError, String(error));
    assert(error.quality.failures.some((f) => f.includes("FALLO")), error.quality.failures.join());
  }
  const forced = await auditCopy(DEMO, edit, { mapping, force: true });
  assertEquals(forced.quality?.forced, true);
  for (const [id, n] of Object.entries(affected(forced))) assert(n <= baseline[id], `${id} grew`);
});
