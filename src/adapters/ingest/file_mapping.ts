// SPDX-License-Identifier: MIT
/** Turns the records the file readers yield into the canonical model. */

import type {
  Order,
  OrderState,
  ProcessInstance,
  ProvisioningAttempt,
  ServiceOrder,
  WorkOrder,
} from "../../domain/model.ts";
import type { RawRecord } from "../../ports/evidence_source.ts";

const ORDER_STATES: readonly OrderState[] = [
  "DRAFT",
  "SUBMITTED",
  "VALIDATED",
  "DECOMPOSED",
  "SCHEDULED",
  "INSTALLED",
  "PROVISIONING",
  "ACTIVE",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "HELD",
  "PARTIAL",
  "CANCELLING",
];

const orderState = (text: string): OrderState =>
  ORDER_STATES.find((s) => s === text.toUpperCase()) ?? "UNMAPPED";

const str = (v: unknown) => String(v);
const optional = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Every order sells one line, as the stub assumes; the item id is `<order>-1`. */
export const itemOf = (orderRef: string) => `${orderRef}-1`;

export function mapFileOrder(r: RawRecord): Order {
  const v = r.value;
  const order: Order = {
    orderRef: str(v.order_ref),
    submittedAt: str(v.submitted_at),
    state: orderState(str(v.order_state)),
    rawState: str(v.order_state),
    offerId: str(v.offer_id),
    offerVersion: optional(v.offer_version) ?? "unknown",
    itemRefs: [itemOf(str(v.order_ref))],
    provenance: r.provenance,
  };
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
    state: orderState(str(v.so_state)),
    rawState: str(v.so_state),
    createdAt: str(v.so_created_at),
    productOrderItemRef: itemOf(str(v.order_ref)),
    provenance: r.provenance,
  };
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
    kind: WORK_KINDS.find((k) => k === str(v.wo_kind).toLowerCase()) ?? "installation",
    state: str(v.wo_state),
    createdAt: str(v.wo_created_at),
  };
}

export function mapFileProcess(r: RawRecord): ProcessInstance {
  const v = r.value;
  return {
    processId: str(v.process_id),
    soRef: optional(v.so_ref),
    businessKey: optional(v.business_key),
    state: str(v.state),
    startedAt: str(v.started_at),
    endedAt: optional(v.ended_at),
  };
}

const ATTEMPT_STATES = ["pending", "failed", "succeeded"] as const;

export function mapFileAttempt(r: RawRecord): ProvisioningAttempt {
  const v = r.value;
  const raw = str(v.state);
  return {
    attemptId: str(v.attempt_id),
    soRef: optional(v.so_ref),
    serial: optional(v.serial) ?? "",
    state: ATTEMPT_STATES.find((s) => s === raw.toLowerCase()) ?? "unmapped",
    rawState: raw,
    errorCode: optional(v.error_code),
    startedAt: str(v.started_at),
    endedAt: optional(v.ended_at),
    provenance: r.provenance,
  };
}
