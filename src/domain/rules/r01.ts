// SPDX-License-Identifier: MIT
/**
 * R01, activation fails and nobody retries (M3-03, M3-09), rule version `R01@1`.
 *
 * A failed activation attempt with no later attempt on the same product order item within
 * `thresholds.retry_window_hours` is fallout: a person has to notice it and push it through.
 * The key is the **item**, not the service order: R04's retry is a new service order over the
 * same item, so it is still a retry here and the rule does not count it twice.
 *
 * Pure: it reads what correlation already joined and the rule settings of the config.
 */

import type { CorrelatedOrder, Linked } from "../correlation.ts";
import {
  type Cost,
  type CostTerm,
  type ErrorClass,
  EVIDENCE_SAMPLE_MAX,
  type EvidenceRef,
  type Finding,
  type ImpactConfig,
  type ProvisioningAttempt,
  type R01Config,
  type RecordRef,
} from "../model.ts";
import type { OrderCharge } from "../totals.ts";
import type { RuleContext } from "./index.ts";
import { severityFor } from "./severity.ts";

export const R01_ID = "R01";
export const R01_TITLE = "Activation fails and nobody retries";
export const R01_VERSION = "R01@1";
export const R01_FORMULA =
  "hours = affected × (manual_minutes + wait_days × daily_followup_minutes) / 60";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DEFAULT_OLD_PENDING_HOURS = 72;

/** One order that carries fallout, with the proof. */
export interface R01Hit {
  orderRef: string;
  failed: Linked<ProvisioningAttempt>;
  /** The next attempt on the item, when one exists after the retry window. */
  next?: Linked<ProvisioningAttempt>;
  errorClass: ErrorClass;
  /** From the failure to the next attempt, or to the end of the data when there is none. */
  waitDays: number;
  entry: CorrelatedOrder;
}

export interface R01Scan {
  hits: R01Hit[];
  /** Counts of failed attempts (not orders) that the rule left out, and why. */
  excludedPermanent: number;
  excludedMaintenance: number;
  uncertainTimeout: number;
  oldPending: number;
  resolvedByCallback: number;
  /** Failed attempts whose start time cannot be read: the gap cannot be measured. */
  unmeasuredAttempts: number;
  /** Counted fallout orders whose error code is not in the map. */
  unknownCode: number;
  /** Failed attempts that could not be placed under an order (R05's weak links). */
  unlinkedFailed: number;
  ambiguousFailed: number;
}

const ms = (iso: string): number => Date.parse(iso);

export function r01Settings(config: ImpactConfig): R01Config {
  return {
    errorClasses: config.rules?.r01?.errorClasses ?? [],
    maintenanceWindows: config.rules?.r01?.maintenanceWindows ?? [],
    oldPendingHours: config.rules?.r01?.oldPendingHours ?? DEFAULT_OLD_PENDING_HOURS,
  };
}

/** The class of an error code in the config; `unknown` for a code that is not listed. */
export function classOf(code: string | null, settings: R01Config): ErrorClass {
  if (code === null) return "unknown";
  return settings.errorClasses.find((e) => e.code === code)?.class ?? "unknown";
}

/** The latest moment any attempt shows: "the end of the data", with no wall clock. */
function asOf(orders: readonly CorrelatedOrder[]): number {
  let latest = 0;
  for (const entry of orders) {
    for (const { item } of entry.attempts) {
      for (const at of [item.startedAt, item.endedAt]) {
        const t = at === null ? NaN : ms(at);
        if (!Number.isNaN(t) && t > latest) latest = t;
      }
    }
  }
  return latest;
}

