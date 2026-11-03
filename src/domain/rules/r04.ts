// SPDX-License-Identifier: MIT
/**
 * R04, retry duplicates service orders (M3-02), rule version `R04@1`.
 *
 * Fires when two or more service orders decompose the same product order item. It is a
 * pure function: it reads what correlation already joined and invents no rate.
 */

import type { CorrelatedOrder } from "../correlation.ts";
import type { EvidenceRef, Finding, ImpactConfig, Severity } from "../model.ts";

export const R04_VERSION = "R04@1";

/** Severity is derived from impact, never declared by hand (rules.md). */
export function severityFor(shareOfOrders: number, hoursMonth: number): Severity {
  if (shareOfOrders > 0.1 || hoursMonth > 200) return "critical";
  if (shareOfOrders > 0.02 || hoursMonth > 50) return "high";
  return "medium";
}

/** Returns null when no order is affected. */
export function detectR04(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
): Finding | null {
  const evidence: EvidenceRef[] = [];
  let duplicates = 0;
  let reachedActivation = 0;

  for (const entry of orders) {
    // A cancelled order replaced by a new one is deliberate, so it does not count.
    const live = entry.serviceOrders.filter((l) => l.item.state !== "CANCELLED");
    const byItem = new Map<string, typeof live>();
    for (const linked of live) {
      const item = linked.item.productOrderItemRef;
      if (item === undefined) continue; // cannot be evaluated; never guessed
      byItem.set(item, [...(byItem.get(item) ?? []), linked]);
    }
    for (const [item, group] of byItem) {
      if (group.length < 2) continue;
      duplicates++;
      const ids = group.map((l) => l.item.soRef).sort();
      const extra = group.slice(1).map((l) => l.item.soRef);
      const attempts = entry.attempts.filter((a) => extra.includes(a.link.toId ?? ""));
      if (attempts.length > 0) reachedActivation++;
      evidence.push({
        orderRef: entry.order.orderRef,
        eventIds: [...ids, ...attempts.map((a) => a.item.attemptId)],
        note: `${group.length} service orders over item ${item}` +
          (attempts.length > 0 ? "; the duplicate reached activation" : ""),
      });
    }
  }
  if (duplicates === 0) return null;
  evidence.sort((a, b) => a.orderRef.localeCompare(b.orderRef));

  const hours = duplicates * config.rates.cleanupMinutes / 60;
  const usd = hours * config.loadedHourUsd +
    reachedActivation * config.rates.duplicateActivationCostUsd;
  const share = duplicates / orders.length;
  return {
    id: R04_VERSION,
    title: "OMS retry duplicates service orders",
    severity: severityFor(share, hours),
    affectedOrders: duplicates,
    shareOfOrders: share,
    evidence,
    impact: { hoursMonth: hours, usdMonth: usd, revenueAtRiskUsd: 0 },
    recommendation:
      "Make the retry reuse the existing service order, and confirm in billing the orders " +
      "whose duplicate reached activation.",
  };
}
