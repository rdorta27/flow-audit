// SPDX-License-Identifier: MIT
/** The story of one order (M4-04) and the net total (M4-05). */

import { chargesR04 } from "../src/domain/rules/r04.ts";
import { buildStory, storyText } from "../src/domain/story.ts";
import { computeTotals, type OrderCharge } from "../src/domain/totals.ts";
import type { Finding } from "../src/domain/model.ts";
import { assert, assertEquals } from "./assert.ts";
import { auditStub, demoConfig } from "./stub_sources.ts";

const audit = await auditStub();
const entryOf = (ref: string) => audit.correlation.orders.find((o) => o.order.orderRef === ref)!;

Deno.test("ORD-1005 reads as the five steps of the acceptance, in order", () => {
  const steps = buildStory(entryOf("ORD-1005"), audit.findings);
  const whats = steps.map((s) => s.what);
  const at = (needle: string) => whats.findIndex((w) => w.includes(needle));
  assert(at("received") === 0, "order received first");
  assert(
    at("SO-20005") < at("activation attempt on SO-20005"),
    "first service order, then attempt",
  );
  assert(whats[at("activation attempt on SO-20005")].includes("failed"), "first attempt failed");
  assert(at("second service order (SO-30005)") > at("activation attempt on SO-20005"));
  assert(whats[at("activation attempt on SO-30005")].includes("succeeded"), "then succeeded");
  const dup = steps.find((s) => s.what.includes("second service order"))!;
  assertEquals(dup.finding, "R04");
  // ORD-1005 has one repeated service order; the order with a third one is ORD-1017.
  assertEquals(steps.filter((s) => s.finding !== null).length, 1);
  assertEquals(whats.some((w) => w.includes("third service order")), false);
});

Deno.test("steps the source cannot show are listed as not observed, with a reason", () => {
  const steps = buildStory(entryOf("ORD-1005"), audit.findings);
  const missing = steps.filter((s) => !s.observed);
  assertEquals(missing.map((s) => s.system), ["CAT", "BPM"]);
  for (const s of missing) {
    assertEquals(s.reason, "not visible in this source");
    assertEquals(s.at, null);
    assertEquals(s.record, null);
  }
  for (const s of steps.filter((s) => s.observed)) {
    assert(s.record !== null && s.at !== null, "an observed step names its record and time");
  }
});

Deno.test("each event kind has its own sentence; the same input gives the same story", () => {
  const a = buildStory(entryOf("ORD-1005"), audit.findings);
  const b = buildStory(entryOf("ORD-1005"), audit.findings);
  assertEquals(a, b);
  assertEquals(storyText(a).length, a.length);
  const kinds = new Set(a.map((s) => s.what.replace(/[A-Z]{2,3}-\d+/g, "#")));
  assert(kinds.size >= 6, "received, catalog, service order, again, orchestrator, attempts");
});

Deno.test("an order with no problem has no flagged step", () => {
  const clean = audit.correlation.orders.find((e) => e.serviceOrders.length === 1)!;
  const steps = buildStory(clean, audit.findings);
  assert(steps.every((s) => s.finding === null));
});

Deno.test("the report journeys carry the story", () => {
  for (const j of audit.report.journeys) assert(j.story.length >= 3, j.orderRef);
});

const finding = (id: string, hours: number): Finding => ({
  ...audit.findings[0],
  id,
  cost: { ...audit.findings[0].cost, hoursMonth: hours },
});
const charge = (ruleId: string, orderRef: string, hours: number): OrderCharge => ({
  ruleId,
  orderRef,
  hours,
});

Deno.test("the 20 R04 orders also carry R01: the overlap keeps the larger charge", () => {
  const t = audit.report.totals;
  assertEquals(Object.keys(audit.report.overlap.byOrder).length, 20);
  assertEquals(audit.report.overlap.pairs, [{ rules: ["R01", "R04"], orders: 20 }]);
  assert(t.net.hours < t.gross.hours);
  // R04 (90 min) beats R01 (42.5 min) on each of the 20, so R01 loses 20 × 42.5 min.
  assert(Math.abs(t.gross.hours - t.net.hours - 20 * 42.5 / 60) < 1e-9);
});

Deno.test("R04 charges add up to the finding's cost", () => {
  const charges = chargesR04(audit.correlation.orders, demoConfig);
  assertEquals(charges.length, 20);
  const f = audit.findings.find((x) => x.id === "R04")!;
  assert(Math.abs(charges.reduce((s, c) => s + c.hours, 0) - f.cost.hoursMonth) < 1e-9);
});

Deno.test("an overlapping order is counted once, at its largest charge", () => {
  const findings = [finding("R01", 3), finding("R03", 2)];
  const t = computeTotals(findings, [
    charge("R01", "A", 2),
    charge("R03", "A", 1),
    charge("R01", "B", 1),
    charge("R03", "C", 1),
  ]);
  assertEquals(t.gross, { hours: 5 });
  assertEquals(t.net, { hours: 4 });
  assertEquals(t.overlap.byOrder, { A: ["R01", "R03"] });
  assertEquals(t.overlap.pairs, [{ rules: ["R01", "R03"], orders: 1 }]);
});

Deno.test("on a tie the lowest rule id stays, whatever the input order", () => {
  const findings = [finding("R01", 1), finding("R03", 1)];
  const a = computeTotals(findings, [charge("R03", "A", 1), charge("R01", "A", 1)]);
  const b = computeTotals(findings, [charge("R01", "A", 1), charge("R03", "A", 1)]);
  assertEquals(a, b);
  assertEquals(a.net, { hours: 1 });
});

Deno.test("a finding outside the total adds nothing to either figure", () => {
  const out = { ...finding("R05", 9), inTotal: false };
  const t = computeTotals([finding("R04", 1), out], [charge("R05", "A", 9)]);
  assertEquals(t.gross, { hours: 1 });
  assertEquals(t.net, t.gross);
});
