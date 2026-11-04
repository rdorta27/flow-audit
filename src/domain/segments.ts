// SPDX-License-Identifier: MIT
/**
 * Classifies the time of an order's journey as work, wait or gap (M2-04).
 *
 * | Kind   | What it is                                                                 |
 * |--------|----------------------------------------------------------------------------|
 * | `queue`| A human task waits to be claimed (only when `claimedAt` is known)            |
 * | `work` | A system is executing: a process task or gateway, or a provisioning attempt |
 * | `wait` | A process timer is running: the process is waiting on purpose               |
 * | `gap`  | No system has any record covering this time: nobody is known to be working  |
 *
 * A gap is the finding-worthy one. It is not proof that something is broken, only that the
 * data cannot say what was happening, and the report shows it as the time lost between steps.
 * A human task (`actor: "human"`) is `work`: the queue time before an analyst picks it up is
 * inside it and cannot be told apart from hands-on time with the data we have.
 *
 * It needs **event history**. A snapshot says what a resource looks like now, not when each
 * step ran, so snapshot evidence is refused with a reason instead of being guessed at.
 * Evidence with no provenance (the dataset files) counts as history.
 *
 * Segments never overlap: the time of overlapping records is counted once, and when a process
 * task and a provisioning attempt start together the attempt is kept.
 *
 * Records still running (no end time) cannot bound a segment; their ids are returned in
 * `open` so a rule can see that the order was not finished when the data was taken.
 * Work orders carry no end time and are not segmented.
 */

import { type CorrelatedOrder, type CorrelationResult, toJourneys } from "./correlation.ts";
import type {
  Activity,
  OrderJourney,
  Segment,
  SegmentKind,
  StagePercentiles,
  StageTime,
  SystemId,
  WaitingReport,
} from "./model.ts";

export type SegmentResult =
  | { ok: true; segments: Segment[]; open: string[] }
  | { ok: false; reason: string };

interface Interval {
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
  segment: Omit<Segment, "from" | "to">;
}

export function classifySegments(
  entry: CorrelatedOrder,
  activities: readonly Activity[],
): SegmentResult {
  const snapshot = [
    entry.order.provenance,
    ...entry.serviceOrders.map((l) => l.item.provenance),
  ].find((p) => p?.kind === "snapshot");
  if (snapshot) {
    return {
      ok: false,
      reason:
        `${entry.order.orderRef}: the evidence is a snapshot read from ${snapshot.endpoint}; ` +
        `a snapshot has no record of when each step ran, so no segments can be built`,
    };
  }

  const processIds = new Set(entry.processes.map((l) => l.item.processId));
  const intervals: Interval[] = [];
  const open: string[] = [];

  const add = (from: string, to: string | null, id: string, segment: Interval["segment"]) => {
    if (to === null) {
      open.push(id);
      return;
    }
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
      throw new Error(`${id}: invalid interval ${from} to ${to}`);
    }
    intervals.push({ from, to, fromMs, toMs, segment });
  };

  for (const activity of activities) {
    if (!processIds.has(activity.processId)) continue;
    const id = `${activity.processId}#${activity.sequence}`;
    const timer = activity.kind === "timer";
    // M2-10: a human task with a claim time has two parts, the queue and the work.
    const claimed = activity.actor === "human" && activity.claimedAt !== undefined &&
        Date.parse(activity.claimedAt) >= Date.parse(activity.startedAt) &&
        Date.parse(activity.claimedAt) <= Date.parse(activity.endedAt ?? activity.claimedAt)
      ? activity.claimedAt
      : null;
    if (claimed !== null) {
      add(activity.startedAt, claimed, `${id}:queue`, {
        system: "BPM",
        kind: "queue",
        state: activity.name,
        actor: activity.actor,
      });
      add(claimed, activity.endedAt, id, {
        system: "BPM",
        kind: "work",
        state: activity.name,
        actor: activity.actor,
      });
      continue;
    }
    add(activity.startedAt, activity.endedAt, id, {
      system: "BPM",
      kind: timer ? "wait" : "work",
      state: timer ? (activity.timerExpired ? "timer_expired" : "timer") : activity.name,
      actor: activity.actor,
      // Queue and work cannot be told apart without a claim time.
      ...(activity.actor === "human" && !timer ? { queueSeparable: false } : {}),
    });
  }
  for (const { item: attempt } of entry.attempts) {
    add(attempt.startedAt, attempt.endedAt, attempt.attemptId, {
      system: "PROV",
      kind: "work",
      state: attempt.state,
      actor: "system",
    });
  }

  // Segments never overlap. When a process task and a provisioning attempt start together,
  // the attempt goes first and the task around it is clipped: its state is the outcome.
  const rank = (i: Interval) => (i.segment.system === "PROV" ? 0 : 1);
  intervals.sort((a, b) => a.fromMs - b.fromMs || rank(a) - rank(b) || a.toMs - b.toMs);

  const segments: Segment[] = [];
  let cursor = { ms: Date.parse(entry.order.submittedAt), iso: entry.order.submittedAt };
  let system: SystemId = "OMS";
  for (const interval of intervals) {
    if (interval.toMs <= cursor.ms) continue; // fully covered by an earlier segment
    if (interval.fromMs > cursor.ms) {
      segments.push({
        system,
        from: cursor.iso,
        to: interval.from,
        kind: "gap",
        state: "no_evidence",
      });
      segments.push({ ...interval.segment, from: interval.from, to: interval.to });
    } else {
      // Overlaps the previous segment: keep only the part not already counted.
      segments.push({ ...interval.segment, from: cursor.iso, to: interval.to });
    }
    cursor = { ms: interval.toMs, iso: interval.to };
    system = interval.segment.system;
  }

  return { ok: true, segments, open: open.sort() };
}

