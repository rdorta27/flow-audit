// SPDX-License-Identifier: MIT
import {
  DUPLICATE_ORDERS,
  EXPECTED,
  FALLOUT_ORDERS,
  generateDemoDataset,
  IMPACT_CONFIG,
  MAINTENANCE_WINDOW,
  ORDERS,
  PERMANENT_ERROR_CODES,
  STUCK_ORDERS,
  TIMER_ORDERS,
  WEAK_LINK_ORDERS,
} from "../src/dataset/generator.ts";
import { configFromFile, configToFile } from "../src/domain/data_files.ts";
import { isTerminal } from "../src/domain/model.ts";
import { assert, assertEquals } from "./assert.ts";

const dataset = generateDemoDataset();
const datasetUrl = new URL("../data/demo/", import.meta.url);

Deno.test("generation is deterministic", () => {
  assertEquals(JSON.stringify(generateDemoDataset()), JSON.stringify(dataset));
});

Deno.test("counts match the golden numbers", () => {
  assertEquals(dataset.orders.length, EXPECTED.orders);
  assertEquals(dataset.serviceOrders.length, EXPECTED.service_orders);
  assertEquals(dataset.workOrders.length, EXPECTED.work_orders);
  assertEquals(dataset.processes.length, EXPECTED.processes);
  assertEquals(dataset.attempts.length, EXPECTED.attempts);

  const byState = (state: string) => dataset.attempts.filter((a) => a.state === state).length;
  assertEquals(byState("failed"), EXPECTED.attempts_by_state.failed);
  assertEquals(byState("pending"), EXPECTED.attempts_by_state.pending);
  assertEquals(byState("succeeded"), EXPECTED.attempts_by_state.succeeded);
});

Deno.test("every service order belongs to exactly one order", () => {
  const orderRefs = new Set(dataset.orders.map((order) => order.orderRef));
  for (const serviceOrder of dataset.serviceOrders) {
    assert(
      orderRefs.has(serviceOrder.orderRef),
      `${serviceOrder.soRef} points to unknown order ${serviceOrder.orderRef}`,
    );
  }
});

Deno.test("every work order belongs to one service order", () => {
  const soRefs = new Set(dataset.serviceOrders.map((serviceOrder) => serviceOrder.soRef));
  for (const workOrder of dataset.workOrders) {
    assert(soRefs.has(workOrder.soRef), `${workOrder.woRef} points to unknown ${workOrder.soRef}`);
  }
});

Deno.test("every process maps to one service order", () => {
  const soRefs = new Set(dataset.serviceOrders.map((serviceOrder) => serviceOrder.soRef));
  for (const process of dataset.processes) {
    assert(process.soRef !== null, `${process.processId} has no service order`);
    assert(soRefs.has(process.soRef), `${process.processId} points to unknown ${process.soRef}`);
  }
});

Deno.test("every attempt carries a serial and links to a known service order", () => {
  const soRefs = new Set(dataset.serviceOrders.map((serviceOrder) => serviceOrder.soRef));
  for (const attempt of dataset.attempts) {
    assert(attempt.serial.length > 0, `${attempt.attemptId} has no serial`);
    if (attempt.soRef !== null) {
      assert(soRefs.has(attempt.soRef), `${attempt.attemptId} points to unknown ${attempt.soRef}`);
    }
  }
});

Deno.test("timestamps are ordered inside every entity", () => {
  const ordersByRef = new Map(dataset.orders.map((order) => [order.orderRef, order]));
  const serviceOrdersByRef = new Map(
    dataset.serviceOrders.map((serviceOrder) => [serviceOrder.soRef, serviceOrder]),
  );

  for (const serviceOrder of dataset.serviceOrders) {
    const order = ordersByRef.get(serviceOrder.orderRef)!;
    assert(
      serviceOrder.createdAt >= order.submittedAt,
      `${serviceOrder.soRef} created before its order`,
    );
  }

  for (const workOrder of dataset.workOrders) {
    const serviceOrder = serviceOrdersByRef.get(workOrder.soRef)!;
    assert(
      workOrder.createdAt >= serviceOrder.createdAt,
      `${workOrder.woRef} created before its service order`,
    );
  }

  for (const process of dataset.processes) {
    assert(
      process.startedAt <= (process.endedAt ?? process.startedAt),
      `${process.processId} ends before`,
    );
  }

  for (const attempt of dataset.attempts) {
    assert(
      attempt.startedAt <= (attempt.endedAt ?? attempt.startedAt),
      `${attempt.attemptId} ends before it starts`,
    );
  }

  for (const activity of dataset.activities) {
    assert(
      activity.startedAt <= (activity.endedAt ?? activity.startedAt),
      `${activity.processId}#${activity.sequence} ends before it starts`,
    );
  }
});

