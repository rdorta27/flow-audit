// SPDX-License-Identifier: MIT
/**
 * Correlation and segments (M2-02, M2-03, M2-04).
 *
 * Small hand-built cases pin each confidence level and each way a join can go wrong
 * (orphans, conflicting references, duplicate ids); the synthetic dataset and the TMF stub
 * then check the same code at full size.
 */

import { Tmf622ProductOrderSource } from "../src/adapters/ingest/tmf622_source.ts";
import { Tmf640ServiceActivationSource } from "../src/adapters/ingest/tmf640_source.ts";
import { Tmf641ServiceOrderSource } from "../src/adapters/ingest/tmf641_source.ts";
import {
  mapActivation,
  mapProductOrder,
  mapServiceOrder,
} from "../src/adapters/ingest/tmf_mapping.ts";
import { EXPECTED, generateDemoDataset } from "../src/dataset/generator.ts";
import {
  correlate,
  type CorrelationInput,
  type Link,
  summarizeLinks,
  toJourneys,
} from "../src/domain/correlation.ts";
import type { Order, ProvisioningAttempt, ServiceOrder } from "../src/domain/model.ts";
import { classifySegments, journeysWithSegments } from "../src/domain/segments.ts";
import type { RawRecord } from "../src/ports/evidence_source.ts";
import { loadStubDataset } from "../src/stub/dataset.ts";
import { buildStubState } from "../src/stub/mapping.ts";
import { createHandler } from "../src/stub/router.ts";
import { assert, assertEquals } from "./assert.ts";

const T0 = "2026-09-01T00:00:00.000Z";

const order = (ref: string, extra: Partial<Order> = {}): Order => ({
  orderRef: ref,
  submittedAt: T0,
  state: "ACTIVE",
  offerId: "OFFER",
  offerVersion: "v1",
  ...extra,
});

const so = (ref: string, orderRef: string, extra: Partial<ServiceOrder> = {}): ServiceOrder => ({
  soRef: ref,
  orderRef,
  specId: "SPEC",
  state: "ACTIVE",
  createdAt: T0,
  ...extra,
});

const attempt = (
  id: string,
  soRef: string | null,
  extra: Partial<ProvisioningAttempt> = {},
): ProvisioningAttempt => ({
  attemptId: id,
  soRef,
  serial: "",
  state: "succeeded",
  errorCode: null,
  startedAt: T0,
  endedAt: "2026-09-01T00:01:00.000Z",
  ...extra,
});

function only(links: Link[], fromId: string): Link {
  const found = links.filter((l) => l.fromId === fromId);
  assertEquals(found.length, 1, `expected one link from ${fromId}`);
  return found[0];
}

Deno.test("a record that names its parent is explicit, and the journey is strong", () => {
  const result = correlate({
    orders: [order("ORD-1")],
    serviceOrders: [so("SO-1", "ORD-1")],
    processes: [{
      processId: "BPM-1",
      soRef: "SO-1",
      businessKey: "ORD-1",
      state: "COMPLETED",
      startedAt: T0,
      endedAt: null,
    }],
    attempts: [attempt("ACT-1", "SO-1")],
  });
  assertEquals(result.links.map((l) => l.confidence), [
    "explicit",
    "explicit",
    "explicit",
  ]);
  const [journey] = result.orders;
  assertEquals(
    [journey.serviceOrders.length, journey.processes.length, journey.attempts.length],
    [1, 1, 1],
  );
  assertEquals(toJourneys(result)[0].correlation, { strong: true, gaps: [] });
});

Deno.test("orphans: a service order with no reference, or pointing at nothing, is missing", () => {
  const result = correlate({
    orders: [order("ORD-1")],
    serviceOrders: [so("SO-A", ""), so("SO-B", "ORD-404")],
    attempts: [attempt("ACT-1", "SO-404")],
  });
  assertEquals(only(result.links, "SO-A").confidence, "missing");
  assertEquals(only(result.links, "SO-B").confidence, "missing");
  assert(only(result.links, "SO-B").basis.includes("ORD-404"));
  assertEquals(only(result.links, "ACT-1").confidence, "missing");
  // Nothing was placed under ORD-1, and the orphans are kept, not dropped.
  assertEquals(result.orders[0].serviceOrders.length, 0);
  assertEquals(result.unresolved.serviceOrders.map((l) => l.item.soRef), ["SO-A", "SO-B"]);
  assertEquals(result.unresolved.attempts.length, 1);
});

