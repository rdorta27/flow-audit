// SPDX-License-Identifier: MIT
/**
 * The story of one order in plain language (M4-04). Pure: a correlated order in, ordered steps
 * out. Every sentence comes from one template per event kind (English; L-01 adds languages),
 * so the story cannot say more than the evidence does. A step the source cannot show is kept
 * in the story with `observed: false` and the reason, never invented and never dropped.
 */

import type { CorrelatedOrder } from "./correlation.ts";
import type { Finding, StoryStep } from "./model.ts";

const NOT_VISIBLE = "not visible in this source";

const ORDINALS: Record<number, string> = { 2: "second", 3: "third", 4: "fourth" };

/** Sentence templates, one per event kind. */
const TEMPLATES = {
  received: () => "The order manager received the order.",
  catalog: () => "The product catalog was checked that the offer can be sold and activated.",
  serviceOrder: (so: string, line: string) => `A service order (${so}) was created for ${line}.`,
  serviceOrderAgain: (nth: number, so: string, line: string) =>
    `A ${ORDINALS[nth] ?? `number ${nth}`} service order (${so}) was created for ${line}, ` +
    `which already had one.`,
  process: (id: string) => `The process orchestrator started process ${id}.`,
  orchestrator: () => "The process orchestrator ran its tasks for the order.",
  attempt: (state: string, so: string, code: string | null) =>
    `An activation attempt on ${so} ${state}${code ? ` (error ${code})` : ""}.`,
} as const;

const ATTEMPT_WORDS: Record<string, string> = {
  failed: "failed",
  succeeded: "succeeded",
  pending: "is still pending",
  unmapped: "ended in a state this audit does not recognise",
};

/** Builds the ordered steps for one order; `findings` are those that list the order as evidence. */
export function buildStory(
  entry: CorrelatedOrder,
  findings: readonly Finding[],
): StoryStep[] {
  const ref = entry.order.orderRef;
  const flagged = new Map<string, string>(); // record id -> finding id
  for (const f of findings) {
    for (const e of f.evidence) {
      if (e.orderRef !== ref) continue;
      for (const id of e.eventIds) if (!flagged.has(id)) flagged.set(id, f.id);
    }
  }
  const lineName = (item: string | undefined) => {
    if (item === undefined) return "an order line";
    const index = entry.order.itemRefs?.indexOf(item) ?? -1;
    return index >= 0 ? `line ${index + 1}` : `line ${item}`;
  };
  const record = (r?: { externalId: string; endpoint: string }) =>
    r ? { id: r.externalId, endpoint: r.endpoint } : null;

  const steps: StoryStep[] = [];
  const base = {
    at: null as string | null,
    system: "OMS" as StoryStep["system"],
    what: "",
    record: null as StoryStep["record"],
    finding: null as string | null,
    observed: true,
    reason: null as string | null,
  };

  steps.push({
    ...base,
    at: entry.order.submittedAt,
    system: "OMS",
    what: TEMPLATES.received(),
    record: record(entry.order.provenance),
  });
  steps.push({
    ...base,
    at: null,
    system: "CAT",
    what: TEMPLATES.catalog(),
    observed: false,
    reason: NOT_VISIBLE,
  });

  const timed: StoryStep[] = [];
  const seenItems = new Map<string, number>();
  const sos = [...entry.serviceOrders].sort((a, b) =>
    a.item.createdAt.localeCompare(b.item.createdAt)
  );
  for (const { item } of sos) {
    const key = item.productOrderItemRef;
    const nth = key === undefined ? 1 : (seenItems.get(key) ?? 0) + 1;
    if (key !== undefined) seenItems.set(key, nth);
    const again = nth > 1;
    timed.push({
      ...base,
      at: item.createdAt,
      system: "OMS",
      what: again
        ? TEMPLATES.serviceOrderAgain(nth, item.soRef, lineName(key))
        : TEMPLATES.serviceOrder(item.soRef, lineName(key)),
      record: record(item.provenance),
      // The problem starts at the repeated order, not at the first one.
      finding: again ? flagged.get(item.soRef) ?? null : null,
    });
  }
  for (const { item } of entry.processes) {
    timed.push({
      ...base,
      at: item.startedAt,
      system: "BPM",
      what: TEMPLATES.process(item.processId),
    });
  }
  for (const { item } of entry.attempts) {
    timed.push({
      ...base,
      at: item.endedAt ?? item.startedAt,
      system: "PROV",
      what: TEMPLATES.attempt(
        ATTEMPT_WORDS[item.state] ?? item.state,
        item.soRef ?? "an unlinked service order",
        item.errorCode,
      ),
      record: record(item.provenance),
    });
  }
  timed.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.system.localeCompare(b.system));
  steps.push(...timed);

  if (entry.processes.length === 0) {
    // Placed after the first service order, where the orchestrator would have run its tasks.
    const first = steps.findIndex((s) => s.system === "OMS" && s.at !== null && s !== steps[0]);
    steps.splice(first < 0 ? steps.length : first + 1, 0, {
      ...base,
      at: null,
      system: "BPM",
      what: TEMPLATES.orchestrator(),
      observed: false,
      reason: NOT_VISIBLE,
    });
  }
  return steps;
}

/** One line per step, for the terminal and for tests. */
export function storyText(steps: readonly StoryStep[]): string[] {
  return steps.map((s, i) => {
    const when = s.at ?? "time unknown";
    const proof = s.observed
      ? s.record ? ` [${s.record.id} · ${s.record.endpoint}]` : ""
      : ` [${s.reason}]`;
    const flag = s.finding ? ` <- ${s.finding}` : "";
    return `${i + 1}. ${when} · ${s.system} · ${s.what}${proof}${flag}`;
  });
}
