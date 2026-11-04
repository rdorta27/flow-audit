// SPDX-License-Identifier: MIT
/**
 * R04, duplicate service order (M3-02, M3-08), rule version `R04@2`.
 *
 * Fires when two or more service orders decompose the same product order item. It is a
 * pure function: it reads what correlation already joined and invents no rate.
 */

import { isAmendingAction } from "../amendments.ts";
import type { CorrelatedOrder } from "../correlation.ts";
import {
  type Cost,
  type CostTerm,
  EVIDENCE_SAMPLE_MAX,
  type EvidenceRef,
  type Finding,
  type ImpactConfig,
  orderRefsOf,
  type Provenance,
  type ProvisioningAttempt,
  type RecordRef,
  type ServiceOrder,
  type SystemId,
} from "../model.ts";
import type { Link, Linked } from "../correlation.ts";
import type { OrderCharge } from "../totals.ts";
import { severityFor } from "./severity.ts";

export const R04_ID = "R04";
export const R04_TITLE = "Duplicate service order";
export const R04_VERSION = "R04@2";

export const R04_FORMULA = "hours = groups × cleanup_minutes / 60";

function recordRef(system: SystemId, provenance: Provenance | undefined): RecordRef[] {
  return provenance
    ? [{ system, externalId: provenance.externalId, endpoint: provenance.endpoint }]
    : [];
}

export type R04Cause = "retry_new_order" | "parallel_duplicate";

/** One product order item with two or more live service orders. */
export interface R04Group {
  orderRef: string;
  item: string;
  /** Oldest first: the first is the original, the rest are the extras. */
  serviceOrders: Linked<ServiceOrder>[];
  /**
   * `amendment`: a later service order modifies or deletes the item (its `action`), so it is
   * not a repeat. `needs_review`: the service orders differ in spec, so it may be one.
   */
  verdict: "duplicate" | "needs_review" | "amendment";
  /** Why the extras exist; only for a duplicate. */
  cause?: R04Cause;
  extras: string[];
  attempts: Linked<ProvisioningAttempt>[];
}

/**
 * Groups an order's live service orders by item and classifies each group. A cancelled
 * order replaced by a new one is deliberate, and a state we could not read is neither live
 * nor dead, so neither counts. A spec of "unknown" (a source that sends none) cannot show a
 * difference, so only two different known specs make a group `needs_review`. A later service
 * order whose action is `modify` or `delete` (M2-08) makes the group an `amendment`: neither
 * counted nor priced. An absent action is unknown and never read as an amendment.
 */
export function groupsR04(entry: CorrelatedOrder): R04Group[] {
  const live = entry.serviceOrders.filter((l) =>
    l.item.state !== "CANCELLED" && l.item.state !== "UNMAPPED"
  );
  const byItem = new Map<string, typeof live>();
  for (const linked of live) {
    const item = linked.item.productOrderItemRef;
    if (item === undefined) continue; // cannot be evaluated; never guessed
    byItem.set(item, [...(byItem.get(item) ?? []), linked]);
  }
  const groups: R04Group[] = [];
  for (const [item, unsorted] of byItem) {
    if (unsorted.length < 2) continue;
    const sos = [...unsorted].sort((a, b) =>
      a.item.createdAt.localeCompare(b.item.createdAt) || a.item.soRef.localeCompare(b.item.soRef)
    );
    const specs = new Set(sos.map((l) => l.item.specId).filter((id) => id !== "unknown"));
    const extras = sos.slice(1).map((l) => l.item.soRef);
    const attempts = entry.attempts.filter((a) => extras.includes(a.link.toId ?? ""));
    const amendment = sos.slice(1).some((l) => isAmendingAction(l.item.action));
    const duplicate = !amendment && specs.size <= 1;
    groups.push({
      orderRef: entry.order.orderRef,
      item,
      serviceOrders: sos,
      verdict: amendment ? "amendment" : duplicate ? "duplicate" : "needs_review",
      cause: duplicate
        ? (sos[0].item.state === "FAILED" ? "retry_new_order" : "parallel_duplicate")
        : undefined,
      extras,
      attempts,
    });
  }
  return groups;
}