Deno.test("an order line the service order points at is enough when orderRef is absent", () => {
  const result = correlate({
    orders: [order("ORD-1", { itemRefs: ["ORD-1-1"] })],
    serviceOrders: [so("SO-1", "", { productOrderItemRef: "ORD-1-1" })],
    attempts: [],
  });
  const link = only(result.links, "SO-1");
  assertEquals([link.confidence, link.toId], ["explicit", "ORD-1"]);
  assert(link.basis.includes("ORD-1-1"));
});

Deno.test("conflicting: orderRef and the order line disagree", () => {
  const result = correlate({
    orders: [order("ORD-1", { itemRefs: ["ORD-1-1"] }), order("ORD-2", { itemRefs: ["ORD-2-1"] })],
    serviceOrders: [so("SO-1", "ORD-2", { productOrderItemRef: "ORD-1-1" })],
    attempts: [],
  });
  const link = only(result.links, "SO-1");
  assertEquals([link.confidence, link.toId], ["conflicting", null]);
  assertEquals(link.candidates, ["ORD-2", "ORD-1"]);
  assertEquals(result.unresolved.serviceOrders.length, 1);
});

Deno.test("conflicting: an attempt's terminal contradicts its service order", () => {
  const result = correlate({
    orders: [order("ORD-1")],
    serviceOrders: [so("SO-1", "ORD-1", { terminalSerial: "SN-1" })],
    attempts: [attempt("ACT-1", "SO-1", { serial: "SN-9" })],
  });
  assertEquals(only(result.links, "ACT-1").confidence, "conflicting");
});

Deno.test("conflicting: a process's business key contradicts its service order", () => {
  const result = correlate({
    orders: [order("ORD-1"), order("ORD-2")],
    serviceOrders: [so("SO-1", "ORD-1")],
    processes: [{
      processId: "BPM-1",
      soRef: "SO-1",
      businessKey: "ORD-2",
      state: "COMPLETED",
      startedAt: T0,
      endedAt: null,
    }],
    attempts: [],
  });
  assertEquals(only(result.links, "BPM-1").confidence, "conflicting");
});

Deno.test("duplicate ids are reported and make every link that points at them ambiguous", () => {
  const result = correlate({
    orders: [order("ORD-1"), order("ORD-1"), order("ORD-2")],
    serviceOrders: [so("SO-1", "ORD-1"), so("SO-2", "ORD-2"), so("SO-2", "ORD-2")],
    attempts: [attempt("ACT-1", "SO-2")],
  });
  assertEquals(result.duplicateIds, [
    { entity: "order", id: "ORD-1", count: 2 },
    { entity: "service_order", id: "SO-2", count: 2 },
  ]);
  assertEquals(only(result.links, "SO-1").confidence, "ambiguous");
  assertEquals(only(result.links, "ACT-1").confidence, "ambiguous");
  // ORD-1 is ambiguous, so it has no journey of its own; ORD-2 does, with nothing attached.
  assertEquals(result.orders.map((o) => o.order.orderRef), ["ORD-2"]);
  assertEquals(result.orders[0].attempts.length, 0);
});

Deno.test("an attempt with no service order is placed by terminal serial, never silently", () => {
  const result = correlate({
    orders: [order("ORD-1"), order("ORD-2"), order("ORD-3")],
    serviceOrders: [
      so("SO-1", "ORD-1", { terminalSerial: "SN-1" }),
      so("SO-2", "ORD-2", { terminalSerial: "SN-2" }),
      so("SO-3", "ORD-3", { terminalSerial: "SN-2" }),
    ],
    attempts: [
      attempt("ACT-ONE", null, { serial: "SN-1" }),
      attempt("ACT-TWO", null, { serial: "SN-2" }),
      attempt("ACT-NONE", null, { serial: "SN-404" }),
      attempt("ACT-BLANK", null, { serial: "" }),
    ],
  });
  const one = only(result.links, "ACT-ONE");
  assertEquals([one.confidence, one.toId], ["inferred", "SO-1"]);
  const two = only(result.links, "ACT-TWO");
  assertEquals([two.confidence, two.toId, two.candidates], ["ambiguous", null, ["SO-2", "SO-3"]]);
  assertEquals(only(result.links, "ACT-NONE").confidence, "missing");
  assertEquals(only(result.links, "ACT-BLANK").confidence, "missing");

  // The inferred one is placed, and the journey says it is not strong and why.
  const journey = toJourneys(result).find((j) => j.orderRef === "ORD-1")!;
  assertEquals(journey.correlation.strong, false);
  assert(
    journey.correlation.gaps[0].includes("ACT-ONE") &&
      journey.correlation.gaps[0].includes("inferred"),
  );
  assertEquals(result.unresolved.attempts.map((l) => l.item.attemptId), [
    "ACT-BLANK",
    "ACT-NONE",
    "ACT-TWO",
  ]);
});

