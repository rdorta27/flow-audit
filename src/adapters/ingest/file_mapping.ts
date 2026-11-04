// SPDX-License-Identifier: MIT
/** Turns the records the file readers yield into the canonical model. */

import type {
  Activity,
  Actor,
  ItemAction,
  Order,
  OrderItem,
  OrderState,
  ProcessInstance,
  ProcessTask,
  ProvisioningAttempt,
  ServiceOrder,
  WorkOrder,
} from "../../domain/model.ts";
import type { RawRecord } from "../../ports/evidence_source.ts";

/** The reader already translated the state; `null` means the mapping let it through unmapped. */
const orderState = (canonical: unknown): OrderState =>
  typeof canonical === "string" ? canonical as OrderState : "UNMAPPED";

const str = (v: unknown) => String(v);
const optional = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** With `single_line_orders` every order sells one line, as the stub assumes: `<order>-1`. */
export const itemOf = (orderRef: string) => `${orderRef}-1`;

const ACTIONS: Record<string, ItemAction> = {
  add: "add",
  modify: "modify",
  delete: "delete",
  nochange: "noChange",
};

/** Case and separators are ignored; a value outside the four actions is left out. */
const actionOf = (v: unknown): ItemAction | undefined =>
  typeof v === "string" ? ACTIONS[v.replace(/[\s_-]/g, "").toLowerCase()] : undefined;

function fileItems(v: Record<string, unknown>): OrderItem[] {
  if (!Array.isArray(v.items)) return [];
  return v.items.map((raw: Record<string, unknown>) => {
    const item: OrderItem = {
      itemRef: str(raw.item_ref),
      offerId: optional(raw.offer_id) ?? str(v.offer_id),
    };
    const spec = optional(raw.spec_id);
    if (spec) item.specId = spec;
    const action = actionOf(raw.action);
    if (action) item.action = action;
    const parent = optional(raw.parent_item);
    if (parent) item.parentItem = parent;
    const replaces = optional(raw.replaces_item);
    if (replaces) item.replacesItem = replaces;
    return item;
  });
}

export function mapFileOrder(r: RawRecord): Order {
  const v = r.value;
  const order: Order = {
    orderRef: str(v.order_ref),
    submittedAt: str(v.submitted_at),
    state: orderState(v.order_state),
    rawState: str(v.order_state_raw),
    offerId: str(v.offer_id),
    offerVersion: optional(v.offer_version) ?? "unknown",
    provenance: r.provenance,
  };
  const rawAt = optional(v.submitted_at_raw);
  if (rawAt) order.submittedAtRaw = rawAt;
  const lines = fileItems(v);
  if (lines.length > 0) {
    order.items = lines;
    order.itemRefs = lines.map((l) => l.itemRef);
  } else if (v.single_line === true) order.itemRefs = [itemOf(str(v.order_ref))];
  const replaces = optional(v.replaces_order_ref);
  if (replaces) order.replacesOrderRef = replaces;
  return order;
}

export function mapFileServiceOrder(r: RawRecord): ServiceOrder {
  const v = r.value;
  const so: ServiceOrder = {
    soRef: str(v.so_ref),
    orderRef: str(v.order_ref),
    specId: str(v.spec_id),
    state: orderState(v.so_state),
    rawState: str(v.so_state_raw),
    createdAt: str(v.so_created_at),
    provenance: r.provenance,
  };
  const rawAt = optional(v.so_created_at_raw);
  if (rawAt) so.createdAtRaw = rawAt;
  const item = optional(v.item_ref);
  if (item) so.productOrderItemRef = item;
  else if (v.single_line === true) so.productOrderItemRef = itemOf(str(v.order_ref));
  const action = actionOf(v.so_action);
  if (action) so.action = action;
  const serial = optional(v.terminal_serial);
  if (serial) so.terminalSerial = serial;
  return so;
}

const WORK_KINDS: readonly WorkOrder["kind"][] = ["installation", "activation", "recovery"];

export function mapFileWorkOrder(r: RawRecord): WorkOrder {
  const v = r.value;
  return {
    woRef: str(v.wo_ref),
    soRef: str(v.so_ref),
    kind: WORK_KINDS.find((k) => k === v.wo_kind) ?? "installation",
    state: optional(v.wo_state) ?? "unknown",
    createdAt: str(v.wo_created_at),
  };
}

export function mapFileProcess(r: RawRecord): ProcessInstance {
  const v = r.value;
  return {
    processId: str(v.process_id),
    soRef: optional(v.so_ref),
    businessKey: optional(v.business_key),
    state: optional(v.state) ?? "unmapped",
    startedAt: str(v.started_at),
    endedAt: optional(v.ended_at),
    ...(optional(v.started_at_raw) ? { startedAtRaw: optional(v.started_at_raw)! } : {}),
    tasks: tasksOf(v.activities),
    ...bpmV2(r),
  };
}

