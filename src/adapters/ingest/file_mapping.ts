// SPDX-License-Identifier: MIT
/** Turns the records the file readers yield into the canonical model. */

import type {
  Actor,
  Order,
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
  if (v.single_line === true) order.itemRefs = [itemOf(str(v.order_ref))];
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
  if (v.single_line === true) so.productOrderItemRef = itemOf(str(v.order_ref));
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
    tasks: tasksOf(v.activities),
  };
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
  return {
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