Deno.test("a process with only a business key is inferred; with nothing, missing", () => {
  const process = (id: string, soRef: string | null, businessKey: string | null) => ({
    processId: id,
    soRef,
    businessKey,
    state: "COMPLETED",
    startedAt: T0,
    endedAt: null,
  });
  const result = correlate({
    orders: [order("ORD-1")],
    serviceOrders: [],
    processes: [process("BPM-KEY", null, "ORD-1"), process("BPM-NONE", null, null)],
    attempts: [],
  });
  const key = only(result.links, "BPM-KEY");
  assertEquals([key.kind, key.confidence, key.toId], ["process->order", "inferred", "ORD-1"]);
  assertEquals(only(result.links, "BPM-NONE").confidence, "missing");
  assertEquals(result.orders[0].processes.length, 1);
});

Deno.test("the result does not depend on the order the records arrive in", () => {
  const data = generateDemoDataset();
  const input = (reverse: boolean): CorrelationInput => {
    const pick = <T>(list: T[]) => (reverse ? [...list].reverse() : list);
    return {
      orders: pick(data.orders),
      serviceOrders: pick(data.serviceOrders),
      processes: pick(data.processes),
      attempts: pick(data.attempts),
    };
  };
  assertEquals(
    JSON.stringify(correlate(input(false))),
    JSON.stringify(correlate(input(true))),
  );
});

Deno.test("on the synthetic dataset, only the 300 weak attempts are not explicit", () => {
  const data = generateDemoDataset();
  const result = correlate({
    orders: data.orders,
    serviceOrders: data.serviceOrders,
    processes: data.processes,
    attempts: data.attempts,
  });
  const summary = summarizeLinks(result.links);
  assertEquals(summary["service_order->order"].explicit, EXPECTED.service_orders);
  assertEquals(summary["process->service_order"].explicit, EXPECTED.processes);

  const attempts = summary["attempt->service_order"];
  assertEquals(attempts.explicit, EXPECTED.attempts - 300);
  assertEquals(attempts.inferred + attempts.ambiguous + attempts.missing, 300);
  assert(attempts.inferred > 0, "the terminal serial should place most weak attempts");
  assertEquals(attempts.conflicting, 0);
  assertEquals(result.duplicateIds, []);

  const gaps = toJourneys(result).filter((j) => !j.correlation.strong).length;
  assert(gaps > 0 && gaps <= 300, `journeys with gaps: ${gaps}`);
});

// Against the TMF stub, through the mapper ----------------------------------------

async function collect(source: { read(): AsyncIterable<RawRecord> }): Promise<RawRecord[]> {
  const rows: RawRecord[] = [];
  for await (const row of source.read()) rows.push(row);
  return rows;
}

