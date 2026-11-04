// SPDX-License-Identifier: MIT
/** Test helpers: small hand-built worlds for the rule tests. */

import { correlate, type CorrelationInput } from "../src/domain/correlation.ts";
import type {
  ImpactConfig,
  Order,
  ProcessInstance,
  ProvisioningAttempt,
  ServiceOrder,
} from "../src/domain/model.ts";
import { demoConfig } from "./stub_sources.ts";

export const T0 = Date.parse("2026-09-01T00:00:00.000Z");
export const HOUR = 3_600_000;
export const at = (ms: number) => new Date(ms).toISOString();

export const config: ImpactConfig = demoConfig;

export const order = (ref: string, extra: Partial<Order> = {}): Order => ({
  orderRef: ref,
  submittedAt: at(T0),
  state: "ACTIVE",
  offerId: "OFFER-1",
  offerVersion: "v1",
  ...extra,
});

export const so = (ref: string, orderRef: string, extra: Partial<ServiceOrder> = {}) => ({
  soRef: ref,
  orderRef,
  specId: "SPEC-1",
  state: "ACTIVE",
  createdAt: at(T0),
  productOrderItemRef: `${orderRef}-1`,
  ...extra,
} as ServiceOrder);

export const attempt = (
  id: string,
  soRef: string | null,
  startHours: number,
  extra: Partial<ProvisioningAttempt> = {},
): ProvisioningAttempt => ({
  attemptId: id,
  soRef,
  serial: "SN-1",
  state: "failed",
  errorCode: "HUB_TIMEOUT",
  startedAt: at(T0 + startHours * HOUR),
  endedAt: at(T0 + startHours * HOUR + 30_000),
  ...extra,
});

export const world = (input: CorrelationInput) => correlate(input);

export const process = (
  id: string,
  soRef: string,
  tasks: ProcessInstance["tasks"],
): ProcessInstance => ({
  processId: id,
  soRef,
  businessKey: null,
  state: "COMPLETED",
  startedAt: at(T0),
  endedAt: at(T0 + HOUR),
  tasks,
});
