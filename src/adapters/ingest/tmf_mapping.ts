// SPDX-License-Identifier: MIT
/**
 * Maps raw TMF records onto the canonical model (M2-02).
 *
 * The domain never sees a TMF shape: readers yield `RawRecord`s, and these functions turn
 * them into `Order`, `ServiceOrder` and `ProvisioningAttempt`, keeping the record's
 * provenance. A record the mapper cannot read fails with its id and the reason.
 *
 * **State translation is lossy.** TMF has a handful of states and the canonical lifecycle
 * has ten, so an API state stands for the later part of the lifecycle:
 *
 * | TMF state                    | Canonical       | What is lost                              |
 * |------------------------------|-----------------|-------------------------------------------|
 * | `COMPLETED`                  | `ACTIVE`        | nothing: the order reached activation      |
 * | `IN_PROGRESS`                | `PROVISIONING`  | whether it is decomposed, installed, etc.  |
 * | `ACKNOWLEDGED`, `PENDING`    | `SUBMITTED`     | whether it was validated                   |
 * | `FAILED`, `REJECTED`         | `FAILED`        | which of the two it was                    |
 * | `CANCELLED`                  | `CANCELLED`     | nothing                                    |
 *
 * An unknown state is an error, never a silent default.
 *
 * Fields the API does not carry are filled with a marker, not invented: `offerVersion` and
 * `specId` are `"unknown"` and an attempt's `serial` is `""`. Correlation treats an empty
 * serial as absent, so it never joins on it.
 */

import type { Order, OrderState, ProvisioningAttempt, ServiceOrder } from "../../domain/model.ts";
import type { RawRecord } from "../../ports/evidence_source.ts";
import { TmfError } from "./tmf_client.ts";

const ORDER_STATES: Record<string, OrderState> = {
  COMPLETED: "ACTIVE",
  IN_PROGRESS: "PROVISIONING",
  ACKNOWLEDGED: "SUBMITTED",
  PENDING: "SUBMITTED",
  FAILED: "FAILED",
  REJECTED: "FAILED",
  CANCELLED: "CANCELLED",
};

const ATTEMPT_STATES: Record<string, ProvisioningAttempt["state"]> = {
  COMPLETED: "succeeded",
  FAILED: "failed",
  PENDING: "pending",
  IN_PROGRESS: "pending",
};

type Json = Record<string, unknown>;

function fail(record: RawRecord, why: string): never {
  throw new TmfError(
    `${record.provenance.endpoint}: record ${record.line} ("${record.provenance.externalId}") ${why}`,
  );
}

function state<T>(record: RawRecord, table: Record<string, T>): T {
  const tmf = String(record.value.state);
  const mapped = table[tmf];
  if (mapped === undefined) {
    fail(record, `has state "${tmf}", which is not one of ${Object.keys(table).join(", ")}`);
  }
  return mapped;
}

function items(record: RawRecord, field: string): Json[] {
  const list = record.value[field];
  if (!Array.isArray(list) || list.length === 0) fail(record, `has no ${field}`);
  return list as Json[];
}

export function mapProductOrder(record: RawRecord): Order {
  const lines = items(record, "productOrderItem");
  const offering = lines[0].productOffering as Json | undefined;
  return {
    orderRef: record.provenance.externalId,
    submittedAt: String(record.value.orderDate),
    state: state(record, ORDER_STATES),
    offerId: typeof offering?.id === "string" ? offering.id : "unknown",
    offerVersion: "unknown",
    itemRefs: lines.map((line) => String(line.id)),
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
  return {
    soRef: record.provenance.externalId,
    orderRef: link.productOrderId,
    specId: "unknown",
    state: state(record, ORDER_STATES),
    createdAt: String(record.value.orderDate),
    productOrderItemRef: link.id,
    provenance: record.provenance,
  };
}

export function mapActivation(record: RawRecord): ProvisioningAttempt {
  const link = record.value.serviceOrder as Json | undefined;
  const completion = record.value.completionDate;
  return {
    attemptId: record.provenance.externalId,
    soRef: typeof link?.id === "string" ? link.id : null,
    serial: "",
    state: state(record, ATTEMPT_STATES),
    errorCode: null,
    startedAt: String(record.value.activationDate),
    endedAt: typeof completion === "string" ? completion : null,
    provenance: record.provenance,
  };
}