Deno.test("read from the TMF stub, all service orders are explicit and 300 attempts have no link", async () => {
  const data = await loadStubDataset(new URL("../data/demo/", import.meta.url));
  const handle = createHandler({
    state: buildStubState(data.catalog, data.orders, data.serviceOrders, data.attempts),
  });
  const config = {
    baseUrl: "http://127.0.0.1:8081",
    fetch:
      ((input: string | URL | Request, init?: RequestInit) =>
        handle(new Request(String(input), init))) as typeof fetch,
  };
  const orders = (await collect(new Tmf622ProductOrderSource(config))).map(mapProductOrder);
  const serviceOrders = (await collect(new Tmf641ServiceOrderSource(config))).map(mapServiceOrder);
  const attempts = (await collect(new Tmf640ServiceActivationSource(config))).map(mapActivation);

  const result = correlate({ orders, serviceOrders, attempts });
  const summary = summarizeLinks(result.links);
  assertEquals(summary["service_order->order"].explicit, EXPECTED.service_orders);
  assertEquals(summary["attempt->service_order"].explicit, EXPECTED.attempts - 300);
  // The API carries no terminal serial, so nothing can be inferred: the gap stays visible.
  assertEquals(summary["attempt->service_order"].missing, 300);

  // The 20 duplicated orders show up as 20 journeys with two service orders (one has three).
  const twoOrders = result.orders.filter((o) => o.serviceOrders.length >= 2).length;
  assertEquals(twoOrders, 20);
  assertEquals(result.unmapped, []);

  // Everything read from an API is a snapshot, so there are no segments, and it says why.
  const journeys = journeysWithSegments(result, []);
  assertEquals(journeys[0].segments, []);
  assert(journeys[0].segmentsUnavailable?.includes("snapshot"));
});

// Mapper ----------------------------------------------------------------------------

function raw(system: "OMS" | "PROV", id: string, value: Record<string, unknown>): RawRecord {
  return {
    system,
    source: "x",
    line: 1,
    value,
    provenance: {
      externalId: id,
      endpoint: "http://x/y",
      retrievedAt: T0,
      simulated: true,
      kind: "snapshot",
    },
  };
}

Deno.test("the mapper translates TMF states, keeps provenance and the source state", () => {
  const base = {
    orderDate: T0,
    productOrderItem: [{ id: "I-1", productOffering: { id: "OFFER-1" } }],
  };
  const mapped = mapProductOrder(raw("OMS", "ORD-1", { ...base, state: "COMPLETED" }));
  assertEquals([mapped.state, mapped.itemRefs, mapped.offerId], ["ACTIVE", ["I-1"], "OFFER-1"]);
  assertEquals([mapped.rawState, mapped.provenance?.kind], ["COMPLETED", "snapshot"]);
  assertEquals(
    mapProductOrder(raw("OMS", "ORD-2", { ...base, state: "IN_PROGRESS" })).state,
    "PROVISIONING",
  );
});

Deno.test("every TMF622 and TMF641 state maps, in either spelling, and REJECTED is not FAILED", () => {
  const base = { orderDate: T0, productOrderItem: [{ id: "I-1" }] };
  const expected: Record<string, string> = {
    acknowledged: "SUBMITTED",
    pending: "SUBMITTED",
    held: "HELD",
    inProgress: "PROVISIONING",
    IN_PROGRESS: "PROVISIONING",
    partial: "PARTIAL",
    assessingCancellation: "CANCELLING",
    pendingCancellation: "CANCELLING",
    completed: "ACTIVE",
    failed: "FAILED",
    rejected: "REJECTED",
    cancelled: "CANCELLED",
  };
  for (const [tmf, canonical] of Object.entries(expected)) {
    const mapped = mapProductOrder(raw("OMS", "ORD-S", { ...base, state: tmf }));
    assertEquals([mapped.state, mapped.rawState], [canonical, tmf], tmf);
  }
});

Deno.test("an unknown state is read, kept, counted by system and state, and ignored by R04", () => {
  const base = { orderDate: T0, productOrderItem: [{ id: "I-1" }] };
  const mappedOrder = mapProductOrder(raw("OMS", "ORD-U", { ...base, state: "FALLOUT" }));
  assertEquals([mappedOrder.state, mappedOrder.rawState], ["UNMAPPED", "FALLOUT"]);

  const service = (id: string, state: string) =>
    mapServiceOrder(raw("OMS", id, {
      state,
      orderDate: T0,
      serviceOrderItem: [{ productOrderItem: { id: "I-1", productOrderId: "ORD-U" } }],
    }));
  const live = service("SO-1", "COMPLETED");
  const odd = service("SO-2", "SUSPENDED");
  const odd2 = service("SO-3", "SUSPENDED");
  const activation = mapActivation(raw("PROV", "ACT-1", { state: "ON_HOLD", activationDate: T0 }));
  assertEquals([odd.state, odd.rawState], ["UNMAPPED", "SUSPENDED"]);
  assertEquals([activation.state, activation.rawState], ["unmapped", "ON_HOLD"]);

  const result = correlate({
    orders: [{ ...mappedOrder, itemRefs: ["I-1"] }],
    serviceOrders: [live, odd, odd2],
    attempts: [activation],
  });
  assertEquals(result.unmapped, [
    { system: "OMS", state: "FALLOUT", count: 1 },
    { system: "OMS", state: "SUSPENDED", count: 2 },
    { system: "PROV", state: "ON_HOLD", count: 1 },
  ]);
  const entry = result.orders[0];
  assertEquals(entry.serviceOrders.length, 3);
  assertEquals(entry.order.rawState, "FALLOUT");
  assertEquals(detectR04(result.orders, R04_CONFIG), null);
});

