// SPDX-License-Identifier: MIT
/**
 * Independent validation (M6-02): 41 hand-written orders with borderline cases.
 *
 * The expected answers in `tests/golden/validation/expected.json` were labelled from the rule
 * definitions in `docs/architecture/rules.md`, not by running the engine, so passing them says
 * more than passing the generator's own `expected.json`. The data is synthetic.
 */

import { assert, assertEquals } from "./assert.ts";
import { auditCopy, VALIDATION } from "./validation_support.ts";

const expected = JSON.parse(await Deno.readTextFile(`${VALIDATION}expected.json`));
const result = await auditCopy(VALIDATION);
const finding = (id: string) => result.findings.find((f) => f.id === id);

Deno.test("the hand-written set is 30 to 50 orders and passes the gate", () => {
  assert(expected.orders >= 30 && expected.orders <= 50, `${expected.orders} orders`);
  assertEquals(result.correlation.orders.length, expected.orders);
  assertEquals(result.quality?.passed, true);
  assertEquals(result.quality?.failures, []);
});

Deno.test("each rule finds exactly the orders a person labelled", () => {
  for (const id of ["R01", "R03", "R04"]) {
    const want = expected.findings[id];
    const got = finding(id);
    assertEquals(got?.affectedOrders, want.affected_orders, `${id} count`);
    assertEquals(got?.evidence.map((e) => e.orderRef).sort(), want.orders, `${id} orders`);
  }
  assertEquals(finding("R05")?.affectedOrders, expected.findings.R05.affected_orders);
});

Deno.test("every labelled case that names a rule is judged as labelled", () => {
  let checked = 0;
  for (const c of expected.cases) {
    for (const id of ["R01", "R03", "R04"]) {
      if (!(id in c.expect)) continue;
      const found = finding(id)?.evidence.some((e) => e.orderRef === c.order) ?? false;
      assertEquals(found, c.expect[id], `${c.order} ${id}: ${c.why}`);
      checked++;
    }
  }
  assert(checked >= 25, `only ${checked} labelled judgements`);
});

Deno.test("the borderline buckets are counted where a person puts them", () => {
  const r01 = finding("R01")!.breakdown!;
  assertEquals(
    [r01.excludedPermanent, r01.excludedMaintenance, r01.unknownCode],
    [1, 2, 1],
  );
  const r03 = finding("R03")!.breakdown!;
  assertEquals(
    [r03.expiredTimers, r03.recovered, r03.inHumanManagement, r03.suspended, r03.withinThreshold],
    [6, 1, 1, 1, 1],
  );
  assertEquals([r03.continuedWithoutCompensation, r03.stuck], [1, 1]);
});

Deno.test("R02 is not evaluated without a catalog, never reported as zero", () => {
  assertEquals(result.findings.some((f) => f.id === "R02"), false);
  assertEquals(result.quality?.notEvaluable.map((n) => n.rule), expected.not_evaluable);
});

Deno.test("hours follow the formulas on the labelled orders", () => {
  assertEquals(finding("R04")!.cost.hoursMonth, 1.5); // one group, 90 minutes
  assertEquals(finding("R05")!.cost.hoursMonth, 3.75); // five weak links, 45 minutes
  assertEquals(finding("R01")!.cost.terms[0].hours, 7 * 5 / 60); // manual minutes
});