Deno.test("every order is terminal or deliberately open", () => {
  const open = dataset.orders.filter((order) => !isTerminal(order.state));
  const planned = new Set([
    ...dataset.defects.stuck,
    ...dataset.defects.legit.longRunning,
    ...dataset.defects.legit.suspended,
    ...dataset.defects.legit.falloutQueue,
  ]);
  assertEquals(open.length, planned.size);
  assertEquals(
    planned.size,
    STUCK_ORDERS + EXPECTED.cases.long_running_orders + EXPECTED.cases.suspended_orders +
      EXPECTED.cases.fallout_queue_orders,
  );
  for (const order of open) {
    assert(order.state === "PROVISIONING", `${order.orderRef} is open in an unexpected state`);
    assert(planned.has(order.orderRef), `${order.orderRef} is not a planned open order`);
  }
});

Deno.test("offer versions do not overlap", () => {
  for (const offer of dataset.catalog.offers) {
    const versions = [...offer.versions].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    for (let index = 1; index < versions.length; index++) {
      const previous = versions[index - 1];
      const current = versions[index];
      assert(
        previous.validTo === null || previous.validTo <= current.validFrom,
        `${offer.offerId} has overlapping versions`,
      );
    }
  }
});

Deno.test("the first versions miss the capacity attribute; v2 adds it from mid-month", () => {
  const specOf = (specId: string) => dataset.catalog.specs.find((spec) => spec.specId === specId)!;
  const has = (specId: string) =>
    specOf(specId).attributes.some((attribute) => attribute.name === "capacity_profile");

  for (const offer of dataset.catalog.offers) {
    const [first, ...later] = offer.versions;
    assert(
      !has(first.specId),
      `${offer.offerId} ${first.version} must not define capacity_profile`,
    );
    for (const version of later) {
      assert(has(version.specId), `${offer.offerId} ${version.version} adds capacity_profile`);
    }
  }
  const offer200 = dataset.catalog.offers.find((o) => o.offerId === "OFFER-SKYHOME-200")!;
  assertEquals(offer200.versions.map((v) => v.version), ["v1", "v2"]);
  assertEquals(offer200.versions[1].validFrom, EXPECTED.cases.offer_v2_valid_from);

  const v2 = dataset.orders.filter((order) => order.offerVersion === "v2");
  assertEquals(v2.length, EXPECTED.cases.offer_v2_orders);
  for (const order of v2) {
    assert(order.submittedAt >= offer200.versions[1].validFrom, `${order.orderRef} before v2`);
  }
  for (const order of dataset.orders.filter((o) => o.offerId === "OFFER-SKYHOME-200")) {
    const live = order.submittedAt >= offer200.versions[1].validFrom ? "v2" : "v1";
    assertEquals(order.offerVersion, live, order.orderRef);
  }
});

Deno.test("R02 is a subset: only orders on the first version have a human capacity check", () => {
  const checks = dataset.activities.filter((activity) => activity.name === "capacity_check");
  assertEquals(checks.length, ORDERS, "every order has one capacity check");
  const human = checks.filter((activity) => activity.actor === "human");
  assertEquals(human.length, EXPECTED.findings.R02.affected_orders);
  assertEquals(human.length / ORDERS, EXPECTED.findings.R02.share_of_orders);
});

Deno.test("defect cohorts have the documented size", () => {
  assertEquals(dataset.defects.fallout.length, FALLOUT_ORDERS);
  assertEquals(dataset.defects.timers.length, TIMER_ORDERS);
  assertEquals(dataset.defects.stuck.length, STUCK_ORDERS);
  assertEquals(dataset.defects.duplicates.length, DUPLICATE_ORDERS);
  assertEquals(dataset.defects.weakLinks.length, WEAK_LINK_ORDERS);
});

Deno.test("R01: failed attempts wait longer than the retry window", () => {
  const soRefsByOrder = new Map<string, string[]>();
  for (const serviceOrder of dataset.serviceOrders) {
    const list = soRefsByOrder.get(serviceOrder.orderRef) ?? [];
    list.push(serviceOrder.soRef);
    soRefsByOrder.set(serviceOrder.orderRef, list);
  }
  const failedRefs = new Set(
    dataset.attempts.filter((attempt) => attempt.state === "failed").map((attempt) =>
      attempt.soRef
    ),
  );

  assertEquals(failedRefs.size, EXPECTED.attempts_by_state.failed);

  for (const orderRef of dataset.defects.fallout) {
    const refs = soRefsByOrder.get(orderRef)!;
    assert(
      refs.some((soRef) => failedRefs.has(soRef)),
      `${orderRef} has no failed attempt`,
    );
  }

  // The legitimate failures are not in the planted cohort.
  const planted = new Set(dataset.defects.fallout);
  for (
    const orderRef of [
      ...dataset.defects.legit.permanentErrors,
      ...dataset.defects.legit.maintenanceFailures,
      ...dataset.defects.legit.falloutQueue,
    ]
  ) {
    assert(!planted.has(orderRef), `${orderRef} is both planted fallout and legitimate`);
  }
});

