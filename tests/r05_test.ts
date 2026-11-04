// SPDX-License-Identifier: MIT
/** R05@1: every link that is not explicit is one incident; shown apart from the total (D-11). */

import { detectR05, weakLinks } from "../src/domain/rules/r05.ts";
import { assert, assertEquals } from "./assert.ts";
import { attempt, config, order, so, world } from "./rules_fixture.ts";
import { auditStub } from "./stub_sources.ts";

const ok = { state: "succeeded" as const, errorCode: null };

Deno.test("R05 counts each weak link by confidence and never an explicit one", () => {
  const result = world({
    orders: [order("O1"), order("O2")],
    serviceOrders: [
      so("S1", "O1", { terminalSerial: "SN-1" }),
      so("S2", "O2", { terminalSerial: "SN-2" }),
      so("S3", "O2", { terminalSerial: "SN-2" }),
    ],
    attempts: [
      attempt("A1", "S1", 0, ok), // explicit
      attempt("A2", null, 1, { ...ok, serial: "SN-1" }), // inferred (one candidate)
      attempt("A3", null, 1, { ...ok, serial: "SN-2" }), // ambiguous (two candidates)
      attempt("A4", null, 1, { ...ok, serial: "" }), // missing
    ],
  });
  const context = { correlation: result };
  assertEquals(weakLinks(context).length, 3);
  const f = detectR05(result.orders, config, context)!;
  assertEquals(f.id, "R05");
  assertEquals(f.ruleVersion, "R05@1");
  assertEquals(f.affectedOrders, 3);
  assertEquals(
    [f.breakdown?.inferred, f.breakdown?.ambiguous, f.breakdown?.missing, f.breakdown?.conflicting],
    [1, 1, 1, 0],
  );
  assert(Math.abs(f.cost.hoursMonth - 3 * 45 / 60) < 1e-9);
  assertEquals(f.inTotal, false);
});

Deno.test("R05 is silent when every link is explicit or there is no correlation", () => {
  const result = world({
    orders: [order("O1")],
    serviceOrders: [so("S1", "O1")],
    attempts: [attempt("A1", "S1", 0, ok)],
  });
  assertEquals(detectR05(result.orders, config, { correlation: result }), null);
  assertEquals(detectR05(result.orders, config), null);
});

Deno.test("demo over the stub: 300 missing links, 225 h, shown apart from the total", async () => {
  const { findings, report } = await auditStub();
  const r05 = findings.find((f) => f.id === "R05")!;
  assertEquals(r05.affectedOrders, 300);
  assertEquals(r05.breakdown?.missing, 300);
  assertEquals(r05.cost.hoursMonth, 225);
  assertEquals(r05.inTotal, false);
  assertEquals(r05.evidenceTotal, 300);
  const counted = findings.filter((f) => f.inTotal).reduce((s, f) => s + f.cost.hoursMonth, 0);
  assertEquals(report.totals.gross.hours, counted);
});