export function scanR01(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): R01Scan {
  const settings = r01Settings(config);
  const windowMs = config.thresholds.retryWindowHours * HOUR;
  const windows = settings.maintenanceWindows.map((w) => [ms(w.from), ms(w.to)] as const);
  const end = asOf(orders);
  const scan: R01Scan = {
    hits: [],
    excludedPermanent: 0,
    excludedMaintenance: 0,
    uncertainTimeout: 0,
    oldPending: 0,
    resolvedByCallback: 0,
    unmeasuredAttempts: 0,
    unknownCode: 0,
    unlinkedFailed: 0,
    ambiguousFailed: 0,
  };

  for (const unplaced of context?.correlation?.unresolved.attempts ?? []) {
    if (unplaced.item.state !== "failed") continue;
    scan.unlinkedFailed++;
    if (unplaced.link.confidence === "ambiguous") scan.ambiguousFailed++;
  }

  for (const entry of orders) {
    const sos = new Map(entry.serviceOrders.map((l) => [l.item.soRef, l.item]));
    const itemOf = (a: Linked<ProvisioningAttempt>): string => {
      const so = sos.get(a.link.toId ?? "");
      return so?.productOrderItemRef ?? a.link.toId ?? entry.order.orderRef;
    };
    const activations = entry.attempts
      .filter((a) => a.item.operation === undefined || a.item.operation === "activate")
      .sort((a, b) =>
        ms(a.item.startedAt) - ms(b.item.startedAt) ||
        a.item.attemptId.localeCompare(b.item.attemptId)
      );

    let hit: R01Hit | undefined;
    for (const a of activations) {
      const so = sos.get(a.link.toId ?? "");
      if (!so || so.state === "CANCELLED") continue;
      const at = a.item;
      if (at.outcome === "timeout") {
        scan.uncertainTimeout++;
        continue;
      }
      if (at.state === "pending" || at.outcome === "pending") {
        if (end - ms(at.startedAt) > settings.oldPendingHours * HOUR) scan.oldPending++;
        continue;
      }
      if (at.state !== "failed") continue;
      if (at.outcome === "succeeded") {
        scan.resolvedByCallback++;
        continue;
      }
      const start = ms(at.startedAt);
      if (Number.isNaN(start)) {
        scan.unmeasuredAttempts++;
        continue;
      }
      const key = itemOf(a);
      const next = activations.find((b) =>
        b !== a && itemOf(b) === key && ms(b.item.startedAt) > start
      );
      // Inside the window (the boundary included) there was a retry: not fallout.
      if (next && ms(next.item.startedAt) - start <= windowMs) continue;

      let errorClass = classOf(at.errorCode, settings);
      if (
        errorClass !== "permanent" && windows.some(([from, to]) => start >= from && start <= to)
      ) {
        errorClass = "maintenance";
      }
      if (errorClass === "permanent") {
        scan.excludedPermanent++;
        continue;
      }
      if (errorClass === "maintenance") {
        scan.excludedMaintenance++;
        continue;
      }
      if (hit) continue; // one charge per order: the first unretried failure
      const until = next ? ms(next.item.startedAt) : Math.max(end, start);
      hit = {
        orderRef: entry.order.orderRef,
        failed: a,
        next,
        errorClass,
        waitDays: (until - start) / DAY,
        entry,
      };
    }
    if (hit) {
      if (hit.errorClass === "unknown") scan.unknownCode++;
      scan.hits.push(hit);
    }
  }
  return scan;
}

function recordRefs(hit: R01Hit): RecordRef[] {
  const refs: RecordRef[] = [];
  const add = (system: RecordRef["system"], p?: { externalId: string; endpoint: string }) => {
    if (p) refs.push({ system, externalId: p.externalId, endpoint: p.endpoint });
  };
  add("OMS", hit.entry.order.provenance);
  add("PROV", hit.failed.item.provenance);
  if (hit.next) add("PROV", hit.next.item.provenance);
  return refs;
}

