// SPDX-License-Identifier: MIT
/** Multi-line orders and amendments (M2-08). */

import { mapFileOrder, mapFileServiceOrder } from "../src/adapters/ingest/file_mapping.ts";
import { mapProductOrder, mapServiceOrder } from "../src/adapters/ingest/tmf_mapping.ts";
import { correlate } from "../src/domain/correlation.ts";
import type { Order, ProvisioningAttempt, ServiceOrder } from "../src/domain/model.ts";
import { detectR04 } from "../src/domain/rules/r04.ts";
import { detectR05 } from "../src/domain/rules/r05.ts";
import type { RawRecord } from "../src/ports/evidence_source.ts";
import { assertEquals } from "./assert.ts";

const T0 = "2026-09-01T00:00:00.000Z";
const CONFIG = {
  ordersPerMonth: 100,
  rates: {
    manualMinutes: 5,
    dailyFollowupMinutes: 15,
    cleanupMinutes: 90,
    investigationMinutes: 45,
  },
  thresholds: { retryWindowHours: 24, stuckAfterHours: 72, duplicateWindowMinutes: 10 },
};

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
  productOrderItemRef: "i1",
  ...extra,
});

function raw(id: string, value: Record<string, unknown>): RawRecord {
  return {
    system: "OMS",
    source: "x",
    line: 1,
    value,
    provenance: {
      externalId: id,
      endpoint: "x",
      retrievedAt: T0,
      simulated: true,
      kind: "snapshot",
    },
  };
}

Deno.test("a two-line TMF order yields two items with offer, spec, action, parent and replacement", () => {
  const mapped = mapProductOrder(raw("ORD-1", {
    state: "COMPLETED",
    orderDate: T0,
    replaces: { id: "ORD-0" },
    productOrderItem: [
      {
        id: "I-1",
        action: "add",
        productOffering: { id: "BUNDLE" },
        product: { productSpecification: { id: "SPEC-B" } },
      },
      {
        id: "I-2",
        action: "MODIFY",
        productOffering: { id: "ROUTER" },
        parentItem: { id: "I-1" },
        productOrderItemRelationship: [{ id: "I-0", relationshipType: "replaces" }],
      },
    ],
  }));
  assertEquals(mapped.itemRefs, ["I-1", "I-2"]);
  assertEquals(mapped.offerId, "BUNDLE");
  assertEquals(mapped.replacesOrderRef, "ORD-0");
  assertEquals(mapped.items, [
    { itemRef: "I-1", offerId: "BUNDLE", specId: "SPEC-B", action: "add" },
    { itemRef: "I-2", offerId: "ROUTER", action: "modify", parentItem: "I-1", replacesItem: "I-0" },
  ]);
});

Deno.test("a TMF service order keeps its action; an unknown action is left out", () => {
  const base = {
    state: "COMPLETED",
    orderDate: T0,
  };
  const item = (action: string) => ({
    ...base,
    serviceOrderItem: [{ id: "S-1", action, productOrderItem: { id: "I-1", productOrderId: "O" } }],
  });
  assertEquals(mapServiceOrder(raw("SO-1", item("modify"))).action, "modify");
  assertEquals(mapServiceOrder(raw("SO-1", item("noChange"))).action, "noChange");
  assertEquals(mapServiceOrder(raw("SO-1", item("whatever"))).action, undefined);
});

Deno.test("the file mapper reads items and the service order action from client columns", () => {
  const mapped = mapFileOrder(raw("ORD-1", {
    order_ref: "ORD-1",
    submitted_at: T0,
    order_state: "ACTIVE",
    order_state_raw: "ACTIVE",
    offer_id: "BUNDLE",
    items: [
      { item_ref: "L1", offer_id: null, spec_id: "SPEC-B", action: "add" },
      { item_ref: "L2", offer_id: "ROUTER", action: "no_change", parent_item: "L1" },
    ],
  }));
  assertEquals(mapped.itemRefs, ["L1", "L2"]);
  assertEquals(mapped.items?.[0].offerId, "BUNDLE");
  assertEquals(mapped.items?.[1], {
    itemRef: "L2",
    offerId: "ROUTER",
    action: "noChange",
    parentItem: "L1",
  });
  const s = mapFileServiceOrder(raw("SO-1", {
    so_ref: "SO-1",
    order_ref: "ORD-1",
    spec_id: "SPEC",
    so_state: "ACTIVE",
    so_state_raw: "ACTIVE",
    so_created_at: T0,
    so_action: "Delete",
    item_ref: "L2",
  }));
  assertEquals([s.action, s.productOrderItemRef], ["delete", "L2"]);
});

