// SPDX-License-Identifier: MIT
/**
 * Amendments (M2-08): an order or an item that replaces another, and a service order whose
 * action changes what an earlier one built. Pure helpers that correlation and the rules share,
 * so "an amendment is not a duplicate nor a missing link" is decided in one place.
 */

import type { ItemAction, Order } from "./model.ts";

/** A service order with one of these actions amends its item; it does not repeat it. */
export function isAmendingAction(action: ItemAction | undefined): boolean {
  return action === "modify" || action === "delete";
}

/** Order refs that some other order replaces, from either side of the declaration. */
export function replacedOrderRefs(orders: readonly Order[]): Set<string> {
  const replaced = new Set<string>();
  for (const order of orders) {
    if (order.replacesOrderRef) replaced.add(order.replacesOrderRef);
    if (order.supersededByOrderRef) replaced.add(order.orderRef);
  }
  return replaced;
}

/** The order that replaces `ref`, when exactly one does. */
export function replacementIndex(orders: readonly Order[]): Map<string, string> {
  const found = new Map<string, Set<string>>();
  const add = (replaced: string, by: string) => {
    found.set(replaced, (found.get(replaced) ?? new Set()).add(by));
  };
  for (const order of orders) {
    if (order.replacesOrderRef) add(order.replacesOrderRef, order.orderRef);
    if (order.supersededByOrderRef) add(order.orderRef, order.supersededByOrderRef);
  }
  const unique = new Map<string, string>();
  for (const [replaced, by] of found) if (by.size === 1) unique.set(replaced, [...by][0]);
  return unique;
}

/** The item that replaces `itemRef`, from either side, mapped to the order that owns it. */
export function itemReplacementOwners(orders: readonly Order[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const order of orders) {
    for (const item of order.items ?? []) {
      if (item.replacesItem) {
        owners.set(item.replacesItem, [...(owners.get(item.replacesItem) ?? []), order.orderRef]);
      }
    }
  }
  return owners;
}