/** Returns null when no order is affected. */
export function detectR04(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
): Finding | null {
  const evidence: EvidenceRef[] = [];
  let duplicates = 0;
  let reachedActivation = 0;
  let activationAttempts = 0;
  let extraServiceOrders = 0;
  let retryNewOrder = 0;
  let parallelDuplicate = 0;
  let needsReview = 0;
  let amendments = 0;
  const links: Link[] = [];

  for (const entry of orders) {
    for (const g of groupsR04(entry)) {
      if (g.verdict === "amendment") {
        amendments++;
        continue;
      }
      if (g.verdict === "needs_review") {
        needsReview++;
        continue;
      }
      duplicates++;
      extraServiceOrders += g.extras.length;
      if (g.cause === "retry_new_order") retryNewOrder++;
      else parallelDuplicate++;
      if (g.attempts.length > 0) reachedActivation++;
      activationAttempts += g.attempts.length;
      const ids = g.serviceOrders.map((l) => l.item.soRef);
      links.push(...g.serviceOrders.map((l) => l.link), ...g.attempts.map((a) => a.link));
      evidence.push({
        orderRef: g.orderRef,
        eventIds: [...ids, ...g.attempts.map((a) => a.item.attemptId)],
        records: [
          ...recordRef("OMS", entry.order.provenance),
          ...g.serviceOrders.flatMap((l) => recordRef("OMS", l.item.provenance)),
          ...g.attempts.flatMap((a) => recordRef("PROV", a.item.provenance)),
        ],
        note: `${g.serviceOrders.length} service orders over item ${g.item} ` +
          `(${g.extras.length} extra, ${g.cause})` +
          (g.attempts.length > 0 ? "; a duplicate reached activation" : ""),
      });
    }
  }
  if (duplicates === 0) return null;
  evidence.sort((a, b) => a.orderRef.localeCompare(b.orderRef));

  const hours = duplicates * config.rates.cleanupMinutes / 60;
  const terms: CostTerm[] = [{
    name: "Clean-up of duplicate service orders",
    hours,
    basis: "rate_assumption",
    observed: duplicates,
    inputKeys: ["rates.cleanup_minutes"],
  }];
  const inputs: Cost["inputs"] = [
    input("rates.cleanup_minutes", config.rates.cleanupMinutes),
  ];
  const unmeasured: Cost["unmeasured"] = [];
  const share = duplicates / orders.length;
  const inferred = links.filter((l) => l.confidence !== "explicit").length;
  const inferredLinkShare = links.length === 0 ? 0 : inferred / links.length;
  return {
    id: R04_ID,
    ruleVersion: R04_VERSION,
    title: R04_TITLE,
    plainSummary: "A second service order exists for the same order line. When activation " +
      "failed, a retry created a new order instead of reusing the first.",
    where: "OMS",
    severity: severityFor(share, hours),
    status: "detected",
    affectedOrders: duplicates,
    shareOfOrders: share,
    evidenceLevel: "strong",
    evidence: evidence.slice(0, EVIDENCE_SAMPLE_MAX),
    evidenceTotal: evidence.length,
    affectedOrderRefs: orderRefsOf(evidence),
    confidence: { level: inferred === 0 ? "confirmed" : "possible", inferredLinkShare },
    inTotal: true,
    breakdown: {
      groups: duplicates,
      extraServiceOrders,
      retryNewOrder,
      parallelDuplicate,
      needsReview,
      amendments,
      reachedActivation,
      activationAttempts,
    },
    cost: {
      kind: "one_off",
      periodDays: null,
      normalisation: null,
      hoursMonth: hours,
      hoursLow: hours,
      hoursHigh: hours,
      formula: R04_FORMULA,
      inputs,
      terms,
      unmeasured,
    },
    scenario: {
      fix: "make the retry reuse the existing service order instead of creating a new one",
      mechanism: "removes the duplicates created by a retry after a failure; duplicates created " +
        "in parallel need a separate deduplication and are assumed to stay",
      fixedOrders: retryNewOrder,
      ordersAfter: parallelDuplicate,
      hoursAfter: parallelDuplicate * config.rates.cleanupMinutes / 60,
      kind: "projection",
    },
    recommendation:
      "Make the retry reuse the existing service order, and confirm in billing the orders " +
      "whose duplicate reached activation.",
  };
}

/**
 * What R04 charges to each duplicated item, for the net total (M4-05). Same groups and rates
 * as `detectR04`, so the charges add up to the finding's cost.
 */
export function chargesR04(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
): OrderCharge[] {
  const charges: OrderCharge[] = [];
  for (const entry of orders) {
    for (const g of groupsR04(entry)) {
      if (g.verdict !== "duplicate") continue;
      const hours = config.rates.cleanupMinutes / 60;
      charges.push({
        ruleId: R04_ID,
        orderRef: g.orderRef,
        hours,
      });
    }
  }
  return charges;
}

function input(key: string, value: number): Cost["inputs"][number] {
  return { key, value, source: null, owner: null, date: null };
}