Deno.test("R04: a later modify or delete over the item is an amendment, not a duplicate", () => {
  const run = (second: ServiceOrder["action"], third?: ServiceOrder["action"]) => {
    const sos = [
      so("S1", "O1", { action: "add", createdAt: "2026-09-01T00:00:00Z" }),
      so("S2", "O1", { action: second, createdAt: "2026-09-02T00:00:00Z" }),
      ...(third ? [so("S3", "O1", { action: third, createdAt: "2026-09-02T01:00:00Z" })] : []),
    ];
    return detectR04(
      correlate({ orders: [order("O1")], serviceOrders: sos, attempts: [] }).orders,
      CONFIG,
    );
  };
  assertEquals(run("modify"), null);
  assertEquals(run("modify", "add"), null); // change plus add on one item
  assertEquals(run("delete"), null);
  assertEquals(run("add")?.affectedOrders, 1); // two adds are still a duplicate
  assertEquals(run(undefined)?.affectedOrders, 1); // an unknown action is never an amendment
});

Deno.test("R04 counts the amendment apart and keeps the duplicates at their hours", () => {
  const orders = [order("O1"), order("O2")];
  const sos = [
    so("S1", "O1", { state: "FAILED" }),
    so("S2", "O1", { createdAt: "2026-09-02T00:00:00Z" }),
    so("S3", "O2", { productOrderItemRef: "j1", action: "add" }),
    so("S4", "O2", {
      productOrderItemRef: "j1",
      action: "modify",
      createdAt: "2026-09-03T00:00:00Z",
    }),
  ];
  const f = detectR04(correlate({ orders, serviceOrders: sos, attempts: [] }).orders, CONFIG)!;
  assertEquals([f.affectedOrders, f.cost.hoursMonth], [1, 1.5]);
  assertEquals(f.breakdown?.amendments, 1);
});

Deno.test("a service order of a replaced order that is gone correlates to the replacement", () => {
  const input = {
    orders: [order("O2", { replacesOrderRef: "O1" })],
    serviceOrders: [so("S1", "O1")],
    attempts: [],
  };
  const result = correlate(input);
  assertEquals(result.orders[0].serviceOrders.map((l) => l.item.soRef), ["S1"]);
  assertEquals(result.links[0].confidence, "explicit");
  assertEquals(result.unresolved.serviceOrders, []);
  assertEquals(detectR05(result.orders, CONFIG, { correlation: result } as never), null);
  // Without the declaration the same record is an orphan.
  const orphan = correlate({ ...input, orders: [order("O2")] });
  assertEquals(orphan.links[0].confidence, "missing");
});

Deno.test("a service order on a replaced item follows the item to the replacing order", () => {
  const result = correlate({
    orders: [
      order("O2", {
        itemRefs: ["n1"],
        items: [{ itemRef: "n1", offerId: "X", replacesItem: "i1" }],
      }),
    ],
    serviceOrders: [so("S1", "", { productOrderItemRef: "i1" })],
    attempts: [],
  });
  assertEquals(result.orders[0].serviceOrders.length, 1);
});

Deno.test("a terminal shared by a cancelled replaced order and its replacement is not ambiguous", () => {
  const attempts: ProvisioningAttempt[] = [{
    attemptId: "A1",
    soRef: null,
    serial: "SN-1",
    state: "succeeded",
    errorCode: null,
    startedAt: T0,
    endedAt: null,
  }];
  const orders = [order("O1", { state: "CANCELLED" }), order("O2", { replacesOrderRef: "O1" })];
  const sos = [
    so("S1", "O1", { state: "CANCELLED", terminalSerial: "SN-1", productOrderItemRef: "a" }),
    so("S2", "O2", { terminalSerial: "SN-1", productOrderItemRef: "b" }),
  ];
  const link = correlate({ orders, serviceOrders: sos, attempts }).links.find((l) =>
    l.fromId === "A1"
  )!;
  assertEquals([link.confidence, link.toId], ["inferred", "S2"]);
  const plain = correlate({ orders: [order("O1"), order("O2")], serviceOrders: sos, attempts });
  assertEquals(plain.links.find((l) => l.fromId === "A1")!.confidence, "ambiguous");
});
