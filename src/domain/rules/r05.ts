// SPDX-License-Identifier: MIT
/**
 * R05, no end-to-end correlation id (M3-05), rule version `R05@1`.
 *
 * Every link of the correlation that is not `explicit` (inferred, ambiguous, conflicting or
 * missing) is one incident: someone had to investigate to join two records. The rule reads the
 * correlation report and does no matching of its own. It counts **weak links, not orders**: an
 * order with two weak links is two incidents. It stays out of the net total (D-11).
 */

import type { CorrelatedOrder, Link, LinkConfidence, LinkKind } from "../correlation.ts";
import {
  type Cost,
  EVIDENCE_SAMPLE_MAX,
  type EvidenceRef,
  type Finding,
  type ImpactConfig,
  type Provenance,
  type RecordRef,
  type SystemId,
} from "../model.ts";
import type { OrderCharge } from "../totals.ts";
import type { RuleContext } from "./index.ts";
import { severityFor } from "./severity.ts";

export const R05_ID = "R05";
export const R05_TITLE = "No end-to-end correlation id";
export const R05_VERSION = "R05@1";
export const R05_FORMULA = "hours = incidents × investigation_minutes / 60";

const WEAK: readonly LinkConfidence[] = ["inferred", "ambiguous", "missing", "conflicting"];
const FROM_SYSTEM: Record<LinkKind, SystemId> = {
  "service_order->order": "OMS",
  "process->service_order": "BPM",
  "process->order": "BPM",
  "attempt->service_order": "PROV",
};

export function weakLinks(context?: RuleContext): Link[] {
  return (context?.correlation?.links ?? []).filter((l) => l.confidence !== "explicit");
}

/** Returns null when every link is explicit, or when there is no correlation to read. */
export function detectR05(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): Finding | null {
  const correlation = context?.correlation;
  const weak = weakLinks(context);
  if (!correlation || weak.length === 0) return null;

  // Where each linked record lives, so the evidence can point at it and at its order.
  const provenance = new Map<string, Provenance | undefined>();
  const orderOfSo = new Map<string, string>();
  const orderOfRecord = new Map<string, string>();
  for (const entry of orders) {
    for (const l of entry.serviceOrders) {
      orderOfSo.set(l.item.soRef, entry.order.orderRef);
      orderOfRecord.set(l.item.soRef, entry.order.orderRef);
      provenance.set(l.item.soRef, l.item.provenance);
    }
    for (const l of entry.processes) orderOfRecord.set(l.item.processId, entry.order.orderRef);
    for (const l of entry.attempts) {
      orderOfRecord.set(l.item.attemptId, entry.order.orderRef);
      provenance.set(l.item.attemptId, l.item.provenance);
    }
  }
  for (const l of correlation.unresolved.serviceOrders) {
    provenance.set(l.item.soRef, l.item.provenance);
  }
  for (const l of correlation.unresolved.attempts) {
    provenance.set(l.item.attemptId, l.item.provenance);
  }

  const counts = Object.fromEntries(WEAK.map((c) => [c, 0])) as Record<LinkConfidence, number>;
  const evidence: EvidenceRef[] = weak.map((link) => {
    counts[link.confidence]++;
    const orderRef = orderOfRecord.get(link.fromId) ??
      (link.toId ? orderOfSo.get(link.toId) : undefined) ?? link.fromId;
    const prov = provenance.get(link.fromId);
    const records: RecordRef[] = prov
      ? [{ system: FROM_SYSTEM[link.kind], externalId: prov.externalId, endpoint: prov.endpoint }]
      : [];
    return {
      orderRef,
      eventIds: [link.fromId],
      records,
      note: `${link.kind} ${link.fromId}: ${link.confidence} (${link.basis})`,
    };
  });
  evidence.sort((a, b) =>
    a.orderRef.localeCompare(b.orderRef) || a.eventIds[0].localeCompare(b.eventIds[0])
  );

  const incidents = weak.length;
  const hours = incidents * config.rates.investigationMinutes / 60;
  const share = incidents / Math.max(orders.length, 1);
  const inputs: Cost["inputs"] = [{
    key: "rates.investigation_minutes",
    value: config.rates.investigationMinutes,
    source: null,
    owner: null,
    date: null,
  }];
  return {
    id: R05_ID,
    ruleVersion: R05_VERSION,
    title: R05_TITLE,
    plainSummary: "Some records cannot be tied to their order by an id they carry, so a person " +
      "has to work out which belong together.",
    where: "OMS → PROV",
    severity: severityFor(Math.min(share, 1), hours),
    status: "detected",
    affectedOrders: incidents,
    shareOfOrders: Math.min(share, 1),
    evidenceLevel: "weak",
    evidence: evidence.slice(0, EVIDENCE_SAMPLE_MAX),
    evidenceTotal: evidence.length,
    confidence: { level: "possible", inferredLinkShare: 1 },
    inTotal: false,
    breakdown: {
      weakLinks: incidents,
      inferred: counts.inferred,
      ambiguous: counts.ambiguous,
      missing: counts.missing,
      conflicting: counts.conflicting,
    },
    cost: {
      kind: "recurring",
      periodDays: null,
      normalisation: null,
      hoursMonth: hours,
      hoursLow: hours,
      hoursHigh: hours,
      formula: R05_FORMULA,
      inputs,
      terms: [{
        name: "Investigation of the weak links",
        hours,
        basis: "rate_assumption",
        observed: incidents,
        inputKeys: ["rates.investigation_minutes"],
      }],
      unmeasured: [],
    },
    scenario: {
      fix: "carry the order id (or the service order id) on every record",
      mechanism: "every link then names its parent, so no link has to be inferred and none " +
        "needs investigating",
      fixedOrders: incidents,
      ordersAfter: 0,
      hoursAfter: 0,
      kind: "projection",
    },
    recommendation: "Carry the order id (or the service order id) on every record, so no link " +
      "has to be inferred.",
  };
}

/** R05 is shown apart from the total (D-11), so it charges no order. */
export function chargesR05(
  _orders: readonly CorrelatedOrder[],
  _config: ImpactConfig,
  _context?: RuleContext,
): OrderCharge[] {
  return [];
}
