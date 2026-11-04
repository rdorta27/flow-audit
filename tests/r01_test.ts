// SPDX-License-Identifier: MIT
/** R01@1 and the error classes of M3-09: positive, negative, boundary and the demo's numbers. */

import { runAudit } from "../src/app/run_audit.ts";
import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { parseMapping } from "../src/adapters/ingest/mapping.ts";
import { chargesR01, detectR01, scanR01 } from "../src/domain/rules/r01.ts";
import { severityFor } from "../src/domain/rules/severity.ts";
import type { ImpactConfig } from "../src/domain/model.ts";
import { assert, assertEquals } from "./assert.ts";
import { at, attempt, config, HOUR, order, so, T0, world } from "./rules_fixture.ts";
import { auditStub } from "./stub_sources.ts";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** One order, one service order, the given attempts. */
function one(attempts: ReturnType<typeof attempt>[], soExtra = {}, cfg: ImpactConfig = config) {
  const result = world({
    orders: [order("O1")],
    serviceOrders: [so("S1", "O1", soExtra)],
    attempts,
  });
  return { orders: result.orders, cfg, result };
}

Deno.test("R01 fires on a failure whose retry comes after 72 h: (5 + 3 × 15) / 60 h", () => {
  const { orders, cfg } = one([
    attempt("A1", "S1", 0),
    attempt("A2", "S1", 72, { state: "succeeded", errorCode: null }),
  ]);
  const f = detectR01(orders, cfg)!;
  assertEquals(f.affectedOrders, 1);
  assertEquals(f.cost.terms.map((t) => round1(t.hours * 60)), [5, 45]);
  assert(Math.abs(f.cost.hoursMonth - 50 / 60) < 1e-9);
  assertEquals(f.cost.formula.includes("wait_days"), true);
  assertEquals(f.id, "R01");
  assertEquals(f.ruleVersion, "R01@1");
  assertEquals(f.cost.inputs.map((i) => i.key), [
    "rates.manual_minutes",
    "rates.daily_followup_minutes",
    "thresholds.retry_window_hours",
  ]);
  assert(Math.abs(chargesR01(orders, cfg)[0].hours - f.cost.hoursMonth) < 1e-9);
});

Deno.test("R01 measures the wait to the end of the data when no attempt follows", () => {
  const other = world({
    orders: [order("O1"), order("O2")],
    serviceOrders: [so("S1", "O1"), so("S2", "O2")],
    attempts: [
      attempt("A1", "S1", 0),
      attempt("A9", "S2", 48, { state: "succeeded", errorCode: null }),
    ],
  });
  const hit = scanR01(other.orders, config).hits[0];
  assertEquals(hit.next, undefined);
  assert(Math.abs(hit.waitDays - (48 * HOUR + 30_000 - 0) / (24 * HOUR)) < 0.01);
});

Deno.test("R01 does not fire when a retry follows inside the window", () => {
  const { orders, cfg } = one([
    attempt("A1", "S1", 0),
    attempt("A2", "S1", 2, { state: "succeeded", errorCode: null }),
  ]);
  assertEquals(detectR01(orders, cfg), null);
});

Deno.test("R01 boundary: a retry at exactly 24 h is a retry; 24 h and one second is not", () => {
  const retry = (secondsLate: number) =>
    one([
      attempt("A1", "S1", 0),
      {
        ...attempt("A2", "S1", 24, { state: "succeeded", errorCode: null }),
        startedAt: at(T0 + 24 * HOUR + secondsLate * 1000),
      },
    ]);
  assertEquals(scanR01(retry(0).orders, config).hits.length, 0);
  assertEquals(scanR01(retry(1).orders, config).hits.length, 1);
});

Deno.test("R01 does not fire on a cancelled service order", () => {
  const { orders, cfg } = one([attempt("A1", "S1", 0)], { state: "CANCELLED" });
  assertEquals(detectR01(orders, cfg), null);
});

Deno.test("R01 reads a retry on a new service order of the same item as a retry (R04's case)", () => {
  const result = world({
    orders: [order("O1")],
    serviceOrders: [so("S1", "O1", { state: "FAILED" }), so("S2", "O1")],
    attempts: [
      attempt("A1", "S1", 0),
      attempt("A2", "S2", 1, { state: "succeeded", errorCode: null }),
    ],
  });
  assertEquals(scanR01(result.orders, config).hits.length, 0);
  // The same retry 60 h later is fallout, counted once for the order.
  const late = world({
    orders: [order("O1")],
    serviceOrders: [so("S1", "O1", { state: "FAILED" }), so("S2", "O1")],
    attempts: [
      attempt("A1", "S1", 0),
      attempt("A2", "S2", 60, { state: "succeeded", errorCode: null }),
    ],
  });
  const hits = scanR01(late.orders, config).hits;
  assertEquals(hits.length, 1);
  assertEquals(hits[0].next?.item.attemptId, "A2");
  assert(Math.abs(hits[0].waitDays - 2.5) < 1e-9);
});

Deno.test("R01 leaves out permanent errors and failures inside a maintenance window", () => {
  const permanent = one([attempt("A1", "S1", 0, { errorCode: "ACCOUNT_BLOCKED" })]);
  assertEquals(detectR01(permanent.orders, config), null);
  assertEquals(scanR01(permanent.orders, config).excludedPermanent, 1);

  // 2026-09-14 02:00-06:00 is the window of the demo config.
  const inside = Date.parse("2026-09-14T03:00:00.000Z");
  const maintenance = world({
    orders: [order("O1")],
    serviceOrders: [so("S1", "O1")],
    attempts: [{ ...attempt("A1", "S1", 0), startedAt: at(inside) }],
  });
  const scan = scanR01(maintenance.orders, config);
  assertEquals([scan.hits.length, scan.excludedMaintenance], [0, 1]);

  // Just outside the window the same failure is fallout.
  const outside = world({
    orders: [order("O1")],
    serviceOrders: [so("S1", "O1")],
    attempts: [{ ...attempt("A1", "S1", 0), startedAt: "2026-09-14T06:00:01.000Z" }],
  });
  assertEquals(scanR01(outside.orders, config).hits.length, 1);
});