Deno.test("R03: timers expire and some orders never recover", () => {
  const expired = dataset.activities.filter((activity) => activity.timerExpired === true);
  assertEquals(expired.length, TIMER_ORDERS);

  const running = dataset.processes.filter((process) => process.state === "RUNNING");
  assertEquals(
    running.length,
    STUCK_ORDERS + EXPECTED.cases.long_running_orders + EXPECTED.cases.fallout_queue_orders,
  );
  for (const process of running) {
    assert(process.endedAt === null, `${process.processId} is running but has an end`);
  }
});

Deno.test("legitimate cases have the documented size", () => {
  const legit = dataset.defects.legit;
  assertEquals(legit.normalTimers.length, EXPECTED.cases.normal_timer_orders);
  assertEquals(legit.longRunning.length, EXPECTED.cases.long_running_orders);
  assertEquals(legit.suspended.length, EXPECTED.cases.suspended_orders);
  assertEquals(legit.falloutQueue.length, EXPECTED.cases.fallout_queue_orders);
  assertEquals(legit.offerV2.length, EXPECTED.cases.offer_v2_orders);
  assertEquals(legit.permanentErrors.length, EXPECTED.cases.permanent_error_orders);
  assertEquals(legit.maintenanceFailures.length, EXPECTED.cases.maintenance_failure_orders);
  assertEquals(legit.replaced.length, EXPECTED.cases.replaced_orders);
  assertEquals(legit.replacing.length, EXPECTED.cases.replaced_orders);
  assertEquals(
    legit.threeServiceOrderDuplicates.length,
    EXPECTED.cases.three_service_order_duplicates,
  );
  assertEquals(legit.reusedSerials.length, EXPECTED.cases.reused_serial_orders);
});

Deno.test("normal timers wait and end on their own; they are not R03", () => {
  const normal = new Set(dataset.defects.legit.normalTimers);
  const timers = dataset.activities.filter((a) => a.kind === "timer" && a.timerExpired !== true);
  assertEquals(timers.length, EXPECTED.cases.normal_timer_orders);
  for (const timer of timers) {
    assert(timer.endedAt !== null, `${timer.processId} timer never ended`);
    assert(
      normal.has(`ORD-${1000 + Number(timer.processId.slice(4)) - 50000}`),
      `${timer.processId} is not a planned normal timer`,
    );
  }
});

Deno.test("healthy open work: running under the stuck threshold, one suspended, one in a queue", () => {
  const end = Date.parse(dataset.meta.windowEnd);
  const byBusinessKey = new Map(dataset.processes.map((p) => [p.businessKey, p]));
  for (const orderRef of dataset.defects.legit.longRunning) {
    const process = byBusinessKey.get(orderRef)!;
    assertEquals(process.state, "RUNNING");
    const hours = (end - Date.parse(process.startedAt)) / 3_600_000;
    assert(hours > 24 && hours < IMPACT_CONFIG.thresholds.stuckAfterHours, `${orderRef}: ${hours}`);
  }
  assertEquals(byBusinessKey.get(dataset.defects.legit.suspended[0])!.state, "SUSPENDED");
  const queued = byBusinessKey.get(dataset.defects.legit.falloutQueue[0])!;
  const waiting = dataset.activities.filter((a) =>
    a.processId === queued.processId && a.name === "fallout_review"
  );
  assertEquals(waiting.map((a) => [a.actor, a.endedAt]), [["human", null]]);
});

Deno.test("permanent errors and maintenance failures are failures R01 must not treat as fallout", () => {
  const attemptsOf = (orderRef: string) => {
    const soRefs = new Set(
      dataset.serviceOrders.filter((so) => so.orderRef === orderRef).map((so) => so.soRef),
    );
    return dataset.attempts.filter((a) => a.soRef !== null && soRefs.has(a.soRef));
  };
  for (const orderRef of dataset.defects.legit.permanentErrors) {
    const [only] = attemptsOf(orderRef);
    assertEquals(attemptsOf(orderRef).length, 1, `${orderRef} is never retried`);
    assertEquals(only.state, "failed");
    assert(PERMANENT_ERROR_CODES.includes(only.errorCode!), `${orderRef}: ${only.errorCode}`);
  }
  for (const orderRef of dataset.defects.legit.maintenanceFailures) {
    const [failed, retry] = attemptsOf(orderRef);
    assertEquals([failed.state, failed.errorCode, retry.state], [
      "failed",
      "HUB_TIMEOUT",
      "succeeded",
    ]);
    assert(
      failed.startedAt >= MAINTENANCE_WINDOW.from && failed.startedAt < MAINTENANCE_WINDOW.to,
      `${orderRef} failed outside the window`,
    );
    const hours = (Date.parse(retry.startedAt) - Date.parse(failed.startedAt)) / 3_600_000;
    assert(
      hours < IMPACT_CONFIG.thresholds.retryWindowHours,
      `${orderRef} retried after ${hours} h`,
    );
  }
});

