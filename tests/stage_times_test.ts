// SPDX-License-Identifier: MIT
/** Measured waiting per stage (M4-10). */

import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { parseMapping } from "../src/adapters/ingest/mapping.ts";
import { renderHtml } from "../src/adapters/report/html_renderer.ts";
import { runAudit } from "../src/app/run_audit.ts";
import { classifySegments, stageTimes } from "../src/domain/segments.ts";
import type { Segment, SystemId } from "../src/domain/model.ts";
import { assert, assertEquals } from "./assert.ts";
import { demoConfig } from "./stub_sources.ts";

const clock = { nowIso: () => "2026-09-01T00:00:00Z" };
const DEMO = new URL("../data/demo/", import.meta.url).pathname;

const segment = (
  system: SystemId,
  state: string,
  kind: Segment["kind"],
  hours: number,
): Segment => ({
  system,
  from: "2026-09-01T00:00:00.000Z",
  to: new Date(Date.parse("2026-09-01T00:00:00.000Z") + hours * 3_600_000).toISOString(),
  kind,
  state,
});

Deno.test("a finding explains a stage only when its orders concentrate the waiting", () => {
  const journeys = [
    { orderRef: "A", segments: [segment("PROV", "no_evidence", "gap", 60)] },
    { orderRef: "B", segments: [segment("PROV", "no_evidence", "gap", 1)] },
    { orderRef: "C", segments: [segment("BPM", "capacity_check", "work", 2)] },
  ];
  const wide = stageTimes(journeys, [
    { ruleId: "R-wide", orderRef: "A" },
    { ruleId: "R-wide", orderRef: "B" },
    { ruleId: "R-wide", orderRef: "C" },
    { ruleId: "R-narrow", orderRef: "A" },
  ], 3);
  assertEquals(wide.mostWaiting?.stage, "no_evidence");
  assertEquals(wide.mostWaiting?.findings, ["R-narrow"]);
  assert(wide.mostWaiting!.waitingHours > 60 && wide.mostWaiting!.waitingHours < 62);
});

Deno.test("on the demo files the stage with the most waiting equals an independent sum", async () => {
  const mapping = parseMapping(
    await Deno.readTextFile(new URL("../data/demo/mapping.json", import.meta.url)),
    "data/demo/mapping.json",
  );
  const sources = createFileSources(mapping, {
    dir: DEMO,
    now: () => "2026-09-30T00:00:00.000Z",
  });
  const audit = await runAudit({}, { clock, sources, config: demoConfig });
  const activities = audit.correlation.orders.flatMap((e) =>
    e.processes.flatMap((p) => p.item.activities ?? [])
  );
  const totals = new Map<string, number>();
  for (const entry of audit.correlation.orders) {
    const classified = classifySegments(entry, activities);
    if (!classified.ok) continue;
    for (const s of classified.segments) {
      if (s.kind === "work") continue;
      const hours = (Date.parse(s.to) - Date.parse(s.from)) / 3_600_000;
      if (!(hours > 0)) continue;
      const key = `${s.system}\t${s.state}`;
      totals.set(key, (totals.get(key) ?? 0) + hours);
    }
  }
  let best = "";
  let bestHours = -1;
  for (const [key, hours] of totals) {
    if (hours > bestHours) {
      best = key;
      bestHours = hours;
    }
  }
  const [system, stage] = best.split("\t");
  const waiting = audit.report.waiting;
  assert(waiting.measurable, "the demo files are history");
  assertEquals(waiting.reason, null);
  assertEquals(waiting.mostWaiting?.system, system);
  assertEquals(waiting.mostWaiting?.stage, stage);
  assert(Math.abs((waiting.mostWaiting?.waitingHours ?? 0) - bestHours) < 1e-6);
  assert(waiting.mostWaiting!.findings.length > 0, "a finding explains the stage");

  const html = renderHtml(audit.report);
  const start = html.indexOf('id="wait-stages"');
  const section = html.slice(start, html.indexOf("</section>", start));
  assert(section.includes(`data-stage="${system}:${stage}"`), section.slice(0, 400));
  assert(section.includes("not part of the estimate"));
  assert(!section.includes('class="ahr"'), "waiting is not linked to a rate");
  assert(section.includes("gap-hatch"), "the gap is hatched");
  for (const id of waiting.mostWaiting!.findings) {
    assert(section.includes(`href="#${id}"`), id);
  }
  assert(!section.includes("×"), "waiting is not multiplied by a rate");
  const inTotal = audit.report.findings.filter((f) => f.inTotal)
    .reduce((sum, f) => sum + f.cost.hoursMonth, 0);
  assert(Math.abs(inTotal - audit.report.totals.gross.hours) < 1e-6, "totals stay the estimate");
  assert(waiting.mostWaiting!.waitingHours > audit.report.totals.gross.hours);
});
