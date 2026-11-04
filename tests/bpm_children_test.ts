// SPDX-License-Identifier: MIT
/** M2-10: child processes hang on their root, warnings, and the BPM segments of the report. */

import { runAudit } from "../src/app/run_audit.ts";
import { correlate, summarizeLinks } from "../src/domain/correlation.ts";
import { bpmWarnings } from "../src/domain/bpm_warnings.ts";
import type { Activity, ProcessInstance } from "../src/domain/model.ts";
import { assert, assertEquals } from "./assert.ts";
import { memorySources } from "./memory_sources.ts";
import { at, config, HOUR, order, so, T0 } from "./rules_fixture.ts";

const proc = (id: string, extra: Partial<ProcessInstance> = {}): ProcessInstance => ({
  processId: id,
  soRef: null,
  businessKey: null,
  state: "COMPLETED",
  startedAt: at(T0),
  endedAt: at(T0 + HOUR),
  ...extra,
});

const base = {
  orders: [order("O1"), order("O2")],
  serviceOrders: [so("S1", "O1"), so("S2", "O2")],
  attempts: [],
};

Deno.test("a child process is counted once, under the order of its root", () => {
  const result = correlate({
    ...base,
    processes: [
      proc("P1", { soRef: "S1" }),
      // No reference of its own: it used to be an orphan.
      proc("P2", { parentProcessId: "P1", rootProcessId: "P1" }),
      // Its own reference agrees with the root: it stays explicit.
      proc("P3", { soRef: "S1", parentProcessId: "P1", rootProcessId: "P1" }),
      // A grandchild finds the root through its parent.
      proc("P4", { parentProcessId: "P2" }),
      // Its own reference disagrees: the root wins and the link says so.
      proc("P5", { soRef: "S2", parentProcessId: "P1", rootProcessId: "P1" }),
    ],
  });
  const o1 = result.orders.find((e) => e.order.orderRef === "O1")!;
  assertEquals(o1.processes.map((l) => l.item.processId), ["P1", "P2", "P3", "P4", "P5"]);
  assertEquals(result.orders.find((e) => e.order.orderRef === "O2")!.processes.length, 0);
  assertEquals(result.unresolved.processes.length, 0);
  const total = result.orders.reduce((n, e) => n + e.processes.length, 0);
  assertEquals(total, 5, "each process appears under exactly one order");
  const byId = new Map(o1.processes.map((l) => [l.item.processId, l.link]));
  assertEquals(byId.get("P3")!.confidence, "explicit");
  assertEquals(byId.get("P2")!.confidence, "inferred");
  assert(byId.get("P2")!.basis.includes("child of process P1"));
  assert(byId.get("P5")!.basis.includes("its own reference was"));
  assertEquals(summarizeLinks(result.links)["process->service_order"].missing, 0);
});

Deno.test("a child whose root is missing from the data keeps its own link", () => {
  const result = correlate({
    ...base,
    processes: [proc("P9", { soRef: "S2", parentProcessId: "GONE" })],
  });
  assertEquals(result.orders.find((e) => e.order.orderRef === "O2")!.processes.length, 1);
});

Deno.test("loops and event subprocesses are named in a warning, plain data in none", () => {
  const event: Activity = {
    processId: "P2",
    sequence: 1,
    kind: "task",
    name: "on_error",
    actor: "system",
    startedAt: at(T0),
    endedAt: at(T0 + HOUR),
    eventSubprocess: true,
  };
  assertEquals(bpmWarnings([proc("P1")]), []);
  const warnings = bpmWarnings([proc("P1", { loopIndex: 2 }), proc("P2", { activities: [event] })]);
  assertEquals(warnings.length, 2);
  assert(warnings[0].includes("loop index") && warnings[0].includes("P1"));
  assert(warnings[1].includes("event subprocess") && warnings[1].includes("P2"));
});

Deno.test("the audit prints the warning and the journey shows queue and work segments", async () => {
  const task: Activity = {
    processId: "P1",
    sequence: 1,
    kind: "task",
    name: "capacity_check",
    actor: "human",
    startedAt: at(T0 + HOUR),
    claimedAt: at(T0 + 3 * HOUR),
    endedAt: at(T0 + 5 * HOUR),
  };
  const lines: string[] = [];
  const result = await runAudit({}, {
    clock: { nowIso: () => "2026-09-01T00:00:00Z" },
    sources: memorySources({
      orders: [order("O1")],
      serviceOrders: [so("S1", "O1")],
      attempts: [{
        attemptId: "A1",
        soRef: "S1",
        serial: "SN-1",
        state: "failed",
        errorCode: "HUB_TIMEOUT",
        startedAt: at(T0 + 6 * HOUR),
        endedAt: at(T0 + 6 * HOUR + 30_000),
      }],
      processes: [proc("P1", { soRef: "S1", loopIndex: 1, activities: [task] })],
    }),
    config,
    onProgress: (m) => lines.push(m),
  });
  assert(lines.some((l) => l.startsWith("warning:") && l.includes("loop index")), lines.join("\n"));
  assertEquals(result.warnings.length, 1);
  const journey = result.journeys.find((j) => j.orderRef === "O1")!;
  const kinds = journey.segments.map((s) => `${s.kind}:${s.state}`);
  assert(kinds.includes("queue:capacity_check"), kinds.join(" "));
  assert(kinds.includes("work:capacity_check"), kinds.join(" "));
});
