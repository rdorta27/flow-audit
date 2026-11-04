// SPDX-License-Identifier: MIT
/** R03@1 (M3-07) and the BPM model v2 (M2-10): stuck, recovered, owned, healthy, snapshot. */

import { runAudit } from "../src/app/run_audit.ts";
import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { parseMapping } from "../src/adapters/ingest/mapping.ts";
import { classifySegments } from "../src/domain/segments.ts";
import { chargesR03, detectR03, scanR03 } from "../src/domain/rules/r03.ts";
import type { Activity, ImpactConfig, ProcessInstance } from "../src/domain/model.ts";
import { assert, assertEquals } from "./assert.ts";
import { at, config, HOUR, order, so, T0, world } from "./rules_fixture.ts";
import { stubSources } from "./stub_sources.ts";

const DAY = 24 * HOUR;
const cfg: ImpactConfig = {
  ...config,
  rules: {
    ...config.rules,
    r03: {
      timerActivities: ["activation_timer"],
      compensationActivities: ["activation_recovery"],
      humanManagementTasks: ["fallout_review"],
    },
  },
};

const act = (
  seq: number,
  name: string,
  kind: Activity["kind"],
  fromH: number,
  toH: number | null,
  extra: Partial<Activity> = {},
): Activity => ({
  processId: "P1",
  sequence: seq,
  kind,
  name,
  actor: kind === "task" && name !== "installation" ? "human" : "system",
  startedAt: at(T0 + fromH * HOUR),
  endedAt: toH === null ? null : at(T0 + toH * HOUR),
  ...extra,
});

/** One order, expiry at hour 24, then `after`; the end of the period is order O2 at `endDays`. */
function scene(
  after: Activity[],
  extra: Partial<ProcessInstance> = {},
  endDays = 10,
) {
  const timer = act(1, "activation_timer", "timer", 0, 24, { timerExpired: true });
  const p: ProcessInstance = {
    processId: "P1",
    soRef: "S1",
    businessKey: null,
    state: "RUNNING",
    startedAt: at(T0),
    endedAt: null,
    activities: [timer, ...after],
    ...extra,
  };
  return world({
    orders: [order("O1"), order("O2", { submittedAt: at(T0 + endDays * DAY) })],
    serviceOrders: [so("S1", "O1"), so("S2", "O2")],
    processes: [p],
    attempts: [],
  }).orders;
}

Deno.test("R03 flags an expired timer with nothing after it: (5 + days × 15) / 60 h", () => {
  const orders = scene([]);
  const f = detectR03(orders, cfg)!;
  assertEquals(f.affectedOrders, 1);
  assertEquals(f.status, "detected");
  assertEquals(f.ruleVersion, "R03@1");
  // expiry at day 1, period end at day 10: 9 days
  assert(Math.abs(f.cost.hoursMonth - (5 + 9 * 15) / 60) < 1e-9);
  assert(Math.abs(chargesR03(orders, cfg)[0].hours - f.cost.hoursMonth) < 1e-9);
  assertEquals(f.cost.kind, "accumulated_to_period_end");
});

Deno.test("R03 does not flag an order recovered by the declared compensation", () => {
  const orders = scene([act(2, "activation_recovery", "task", 30, 31)], {
    state: "COMPLETED",
    endedAt: at(T0 + 31 * HOUR),
  });
  assertEquals(detectR03(orders, cfg), null);
  assertEquals(scanR03(orders, cfg).recovered, 1);
});

Deno.test("what counts as a compensation is declared, not hard-coded", () => {
  const orders = scene([act(2, "activation_recovery", "task", 30, 31)], {
    state: "COMPLETED",
    endedAt: at(T0 + 31 * HOUR),
  });
  const other = { ...cfg, rules: { r03: { ...cfg.rules!.r03!, compensationActivities: [] } } };
  // Undeclared: the later task is "something followed", closed on its own, so still not stuck
  // but not counted as a recovery either.
  const scan = scanR03(orders, other);
  assertEquals([scan.recovered, scan.continued, scan.hits.length], [0, 1, 0]);
});

Deno.test("an order whose process waits on an open human fallout task is in human management", () => {
  const orders = scene([act(2, "fallout_review", "task", 30, null)]);
  const scan = scanR03(orders, cfg);
  assertEquals([scan.inHumanManagement, scan.hits.length], [1, 0]);
  assertEquals(detectR03(orders, cfg), null);
});