/** Returns null when no order is affected. */
export function detectR01(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): Finding | null {
  const scan = scanR01(orders, config, context);
  const affected = scan.hits.length;
  if (affected === 0) return null;

  const evidence: EvidenceRef[] = scan.hits.map((h) => ({
    orderRef: h.orderRef,
    eventIds: [h.failed.item.attemptId, ...(h.next ? [h.next.item.attemptId] : [])],
    records: recordRefs(h),
    note: `${h.failed.item.errorCode ?? "no error code"} (${h.errorClass}); ` +
      (h.next
        ? `next attempt ${h.waitDays.toFixed(1)} days later`
        : `no later attempt in ${h.waitDays.toFixed(1)} days`) +
      `; link ${h.failed.link.confidence}`,
  }));
  evidence.sort((a, b) => a.orderRef.localeCompare(b.orderRef));

  const waitDays = scan.hits.reduce((sum, h) => sum + h.waitDays, 0);
  const { manualMinutes, dailyFollowupMinutes } = config.rates;
  const terms: CostTerm[] = [
    {
      name: "Manual handling of the failed activations",
      hours: affected * manualMinutes / 60,
      basis: "rate_assumption",
      observed: affected,
      inputKeys: ["rates.manual_minutes"],
    },
    {
      name: "Daily follow-up while the order waits",
      hours: waitDays * dailyFollowupMinutes / 60,
      basis: "rate_assumption",
      observed: waitDays,
      inputKeys: ["rates.daily_followup_minutes"],
    },
  ];
  const hours = terms[0].hours + terms[1].hours;
  const fixed = scan.hits.filter((h) => h.errorClass === "transient");
  const remaining = scan.hits.filter((h) => h.errorClass !== "transient");
  const inputs: Cost["inputs"] = [
    input("rates.manual_minutes", manualMinutes),
    input("rates.daily_followup_minutes", dailyFollowupMinutes),
    input("thresholds.retry_window_hours", config.thresholds.retryWindowHours),
  ];
  const unmeasured: Cost["unmeasured"] = [];
  if (scan.unmeasuredAttempts > 0) {
    unmeasured.push({
      term: "Failed attempts with no readable start time",
      reason: `${scan.unmeasuredAttempts} failed attempts carry no usable time, so the gap to ` +
        "a retry cannot be measured (the source is a snapshot without history); not counted",
    });
  }
  if (scan.unlinkedFailed > 0) {
    unmeasured.push({
      term: "Failed attempts with no service order",
      reason: `${scan.unlinkedFailed} failed attempts cannot be placed under an order ` +
        `(${scan.ambiguousFailed} ambiguous); not counted`,
    });
  }

  const share = affected / orders.length;
  const placed = scan.hits.map((h) => h.failed.link);
  const inferred = placed.filter((l) => l.confidence !== "explicit").length;
  return {
    id: R01_ID,
    ruleVersion: R01_VERSION,
    title: R01_TITLE,
    plainSummary: "An activation failed and nothing tried it again within the retry window, " +
      "so a person has to find the order and push it through by hand.",
    where: "PROV",
    severity: severityFor(share, hours),
    status: "detected",
    affectedOrders: affected,
    shareOfOrders: share,
    evidenceLevel: "strong",
    evidence: evidence.slice(0, EVIDENCE_SAMPLE_MAX),
    evidenceTotal: evidence.length,
    confidence: {
      level: inferred === 0 ? "confirmed" : "possible",
      inferredLinkShare: placed.length === 0 ? 0 : inferred / placed.length,
    },
    inTotal: true,
    breakdown: {
      waitDays,
      excludedPermanent: scan.excludedPermanent,
      excludedMaintenance: scan.excludedMaintenance,
      uncertainTimeout: scan.uncertainTimeout,
      oldPending: scan.oldPending,
      resolvedByCallback: scan.resolvedByCallback,
      unknownCode: scan.unknownCode,
      inferredLinks: placed.filter((l) => l.confidence === "inferred").length,
      unlinkedFailedAttempts: scan.unlinkedFailed,
      ambiguousFailedAttempts: scan.ambiguousFailed,
    },
    cost: {
      kind: "recurring",
      periodDays: null,
      normalisation: null,
      hoursMonth: hours,
      hoursLow: hours,
      hoursHigh: hours,
      formula: R01_FORMULA,
      inputs,
      terms,
      unmeasured,
    },
    scenario: {
      fix: `retry a failed activation automatically within ${config.thresholds.retryWindowHours} h`,
      mechanism: "a retry clears the failures whose error code the config classes as transient; " +
        "failures with a code it does not classify are assumed to stay",
      fixedOrders: fixed.length,
      ordersAfter: affected - fixed.length,
      hoursAfter: remaining.reduce((sum, h) => sum + hitHours(h, config), 0),
      kind: "projection",
    },
    recommendation: "Retry a failed activation automatically, or raise it to a queue a person " +
      "owns, within the retry window.",
  };
}

/** What R01 charges to each order, for the net total (M4-05). Same scan as `detectR01`. */
export function chargesR01(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): OrderCharge[] {
  return scanR01(orders, config, context).hits.map((h) => ({
    ruleId: R01_ID,
    orderRef: h.orderRef,
    hours: hitHours(h, config),
  }));
}

function hitHours(h: R01Hit, config: ImpactConfig): number {
  const { manualMinutes, dailyFollowupMinutes } = config.rates;
  return (manualMinutes + h.waitDays * dailyFollowupMinutes) / 60;
}

function input(key: string, value: number): Cost["inputs"][number] {
  return { key, value, source: null, owner: null, date: null };
}
