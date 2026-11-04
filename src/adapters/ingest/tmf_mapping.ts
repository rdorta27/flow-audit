// SPDX-License-Identifier: MIT
/**
 * Maps raw TMF records onto the canonical model (M2-02).
 *
 * The domain never sees a TMF shape: readers yield `RawRecord`s, and these functions turn
 * them into `Order`, `ServiceOrder` and `ProvisioningAttempt`, keeping the record's
 * provenance. A record the mapper cannot read (no items, no link) fails with its id and the reason.
 *
 * **State translation is lossy.** TMF has a handful of states and the canonical lifecycle
 * has more, so an API state stands for the later part of the lifecycle. Names are compared
 * without case or separators (`IN_PROGRESS` = `inProgress`):
 *
 * | TMF state                                  | Canonical       | What is lost                  |
 * |--------------------------------------------|-----------------|-------------------------------|
 * | `completed`                                | `ACTIVE`        | nothing                       |
 * | `inProgress`                               | `PROVISIONING`  | whether it is decomposed etc. |
 * | `acknowledged`, `pending`                  | `SUBMITTED`     | whether it was validated      |
 * | `held`                                     | `HELD`          | why it is held                |
 * | `partial`                                  | `PARTIAL`       | which items finished          |
 * | `assessingCancellation`, `pendingCancellation` | `CANCELLING` | which of the two           |
 * | `failed`                                   | `FAILED`        | nothing                       |
 * | `rejected`                                 | `REJECTED`      | nothing (a validation refusal) |
 * | `cancelled`                                | `CANCELLED`     | nothing                       |
 * | anything else                              | `UNMAPPED`      | the meaning; `rawState` keeps the text |
 *
 * An unknown state never fails the read: the record maps to `UNMAPPED` (`unmapped` for an
 * attempt), keeps the source text in `rawState`, and correlation counts it by system and
 * state. Rules treat it as neither failed nor active.
 *
 * Fields the API does not carry are filled with a marker, not invented: `offerVersion` and
 * `specId` are `"unknown"` and an attempt's `serial` is `""`. Correlation treats an empty
 * serial as absent, so it never joins on it.
 */

import type {
  AttemptOperation,
  AttemptOutcome,
  ItemAction,
  Order,
  OrderItem,
  OrderState,
  ProvisioningAttempt,
  ServiceOrder,
} from "../../domain/model.ts";
import type { RawRecord } from "../../ports/evidence_source.ts";
import { TmfError } from "./tmf_client.ts";

/** Lower case with separators dropped, so `IN_PROGRESS`, `inProgress` and `in-progress` meet. */
function normalize(state: string): string {
  return state.replace(/[\s_-]/g, "").toLowerCase();
}

const ORDER_STATES: Record<string, OrderState> = {
  completed: "ACTIVE",
  inprogress: "PROVISIONING",
  acknowledged: "SUBMITTED",
  pending: "SUBMITTED",
  held: "HELD",
  partial: "PARTIAL",
  assessingcancellation: "CANCELLING",
  pendingcancellation: "CANCELLING",
  failed: "FAILED",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
};

const ATTEMPT_STATES: Record<string, ProvisioningAttempt["state"]> = {
  completed: "succeeded",
  failed: "failed",
  pending: "pending",
  acknowledged: "pending",
  inprogress: "pending",
};

type Json = Record<string, unknown>;

function fail(record: RawRecord, why: string): never {
  throw new TmfError(
    `${record.provenance.endpoint}: record ${record.line} ("${record.provenance.externalId}") ${why}`,
  );
}

/** An unknown state is kept as `unmapped`; the record is read, never dropped or guessed. */
function state<T>(record: RawRecord, table: Record<string, T>, unmapped: T): T {
  return table[normalize(String(record.value.state))] ?? unmapped;
}

function items(record: RawRecord, field: string): Json[] {
  const list = record.value[field];
  if (!Array.isArray(list) || list.length === 0) fail(record, `has no ${field}`);
  return list as Json[];
}

const ACTIONS: Record<string, ItemAction> = {
  add: "add",
  modify: "modify",
  delete: "delete",
  nochange: "noChange",
};

/** An action outside the four TMF values is left out, never guessed. */
function actionOf(value: unknown): ItemAction | undefined {
  return typeof value === "string" ? ACTIONS[normalize(value)] : undefined;
}