type Bag = Record<string, unknown>;
const text = (v: unknown): string | undefined => typeof v === "string" && v !== "" ? v : undefined;
const flag = (v: unknown): boolean | undefined =>
  v === true || v === "true" ? true : v === false || v === "false" ? false : undefined;

/** The M2-10 fields, only the ones the source had; nothing is invented. */
function bpmV2(r: RawRecord): Partial<ProcessInstance> {
  const v = r.value as Bag;
  const out: Partial<ProcessInstance> = {};
  if (r.provenance) {
    out.evidenceKind = r.provenance.kind;
    out.provenance = r.provenance;
  }
  if (Array.isArray(v.activities)) {
    out.activities = (v.activities as Bag[]).map((a, i): Activity => {
      const act: Activity = {
        processId: str(v.process_id),
        sequence: Number(a.sequence ?? i + 1),
        kind: a.kind === "timer" || a.kind === "gateway" ? a.kind : "task",
        name: str(a.name ?? ""),
        actor: ACTORS.find((x) => x === a.actor) ?? "system",
        startedAt: str(a.started_at),
        endedAt: text(a.ended_at) ?? null,
      };
      const expired = flag(a.timer_expired);
      if (expired !== undefined) act.timerExpired = expired;
      const kind = text(a.timer_kind);
      if (kind === "boundary" || kind === "intermediate" || kind === "escalation") {
        act.timerKind = kind;
      }
      const interrupting = flag(a.interrupting);
      if (interrupting !== undefined) act.interrupting = interrupting;
      const set = (key: keyof Activity, value: string | undefined) => {
        if (value !== undefined) (act as unknown as Bag)[key] = value;
      };
      set("attachedTo", text(a.attached_to));
      set("dueDate", text(a.due_date));
      set("firedAt", text(a.fired_at));
      set("nextActivityId", text(a.next_activity_id));
      set("taskId", text(a.task_id));
      set("assignee", text(a.assignee));
      set("candidateGroup", text(a.candidate_group));
      set("createdAt", text(a.created_at));
      set("claimedAt", text(a.claimed_at));
      set("dueAt", text(a.due_at));
      const eventSub = flag(a.event_subprocess);
      if (eventSub === true) act.eventSubprocess = true;
      return act;
    });
  }
  const suspended = flag(v.suspended);
  if (suspended !== undefined) out.suspended = suspended;
  if (text(v.end_reason)) out.endReason = text(v.end_reason);
  if (text(v.parent_process_id)) out.parentProcessId = text(v.parent_process_id);
  if (text(v.root_process_id)) out.rootProcessId = text(v.root_process_id);
  if (text(v.process_definition_key)) out.processDefinitionKey = text(v.process_definition_key);
  if (text(v.process_definition_version)) {
    out.processDefinitionVersion = text(v.process_definition_version);
  }
  if (text(v.loop_index) !== undefined) out.loopIndex = Number(v.loop_index);
  if (Array.isArray(v.incidents)) {
    out.incidents = (v.incidents as Bag[]).map((i) => ({
      type: str(i.type),
      createdAt: str(i.created_at ?? ""),
      ...(text(i.resolved_at) ? { resolvedAt: text(i.resolved_at)! } : {}),
      ...(text(i.message) ? { message: text(i.message)! } : {}),
    }));
  }
  return out;
}

const ACTORS: readonly Actor[] = ["system", "human", "partner"];

/** The tasks of a process (not its timers or gateways); an actor we cannot read is `system`. */
function tasksOf(activities: unknown): ProcessTask[] {
  if (!Array.isArray(activities)) return [];
  return activities.flatMap((a: Record<string, unknown>) =>
    a.kind === "task" && typeof a.name === "string"
      ? [{ name: a.name, actor: ACTORS.find((x) => x === a.actor) ?? "system" }]
      : []
  );
}

export function mapFileAttempt(r: RawRecord): ProvisioningAttempt {
  const v = r.value;
  const startedRaw = optional(v.started_at_raw);
  const endedRaw = optional(v.ended_at_raw);
  return {
    ...(startedRaw ? { startedAtRaw: startedRaw } : {}),
    ...(endedRaw ? { endedAtRaw: endedRaw } : {}),
    attemptId: str(v.attempt_id),
    soRef: optional(v.so_ref),
    serial: optional(v.serial) ?? "",
    state: (optional(v.state) ?? "unmapped") as ProvisioningAttempt["state"],
    rawState: str(v.state_raw),
    errorCode: optional(v.error_code),
    startedAt: str(v.started_at),
    endedAt: optional(v.ended_at),
    provenance: r.provenance,
  };
}
