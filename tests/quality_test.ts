// SPDX-License-Identifier: MIT
/** Time zones (M5-08) and the data-quality gate (M5-10). */

import { QualityGateError, runAudit } from "../src/app/run_audit.ts";
import { readDate } from "../src/adapters/ingest/dates.ts";
import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { MappingError, parseMapping } from "../src/adapters/ingest/mapping.ts";
import { assessQuality, notEvaluableRules, type SystemFacts } from "../src/domain/quality.ts";
import { qualityLines } from "../src/cli/main.ts";
import { assert, assertEquals } from "./assert.ts";
import { demoConfig, stubSources } from "./stub_sources.ts";

const DEMO = new URL("../data/demo/", import.meta.url).pathname;
const clock = { nowIso: () => "2026-09-01T00:00:00Z" };
const now = () => "2026-09-30T00:00:00.000Z";
const demoMapping = await Deno.readTextFile(`${DEMO}mapping.json`);
// deno-lint-ignore no-explicit-any
const demoJson = (): any => JSON.parse(demoMapping);

/** A copy of the demo exports in a temp dir; `edit` changes a file's text on the way. */
async function copyDemo(edit: Record<string, (text: string) => string> = {}) {
  const dir = await Deno.makeTempDir();
  for (const f of ["oms_orders.csv", "bpm_history.jsonl", "provisioning.jsonl", "catalog.json"]) {
    const text = await Deno.readTextFile(`${DEMO}${f}`);
    await Deno.writeTextFile(`${dir}/${f}`, edit[f] ? edit[f](text) : text);
  }
  return dir;
}

async function gated(dir: string, mapping: string, force = false) {
  const sources = createFileSources(parseMapping(mapping, "m.json"), { dir, now });
  return await runAudit({}, { clock, sources, config: demoConfig, gate: { force } });
}

Deno.test("named IANA zones follow daylight saving on the date of each timestamp", () => {
  const rule = (zone: string) => ({ format: "iso8601", offsetMinutes: 0, zone });
  assertEquals(readDate("2026-09-15T08:30:00", rule("America/Bogota")), "2026-09-15T13:30:00.000Z");
  assertEquals(readDate("2026-07-01T12:00:00", rule("Europe/Madrid")), "2026-07-01T10:00:00.000Z");
  assertEquals(readDate("2026-01-15T12:00:00", rule("Europe/Madrid")), "2026-01-15T11:00:00.000Z");
  assertEquals(
    readDate("15/03/2026 12:00", {
      format: "dd/MM/yyyy HH:mm",
      offsetMinutes: 0,
      zone: "Asia/Kolkata",
    }),
    "2026-03-15T06:30:00.000Z",
  );
  // A text with its own offset keeps it.
  assertEquals(
    readDate("2026-09-15T08:30:00Z", rule("America/Bogota")),
    "2026-09-15T08:30:00.000Z",
  );
  // Clocks go forward 2026-03-29 02:00 -> 03:00 in Madrid; 02:30 does not exist.
  assertEquals(readDate("2026-03-29T02:30:00", rule("Europe/Madrid")), "2026-03-29T01:30:00.000Z");
  // Clocks go back 2026-10-25 03:00 -> 02:00; 02:30 happens twice and the first is read.
  assertEquals(readDate("2026-10-25T02:30:00", rule("Europe/Madrid")), "2026-10-25T00:30:00.000Z");
});

Deno.test("an unknown zone name is a mapping error naming the field", () => {
  const m = demoJson();
  m.prov.time_zone = "Mars/Olympus";
  try {
    parseMapping(JSON.stringify(m, null, 2), "client.mapping.json");
    throw new Error("expected a MappingError");
  } catch (error) {
    assert(error instanceof MappingError, String(error));
    assert(error.message.includes("time_zone") && error.message.includes("Mars/Olympus"));
  }
  m.prov.time_zone = "Europe/Madrid";
  assertEquals(parseMapping(JSON.stringify(m), "m.json").prov.timeZone, "Europe/Madrid");
});

Deno.test("an export in local time gives the same findings once its zone is declared", async () => {
  const zone = "Europe/Madrid";
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const local = (text: string) =>
    text.replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})Z/g, (_m, _s, ms) => {
      const parts = fmt.format(new Date(_m)).replace(" ", "T");
      return `${parts}.${ms}`;
    });
  const dir = await copyDemo({
    "oms_orders.csv": local,
    "bpm_history.jsonl": local,
    "provisioning.jsonl": local,
  });
  try {
    const m = demoJson();
    for (const b of ["oms", "bpm", "prov"]) m[b].time_zone = zone;
    const same = await gated(DEMO, demoMapping);
    const shifted = await gated(dir, JSON.stringify(m));
    assertEquals(
      shifted.findings.map((f) => f.ruleVersion),
      same.findings.map((f) => f.ruleVersion),
    );
    assertEquals(
      shifted.report.sources.map((s) => s.sha256),
      same.report.sources.map((s) => s.sha256),
    );
    assertEquals(shifted.quality?.passed, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the demo passes the gate from files and from the stub", async () => {
  const files = await gated(DEMO, demoMapping);
  assertEquals(files.quality?.passed, true);
  assertEquals(files.quality?.notEvaluable, []);
  assertEquals(files.findings.map((f) => [f.ruleVersion, f.affectedOrders, f.cost.hoursMonth]), [
    ["R01@1", 400, 283.3333333333333],
    ["R02@1", 4167, 347.25],
    ["R04@2", 20, 30],
    ["R05@1", 300, 225],
  ]);
  const stub = await runAudit({}, {
    clock,
    sources: stubSources(),
    config: demoConfig,
    gate: {},
  });
  assertEquals(stub.quality?.passed, true);
  assertEquals(stub.findings.map((f) => [f.ruleVersion, f.affectedOrders, f.cost.hoursMonth]), [
    ["R01@1", 400, 283.3333333333333],
    ["R04@2", 20, 30],
    ["R05@1", 300, 225],
  ]);
});

