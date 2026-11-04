// SPDX-License-Identifier: MIT
/**
 * Joins the records of the four systems into one journey per order (M2-02).
 *
 * Pure: entities in, links out, no I/O. Every link carries how sure we are of it, and
 * the answer is never silent: anything short of `explicit` is counted as a correlation gap.
 *
 * | Confidence    | Meaning                                                              |
 * |---------------|----------------------------------------------------------------------|
 * | `explicit`    | The record names its parent and the parent exists                    |
 * | `inferred`    | No reference, but one candidate fits (the terminal serial, a key)    |
 * | `ambiguous`   | Several candidates fit, or the id the record points at is not unique |
 * | `missing`     | No reference and no candidate, or the reference points at nothing    |
 * | `conflicting` | Two references on the same record disagree                           |
 *
 * Not implemented: matching by a time window. The model allows it as a last, always-weak
 * resort, but it would hide wrong joins, so it is left out until a source needs it.
 */

import { itemReplacementOwners, replacedOrderRefs, replacementIndex } from "./amendments.ts";
import type {
  Order,
  OrderJourney,
  ProcessInstance,
  ProvisioningAttempt,
  ServiceOrder,
  SystemId,
} from "./model.ts";

export type LinkConfidence = "explicit" | "inferred" | "ambiguous" | "missing" | "conflicting";

export type LinkKind =
  | "service_order->order"
  | "process->service_order"
  | "process->order"
  | "attempt->service_order";

export interface Link {
  kind: LinkKind;
  fromId: string;
  /** The parent the record was joined to; null unless `explicit` or `inferred`. */
  toId: string | null;
  confidence: LinkConfidence;
  /** Why, in words a person can check. */
  basis: string;
  /** The parents that fit, when ambiguous or conflicting. */
  candidates?: string[];
}

export interface Linked<T> {
  item: T;
  link: Link;
}

export interface CorrelationInput {
  orders: readonly Order[];
  serviceOrders: readonly ServiceOrder[];
  processes?: readonly ProcessInstance[];
  attempts: readonly ProvisioningAttempt[];
}

export interface CorrelatedOrder {
  order: Order;
  serviceOrders: Linked<ServiceOrder>[];
  processes: Linked<ProcessInstance>[];
  attempts: Linked<ProvisioningAttempt>[];
}

export interface DuplicateId {
  entity: "order" | "service_order";
  id: string;
  count: number;
}

export interface CorrelationResult {
  orders: CorrelatedOrder[];
  /** Records that could not be placed under exactly one order, with the link that says why. */
  unresolved: {
    serviceOrders: Linked<ServiceOrder>[];
    processes: Linked<ProcessInstance>[];
    attempts: Linked<ProvisioningAttempt>[];
  };
  /** Ids held by more than one record. Links that point at them are `ambiguous`. */
  duplicateIds: DuplicateId[];
  links: Link[];
  /** Records whose state could not be read (M2-05), by system and source state. */
  unmapped: UnmappedState[];
}

export interface UnmappedState {
  system: SystemId;
  /** The state as the source wrote it. */
  state: string;
  count: number;
}

type Summary = Record<LinkKind, Record<LinkConfidence, number>>;

const CONFIDENCES: LinkConfidence[] = [
  "explicit",
  "inferred",
  "ambiguous",
  "missing",
  "conflicting",
];
const KINDS: LinkKind[] = [
  "service_order->order",
  "process->service_order",
  "process->order",
  "attempt->service_order",
];

/** Link counts by kind and confidence, zeros included, so a report can print them as they are. */
export function summarizeLinks(links: readonly Link[]): Summary {
  const summary = {} as Summary;
  for (const kind of KINDS) {
    summary[kind] = Object.fromEntries(CONFIDENCES.map((c) => [c, 0])) as Record<
      LinkConfidence,
      number
    >;
  }
  for (const link of links) summary[link.kind][link.confidence]++;
  return summary;
}

/** Everything that is not `explicit` is a correlation gap, described for the journey. */
export function describeGap(link: Link): string {
  return `${link.kind} ${link.fromId}: ${link.confidence} (${link.basis})`;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined || k === "") continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function present(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : value;
}

function byId<T>(get: (item: T) => string) {
  return (a: T, b: T) => (get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0);
}

