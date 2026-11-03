// SPDX-License-Identifier: MIT
/** The `findings/1` schema (M4-01): validator, file shape and R04's cost block. */

import { correlate } from "../src/domain/correlation.ts";
import { toFileShape } from "../src/domain/report_json.ts";
import { validateReport } from "../src/domain/report_validator.ts";
import { detectR04 } from "../src/domain/rules/r04.ts";
import type { Order, ProvisioningAttempt, ServiceOrder } from "../src/domain/model.ts";
import { assert, assertEquals } from "./assert.ts";
import { auditStub, demoConfig } from "./stub_sources.ts";

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const doc = await Deno.readTextFile(
  new URL("../docs/architecture/report-schema.md", import.meta.url),
);
const exampleText = doc.slice(doc.indexOf("## Example")).match(/```json\n([\s\S]*?)\n```/)![1];
const example = () => JSON.parse(exampleText) as Json;
const configJson = JSON.parse(
  await Deno.readTextFile(new URL("../data/demo/config.json", import.meta.url)),
);

Deno.test("the validator accepts the example in report-schema.md", () => {
  assertEquals(validateReport(example(), configJson), []);
});

Deno.test("the validator rejects a finding with no formula", () => {
  const report = example();
  delete report.findings[0].cost.formula;
  const errors = validateReport(report, configJson);
  assert(errors.some((e) => e.includes("cost.formula")), errors.join("\n"));
});

Deno.test("the validator rejects an input key that is not in config.json", () => {
  const report = example();
  report.findings[0].cost.inputs[0].key = "rates.made_up_minutes";
  const errors = validateReport(report, configJson);
  assert(errors.some((e) => e.includes("not a key of config.json")), errors.join("\n"));
});

Deno.test("the validator rejects hours that differ from the sum of the terms", () => {
  const report = example();
  report.findings[0].cost.hours_month += 5;
  const errors = validateReport(report, configJson);
  assert(errors.some((e) => e.includes("hours_month")), errors.join("\n"));
});

Deno.test("the validator rejects bad enums, camelCase files and an oversized sample", () => {
  const report = example();
  report.findings[0].status = "maybe";
  report.findings[0].cost.kind = "monthly";
  report.findings[0].cost.terms[0].basis = "guess";
  assert(validateReport(report, configJson).length >= 3);
  assert(validateReport({ schemaVersion: "findings/1" }).length > 0);
  const big = example();
  big.findings[0].evidence = Array.from({ length: 21 }, () => big.findings[0].evidence[0]);
  assert(validateReport(big, configJson).some((e) => e.includes("more than 20")));
});

Deno.test("the engine's report validates, and the serializer maps to snake_case", async () => {
  const { report } = await auditStub();
  const file = toFileShape(report) as Json;
  assertEquals(validateReport(file, configJson), []);
  assertEquals(file.schema_version, "findings/1");
  assertEquals(file.findings[0].rule_version, "R04@2");
  assertEquals(file.findings[0].cost.hours_month, 30);
  assertEquals(file.sources[0].rows_read, 5000);
  assertEquals(file.totals.gross.hours, 30);
  // The JSON round trip is what a file would hold.
  assertEquals(validateReport(JSON.parse(JSON.stringify(file)), configJson), []);
  // The config is printed as the file has it: snake_case, and the same as config.json.
  assertEquals(file.config, configJson);
  assertEquals(file.config.orders_per_month, 5000);
  assertEquals(file.config.rates.cleanup_minutes, 90);
  // No camelCase key leaks anywhere.
  assert(!/"[a-z]+[A-Z][A-Za-z]*":/.test(JSON.stringify(file)), "a camelCase key leaked");
});

Deno.test("the serializer keeps order ids in overlap.by_order as they are", async () => {
  const { report } = await auditStub();
  report.overlap.byOrder = { "ORD-1000": ["R04"] };
  const file = toFileShape(report) as Json;
  assertEquals(file.overlap.by_order, { "ORD-1000": ["R04"] });
});

// R04's cost block ------------------------------------------------------------------

const order = (ref: string): Order => ({
  orderRef: ref,
  submittedAt: "2026-09-01T00:00:00Z",
  state: "ACTIVE",
  offerId: "O",
  offerVersion: "1",
});
const so = (ref: string, orderRef: string): ServiceOrder => ({
  soRef: ref,
  orderRef,
  specId: "S",
  state: "ACTIVE",
  createdAt: "2026-09-01T00:00:00Z",
  productOrderItemRef: `${orderRef}-1`,
});
const attempt = (id: string, soRef: string): ProvisioningAttempt => ({
  attemptId: id,
  soRef,
  serial: "SN",
  state: "succeeded",
  errorCode: null,
  startedAt: "2026-09-01T00:00:00Z",
  endedAt: null,
});

Deno.test("R04 cost: one hours term, 30 h, one_off, activations kept as counts", async () => {
  const { findings } = await auditStub();
  const cost = findings[0].cost;
  assertEquals(cost.kind, "one_off");
  assertEquals(cost.terms.map((t) => t.hours), [30]);
  assertEquals(cost.terms.map((t) => t.basis), ["rate_assumption"]);
  assertEquals(cost.terms[0].observed, 20);
  assertEquals(cost.unmeasured, []);
  assertEquals(cost.hoursMonth, 30);
  assertEquals(cost.inputs.map((i) => i.key), ["rates.cleanup_minutes"]);
  assertEquals(findings[0].breakdown?.reachedActivation, 20);
  assertEquals(findings[0].evidenceTotal, 20);
  assert(findings[0].evidence.length <= 20);
});

Deno.test("R04 cost without activations is the same 30 h", () => {
  const orders = Array.from({ length: 20 }, (_, i) => `O${i}`);
  const result = correlate({
    orders: orders.map(order),
    serviceOrders: orders.flatMap((o) => [so(`${o}-A`, o), so(`${o}-B`, o)]),
    attempts: [],
  });
  const finding = detectR04(result.orders, demoConfig)!;
  assertEquals(finding.cost.hoursMonth, 30);
  assertEquals(finding.cost.terms.length, 1);
  assertEquals(finding.breakdown?.reachedActivation, 0);
  const withAttempts = correlate({
    orders: orders.map(order),
    serviceOrders: orders.flatMap((o) => [so(`${o}-A`, o), so(`${o}-B`, o)]),
    attempts: [attempt("ACT-1", "O0-B")],
  });
  const one = detectR04(withAttempts.orders, demoConfig)!;
  assertEquals(one.cost.hoursMonth, 30);
  assertEquals(one.breakdown?.reachedActivation, 1);
});
