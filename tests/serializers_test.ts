// SPDX-License-Identifier: MIT
import { EXPECTED, generateDemoDataset } from "../src/dataset/generator.ts";
import { OMS_COLUMNS, serializeDataset } from "../src/adapters/export/serializers.ts";
import { assert, assertEquals } from "./assert.ts";

const dataset = generateDemoDataset();
const files = serializeDataset(dataset);

Deno.test("catalog export parses into offers and specs", () => {
  const catalog = JSON.parse(files["catalog.json"]);
  assertEquals(catalog.offers.length, 3);
  assertEquals(catalog.specs.length, 3);
  for (const spec of catalog.specs) {
    assert(Array.isArray(spec.attributes), `${spec.specId} has no attributes`);
  }
});

Deno.test("oms export has one row per service order", () => {
  const lines = files["oms_orders.csv"].trimEnd().split("\n");
  assertEquals(lines[0], OMS_COLUMNS.join(","));
  assertEquals(lines.length - 1, dataset.serviceOrders.length);
  for (const line of lines.slice(1)) {
    assertEquals(line.split(",").length, OMS_COLUMNS.length, `bad row: ${line}`);
  }
});

Deno.test("bpm export has one line per process and keeps every activity", () => {
  const lines = files["bpm_history.jsonl"].trimEnd().split("\n");
  assertEquals(lines.length, dataset.processes.length);

  let activities = 0;
  for (const line of lines) {
    const process = JSON.parse(line);
    assert(process.process_id, "process without id");
    assert(process.activities.length > 0, `${process.process_id} has no activities`);
    activities += process.activities.length;
  }
  assertEquals(activities, dataset.activities.length);
});

Deno.test("provisioning export keeps the documented states", () => {
  const lines = files["provisioning.jsonl"].trimEnd().split("\n");
  assertEquals(lines.length, EXPECTED.attempts);

  const states = { failed: 0, pending: 0, succeeded: 0 } as Record<string, number>;
  for (const line of lines) {
    const attempt = JSON.parse(line);
    assert(attempt.serial, `${attempt.attempt_id} has no serial`);
    states[attempt.state]++;
  }

  assertEquals(states.failed, EXPECTED.attempts_by_state.failed);
  assertEquals(states.pending, EXPECTED.attempts_by_state.pending);
  assertEquals(states.succeeded, EXPECTED.attempts_by_state.succeeded);
});

Deno.test("exports are byte-stable across runs", () => {
  assertEquals(serializeDataset(generateDemoDataset()), files);
});