export function correlate(input: CorrelationInput): CorrelationResult {
  const processes = input.processes ?? [];
  const ordersById = groupBy(input.orders, (o) => o.orderRef);
  const sosById = groupBy(input.serviceOrders, (s) => s.soRef);
  const sosBySerial = groupBy(input.serviceOrders, (s) => s.terminalSerial);
  const orderByItem = groupBy(
    input.orders.flatMap((o) => (o.itemRefs ?? []).map((item) => ({ item, order: o }))),
    (entry) => entry.item,
  );

  // Amendments (M2-08): a reference to a replaced order that is gone follows the replacement.
  const replacement = replacementIndex(input.orders);
  const replaced = replacedOrderRefs(input.orders);
  const replacingItem = itemReplacementOwners(input.orders);
  const replacementOf = (ref: string): string | undefined => {
    let current = ref;
    for (let hops = 0; hops < 10 && !ordersById.has(current); hops++) {
      const next = replacement.get(current);
      if (next === undefined) return undefined;
      current = next;
    }
    return current === ref ? undefined : current;
  };

  const duplicateIds: DuplicateId[] = [];
  for (const [id, list] of ordersById) {
    if (list.length > 1) duplicateIds.push({ entity: "order", id, count: list.length });
  }
  for (const [id, list] of sosById) {
    if (list.length > 1) duplicateIds.push({ entity: "service_order", id, count: list.length });
  }
  duplicateIds.sort(byId((d) => `${d.entity}:${d.id}`));

  const links: Link[] = [];
  const keep = (link: Link): Link => {
    links.push(link);
    return link;
  };

  /** Resolves a reference to an order: the shared tail of three of the four link kinds. */
  const toOrder = (
    kind: LinkKind,
    fromId: string,
    ref: string,
    how: string,
    hit: { confidence: LinkConfidence; basis: string } = { confidence: "explicit", basis: how },
  ): Link => {
    const found = ordersById.get(ref);
    if (!found) {
      return keep({
        kind,
        fromId,
        toId: null,
        confidence: "missing",
        basis: `${how} points at order ${ref}, which is not in the data`,
      });
    }
    if (found.length > 1) {
      return keep({
        kind,
        fromId,
        toId: null,
        confidence: "ambiguous",
        basis: `order id ${ref} is held by ${found.length} orders`,
        candidates: [ref],
      });
    }
    return keep({ kind, fromId, toId: ref, ...hit });
  };

  // Service order -> order --------------------------------------------------
  const soLinks = new Map<ServiceOrder, Link>();
  for (const so of input.serviceOrders) {
    const declared = present(so.orderRef);
    const item = present(so.productOrderItemRef);
    const direct = item ? (orderByItem.get(item) ?? []).map((e) => e.order.orderRef) : [];
    const owners = direct.length > 0 ? direct : item ? (replacingItem.get(item) ?? []) : [];
    const owner = owners.length === 1 ? owners[0] : undefined;
    const successor = declared && !ordersById.has(declared) ? replacementOf(declared) : undefined;

    let link: Link;
    if (declared && owner && declared !== owner) {
      link = keep({
        kind: "service_order->order",
        fromId: so.soRef,
        toId: null,
        confidence: "conflicting",
        basis: `orderRef says ${declared} but item ${item} belongs to ${owner}`,
        candidates: [declared, owner],
      });
    } else if (declared && successor) {
      link = toOrder("service_order->order", so.soRef, successor, "orderRef", {
        confidence: "explicit",
        basis: `orderRef ${declared} was replaced by ${successor}`,
      });
    } else if (declared) {
      link = toOrder("service_order->order", so.soRef, declared, "orderRef");
    } else if (owner) {
      link = toOrder("service_order->order", so.soRef, owner, `product order item ${item}`);
    } else {
      link = keep({
        kind: "service_order->order",
        fromId: so.soRef,
        toId: null,
        confidence: "missing",
        basis: item ? `item ${item} is not an item of any order` : "no order reference",
      });
    }
    soLinks.set(so, link);
  }

  /** Resolves a service order reference, with the conflict check against a second clue. */
  const toServiceOrder = (
    kind: LinkKind,
    fromId: string,
    ref: string,
    contradicts: (so: ServiceOrder) => string | undefined,
  ): Link => {
    const found = sosById.get(ref);
    if (!found) {
      return keep({
        kind,
        fromId,
        toId: null,
        confidence: "missing",
        basis: `soRef points at service order ${ref}, which is not in the data`,
      });
    }
    if (found.length > 1) {
      return keep({
        kind,
        fromId,
        toId: null,
        confidence: "ambiguous",
        basis: `service order id ${ref} is held by ${found.length} service orders`,
        candidates: [ref],
      });
    }
    const clash = contradicts(found[0]);
    if (clash) {
      return keep({
        kind,
        fromId,
        toId: null,
        confidence: "conflicting",
        basis: clash,
        candidates: [ref],
      });
    }
    return keep({ kind, fromId, toId: ref, confidence: "explicit", basis: "soRef" });
  };

  // Process -> service order, or -> order by business key --------------------
  const processLinks = new Map<ProcessInstance, Link>();
  for (const process of processes) {
    const soRef = present(process.soRef);
    const key = present(process.businessKey);
    let link: Link;
    if (soRef) {
      link = toServiceOrder(
        "process->service_order",
        process.processId,
        soRef,
        (so) =>
          key && so.orderRef && key !== so.orderRef
            ? `soRef ${soRef} belongs to ${so.orderRef} but the business key says ${key}`
            : undefined,
      );
    } else if (key) {
      link = toOrder("process->order", process.processId, key, "business key", {
        confidence: "inferred",
        basis: "business key only, no service order",
      });
    } else {
      link = keep({
        kind: "process->service_order",
        fromId: process.processId,
        toId: null,
        confidence: "missing",
        basis: "no service order and no business key",
      });
    }
    processLinks.set(process, link);
  }

  // Child processes hang on their root (M2-10) ---------------------------------
  // A call activity starts a child process that may carry its own references, or none. The
  // child belongs to the order of the process it descends from, so it is placed once, there,
  // whatever it says about itself.
  const processById = new Map(processes.map((p) => [p.processId, p]));
  const rootOf = (process: ProcessInstance): ProcessInstance | undefined => {
    let current = process;
    const seen = new Set([process.processId]);
    for (;;) {
      const next = processById.get(present(current.parentProcessId) ?? "") ??
        processById.get(present(current.rootProcessId) ?? "");
      if (!next || seen.has(next.processId)) break;
      seen.add(next.processId);
      current = next;
    }
    return current === process ? undefined : current;
  };
  for (const process of processes) {
    const root = rootOf(process);
    if (!root) continue;
    const own = processLinks.get(process)!;
    const rootLink = processLinks.get(root)!;
    const agrees = own.confidence === "explicit" && own.toId === rootLink.toId &&
      own.kind === rootLink.kind;
    own.kind = rootLink.kind;
    own.toId = rootLink.toId;
    own.candidates = rootLink.candidates;
    if (agrees) continue;
    const mine = own.basis;
    own.confidence = rootLink.confidence === "explicit" ? "inferred" : rootLink.confidence;
    own.basis = `child of process ${root.processId}` +
      (rootLink.confidence === "explicit" ? "" : ` (${rootLink.confidence}: ${rootLink.basis})`) +
      (present(process.soRef) || present(process.businessKey)
        ? `; its own reference was: ${mine}`
        : "");
  }

  // Attempt -> service order -------------------------------------------------
  const attemptLinks = new Map<ProvisioningAttempt, Link>();
  for (const attempt of input.attempts) {
    const soRef = present(attempt.soRef);
    const serial = present(attempt.serial);
    let link: Link;
    if (soRef) {
      link = toServiceOrder(
        "attempt->service_order",
        attempt.attemptId,
        soRef,
        (so) =>
          serial && so.terminalSerial && serial !== so.terminalSerial
            ? `soRef ${soRef} has terminal ${so.terminalSerial} but the attempt used ${serial}`
            : undefined,
      );
    } else if (!serial) {
      link = keep({
        kind: "attempt->service_order",
        fromId: attempt.attemptId,
        toId: null,
        confidence: "missing",
        basis: "no service order reference and no terminal serial",
      });
    } else {
      let fitting = sosBySerial.get(serial) ?? [];
      // A replaced order's cancelled service order shares the terminal with its replacement.
      const live = fitting.filter((s) => !(s.state === "CANCELLED" && replaced.has(s.orderRef)));
      const setAside = fitting.length > 1 && live.length === 1;
      if (setAside) fitting = live;
      const candidates = fitting.map((s) => s.soRef).sort();
      if (candidates.length === 0) {
        link = keep({
          kind: "attempt->service_order",
          fromId: attempt.attemptId,
          toId: null,
          confidence: "missing",
          basis: `terminal serial ${serial} matches no service order`,
        });
      } else if (candidates.length === 1) {
        link = keep({
          kind: "attempt->service_order",
          fromId: attempt.attemptId,
          toId: candidates[0],
          confidence: "inferred",
          basis: `terminal serial ${serial}` +
            (setAside ? " (the cancelled service order of a replaced order is set aside)" : ""),
        });
      } else {
        link = keep({
          kind: "attempt->service_order",
          fromId: attempt.attemptId,
          toId: null,
          confidence: "ambiguous",
          basis: `terminal serial ${serial} matches ${candidates.length} service orders`,
          candidates,
        });
      }
    }
    attemptLinks.set(attempt, link);
  }

  // Attach everything to its order ---------------------------------------------
  const placed = (link: Link) => link.confidence === "explicit" || link.confidence === "inferred";
  const journeys = new Map<string, CorrelatedOrder>();
  for (const [ref, list] of ordersById) {
    if (list.length === 1) {
      journeys.set(ref, { order: list[0], serviceOrders: [], processes: [], attempts: [] });
    }
  }
  const unresolved: CorrelationResult["unresolved"] = {
    serviceOrders: [],
    processes: [],
    attempts: [],
  };
  const orderOfSo = new Map<string, string>();

  for (const [so, link] of soLinks) {
    const journey = placed(link) && link.toId ? journeys.get(link.toId) : undefined;
    if (journey && sosById.get(so.soRef)?.length === 1) {
      journey.serviceOrders.push({ item: so, link });
      orderOfSo.set(so.soRef, journey.order.orderRef);
    } else unresolved.serviceOrders.push({ item: so, link });
  }
  const orderFor = (link: Link): string | undefined => {
    if (!placed(link) || !link.toId) return undefined;
    return link.kind === "process->order" ? link.toId : orderOfSo.get(link.toId);
  };
  for (const [process, link] of processLinks) {
    const journey = journeys.get(orderFor(link) ?? "");
    if (journey) journey.processes.push({ item: process, link });
    else unresolved.processes.push({ item: process, link });
  }
  for (const [attempt, link] of attemptLinks) {
    const journey = journeys.get(orderFor(link) ?? "");
    if (journey) journey.attempts.push({ item: attempt, link });
    else unresolved.attempts.push({ item: attempt, link });
  }

  const orders = [...journeys.values()].sort(byId((j) => j.order.orderRef));
  for (const journey of orders) {
    journey.serviceOrders.sort(byId((l) => l.item.soRef));
    journey.processes.sort(byId((l) => l.item.processId));
    journey.attempts.sort(byId((l) => l.item.attemptId));
  }
  unresolved.serviceOrders.sort(byId((l) => l.item.soRef));
  unresolved.processes.sort(byId((l) => l.item.processId));
  unresolved.attempts.sort(byId((l) => l.item.attemptId));
  links.sort(byId((l) => `${l.kind}:${l.fromId}`));

  const unmappedCounts = new Map<string, UnmappedState>();
  const countUnmapped = (system: SystemId, state: string | undefined) => {
    const key = `${system}\u0000${state ?? ""}`;
    const entry = unmappedCounts.get(key) ?? { system, state: state ?? "", count: 0 };
    entry.count++;
    unmappedCounts.set(key, entry);
  };
  for (const o of input.orders) if (o.state === "UNMAPPED") countUnmapped("OMS", o.rawState);
  for (const s of input.serviceOrders) if (s.state === "UNMAPPED") countUnmapped("OMS", s.rawState);
  for (const a of input.attempts) if (a.state === "unmapped") countUnmapped("PROV", a.rawState);
  const unmapped = [...unmappedCounts.values()].sort(
    byId((u) => `${u.system}:${u.state}`),
  );

  return { orders, unresolved, duplicateIds, links, unmapped };
}

/**
 * One journey per correlated order. `strong` means every record attached to it was joined
 * explicitly; the gaps describe the links that were not. Records that could not be placed
 * under an order are in `CorrelationResult.unresolved`, not in any journey.
 * Segments are filled by `classifySegments` (M2-04), which needs event history.
 */
export function toJourneys(result: CorrelationResult): OrderJourney[] {
  return result.orders.map((entry) => {
    const all = [...entry.serviceOrders, ...entry.processes, ...entry.attempts];
    const gaps = all.filter((l) => l.link.confidence !== "explicit").map((l) =>
      describeGap(l.link)
    );
    return {
      orderRef: entry.order.orderRef,
      segments: [],
      findings: [],
      correlation: { strong: gaps.length === 0, gaps },
    };
  });
}
