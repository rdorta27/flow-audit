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

/**
 * Where a record came from (M1-02), kept on the entities so a finding can point at its
 * proof. The source system is the entity's own system; this holds the rest.
 *
 * Two different times exist and must not be mixed: the time the thing **happened**
 * (`Event.at`, `Order.submittedAt`, `ServiceOrder.createdAt`) and the time it was
 * **observed** (`retrievedAt`, below).
 */
export interface Provenance {
  /** The record's own id in the source system, for example `ORD-1005`. */
  externalId: string;
  /** What was read: the collection URL for an API, the file path for an export. */
  endpoint: string;
  /** When it was read, ISO 8601 UTC. Observation time, never the time the event happened. */
  retrievedAt: string;
  /** True when the source labels itself simulated (the TMF stub does). */
  simulated: boolean;
  /**
   * `snapshot`: the state of a resource when it was read, with no record of how it got there
   * (an API). `history`: transitions with their own timestamps (an event export). A rule that
   * needs durations or transitions must refuse `snapshot` evidence rather than guess.
   */
  kind: "snapshot" | "history";
}

/** The only ingestible unit: append-only, immutable, system-agnostic. */
export interface Event {
  eventId: string;
  /** When it happened (occurrence time), ISO 8601 UTC. Observation time is in `provenance`. */
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
  provenance?: Provenance;
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
  /** Ids of the order lines, when the source exposes them. Service orders point at one. */
  itemRefs?: string[];
  provenance?: Provenance;
}

export interface ServiceOrder {
  soRef: string;
  orderRef: string;
  specId: string;
  state: OrderState;
  createdAt: string;
  /** Terminal assigned to the service. PROV attempts link back through it. */
  terminalSerial?: string;
  /**
   * The product order item this service order decomposes. R04 keys on it: two service
   * orders over one item is a duplicate, two over different items is a multi-line order.
   */
  productOrderItemRef?: string;
  provenance?: Provenance;
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
  provenance?: Provenance;
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
  /** Why `segments` is empty when the evidence cannot support it (a snapshot has no history). */
  segmentsUnavailable?: string;
  /** Rule ids that fired on this journey. */
  findings: string[];
  correlation: CorrelationReport;
}

// Findings and impact -------------------------------------------------------

export type Severity = "critical" | "high" | "medium";

/** Version of the file contract in `docs/architecture/report-schema.md`. */
export const SCHEMA_VERSION = "findings/1";

/** At most this many orders go in `Finding.evidence`; `evidenceTotal` says how many exist. */
export const EVIDENCE_SAMPLE_MAX = 20;

/** One record that proves part of a finding, named by system, external id and endpoint. */
export interface RecordRef {
  system: SystemId;
  externalId: string;
  endpoint: string;
}

export interface EvidenceRef {
  orderRef: string;
  eventIds: string[];
  /** The records behind the order's evidence, so a person can open them in their source. */
  records: RecordRef[];
  note?: string;
}

export type CostKind = "recurring" | "one_off" | "accumulated_to_period_end";

/**
 * `measured`: counted in the evidence. `rate_assumption`: an amount from `config.json`.
 * `not_observed`: the source cannot show it.
 */
export type CostBasis = "measured" | "rate_assumption" | "not_observed";

/** A number taken from `config.json`, named by its dotted key, for example `rates.cleanup_minutes`. */
export interface CostInput {
  key: string;
  value: number;
  /** Where the rate comes from, who owns it and when it was set (M5-07); may be null until then. */
  source: string | null;
  owner: string | null;
  date: string | null;
}

export interface CostTerm {
  name: string;
  amount: number;
  /** The basis of the amount: a rate is `rate_assumption` even when its count is measured. */
  basis: CostBasis;
  /** The count the term multiplies, when the evidence measured one (orders, duplicates). */
  observed: number | null;
  /** Keys of `Cost.inputs` the term uses. */
  inputKeys: string[];
}

export interface UnmeasuredTerm {
  term: string;
  reason: string;
}

export interface RevenueAtRisk {
  /** Never part of `Cost.amountMonth`. */
  amount: number;
  /** `arpu_assumption`, or null when the rule reports none. */
  basis: "arpu_assumption" | null;
  /** Fixed text the report prints next to the figure. */
  label: string;
}