Deno.test("a copy with PROV cut at day 20 fails the gate; --force runs and says so", async () => {
  const dir = await copyDemo({
    "provisioning.jsonl": (t) =>
      t.split("\n").filter((l) => l === "" || JSON.parse(l).started_at < "2026-09-21").join("\n"),
  });
  try {
    try {
      await gated(dir, demoMapping);
      throw new Error("expected the gate to stop the run");
    } catch (error) {
      assert(error instanceof QualityGateError, String(error));
      const prov = error.quality.failures.filter((f) => f.startsWith("PROV"));
      assertEquals(prov.length, 1, error.quality.failures.join("\n"));
      assert(prov[0].includes("covers 6"), prov[0]);
    }
    const forced = await gated(dir, demoMapping, true);
    assertEquals([forced.quality?.passed, forced.quality?.forced], [false, true]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a doubled file is de-duplicated by key and the count is reported", async () => {
  const double = (t: string) => {
    const [header, ...rows] = t.trimEnd().split("\n");
    return [header, ...rows, ...rows].join("\n") + "\n";
  };
  const dir = await copyDemo({
    "oms_orders.csv": double,
    "provisioning.jsonl": (t) => t + t,
  });
  try {
    const result = await gated(dir, demoMapping);
    assertEquals(result.quality?.passed, true);
    const [oms, , prov] = result.quality!.systems;
    assertEquals([oms.rows, oms.duplicateKeys, oms.exactDuplicates], [5000, 5021, 5021]);
    assertEquals([prov.rows, prov.duplicateKeys, prov.exactDuplicates], [5390, 5390, 5390]);
    assertEquals(result.findings.map((f) => [f.ruleVersion, f.affectedOrders]), [
      ["R01@1", 400],
      ["R02@1", 4167],
      ["R04@2", 20],
      ["R05@1", 300],
    ]);
    assert(
      qualityLines(result.quality!).some((l) => l.includes("5,390 repeated records dropped")),
      qualityLines(result.quality!).join("\n"),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an unknown state shows in the gate's output", async () => {
  const dir = await copyDemo({
    "provisioning.jsonl": (t) => {
      let left = 3;
      return t.replace(/"state":"succeeded"/g, (m) => left-- > 0 ? '"state":"weird"' : m);
    },
  });
  try {
    const m = demoJson();
    m.prov.on_unknown_state = "unmapped";
    const result = await gated(dir, JSON.stringify(m));
    const lines = qualityLines(result.quality!);
    assertEquals(result.quality?.passed, true, lines.join("\n"));
    assert(lines.some((l) => l.includes('"weird" x3')), lines.join("\n"));
    // Too many of them fail.
    m.quality = { max_unknown_state_share: 0 };
    assertEquals((await gatedOrFail(dir, JSON.stringify(m))).passed, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

async function gatedOrFail(dir: string, mapping: string) {
  try {
    return (await gated(dir, mapping)).quality!;
  } catch (error) {
    if (error instanceof QualityGateError) return error.quality;
    throw error;
  }
}

const facts = (system: SystemFacts["system"], rows: number, start: string, end: string) =>
  ({
    system,
    label: "x",
    rows,
    duplicateKeys: 0,
    exactDuplicates: 0,
    range: rows ? { start, end } : null,
    children: rows,
    orphans: 0,
    statesRead: rows,
    unknownStates: {},
  }) satisfies SystemFacts;

Deno.test("a rule whose system is absent or thin is not evaluable, never zero findings", () => {
  const q = assessQuality([
    facts("OMS", 100, "2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"),
    facts("PROV", 100, "2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"),
    facts("BPM", 3, "2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"),
  ]);
  assertEquals(q.passed, true);
  const needs = { R01: ["PROV"], R02: ["BPM"], R03: ["CAT"], R04: ["OMS"] } as const;
  const out = notEvaluableRules(q, ["R01", "R02", "R03", "R04"], needs);
  assertEquals(out.map((n) => [n.rule, n.system]), [["R02", "BPM"], ["R03", "CAT"]]);
});

Deno.test("ranges that do not overlap warn and fail; a declared period is the window", () => {
  const q = assessQuality([
    facts("OMS", 100, "2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"),
    facts("PROV", 100, "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z"),
  ]);
  assertEquals(q.passed, false);
  assert(q.warnings.some((w) => w.includes("do not overlap")), q.warnings.join("\n"));
  assertEquals(q.commonWindow, null);

  const p = assessQuality([
    facts("OMS", 100, "2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"),
    facts("PROV", 100, "2026-09-01T00:00:00Z", "2026-09-15T00:00:00Z"),
  ], { period: { start: "2026-09-01T00:00:00Z", end: "2026-09-16T00:00:00Z" } });
  assertEquals(p.passed, true);
  assertEquals(p.window?.declared, true);
});

Deno.test("the mapping takes a period and gate thresholds", () => {
  const m = demoJson();
  m.period = { start: "2026-09-01", end: "2026-09-30" };
  m.quality = { min_rows: 5, max_orphan_share: 0.2 };
  const parsed = parseMapping(JSON.stringify(m, null, 2), "m.json");
  assertEquals(parsed.period, {
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-09-30T23:59:59.999Z",
  });
  assertEquals(parsed.quality?.minRows, 5);
  m.quality = { max_orphan_share: 3 };
  try {
    parseMapping(JSON.stringify(m, null, 2), "m.json");
    throw new Error("expected a MappingError");
  } catch (error) {
    assert(error instanceof MappingError && error.message.includes("max_orphan_share"));
  }
});
