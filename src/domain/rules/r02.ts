// SPDX-License-Identifier: MIT
/**
 * R02, a missing catalog attribute forces a manual task (M3-04), rule version `R02@1`.
 *
 * The contract is a declared list in the config, `rules.r02.activation_requirements`: an
 * attribute that `required_by` needs in the spec, and `via_task`, the manual task a person does
 * when it is missing. That tie is declared, never inferred. An order counts when the spec of its
 * offer version lacks the attribute and one of its processes ran the human task.
 *
 * Which spec applies: the offer version on the order when the catalog has it (`explicit`), else
 * the version valid when the order was submitted (`inferred`), else unknown: listed as
 * unmeasured, not counted. Needs the catalog and the process tasks (files only today).
 */

import type { CorrelatedOrder } from "../correlation.ts";
import {
  type ActivationRequirement,
  type Catalog,
  type Cost,
  EVIDENCE_SAMPLE_MAX,
  type EvidenceRef,
  type Finding,
  type ImpactConfig,
  type Order,
  orderRefsOf,
  type Spec,
} from "../model.ts";
import type { OrderCharge } from "../totals.ts";
import type { RuleContext } from "./index.ts";
import { severityFor } from "./severity.ts";

export const R02_ID = "R02";
export const R02_TITLE = "Missing catalog attribute forces a manual task";
export const R02_VERSION = "R02@1";
export const R02_FORMULA = "hours = affected × manual_minutes / 60";

export interface R02Hit {
  orderRef: string;
  entry: CorrelatedOrder;
  spec: Spec;
  how: "explicit" | "inferred";
  missing: ActivationRequirement[];
  processIds: string[];
}

export interface R02Scan {
  hits: R02Hit[];
  /** Orders whose spec could not be found, so the rule could not decide. */
  unknownSpec: number;
  /** Orders with a missing attribute but no process data or no such manual task. */
  missingWithoutTask: number;
}

/** The spec an order was sold on, and how sure we are of it; null when it cannot be told. */
export function specOf(
  order: Order,
  catalog: Catalog,
): { spec: Spec; how: "explicit" | "inferred" } | null {
  const versions = catalog.offers.find((o) => o.offerId === order.offerId)?.versions ?? [];
  const at = Date.parse(order.submittedAt);
  const stated = versions.find((v) => v.version === order.offerVersion);
  const valid = versions.find((v) =>
    Date.parse(v.validFrom) <= at && (v.validTo === null || at < Date.parse(v.validTo))
  );
  const chosen = stated ?? valid;
  const spec = catalog.specs.find((s) => s.specId === chosen?.specId);
  return chosen && spec ? { spec, how: stated ? "explicit" : "inferred" } : null;
}

export function scanR02(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): R02Scan {
  const scan: R02Scan = { hits: [], unknownSpec: 0, missingWithoutTask: 0 };
  const requirements = config.rules?.r02?.activationRequirements ?? [];
  const catalog = context?.catalog;
  if (!catalog || requirements.length === 0) return scan;

  for (const entry of orders) {
    const found = specOf(entry.order, catalog);
    if (!found) {
      scan.unknownSpec++;
      continue;
    }
    const missing = requirements.filter((r) =>
      !found.spec.attributes.some((a) => a.name === r.attribute)
    );
    if (missing.length === 0) continue;
    const withTask = entry.processes.filter((p) =>
      missing.some((r) =>
        (p.item.tasks ?? []).some((t) => t.name === r.viaTask && t.actor === "human")
      )
    );
    if (withTask.length === 0) {
      scan.missingWithoutTask++;
      continue;
    }
    scan.hits.push({
      orderRef: entry.order.orderRef,
      entry,
      spec: found.spec,
      how: found.how,
      missing,
      processIds: withTask.map((p) => p.item.processId),
    });
  }
  return scan;
}

/** Returns null when no order is affected, or when there is no catalog to read. */
export function detectR02(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): Finding | null {
  const scan = scanR02(orders, config, context);
  const affected = scan.hits.length;
  if (affected === 0) return null;

  const evidence: EvidenceRef[] = scan.hits.map((h) => {
    const prov = h.entry.order.provenance;
    return {
      orderRef: h.orderRef,
      eventIds: h.processIds,
      records: prov
        ? [{ system: "OMS", externalId: prov.externalId, endpoint: prov.endpoint }]
        : [],
      note: `${h.entry.order.offerId} ${h.entry.order.offerVersion} → ${h.spec.specId} lacks ` +
        `${h.missing.map((r) => r.attribute).join(", ")}; ` +
        `human task ${h.missing.map((r) => r.viaTask).join(", ")} ran (spec ${h.how})`,
    };
  });
  evidence.sort((a, b) => a.orderRef.localeCompare(b.orderRef));

  const hours = affected * config.rates.manualMinutes / 60;
  const inputs: Cost["inputs"] = [{
    key: "rates.manual_minutes",
    value: config.rates.manualMinutes,
    source: null,
    owner: null,
    date: null,
  }];
  const unmeasured: Cost["unmeasured"] = [];
  if (scan.unknownSpec > 0) {
    unmeasured.push({
      term: "Orders whose spec is unknown",
      reason: `${scan.unknownSpec} orders match no offer version in the catalog; not counted`,
    });
  }
  const share = affected / orders.length;
  const inferred = scan.hits.filter((h) => h.how === "inferred").length;
  return {
    id: R02_ID,
    ruleVersion: R02_VERSION,
    title: R02_TITLE,
    plainSummary: "The product's technical spec lacks a value the activation system needs, so " +
      "a person fills it in by hand on every order.",
    where: "CAT",
    severity: severityFor(share, hours),
    status: "detected",
    affectedOrders: affected,
    shareOfOrders: share,
    evidenceLevel: "strong",
    evidence: evidence.slice(0, EVIDENCE_SAMPLE_MAX),
    evidenceTotal: evidence.length,
    affectedOrderRefs: orderRefsOf(evidence),
    confidence: {
      level: inferred === 0 ? "confirmed" : "possible",
      inferredLinkShare: inferred / affected,
    },
    inTotal: true,
    breakdown: {
      specInferred: inferred,
      unknownSpec: scan.unknownSpec,
      missingWithoutTask: scan.missingWithoutTask,
    },
    cost: {
      kind: "recurring",
      periodDays: null,
      normalisation: null,
      hoursMonth: hours,
      hoursLow: hours,
      hoursHigh: hours,
      formula: R02_FORMULA,
      inputs,
      terms: [{
        name: "Manual check that the missing attribute makes necessary",
        hours,
        basis: "rate_assumption",
        observed: affected,
        inputKeys: ["rates.manual_minutes"],
      }],
      unmeasured,
    },
    scenario: {
      fix: "add the missing attribute to the spec of the offer version",
      mechanism: "the manual task exists only because the attribute is missing, so every " +
        "order that ran it is assumed not to need it",
      fixedOrders: affected,
      ordersAfter: 0,
      hoursAfter: 0,
      kind: "projection",
    },
    recommendation: "Add the missing attribute to the spec of the offer version, so the " +
      "activation system gets it without a manual step. The hours are freeable capacity, " +
      "not savings.",
  };
}

/** What R02 charges to each order, for the net total (M4-05). */
export function chargesR02(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): OrderCharge[] {
  return scanR02(orders, config, context).hits.map((h) => ({
    ruleId: R02_ID,
    orderRef: h.orderRef,
    hours: config.rates.manualMinutes / 60,
  }));
}
