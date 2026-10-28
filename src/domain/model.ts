// SPDX-License-Identifier: MIT
/**
 * Domain model: the contracts every other layer depends on.
 *
 * This directory has no I/O and imports nothing from outside itself. Rules,
 * reconstruction and impact math live here from milestone M2 on; until then
 * these are types only.
 */

export type SystemId = "CAT" | "OMS" | "BPM" | "PROV";

export type EntityKind =
  | "order"
  | "service_order"
  | "work_order"
  | "process"
  | "activity"
  | "attempt";

export type Actor = "system" | "human" | "partner";

export type OrderState =
  | "DRAFT"
  | "SUBMITTED"
  | "VALIDATED"
  | "DECOMPOSED"
  | "SCHEDULED"
  | "INSTALLED"
  | "PROVISIONING"
  | "ACTIVE"
  | "FAILED"
  | "CANCELLED";

export const TERMINAL_STATES: readonly OrderState[] = ["ACTIVE", "FAILED", "CANCELLED"];

export function isTerminal(state: OrderState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** The only ingestible unit: append-only, immutable, system-agnostic. */
export interface Event {
  eventId: string;
  /** ISO 8601, UTC. */
  at: string;
  system: SystemId;
  entity: EntityKind;
  entityId: string;
  /** System-specific state, normalized to OrderState where possible. */
  state: string;
  actor: Actor;
  orderRef?: string;
  soRef?: string;
  attrs?: Record<string, unknown>;
}

// Catalog -------------------------------------------------------------------

export interface CatalogAttribute {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  /** Systems that read this attribute. Missing PROV attributes are finding R02. */
  usedBy: SystemId[];
}

export interface Spec {
  specId: string;
  name: string;
  serviceType: string;
  attributes: CatalogAttribute[];
}

export interface OfferVersion {
  version: string;
  /** ISO 8601, UTC. */
  validFrom: string;
  validTo: string | null;
  priceUsd: number;
  specId: string;
}

export interface Offer {
  offerId: string;
  name: string;
  family: string;
  status: "active" | "retired";
  versions: OfferVersion[];
}

export interface Catalog {
  offers: Offer[];
  specs: Spec[];
}

// Orders --------------------------------------------------------------------

export interface Order {
  orderRef: string;
  submittedAt: string;
  state: OrderState;
  offerId: string;
  offerVersion: string;
}

export interface ServiceOrder {
  soRef: string;
  orderRef: string;
  specId: string;
  state: OrderState;
  createdAt: string;
  /** Terminal assigned to the service. PROV attempts link back through it. */
  terminalSerial?: string;
}

export interface WorkOrder {
  woRef: string;
  soRef: string;
  kind: "installation" | "activation" | "recovery";
  state: string;
  createdAt: string;
}

export interface ProcessInstance {
  processId: string;
  /** Null when the process only carries a business key. That absence is R05. */
  soRef: string | null;
  businessKey: string | null;
  state: string;
  startedAt: string;
  endedAt: string | null;
}

export interface Activity {
  processId: string;
  /** 1-based order inside the process. */
  sequence: number;
  kind: "task" | "timer" | "gateway";
  name: string;
  actor: Actor;
  startedAt: string;
  endedAt: string | null;
  /** True when a timer fired. An expired timer with no handler is R03. */
  timerExpired?: boolean;
}

export interface ProvisioningAttempt {
  attemptId: string;
  /** Null when the attempt only carries the terminal serial. That absence is R05. */
  soRef: string | null;
  serial: string;
  state: "pending" | "failed" | "succeeded";
  errorCode: string | null;
  startedAt: string;
  endedAt: string | null;
}

// Reconstruction ------------------------------------------------------------

export type SegmentKind = "work" | "wait" | "gap";

export interface Segment {
  system: SystemId;
  from: string;
  to: string;
  kind: SegmentKind;
  state: string;
  actor?: Actor;
}

export interface CorrelationReport {
  strong: boolean;
  /** Human-readable description of every link resolved by a time window. */
  gaps: string[];
}

export interface OrderJourney {
  orderRef: string;
  segments: Segment[];
  /** Rule ids that fired on this journey. */
  findings: string[];
  correlation: CorrelationReport;
}

// Findings and impact -------------------------------------------------------

export type Severity = "critical" | "high" | "medium";

export interface EvidenceRef {
  orderRef: string;
  eventIds: string[];
  note?: string;
}

export interface Impact {
  hoursMonth: number;
  usdMonth: number;
  /** Reported separately; never added to the cost. */
  revenueAtRiskUsd: number;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  affectedOrders: number;
  shareOfOrders: number;
  evidence: EvidenceRef[];
  impact: Impact;
  recommendation: string;
}

export interface ImpactRates {
  manualMinutes: number;
  dailyFollowupMinutes: number;
  cleanupMinutes: number;
  investigationMinutes: number;
  duplicateActivationCostUsd: number;
  arpuUsd: number;
}

export interface ImpactThresholds {
  retryWindowHours: number;
  stuckAfterHours: number;
  duplicateWindowMinutes: number;
}

export interface ImpactConfig {
  currency: "USD";
  ordersPerMonth: number;
  loadedHourUsd: number;
  rates: ImpactRates;
  thresholds: ImpactThresholds;
}