Deno.test("R01 shows the excluded counts in the finding next to a real fallout order", () => {
  const result = world({
    orders: [order("O1"), order("O2"), order("O3")],
    serviceOrders: [so("S1", "O1"), so("S2", "O2"), so("S3", "O3")],
    attempts: [
      attempt("A1", "S1", 0),
      attempt("A2", "S2", 0, { errorCode: "TERMINAL_NOT_REGISTERED" }),
      attempt("A3", "S3", 0, { errorCode: "SOMETHING_NEW" }),
    ],
  });
  const f = detectR01(result.orders, config)!;
  assertEquals(f.affectedOrders, 2);
  assertEquals(f.breakdown?.excludedPermanent, 1);
  assertEquals(f.breakdown?.unknownCode, 1);
  assertEquals(f.evidence.map((e) => e.orderRef), ["O1", "O3"]);
});

Deno.test("R01 treats a timeout as uncertain, a late pending as old pending, a callback as resolved", () => {
  const result = world({
    orders: [order("O1"), order("O2"), order("O3"), order("O4")],
    serviceOrders: [so("S1", "O1"), so("S2", "O2"), so("S3", "O3"), so("S4", "O4")],
    attempts: [
      attempt("A1", "S1", 0, { outcome: "timeout" }),
      attempt("A2", "S2", 0, { state: "pending", errorCode: null, endedAt: null }),
      attempt("A3", "S3", 0, { outcome: "succeeded", callbackAt: at(T0 + 3 * HOUR) }),
      // The latest thing in the data: 200 h after the others.
      attempt("A4", "S4", 200, { state: "succeeded", errorCode: null }),
    ],
  });
  const scan = scanR01(result.orders, config);
  assertEquals(scan.hits.length, 0);
  assertEquals(
    [scan.uncertainTimeout, scan.oldPending, scan.resolvedByCallback],
    [1, 1, 1],
  );
});

Deno.test("R01 refuses an attempt it cannot time, and says so", () => {
  const result = world({
    orders: [order("O1"), order("O2")],
    serviceOrders: [so("S1", "O1"), so("S2", "O2")],
    attempts: [
      attempt("A1", "S1", 0, { startedAt: "not a date" }),
      attempt("A2", "S2", 0),
    ],
  });
  const f = detectR01(result.orders, config)!;
  assertEquals(f.affectedOrders, 1);
  assertEquals(f.cost.unmeasured.length, 1);
  assert(f.cost.unmeasured[0].reason.includes("snapshot"));
});

Deno.test("R01 counts an unplaced failed attempt apart, never as an order", () => {
  const result = world({
    orders: [order("O1")],
    serviceOrders: [
      so("S1", "O1", { terminalSerial: "SN-X" }),
      so("S2", "O1", { terminalSerial: "SN-X" }),
    ],
    attempts: [
      attempt("A1", null, 0, { serial: "SN-X" }),
      attempt("A2", "S1", 72, { state: "succeeded", errorCode: null }),
    ],
  });
  const scan = scanR01(result.orders, config, { correlation: result });
  assertEquals([scan.hits.length, scan.unlinkedFailed, scan.ambiguousFailed], [0, 1, 1]);
});

Deno.test("severity is derived from share and hours", () => {
  assertEquals(severityFor(0.5, 1), "critical");
  assertEquals(severityFor(0.01, 201), "critical");
  assertEquals(severityFor(0.03, 1), "high");
  assertEquals(severityFor(0.01, 60), "high");
  assertEquals(severityFor(0.01, 1), "medium");
});

Deno.test("demo over the stub: 400 orders, 283.3 h; HUB_TIMEOUT is transient, 41 permanent left out", async () => {
  const { findings } = await auditStub();
  const r01 = findings.find((f) => f.id === "R01")!;
  assertEquals(r01.affectedOrders, 400);
  assertEquals(round1(r01.cost.hoursMonth), 283.3);
  assertEquals(r01.severity, "critical");
  assertEquals(r01.breakdown?.excludedPermanent, 41);
  assertEquals(r01.breakdown?.unknownCode, 0);
  assertEquals(r01.evidenceTotal, 400);
  assert(r01.evidence.length <= 20);
});

Deno.test("demo over the files gives the same R01 as the stub", async () => {
  const dir = new URL("../data/demo/", import.meta.url).pathname;
  const mapping = parseMapping(
    await Deno.readTextFile(`${dir}mapping.json`),
    "data/demo/mapping.json",
  );
  const sources = createFileSources(mapping, { dir, now: () => "2026-09-30T00:00:00.000Z" });
  const files = await runAudit({}, {
    clock: { nowIso: () => "2026-09-01T00:00:00Z" },
    sources,
    config,
  });
  const stub = await auditStub();
  const pick = (r: { findings: typeof files.findings }, id: string) => {
    const f = r.findings.find((x) => x.id === id)!;
    // R05's split by confidence differs by source (inferred on files, missing on the stub).
    const b = id === "R05" ? undefined : f.breakdown;
    return { n: f.affectedOrders, h: f.cost.hoursMonth, b, e: f.evidenceTotal };
  };
  for (const id of ["R01", "R04", "R05"]) assertEquals(pick(files, id), pick(stub, id), id);
});