/** Journeys with their segments filled in, or `segmentsUnavailable` saying why not. */
export function journeysWithSegments(
  result: CorrelationResult,
  activities: readonly Activity[],
): OrderJourney[] {
  const entries = new Map(result.orders.map((e) => [e.order.orderRef, e]));
  return toJourneys(result).map((journey) => {
    const classified = classifySegments(entries.get(journey.orderRef)!, activities);
    return classified.ok
      ? { ...journey, segments: classified.segments }
      : { ...journey, segmentsUnavailable: classified.reason };
  });
}

const WAITING_KINDS: readonly SegmentKind[] = ["wait", "queue", "gap"];
/**
 * A finding explains a stage when its orders hold at least this many times the waiting their
 * share of orders would predict. A broad finding that merely includes the waiting orders does
 * not explain the stage.
 */
const EXPLAIN_LIFT = 2;

const hoursOf = (segment: Segment) =>
  (Date.parse(segment.to) - Date.parse(segment.from)) / 3_600_000;

/** Nearest-rank percentile. `p` is 50 or 90. Empty input is null. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const percentiles = (values: readonly number[]): StagePercentiles => ({
  medianHours: percentile(values, 50),
  p90Hours: percentile(values, 90),
});

/**
 * Median and 90th percentile of work, wait, queue and gap per system and stage, over every
 * order that has history (M4-10). A snapshot has no segments, and the result then says
 * "not measurable". Waiting is the sum of wait, queue and gap; it is never a rate.
 */
export function stageTimes(
  journeys: readonly { orderRef: string; segments: readonly Segment[] }[],
  charges: readonly { ruleId: string; orderRef: string }[],
  orderCount: number,
): WaitingReport {
  const measured = journeys.filter((j) => j.segments.length > 0);
  if (measured.length === 0) {
    return { measurable: false, reason: "not measurable", stages: [], mostWaiting: null };
  }

  type Bucket = {
    system: SystemId;
    stage: string;
    orders: Set<string>;
    byKind: Record<SegmentKind, number[]>;
    waitingHours: number;
    waitingByOrder: Map<string, number>;
  };
  const buckets = new Map<string, Bucket>();
  for (const journey of measured) {
    for (const segment of journey.segments) {
      const key = `${segment.system}\t${segment.state}`;
      const hours = hoursOf(segment);
      if (!(hours > 0)) continue;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          system: segment.system,
          stage: segment.state,
          orders: new Set(),
          byKind: { work: [], wait: [], queue: [], gap: [] },
          waitingHours: 0,
          waitingByOrder: new Map(),
        };
        buckets.set(key, bucket);
      }
      bucket.orders.add(journey.orderRef);
      bucket.byKind[segment.kind].push(hours);
      if (WAITING_KINDS.includes(segment.kind)) {
        bucket.waitingHours += hours;
        bucket.waitingByOrder.set(
          journey.orderRef,
          (bucket.waitingByOrder.get(journey.orderRef) ?? 0) + hours,
        );
      }
    }
  }

  const stages: StageTime[] = [...buckets.values()].map((bucket) => ({
    system: bucket.system,
    stage: bucket.stage,
    orders: bucket.orders.size,
    work: percentiles(bucket.byKind.work),
    wait: percentiles(bucket.byKind.wait),
    queue: percentiles(bucket.byKind.queue),
    gap: percentiles(bucket.byKind.gap),
    waitingHours: bucket.waitingHours,
  })).sort((a, b) =>
    b.waitingHours - a.waitingHours || a.system.localeCompare(b.system) ||
    a.stage.localeCompare(b.stage)
  );

  const top = stages[0];
  if (!top || top.waitingHours <= 0) {
    return { measurable: true, reason: null, stages, mostWaiting: null };
  }
  const bucket = buckets.get(`${top.system}\t${top.stage}`)!;
  const byRule = new Map<string, Set<string>>();
  for (const charge of charges) {
    const set = byRule.get(charge.ruleId) ?? new Set();
    set.add(charge.orderRef);
    byRule.set(charge.ruleId, set);
  }
  const findings = [...byRule.entries()].flatMap(([ruleId, orders]) => {
    let held = 0;
    for (const ref of orders) held += bucket.waitingByOrder.get(ref) ?? 0;
    if (held <= 0 || orderCount <= 0) return [];
    const lift = (held / top.waitingHours) / (orders.size / orderCount);
    return lift >= EXPLAIN_LIFT ? [{ ruleId, held }] : [];
  }).sort((a, b) => b.held - a.held || a.ruleId.localeCompare(b.ruleId)).map((x) => x.ruleId);

  return {
    measurable: true,
    reason: null,
    stages,
    mostWaiting: {
      system: top.system,
      stage: top.stage,
      waitingHours: top.waitingHours,
      findings,
    },
  };
}
