import {
  DUPLICATE_ORDERS,
  EXPECTED,
  FALLOUT_ORDERS,
  generateDemoDataset,
  IMPACT_CONFIG,
  ORDERS,
  STUCK_ORDERS,
  TIMER_ORDERS,
  WEAK_LINK_ORDERS,
} from "../src/dataset/generator.ts";
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

Deno.test("every order is terminal or deliberately stuck", () => {
  const open = dataset.orders.filter((order) => !isTerminal(order.state));
  assertEquals(open.length, STUCK_ORDERS);
  for (const order of open) {
    assert(order.state === "PROVISIONING", `${order.orderRef} is open in an unexpected state`);
    assert(
      dataset.defects.stuck.includes(order.orderRef),
      `${order.orderRef} is not a planned stuck order`,
    );
  }
  assertEquals(dataset.orders.length - open.length, ORDERS - STUCK_ORDERS);
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

Deno.test("catalog misses the capacity attribute and every process asks for it", () => {
  for (const spec of dataset.catalog.specs) {
    assert(
      !spec.attributes.some((attribute) => attribute.name === "capacity_profile"),
      `${spec.specId} must not define capacity_profile in the demo`,
    );
  }

  const checks = dataset.activities.filter((activity) => activity.name === "capacity_check");
  assertEquals(checks.length, ORDERS, "every order needs exactly one manual capacity check");
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

  assertEquals(failedRefs.size, FALLOUT_ORDERS);

  for (const orderRef of dataset.defects.fallout) {
    const refs = soRefsByOrder.get(orderRef)!;
    assert(
      refs.some((soRef) => failedRefs.has(soRef)),
      `${orderRef} has no failed attempt`,
    );
  }
});

Deno.test("R03: timers expire and some orders never recover", () => {
  const expired = dataset.activities.filter((activity) => activity.timerExpired === true);
  assertEquals(expired.length, TIMER_ORDERS);

  const running = dataset.processes.filter((process) => process.state === "RUNNING");
  assertEquals(running.length, STUCK_ORDERS);
  for (const process of running) {
    assert(process.endedAt === null, `${process.processId} is running but has an end`);
  }
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
  assertEquals(config, IMPACT_CONFIG);
});
