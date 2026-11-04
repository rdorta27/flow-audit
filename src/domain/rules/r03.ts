// SPDX-License-Identifier: MIT
/**
 * R03, a BPM timer expires and nothing compensates it (M3-07), rule version `R03@1`.
 *
 * A timer activity fires in the activation subprocess, no activity follows it, the process is
 * still open and more than `thresholds.stuck_after_hours` have passed: the order is stuck and a
 * person has to find it. What counts as a compensation (a task, a manual step, a child process)
 * is declared in `rules.r03` of the config, never hard-coded. A process that is waiting on an
 * open human fallout task is "in human management": somebody owns it, so it is left out of the
 * stuck count. With snapshot evidence the dates cannot be trusted, so the finding is
 * `suspected`, with its confidence stated, instead of certain hours.
 *
 * Pure: it reads what correlation already joined and the rule settings of the config.
 */

import type { CorrelatedOrder, Linked } from "../correlation.ts";
import { elapsedHours } from "../calendar.ts";
import {
  type Activity,
  type Cost,
  type CostTerm,
  EVIDENCE_SAMPLE_MAX,
  type EvidenceRef,
  type Finding,
  type ImpactConfig,
  type ProcessInstance,
  type R03Config,
  type RecordRef,
} from "../model.ts";
import type { OrderCharge } from "../totals.ts";
import type { RuleContext } from "./index.ts";
import { severityFor } from "./severity.ts";

export const R03_ID = "R03";
export const R03_VERSION = "R03@1";
export const R03_FORMULA =
  "hours = stuck × (manual_minutes + days_stuck × daily_followup_minutes) / 60";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ms = (iso: string) => Date.parse(iso);

export interface R03Hit {
  orderRef: string;
  process: Linked<ProcessInstance>;
  timer: Activity;
  /** When the timer expired, ISO; null when the source gives no usable time. */
  expiredAt: string | null;
  /** From the expiry to the end of the data; null when the expiry cannot be read. */
  daysStuck: number | null;
  openIncidents: number;
  entry: CorrelatedOrder;
}

export interface R03Scan {
  hits: R03Hit[];
  /** Processes with an expired timer, whatever came next. */
  expired: number;
  recovered: number;
  inHumanManagement: number;
  suspended: number;
  /** Followed by an activity that is not a compensation, or closed on its own. */
  continued: number;
  /** Stuck for less than the threshold: not yet reported. */
  withinThreshold: number;
  /** Stuck orders whose expiry time cannot be read: their days are not measured. */
  unmeasured: number;
  snapshot: boolean;
  periodEnd: number;
}

export function r03Settings(config: ImpactConfig): R03Config {
  const r = config.rules?.r03;
  return {
    compensationActivities: r?.compensationActivities ?? [],
    timerActivities: r?.timerActivities ?? [],
    compensationProcesses: r?.compensationProcesses ?? [],
    humanManagementTasks: r?.humanManagementTasks ?? [],
  };
}

/**
 * The end of the audited period: the declared one (`RuleContext.period`) or else the newest order intake, which is also the window the quality
 * gate measures every system against. Records of a later date (a retry the day after) do not
 * move it, so the days stuck do not depend on when the export was cut. No wall clock.
 */
