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
import type { Activity, OrderJourney, Segment, SystemId } from "./model.ts";

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