export interface Cost {
  currency: "USD";
  kind: CostKind;
  /** Days the amount covers (recurring and accumulated kinds); null for a one-off. */
  periodDays: number | null;
  /** How the amount became "per month", or null when it did not need to. */
  normalisation: string | null;
  hoursMonth: number;
  /** Sum of `terms[].amount`. Revenue at risk is not in it. */
  amountMonth: number;
  /** The formula of `rules.md`, as text. */
  formula: string;
  inputs: CostInput[];
  terms: CostTerm[];
  unmeasured: UnmeasuredTerm[];
  revenueAtRisk: RevenueAtRisk;
}

export type FindingStatus = "detected" | "not_detected" | "insufficient_evidence" | "not_evaluable";

export type EvidenceLevel = "strong" | "weak" | "history";

export interface Confidence {
  level: "confirmed" | "possible";
  /** Share of the links the evidence rests on that are not `explicit`. */
  inferredLinkShare: number;
}

export interface Finding {
  /** The rule, for example `R04`. */
  id: string;
  /** The rule and its version, for example `R04@1`. */
  ruleVersion: string;
  title: string;
  /** One sentence a non-specialist understands. */
  plainSummary: string;
  /** The system, or the seam between two systems, where it happens (for example `OMS`). */
  where: string;
  severity: Severity;
  status: FindingStatus;
  affectedOrders: number;
  shareOfOrders: number;
  evidenceLevel: EvidenceLevel;
  /** A sample of at most `EVIDENCE_SAMPLE_MAX` orders. */
  evidence: EvidenceRef[];
  evidenceTotal: number;
  confidence: Confidence;
  /** False when the finding stays out of the net total (R05, D-11). */
  inTotal: boolean;
  cost: Cost;
  recommendation: string;
}

// The report (findings/1) -----------------------------------------------------

export interface ReportRun {
  id: string;
  generatedAt: string;
  inputsHash: string;
  configHash: string;
  rulesHash: string;
}

export interface ReportSource {
  system: SystemId;
  /** Name of the reader, for example `TMF622 productOrder`. */
  name: string;
  kind: "tmf-api" | "file";
  /** The endpoint or path the records came from. */
  endpoint: string;
  simulated: boolean;
  evidenceKind: "snapshot" | "history";
  records: number;
  rowsRead: number;
  rowsDiscarded: number;
  /** Fingerprint of the records as read (not of their provenance). */
  sha256: string;
}

export interface ReportLabels {
  syntheticData: boolean;
  simulatedIntegration: boolean;
  estimatedImpact: boolean;
}

export interface ReportCorrelation {
  /** Link counts by kind and confidence, zeros included. */
  links: Record<string, Record<string, number>>;
  /** Records that could not be placed under exactly one order. */
  unresolved: number;
  /** Records whose state was not recognised (M2-05); 0 until that card exists. */
  unmapped: number;
}

export interface ReportSystem {
  system: SystemId;
  name: string;
  role: string;
  /** 1-based position in the order-to-activate flow. */
  position: number;
  read: boolean;
  sourceKind: "tmf-api" | "file" | null;
  records: number;
  /** Share of orders with a record from this system; null when the system was not read. */
  coverage: number | null;
  cannotObserve: string[];
  /** Ids of the findings whose evidence touches this system. */
  findings: string[];
}

export interface ReportTotals {
  hours: number;
  amount: number;
}

export interface ReportOverlap {
  /** Order -> rule ids that touch it. Empty until M4-05 computes it. */
  byOrder: Record<string, string[]>;
}

export interface ReportJourney extends OrderJourney {
  /** The order told as a short story (M4-04); null until then. */
  story: string | null;
}

/** The whole report: this is `findings/1`. The file uses the snake_case form of these keys. */
export interface AuditReport {
  schemaVersion: typeof SCHEMA_VERSION;
  engineVersion: string;
  run: ReportRun;
  sources: ReportSource[];
  labels: ReportLabels;
  config: ImpactConfig;
  correlation: ReportCorrelation;
  systems: ReportSystem[];
  findings: Finding[];
  overlap: ReportOverlap;
  /** `gross` adds every finding in the total; `net` counts each order once (M4-05, null until then). */
  totals: { gross: ReportTotals; net: ReportTotals | null };
  journeys: ReportJourney[];
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