function periodEnd(orders: readonly CorrelatedOrder[], declared?: string): number {
  if (declared !== undefined && !Number.isNaN(ms(declared))) return ms(declared);
  let latest = 0;
  for (const entry of orders) {
    const t = ms(entry.order.submittedAt);
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  return latest;
}

export function scanR03(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): R03Scan {
  const settings = r03Settings(config);
  const end = periodEnd(orders, context?.period?.end);
  const scan: R03Scan = {
    hits: [],
    expired: 0,
    recovered: 0,
    inHumanManagement: 0,
    suspended: 0,
    continued: 0,
    withinThreshold: 0,
    unmeasured: 0,
    snapshot: false,
    periodEnd: end,
  };
  const watched = (a: Activity) =>
    a.kind === "timer" && a.timerExpired === true &&
    (settings.timerActivities.length === 0 || settings.timerActivities.includes(a.name));

  for (const entry of orders) {
    let hit: R03Hit | undefined;
    for (const linked of entry.processes) {
      const p = linked.item;
      if (p.evidenceKind === "snapshot") scan.snapshot = true;
      const acts = [...(p.activities ?? [])].sort((a, b) => a.sequence - b.sequence);
      const timer = [...acts].reverse().find(watched);
      if (!timer) continue;
      scan.expired++;
      const after = acts.filter((a) => a.sequence > timer.sequence);
      const childRecovered = (settings.compensationProcesses ?? []).length > 0 &&
        orders.some((o) =>
          o.processes.some((c) =>
            c.item.parentProcessId === p.processId &&
            settings.compensationProcesses!.includes(c.item.processDefinitionKey ?? "")
          )
        );
      if (childRecovered || after.some((a) => settings.compensationActivities.includes(a.name))) {
        scan.recovered++;
        continue;
      }
      const owned = settings.humanManagementTasks ?? [];
      if (
        p.endedAt === null &&
        after.some((a) => a.endedAt === null && (a.actor === "human" || owned.includes(a.name)))
      ) {
        scan.inHumanManagement++;
        continue;
      }
      if (after.length > 0 || p.endedAt !== null) {
        scan.continued++;
        continue;
      }
      if (p.suspended === true || p.state === "SUSPENDED") {
        scan.suspended++;
        continue;
      }
      const expiredAt = timer.firedAt ?? timer.endedAt;
      const t = expiredAt === null ? NaN : ms(expiredAt);
      if (
        !Number.isNaN(t) &&
        elapsedHours(t, end, config.thresholds.stuckAfterBasis, config.calendar) <=
          config.thresholds.stuckAfterHours
      ) {
        scan.withinThreshold++;
        continue;
      }
      if (hit) continue; // one charge per order
      const unreadable = Number.isNaN(t);
      if (unreadable) scan.unmeasured++;
      hit = {
        orderRef: entry.order.orderRef,
        process: linked,
        timer,
        expiredAt: unreadable ? null : expiredAt,
        daysStuck: unreadable ? null : Math.max(0, end - t) / DAY,
        openIncidents: (p.incidents ?? []).filter((i) => i.resolvedAt === undefined).length,
        entry,
      };
    }
    if (hit) scan.hits.push(hit);
  }
  return scan;
}

function recordRefs(hit: R03Hit): RecordRef[] {
  const refs: RecordRef[] = [];
  const add = (system: RecordRef["system"], p?: { externalId: string; endpoint: string }) => {
    if (p) refs.push({ system, externalId: p.externalId, endpoint: p.endpoint });
  };
  add("OMS", hit.entry.order.provenance);
  add("BPM", hit.process.item.provenance);
  return refs;
}

const days = (n: number) => `${n.toFixed(1)} days`;

/** Returns null when no order is stuck. */
export function detectR03(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): Finding | null {
  const scan = scanR03(orders, config, context);
  const affected = scan.hits.length;
  if (affected === 0) return null;

  const measured = scan.hits.filter((h) => h.daysStuck !== null);
  const daysTotal = measured.reduce((sum, h) => sum + h.daysStuck!, 0);
  const { manualMinutes, dailyFollowupMinutes } = config.rates;

  const evidence: EvidenceRef[] = scan.hits.map((h) => ({
    orderRef: h.orderRef,
    eventIds: [h.process.item.processId, `${h.process.item.processId}#${h.timer.sequence}`],
    records: recordRefs(h),
    note: `${h.timer.name} expired ${h.expiredAt ?? "at an unreadable time"}; nothing followed; ` +
      (h.daysStuck === null
        ? "days without service not measured"
        : `${days(h.daysStuck)} without service`) +
      (h.openIncidents > 0 ? `; ${h.openIncidents} open incident(s)` : ""),
  }));
  evidence.sort((a, b) => a.orderRef.localeCompare(b.orderRef));

  const terms: CostTerm[] = [
    {
      name: "Manual handling of the stuck orders",
      hours: affected * manualMinutes / 60,
      basis: "rate_assumption",
      observed: affected,
      inputKeys: ["rates.manual_minutes"],
    },
    {
      name: "Daily follow-up while the order is stuck",
      hours: daysTotal * dailyFollowupMinutes / 60,
      basis: "rate_assumption",
      observed: daysTotal,
      inputKeys: ["rates.daily_followup_minutes"],
    },
  ];
  const hours = terms[0].hours + terms[1].hours;
  const input = (key: string, value: number): Cost["inputs"][number] => ({
    key,
    value,
    source: null,
    owner: null,
    date: null,
  });
  const unmeasured: Cost["unmeasured"] = [];
  if (scan.unmeasured > 0) {
    unmeasured.push({
      term: "Stuck orders with no readable expiry time",
      reason: `${scan.unmeasured} stuck orders carry no usable timer time, so the days without ` +
        "service cannot be measured; only their manual handling is counted",
    });
  }
  if (scan.snapshot) {
    unmeasured.push({
      term: "Days without service",
      reason: "the process evidence is a snapshot: the state is read now, with no record of when " +
        "each step ran, so the days and the hours are suspected, not certain (confidence: possible)",
    });
  }

  const share = affected / orders.length;
  return {
    id: R03_ID,
    ruleVersion: R03_VERSION,
    title: "Timer expires and nobody compensates",
    plainSummary: scan.snapshot
      ? "A process timer seems to have expired and nothing followed it, so the order is " +
        "probably stuck; the evidence is a snapshot, so this is suspected, not confirmed."
      : "A process timer expired, nothing followed it and the order has been without service " +
        "for days, until a person finds it.",
    where: "BPM",
    severity: severityFor(share, hours),
    status: scan.snapshot ? "suspected" : "detected",
    affectedOrders: affected,
    shareOfOrders: share,
    evidenceLevel: scan.snapshot ? "weak" : "history",
    evidence: evidence.slice(0, EVIDENCE_SAMPLE_MAX),
    evidenceTotal: evidence.length,
    confidence: {
      level: scan.snapshot ? "possible" : "confirmed",
      inferredLinkShare: scan.hits.length === 0
        ? 0
        : scan.hits.filter((h) => h.process.link.confidence !== "explicit").length /
          scan.hits.length,
    },
    inTotal: true,
    breakdown: {
      expiredTimers: scan.expired,
      recovered: scan.recovered,
      stuck: affected,
      daysStuck: daysTotal,
      inHumanManagement: scan.inHumanManagement,
      suspended: scan.suspended,
      continuedWithoutCompensation: scan.continued,
      withinThreshold: scan.withinThreshold,
      unmeasured: scan.unmeasured,
    },
    cost: {
      kind: "accumulated_to_period_end",
      periodDays: null,
      normalisation: null,
      hoursMonth: hours,
      formula: R03_FORMULA,
      inputs: [
        input("rates.manual_minutes", manualMinutes),
        input("rates.daily_followup_minutes", dailyFollowupMinutes),
        input("thresholds.stuck_after_hours", config.thresholds.stuckAfterHours),
      ],
      terms,
      unmeasured,
    },
    recommendation: "Give every timer an exit: a compensation task or a queue a person owns, " +
      "so an expired timer never leaves an order waiting.",
  };
}

/** What R03 charges to each order, for the net total (M4-05). Same scan as `detectR03`. */
export function chargesR03(
  orders: readonly CorrelatedOrder[],
  config: ImpactConfig,
  context?: RuleContext,
): OrderCharge[] {
  const { manualMinutes, dailyFollowupMinutes } = config.rates;
  return scanR03(orders, config, context).hits.map((h) => ({
    ruleId: R03_ID,
    orderRef: h.orderRef,
    hours: (manualMinutes + (h.daysStuck ?? 0) * dailyFollowupMinutes) / 60,
  }));
}
