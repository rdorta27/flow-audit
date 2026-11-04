// SPDX-License-Identifier: MIT
/**
 * Gross and net totals (M4-05). Pure.
 *
 * `gross` adds every finding in the total. `net` counts each order once: when several rules
 * charge the same order, only the largest charge stays (rule documented in `rules.md`,
 * "Overlap"). Net is gross minus what the overlap removes, so with no overlap it is exactly
 * the gross figure.
 */

import type { Finding, ReportOverlap } from "./model.ts";

/** What one rule charges to one order, in the same units as the finding's cost. */
export interface OrderCharge {
  ruleId: string;
  orderRef: string;
  hours: number;
}

export interface Totals {
  gross: { hours: number };
  net: { hours: number };
  overlap: ReportOverlap;
}

export function computeTotals(
  findings: readonly Finding[],
  charges: readonly OrderCharge[],
): Totals {
  const counted = findings.filter((f) => f.inTotal);
  const ids = new Set(counted.map((f) => f.id));
  const gross = { hours: counted.reduce((sum, f) => sum + f.cost.hoursMonth, 0) };

  // One charge per (order, rule): a rule that charges an order twice is still one rule.
  const byOrder = new Map<string, Map<string, number>>();
  for (const c of charges) {
    if (!ids.has(c.ruleId)) continue;
    const rules = byOrder.get(c.orderRef) ?? new Map();
    rules.set(c.ruleId, (rules.get(c.ruleId) ?? 0) + c.hours);
    byOrder.set(c.orderRef, rules);
  }

  const overlap: ReportOverlap = { byOrder: {}, pairs: [] };
  const pairCount = new Map<string, number>();
  let removedHours = 0;
  for (const [orderRef, rules] of [...byOrder].sort(([a], [b]) => a.localeCompare(b))) {
    if (rules.size < 2) continue;
    const ruleIds = [...rules.keys()].sort();
    overlap.byOrder[orderRef] = ruleIds;
    // Largest hours stay; on a tie the lowest rule id, so the result never depends on order.
    const keep = ruleIds.reduce((best, id) => rules.get(id)! > rules.get(best)! ? id : best);
    for (const id of ruleIds) {
      if (id === keep) continue;
      removedHours += rules.get(id)!;
    }
    for (let i = 0; i < ruleIds.length; i++) {
      for (let j = i + 1; j < ruleIds.length; j++) {
        const key = `${ruleIds[i]}+${ruleIds[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }
  overlap.pairs = [...pairCount].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, orders]) => ({ rules: key.split("+"), orders }));

  return {
    gross,
    net: { hours: gross.hours - removedHours },
    overlap,
  };
}