Deno.test("the mapper keeps an unlinked activation and rejects a service order over two product orders", () => {
  const unlinked = mapActivation(
    raw("PROV", "ACT-1", { state: "FAILED", activationDate: T0 }),
  );
  assertEquals([unlinked.soRef, unlinked.serial, unlinked.endedAt], [null, "", null]);

  let message = "";
  try {
    mapServiceOrder(raw("OMS", "SO-1", {
      state: "COMPLETED",
      orderDate: T0,
      serviceOrderItem: [
        { productOrderItem: { id: "A-1", productOrderId: "A" } },
        { productOrderItem: { id: "B-1", productOrderId: "B" } },
      ],
    }));
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes("different product orders"), message);
});

// Segments (M2-04) ------------------------------------------------------------------

Deno.test("segments: on the dataset, a duplicated order shows the 60 hours nobody was working", () => {
  const data = generateDemoDataset();
  const result = correlate({
    orders: data.orders,
    serviceOrders: data.serviceOrders,
    processes: data.processes,
    attempts: data.attempts,
  });
  const ref = data.defects.duplicates[0];
  const entry = result.orders.find((o) => o.order.orderRef === ref)!;
  const classified = classifySegments(entry, data.activities);
  assert(classified.ok);

  const { segments } = classified;
  // Contiguous from the moment the order was submitted, never overlapping.
  assertEquals(segments[0].from, entry.order.submittedAt);
  for (let i = 1; i < segments.length; i++) assertEquals(segments[i].from, segments[i - 1].to);

  const hours = (s: { from: string; to: string }) =>
    (Date.parse(s.to) - Date.parse(s.from)) / 3_600_000;
  const longestGap = Math.max(...segments.filter((s) => s.kind === "gap").map(hours));
  assert(longestGap > 59 && longestGap < 61, `longest gap was ${longestGap} h`);

  // The failed attempt, and the retry on the second service order, are both work.
  const provisioning = segments.filter((s) => s.system === "PROV" && s.kind === "work");
  assertEquals(provisioning.map((s) => s.state), ["failed", "succeeded"]);
  // The analyst's task is work done by a human, not a wait.
  const check = segments.find((s) => s.state === "capacity_check")!;
  assertEquals([check.kind, check.actor], ["work", "human"]);
});

Deno.test("segments: an expired timer is a wait, and a segment is never counted twice", () => {
  const data = generateDemoDataset();
  const result = correlate({
    orders: data.orders,
    serviceOrders: data.serviceOrders,
    processes: data.processes,
    attempts: data.attempts,
  });
  const entry = result.orders.find((o) => o.order.orderRef === data.defects.timers[0])!;
  const classified = classifySegments(entry, data.activities);
  assert(classified.ok);
  const waits = classified.segments.filter((s) => s.kind === "wait");
  assertEquals(waits.map((s) => s.state), ["timer_expired"]);
  assertEquals(waits[0].system, "BPM");
});

