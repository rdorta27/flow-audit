// SPDX-License-Identifier: MIT
/**
 * R04, retry duplicates service orders (M3-02), rule version `R04@1`.
 *
 * Fires when two or more service orders decompose the same product order item. It is a
 * pure function: it reads what correlation already joined and invents no rate.
 */

import type { CorrelatedOrder } from "../correlation.ts";
import {
  type Cost,
  type CostTerm,
  EVIDENCE_SAMPLE_MAX,
  type EvidenceRef,
  type Finding,
  type ImpactConfig,
  type Provenance,
  type RecordRef,
  type Severity,
  type SystemId,
} from "../model.ts";
import type { Link } from "../correlation.ts";

export const R04_ID = "R04";
export const R04_VERSION = "R04@1";

export const R04_FORMULA = "hours = duplicates × cleanup_minutes / 60; " +
  "amount = hours × loaded_hour_usd + duplicates_that_reached_activation × duplicate_activation_cost_usd";

function recordRef(system: SystemId, provenance: Provenance | undefined): RecordRef[] {
  return provenance
    ? [{ system, externalId: provenance.externalId, endpoint: provenance.endpoint }]
    : [];
}

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
  let activationsObserved = false;
  const links: Link[] = [];

  for (const entry of orders) {
    // A cancelled order replaced by a new one is deliberate, so it does not count.
    const live = entry.serviceOrders.filter((l) => l.item.state !== "CANCELLED");
    const byItem = new Map<string, typeof live>();
    for (const linked of live) {
      const item = linked.item.productOrderItemRef;
      if (item === undefined) continue; // cannot be evaluated; never guessed
      byItem.set(item, [...(byItem.get(item) ?? []), linked]);
    }
    if (entry.attempts.length > 0) activationsObserved = true;
    for (const [item, group] of byItem) {
      if (group.length < 2) continue;
      duplicates++;
      const ids = group.map((l) => l.item.soRef).sort();
      const extra = group.slice(1).map((l) => l.item.soRef);
      const attempts = entry.attempts.filter((a) => extra.includes(a.link.toId ?? ""));
      if (attempts.length > 0) reachedActivation++;
      links.push(...group.map((l) => l.link), ...attempts.map((a) => a.link));
      evidence.push({
        orderRef: entry.order.orderRef,
        eventIds: [...ids, ...attempts.map((a) => a.item.attemptId)],
        records: [
          ...recordRef("OMS", entry.order.provenance),
          ...group.flatMap((l) => recordRef("OMS", l.item.provenance)),
          ...attempts.flatMap((a) => recordRef("PROV", a.item.provenance)),
        ],
        note: `${group.length} service orders over item ${item}` +
          (attempts.length > 0 ? "; the duplicate reached activation" : ""),
      });
    }
  }
  if (duplicates === 0) return null;
  evidence.sort((a, b) => a.orderRef.localeCompare(b.orderRef));

  const hours = duplicates * config.rates.cleanupMinutes / 60;
  const cleanup = hours * config.loadedHourUsd;
  const terms: CostTerm[] = [{
    name: "Clean-up of duplicate service orders",
    amount: cleanup,
    basis: "rate_assumption",
    observed: duplicates,
    inputKeys: ["rates.cleanupMinutes", "loadedHourUsd"],
  }];
  const inputs: Cost["inputs"] = [
    input("rates.cleanupMinutes", config.rates.cleanupMinutes),
    input("loadedHourUsd", config.loadedHourUsd),
  ];
  const unmeasured: Cost["unmeasured"] = [];
  if (activationsObserved) {
    terms.push({
      name: "Duplicate activations",
      amount: reachedActivation * config.rates.duplicateActivationCostUsd,
      basis: "rate_assumption",
      observed: reachedActivation,
      inputKeys: ["rates.duplicateActivationCostUsd"],
    });
    inputs.push(input("rates.duplicateActivationCostUsd", config.rates.duplicateActivationCostUsd));
  } else {
    unmeasured.push({
      term: "Duplicate activations",
      reason: "not observed in this source: it has no activation records",
    });
  }
  const usd = terms.reduce((sum, t) => sum + t.amount, 0);
  const share = duplicates / orders.length;
  const inferred = links.filter((l) => l.confidence !== "explicit").length;
  const inferredLinkShare = links.length === 0 ? 0 : inferred / links.length;
  return {
    id: R04_ID,
    ruleVersion: R04_VERSION,
    title: "OMS retry duplicates service orders",
    plainSummary: "When activation failed, someone retried by hand and the order manager " +
      "created a second service order for the same line.",
    where: "OMS",
    severity: severityFor(share, hours),
    status: "detected",
    affectedOrders: duplicates,
    shareOfOrders: share,
    evidenceLevel: "strong",
    evidence: evidence.slice(0, EVIDENCE_SAMPLE_MAX),
    evidenceTotal: evidence.length,
    confidence: { level: inferred === 0 ? "confirmed" : "possible", inferredLinkShare },
    inTotal: true,
    cost: {
      currency: config.currency,
      kind: "one_off",
      periodDays: null,
      normalisation: null,
      hoursMonth: hours,
      amountMonth: usd,
      formula: R04_FORMULA,
      inputs,
      terms,
      unmeasured,
      revenueAtRisk: { amount: 0, basis: null, label: "not lost revenue" },
    },
    recommendation:
      "Make the retry reuse the existing service order, and confirm in billing the orders " +
      "whose duplicate reached activation.",
  };
}

function input(key: string, value: number): Cost["inputs"][number] {
  return { key, value, source: null, owner: null, date: null };
}
