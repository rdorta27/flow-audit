// SPDX-License-Identifier: MIT
/**
 * Derived order state (M2-06): what an order's service orders and attempts say about it,
 * compared with what the order says about itself. Pure and informational: it carries no
 * cost and raises no finding (a priced rule is R08, later).
 */

import type { CorrelatedOrder, CorrelationResult } from "./correlation.ts";
import type { OrderState } from "./model.ts";

export type DerivedState = "active" | "partial" | "failed" | "in_progress" | "unknown";

export interface ItemState {
  /** The product order item, or null when the service orders do not name one. */
  itemRef: string | null;
  state: DerivedState;
}

export interface OrderStateReport {
  orderRef: string;
  /** The order's own state. */
  orderState: OrderState;
  items: ItemState[];
  /** The items combined: one state for the whole order. */
  derived: DerivedState;
  /** True when the order's own state contradicts `derived`. */
  disagrees: boolean;
}

const IN_FLIGHT: readonly OrderState[] = [
  "SUBMITTED",
  "VALIDATED",
  "DECOMPOSED",
  "SCHEDULED",
  "INSTALLED",
  "PROVISIONING",
];

/** The state each order state claims; null when it claims nothing comparable. */
function claimed(state: OrderState): DerivedState | null {
  if (state === "ACTIVE") return "active";
  if (state === "FAILED") return "failed";
  if (state === "PARTIAL") return "partial";
  if (IN_FLIGHT.includes(state)) return "in_progress";
  return null;
}

function single(state: OrderState, hasPendingAttempt: boolean): DerivedState {
  if (state === "ACTIVE") return "active";
  if (state === "FAILED") return "failed";
  if (state === "PARTIAL") return "partial";
  if (IN_FLIGHT.includes(state) || (state === "HELD" && hasPendingAttempt)) return "in_progress";
  return "unknown";
}

/** Combines states of parts: all alike stays; active with failed is partial. */
function combine(states: readonly DerivedState[]): DerivedState {
  if (states.length === 0) return "unknown";
  if (states.includes("in_progress")) return "in_progress";
  if (states.includes("unknown")) return "unknown";
  const set = new Set(states);
  if (set.size === 1) return states[0];
  return "partial";
}

export function deriveOrderState(entry: CorrelatedOrder): OrderStateReport {
  const pending = new Set(
    entry.attempts.filter((a) => a.item.state === "pending").map((a) => a.item.soRef),
  );
  const byItem = new Map<string | null, DerivedState[]>();
  for (const { item: so } of entry.serviceOrders) {
    const key = so.productOrderItemRef ?? null;
    const list = byItem.get(key) ?? [];
    list.push(single(so.state, pending.has(so.soRef)));
    byItem.set(key, list);
  }
  const items: ItemState[] = [...byItem].map(([itemRef, states]) => ({
    itemRef,
    state: combine(states),
  }));
  const derived = combine(items.map((i) => i.state));
  const claim = claimed(entry.order.state);
  return {
    orderRef: entry.order.orderRef,
    orderState: entry.order.state,
    items,
    derived,
    disagrees: claim !== null && derived !== "unknown" && claim !== derived,
  };
}

export function deriveOrderStates(result: CorrelationResult): OrderStateReport[] {
  return result.orders.map(deriveOrderState);
}
