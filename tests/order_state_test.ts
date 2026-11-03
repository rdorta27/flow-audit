// SPDX-License-Identifier: MIT
/** Derived order state (M2-06) and the optional attempt fields (M2-07). */

import { correlate } from "../src/domain/correlation.ts";
import { deriveOrderStates } from "../src/domain/order_state.ts";
import type { Order, OrderState, ProvisioningAttempt, ServiceOrder } from "../src/domain/model.ts";
import { mapActivation } from "../src/adapters/ingest/tmf_mapping.ts";
import { assertEquals } from "./assert.ts";

const T = "2026-09-01T10:00:00.000Z";
const order = (state: OrderState): Order => ({
  orderRef: "ORD-1",
  submittedAt: T,
  state,
  offerId: "O",
  offerVersion: "1",
  itemRefs: ["I1"],
});
const so = (n: number, state: OrderState, item = "I1"): ServiceOrder => ({
  soRef: `SO-${n}`,
  orderRef: "ORD-1",
  specId: "S",
  state,
  createdAt: T,
  productOrderItemRef: item,
});

function derive(o: OrderState, sos: ServiceOrder[], attempts: ProvisioningAttempt[] = []) {
  return deriveOrderStates(correlate({ orders: [order(o)], serviceOrders: sos, attempts }))[0];
}

Deno.test("active order with an active service order is consistent", () => {
  const r = derive("ACTIVE", [so(1, "ACTIVE")]);
  assertEquals([r.derived, r.disagrees], ["active", false]);
});

Deno.test("a failed original plus an active duplicate is partial and disagrees", () => {
  const r = derive("ACTIVE", [so(1, "FAILED"), so(2, "ACTIVE")]);
  assertEquals([r.derived, r.disagrees], ["partial", true]);
});

Deno.test("items are derived apart and combined", () => {
  const r = derive("FAILED", [so(1, "FAILED", "I1"), so(2, "ACTIVE", "I2")]);
  assertEquals(r.items.map((i) => i.state), ["failed", "active"]);
  assertEquals([r.derived, r.disagrees], ["partial", true]);
});

Deno.test("no service orders, unmapped and cancelled never disagree", () => {
  assertEquals(derive("ACTIVE", []).derived, "unknown");
  assertEquals(derive("ACTIVE", []).disagrees, false);
  assertEquals(derive("ACTIVE", [so(1, "UNMAPPED")]).disagrees, false);
  assertEquals(derive("CANCELLED", [so(1, "FAILED")]).disagrees, false);
});

Deno.test("an in-flight service order is in_progress", () => {
  const r = derive("PROVISIONING", [so(1, "PROVISIONING")]);
  assertEquals([r.derived, r.disagrees], ["in_progress", false]);
  assertEquals(derive("ACTIVE", [so(1, "PROVISIONING")]).disagrees, true);
});

const raw = (value: Record<string, unknown>) => ({
  system: "PROV" as const,
  source: "t",
  line: 1,
  value,
  provenance: {
    externalId: "ACT-1",
    endpoint: "x",
    retrievedAt: T,
    simulated: true,
    kind: "snapshot" as const,
  },
});

Deno.test("optional attempt fields round-trip and are never required", () => {
  const base = { id: "ACT-1", state: "FAILED", activationDate: T };
  const bare = mapActivation(raw(base));
  assertEquals(
    [bare.attemptNo, bare.operation, bare.requestId, bare.callbackAt, bare.outcome],
    [undefined, undefined, undefined, undefined, undefined],
  );
  const full = mapActivation(raw({
    ...base,
    attemptNo: 2,
    operation: "suspend",
    requestId: "REQ-9",
    callbackDate: "2026-09-01T10:07:00.000Z",
    outcome: "timeout",
  }));
  assertEquals(
    [full.attemptNo, full.operation, full.requestId, full.callbackAt, full.outcome],
    [2, "suspend", "REQ-9", "2026-09-01T10:07:00.000Z", "timeout"],
  );
  assertEquals(
    mapActivation(raw({ ...base, operation: "teleport", attemptNo: 0 })).operation,
    undefined,
  );
});