Deno.test("segments: overlapping records are clipped, and a record still running is reported open", () => {
  const entry = correlate({
    orders: [order("ORD-1")],
    serviceOrders: [so("SO-1", "ORD-1")],
    processes: [{
      processId: "BPM-1",
      soRef: "SO-1",
      businessKey: "ORD-1",
      state: "RUNNING",
      startedAt: T0,
      endedAt: null,
    }],
    attempts: [
      attempt("ACT-1", "SO-1", {
        startedAt: "2026-09-01T00:10:00.000Z",
        endedAt: "2026-09-01T00:30:00.000Z",
      }),
      attempt("ACT-2", "SO-1", {
        startedAt: "2026-09-01T00:20:00.000Z",
        endedAt: "2026-09-01T00:40:00.000Z",
      }),
      attempt("ACT-OPEN", "SO-1", {
        state: "pending",
        startedAt: "2026-09-01T01:00:00.000Z",
        endedAt: null,
      }),
    ],
  }).orders[0];
  const classified = classifySegments(entry, []);
  assert(classified.ok);
  assertEquals(
    classified.segments.map((s) => [s.kind, s.from.slice(11, 16), s.to.slice(11, 16)]),
    [["gap", "00:00", "00:10"], ["work", "00:10", "00:30"], ["work", "00:30", "00:40"]],
  );
  assertEquals(classified.open, ["ACT-OPEN"]);
});

Deno.test("segments: snapshot evidence is refused with a reason, never guessed", () => {
  const snapshot = {
    externalId: "ORD-1",
    endpoint: "http://api/productOrder",
    retrievedAt: T0,
    simulated: false,
    kind: "snapshot" as const,
  };
  const entry = correlate({
    orders: [order("ORD-1", { provenance: snapshot })],
    serviceOrders: [],
    attempts: [],
  }).orders[0];
  const classified = classifySegments(entry, []);
  assert(!classified.ok);
  assert(
    classified.reason.includes("snapshot") && classified.reason.includes("http://api/productOrder"),
  );
});

// R04 (M3-02) -----------------------------------------------------------------------

import { detectR04 } from "../src/domain/rules/r04.ts";

const R04_CONFIG = {
  currency: "USD" as const,
  ordersPerMonth: 5000,
  loadedHourUsd: 45,
  rates: {
    manualMinutes: 5,
    dailyFollowupMinutes: 15,
    cleanupMinutes: 90,
    investigationMinutes: 45,
    duplicateActivationCostUsd: 12,
    arpuUsd: 65,
  },
  thresholds: { retryWindowHours: 24, stuckAfterHours: 72, duplicateWindowMinutes: 10 },
};

Deno.test("R04 finds exactly the 20 duplicated orders on the stub, USD 1,590", async () => {
  const data = await loadStubDataset(new URL("../data/demo/", import.meta.url));
  const handle = createHandler({
    state: buildStubState(data.catalog, data.orders, data.serviceOrders, data.attempts),
  });
  const config = {
    baseUrl: "http://127.0.0.1:8081",
    fetch:
      ((input: string | URL | Request, init?: RequestInit) =>
        handle(new Request(String(input), init))) as typeof fetch,
  };
  const orders = (await collect(new Tmf622ProductOrderSource(config))).map(mapProductOrder);
  const serviceOrders = (await collect(new Tmf641ServiceOrderSource(config))).map(mapServiceOrder);
  const attempts = (await collect(new Tmf640ServiceActivationSource(config))).map(mapActivation);
  const result = correlate({ orders, serviceOrders, attempts });

  const finding = detectR04(result.orders, R04_CONFIG)!;
  assertEquals(finding.affectedOrders, EXPECTED.findings.R04.affected_orders);
  assertEquals(finding.evidence.length, 20);
  assertEquals(finding.cost.hoursMonth, 30);
  assertEquals(finding.cost.amountMonth, 1590);
  assertEquals(finding.severity, "medium");
});

Deno.test("R04 does not fire on a multi-line order or when the first order was cancelled", () => {
  const mk = (ref: string, item: string, state: ServiceOrder["state"] = "ACTIVE") =>
    so(ref, "O1", { productOrderItemRef: item, state });
  const run = (sos: ServiceOrder[]) =>
    detectR04(
      correlate({ orders: [order("O1")], serviceOrders: sos, attempts: [] }).orders,
      R04_CONFIG,
    );
  assertEquals(run([mk("S1", "i1"), mk("S2", "i2")]), null);
  assertEquals(run([mk("S1", "i1", "CANCELLED"), mk("S2", "i1")]), null);
  assertEquals(run([mk("S1", "i1"), mk("S2", "i1")])?.affectedOrders, 1);
});