Deno.test("amendments: a replaced order is cancelled and its replacement names it", () => {
  const byRef = new Map(dataset.orders.map((o) => [o.orderRef, o]));
  const replacing = dataset.orders.filter((o) => o.replacesOrderRef !== undefined);
  assertEquals(replacing.length, EXPECTED.cases.replaced_orders);
  for (const order of replacing) {
    const old = byRef.get(order.replacesOrderRef!)!;
    assertEquals(old.state, "CANCELLED");
    assert(old.submittedAt < order.submittedAt, `${order.orderRef} replaces a later order`);
    const sos = dataset.serviceOrders.filter((so) => so.orderRef === old.orderRef);
    assertEquals(sos.map((so) => so.state), ["CANCELLED"]);
    assertEquals(order.state, "ACTIVE");
  }
});

Deno.test("one planted duplicate has three service orders; a reused serial sits on two orders", () => {
  const sos = dataset.serviceOrders.filter((so) =>
    so.orderRef === dataset.defects.legit.threeServiceOrderDuplicates[0]
  );
  assertEquals(sos.length, 3);

  const owners = new Map<string, Set<string>>();
  for (const so of dataset.serviceOrders) {
    const set = owners.get(so.terminalSerial!) ?? new Set<string>();
    set.add(so.orderRef);
    owners.set(so.terminalSerial!, set);
  }
  const shared = [...owners.values()].filter((set) => set.size > 1);
  assertEquals(shared.length, EXPECTED.cases.reused_serial_orders);
});

Deno.test("R04: duplicates are two service orders for the same offer", () => {
  const byOrder = new Map<string, number>();
  for (const serviceOrder of dataset.serviceOrders) {
    byOrder.set(serviceOrder.orderRef, (byOrder.get(serviceOrder.orderRef) ?? 0) + 1);
  }
  const duplicated = [...byOrder.entries()].filter(([, count]) => count > 1);
  assertEquals(duplicated.length, DUPLICATE_ORDERS);

  for (const [orderRef] of duplicated) {
    const specs = dataset.serviceOrders
      .filter((serviceOrder) => serviceOrder.orderRef === orderRef)
      .map((serviceOrder) => serviceOrder.specId);
    assertEquals(new Set(specs).size, 1, `${orderRef} duplicates across different specs`);
  }
});

Deno.test("R05: weak links carry only the serial", () => {
  const weak = dataset.attempts.filter((attempt) => attempt.soRef === null);
  assertEquals(weak.length, WEAK_LINK_ORDERS);

  const serials = new Map(
    dataset.serviceOrders.map((
      serviceOrder,
    ) => [serviceOrder.terminalSerial, serviceOrder.orderRef]),
  );
  for (const attempt of weak) {
    assert(
      serials.has(attempt.serial),
      `${attempt.attemptId} cannot be resolved even by serial`,
    );
  }
});

Deno.test("no record is lost between entities before ingestion", () => {
  const soRefs = new Set(dataset.serviceOrders.map((serviceOrder) => serviceOrder.soRef));
  const processIds = new Set(dataset.processes.map((process) => process.processId));

  for (const soRef of soRefs) {
    const linked = dataset.processes.filter((process) => process.soRef === soRef);
    assertEquals(linked.length, 1, `${soRef} should have exactly one process`);
  }

  for (const activity of dataset.activities) {
    assert(processIds.has(activity.processId), `${activity.processId} has no process`);
  }

  const serials = new Set(
    dataset.serviceOrders.map((serviceOrder) => serviceOrder.terminalSerial),
  );
  for (const attempt of dataset.attempts) {
    const resolves = attempt.soRef !== null
      ? soRefs.has(attempt.soRef)
      : serials.has(attempt.serial);
    assert(resolves, `${attempt.attemptId} cannot be linked to any service order`);
  }
});

Deno.test("the committed files match the generator", async () => {
  const expected = JSON.parse(await Deno.readTextFile(new URL("expected.json", datasetUrl)));
  const config = JSON.parse(await Deno.readTextFile(new URL("config.json", datasetUrl)));

  assertEquals(expected, EXPECTED);
  assertEquals(config, configToFile(IMPACT_CONFIG));
  assertEquals(configFromFile(config), IMPACT_CONFIG);
});