/** A reference written as `{id}` or as the bare id. */
function refOf(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  const id = (value as Json | undefined)?.id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/** Offer, spec, action, bundle parent and replacement of one product order line (M2-08). */
function mapLine(line: Json): OrderItem {
  const offering = line.productOffering as Json | undefined;
  const item: OrderItem = {
    itemRef: String(line.id),
    offerId: typeof offering?.id === "string" ? offering.id : "unknown",
  };
  const spec = refOf((line.product as Json | undefined)?.productSpecification);
  if (spec) item.specId = spec;
  const action = actionOf(line.action);
  if (action) item.action = action;
  const parent = refOf(line.parentItem);
  if (parent) item.parentItem = parent;
  const relations = Array.isArray(line.productOrderItemRelationship)
    ? line.productOrderItemRelationship as Json[]
    : [];
  for (const relation of relations) {
    const kind = normalize(String(relation.relationshipType));
    const id = refOf(relation);
    if (!id) continue;
    if (kind === "replaces") item.replacesItem = id;
    else if (kind === "replacedby" || kind === "supersededby") item.supersededByItem = id;
    else if (kind === "bundledby" && !item.parentItem) item.parentItem = id;
  }
  return item;
}

export function mapProductOrder(record: RawRecord): Order {
  const lines = items(record, "productOrderItem");
  const mapped = lines.map(mapLine);
  const replaces = refOf(record.value.replaces);
  const supersededBy = refOf(record.value.supersededBy);
  return {
    ...(replaces ? { replacesOrderRef: replaces } : {}),
    ...(supersededBy ? { supersededByOrderRef: supersededBy } : {}),
    items: mapped,
    orderRef: record.provenance.externalId,
    submittedAt: String(record.value.orderDate),
    state: state(record, ORDER_STATES, "UNMAPPED"),
    rawState: String(record.value.state),
    offerId: mapped[0].offerId,
    offerVersion: "unknown",
    itemRefs: mapped.map((item) => item.itemRef),
    provenance: record.provenance,
  };
}

export function mapServiceOrder(record: RawRecord): ServiceOrder {
  const lines = items(record, "serviceOrderItem");
  const link = lines[0].productOrderItem as Json | undefined;
  if (typeof link?.productOrderId !== "string" || typeof link?.id !== "string") {
    fail(record, "has an item with no productOrderItem link");
  }
  const parents = new Set(
    lines.map((line) => (line.productOrderItem as Json | undefined)?.productOrderId),
  );
  if (parents.size > 1) {
    fail(record, `has items that decompose different product orders (${[...parents].join(", ")})`);
  }
  const action = actionOf(lines[0].action);
  const spec = refOf((lines[0].service as Json | undefined)?.serviceSpecification);
  return {
    ...(action ? { action } : {}),
    soRef: record.provenance.externalId,
    orderRef: link.productOrderId,
    specId: spec ?? "unknown",
    state: state(record, ORDER_STATES, "UNMAPPED"),
    rawState: String(record.value.state),
    createdAt: String(record.value.orderDate),
    productOrderItemRef: link.id,
    provenance: record.provenance,
  };
}

const OPERATIONS: readonly AttemptOperation[] = ["activate", "suspend", "deactivate", "modify"];
const OUTCOMES: readonly AttemptOutcome[] = ["succeeded", "failed", "timeout", "pending"];

/** Reads an optional enum field; a value outside the list is left out, never guessed. */
function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" ? allowed.find((a) => a === normalize(value)) : undefined;
}

export function mapActivation(record: RawRecord): ProvisioningAttempt {
  const link = record.value.serviceOrder as Json | undefined;
  const completion = record.value.completionDate;
  const v = record.value;
  const optional: Partial<ProvisioningAttempt> = {};
  if (Number.isInteger(v.attemptNo) && (v.attemptNo as number) > 0) {
    optional.attemptNo = v.attemptNo as number;
  }
  const operation = pick(v.operation, OPERATIONS);
  if (operation) optional.operation = operation;
  if (typeof v.requestId === "string" && v.requestId !== "") optional.requestId = v.requestId;
  if (typeof v.callbackDate === "string" && !Number.isNaN(Date.parse(v.callbackDate))) {
    optional.callbackAt = v.callbackDate;
  }
  const outcome = pick(v.outcome, OUTCOMES);
  if (outcome) optional.outcome = outcome;
  return {
    ...optional,
    attemptId: record.provenance.externalId,
    soRef: typeof link?.id === "string" ? link.id : null,
    serial: "",
    state: state(record, ATTEMPT_STATES, "unmapped"),
    rawState: String(record.value.state),
    errorCode: typeof v.errorCode === "string" && v.errorCode !== "" ? v.errorCode : null,
    startedAt: String(record.value.activationDate),
    endedAt: typeof completion === "string" ? completion : null,
    provenance: record.provenance,
  };
}