Deno.test("a long but healthy process is not flagged: no expired timer", () => {
  const timer = act(1, "activation_timer", "timer", 0, 24, { timerExpired: false });
  const orders = world({
    orders: [order("O1"), order("O2", { submittedAt: at(T0 + 30 * DAY) })],
    serviceOrders: [so("S1", "O1"), so("S2", "O2")],
    processes: [{
      processId: "P1",
      soRef: "S1",
      businessKey: null,
      state: "RUNNING",
      startedAt: at(T0),
      endedAt: null,
      activities: [timer],
    }],
    attempts: [],
  }).orders;
  assertEquals(detectR03(orders, cfg), null);
});

Deno.test("an expiry younger than stuck_after_hours is not yet stuck", () => {
  const orders = scene([], {}, 2); // expiry at day 1, period end day 2: 24 h < 72 h
  assertEquals(detectR03(orders, cfg), null);
  assertEquals(scanR03(orders, cfg).withinThreshold, 1);
});

Deno.test("a suspended process is not stuck", () => {
  assertEquals(detectR03(scene([], { suspended: true }), cfg), null);
});

Deno.test("snapshot evidence makes R03 suspected, with its confidence stated", () => {
  const f = detectR03(scene([], { evidenceKind: "snapshot" }), cfg)!;
  assertEquals(f.status, "suspected");
  assertEquals(f.confidence.level, "possible");
  assertEquals(f.evidenceLevel, "weak");
  assert(f.cost.unmeasured.some((u) => u.reason.includes("confidence: possible")));
});

Deno.test("an expiry with no readable time counts the order but not its days", () => {
  const orders = scene([], {
    activities: [{
      ...act(1, "activation_timer", "timer", 0, 24, { timerExpired: true }),
      endedAt: "not a date",
    }],
  });
  const f = detectR03(orders, cfg)!;
  assertEquals(f.affectedOrders, 1);
  assert(Math.abs(f.cost.hoursMonth - 5 / 60) < 1e-9);
  assertEquals(f.cost.unmeasured.length, 1);
});

Deno.test("a claimed human task splits queue from work; without a claim it is not separable", () => {
  const entry = scene([])[0];
  const claimed = act(2, "fallout_review", "task", 30, 40, { claimedAt: at(T0 + 35 * HOUR) });
  const plain = act(2, "fallout_review", "task", 30, 40);
  const ok = (a: Activity) => {
    const r = classifySegments(entry, [a]);
    assert(r.ok);
    return r.segments.filter((s) => s.system === "BPM" && s.state === "fallout_review");
  };
  assertEquals(ok(claimed).map((s) => [s.kind, s.from, s.to]), [
    ["queue", at(T0 + 30 * HOUR), at(T0 + 35 * HOUR)],
    ["work", at(T0 + 35 * HOUR), at(T0 + 40 * HOUR)],
  ]);
  assertEquals(ok(plain).map((s) => [s.kind, s.queueSeparable]), [["work", false]]);
});

Deno.test("the BPM model v2 fields survive the file reader", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const demo = new URL("../data/demo/", import.meta.url);
    for (const f of ["oms_orders.csv", "provisioning.jsonl", "catalog.json"]) {
      await Deno.copyFile(new URL(f, demo), `${dir}/${f}`);
    }
    const bpm = (await Deno.readTextFile(new URL("bpm_history.jsonl", demo))).split("\n")
      .filter((l) => l !== "").slice(0, 40).map((l) => {
        const p = JSON.parse(l);
        p.root_process_id = p.process_id;
        p.incidents = [{ type: "failedJob", created_at: p.started_at, message: "boom" }];
        for (const a of p.activities) a.claimed_at = a.started_at;
        return JSON.stringify(p);
      }).join("\n");
    await Deno.writeTextFile(`${dir}/bpm_history.jsonl`, bpm + "\n");
    const m = JSON.parse(await Deno.readTextFile(new URL("mapping.json", demo)));
    m.bpm.fields.root_process_id = "root_process_id";
    m.bpm.fields.incidents = "incidents";
    m.bpm.activity_fields.claimed_at = "claimed_at";
    const sources = createFileSources(parseMapping(JSON.stringify(m), "mapping.json"), {
      dir,
      now: () => "2026-09-30T00:00:00.000Z",
    });
    const records = [];
    for await (const r of sources.processes!.read()) records.push(r);
    assertEquals(records.length, 40);
    assertEquals(records[0].value.root_process_id, records[0].value.process_id);
    assertEquals((records[0].value.incidents as unknown[]).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("on the stub R03 is not evaluated (no BPM), never zero", async () => {
  const result = await runAudit({}, {
    clock: { nowIso: () => "2026-09-01T00:00:00Z" },
    sources: stubSources(),
    config,
    gate: {},
  });
  assertEquals(result.findings.some((f) => f.id === "R03"), false);
  const skipped = result.quality!.notEvaluable.filter((n) => n.rule === "R03");
  assertEquals(skipped.map((n) => n.system), ["BPM"]);
});
