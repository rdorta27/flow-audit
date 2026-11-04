// SPDX-License-Identifier: MIT
import { mapActivation, mapProductOrder, mapServiceOrder } from "../adapters/ingest/tmf_mapping.ts";
import { correlate, type CorrelationResult, summarizeLinks } from "../domain/correlation.ts";
import { journeysWithSegments } from "../domain/segments.ts";
import { buildStory } from "../domain/story.ts";
import { computeTotals, type OrderCharge } from "../domain/totals.ts";
import {
  type AuditReport,
  type Catalog,
  type Finding,
  type ImpactConfig,
  type OrderJourney,
  type ReportSource,
  type ReportSystem,
  SCHEMA_VERSION,
  type SystemId,
} from "../domain/model.ts";
import { type RuleContext, RULES } from "../domain/rules/index.ts";
import {
  assessQuality,
  type NotEvaluable,
  notEvaluableRules,
  type QualityReport,
  type QualityThresholds,
  rangeOf,
  type ReaderFacts,
  type SystemFacts,
} from "../domain/quality.ts";
import type { Order, ProcessInstance, ProvisioningAttempt, ServiceOrder } from "../domain/model.ts";
import type { Clock } from "../ports/clock.ts";
import type { EvidenceSource, RawRecord } from "../ports/evidence_source.ts";

import { ENGINE_VERSION } from "../version.ts";

/** How many orders the report draws as journeys. */
export const REPORT_JOURNEYS_MAX = 3;

export interface AuditOptions {
  /** Directory with the exports; reserved for the file sources (M5-02). */
  dataset?: string;
}

/** How a source's records become the canonical model; the TMF mappers when absent. */
export interface RecordMappers {
  order(record: RawRecord): Order;
  serviceOrder(record: RawRecord): ServiceOrder;
  attempt(record: RawRecord): ProvisioningAttempt;
  process?(record: RawRecord): ProcessInstance;
}

/**
 * The sources the audit reads: product orders, service orders and activations (TMF622, TMF641
 * and TMF640 over HTTP, or the files of M5-02), and, only from files, the work orders, the
 * processes and the catalog.
 */
export interface AuditSources {
  productOrders: EvidenceSource;
  serviceOrders: EvidenceSource;
  activations: EvidenceSource;
  workOrders?: EvidenceSource;
  processes?: EvidenceSource;
  catalog?: EvidenceSource;
  mappers?: RecordMappers;
  /** The audited period and the gate's thresholds, from the mapping (M5-08, M5-10). */
  period?: { start: string; end: string };
  quality?: Partial<QualityThresholds>;
  /** The repeats the readers dropped; call after reading. Absent for the TMF sources. */
  readerFacts?: () => Promise<ReaderFacts[]>;
}

/** Asks for the data-quality gate (M5-10); without it no gate runs. */
export interface GateOptions {
  /** Run the rules even when the gate fails; the answer then says it was forced. */
  force?: boolean;
}

export interface AuditDeps {
  sources?: AuditSources;
  /** The impact rates and thresholds; the caller reads them from `config.json`. */
  config?: ImpactConfig;
  clock: Clock;
  gate?: GateOptions;
  /** Progress lines for the caller to show; the application layer prints nothing itself. */
  onProgress?: (message: string) => void;
}

export interface AuditResult {
  /** The in-memory `findings/1` report (written to disk by M4-02). */
  report: AuditReport;
  findings: Finding[];
  /** The journeys the report draws (see `REPORT_JOURNEYS_MAX`), not every order. */
  journeys: OrderJourney[];
  /** The gate's answer; absent when no gate was asked for. */
  quality?: QualityReport;
  /** The full correlation: every order with its linked records. */
  correlation: CorrelationResult;
  /** The records as the sources served them, for callers that show the proof. */
  records: {
    productOrders: RawRecord[];
    serviceOrders: RawRecord[];
    activations: RawRecord[];
    /** Empty when the source does not carry them (the TMF stub). */
    workOrders: RawRecord[];
    processes: RawRecord[];
    catalog: RawRecord[];
  };
}

/** The data failed the gate and `force` was not set (exit code 3). */
export class QualityGateError extends Error {
  constructor(readonly quality: QualityReport) {
    super(`the data failed the quality gate: ${quality.failures.length} problem(s)`);
    this.name = "QualityGateError";
  }
}

export class NoEvidenceSourceError extends Error {
  constructor() {
    super(
      "no evidence source configured. Pass --dataset <dir> (the exports) or " +
        "--source stub (the simulated TMF stub, see `deno task stub`).",
    );
    this.name = "NoEvidenceSourceError";
  }
}

async function collect(source: EvidenceSource): Promise<RawRecord[]> {
  const rows: RawRecord[] = [];
  for await (const row of source.read()) rows.push(row);
  return rows;
}

/** The catalog the file source served as records (`kind` offer or spec); undefined with none. */
function catalogOf(records: readonly RawRecord[]): Catalog | undefined {
  if (records.length === 0) return undefined;
  const parts = (kind: string) =>
    records.filter((r) => r.value.kind === kind).map((r) => {
      const { kind: _kind, id: _id, ...body } = r.value;
      return body;
    });
  return { offers: parts("offer"), specs: parts("spec") } as unknown as Catalog;
}

/** JSON with sorted keys, so the same data always gives the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function describeSource(source: EvidenceSource, rows: RawRecord[]): Promise<ReportSource> {
  const first = rows[0];
  const endpoint = first?.provenance.endpoint ?? source.name;
  return {
    system: first?.system ?? "OMS",
    name: source.name,
    kind: /^https?:\/\//.test(endpoint) ? "tmf-api" : "file",
    endpoint,
    simulated: first?.provenance.simulated ?? false,
    evidenceKind: first?.provenance.kind ?? "snapshot",
    records: rows.length,
    rowsRead: rows.length,
    rowsDiscarded: 0,
    // The records only: the time they were read changes on every run and must not.
    sha256: await sha256(canonical(rows.map((r) => r.value))),
  };
}

const SYSTEM_INFO: Record<
  SystemId,
  { name: string; role: string; cannotObserve: string[]; cannotObserveHistory: string[] }
> = {
  CAT: {
    name: "Product catalog",
    role: "lists what is sold and the technical data needed to switch it on",
    cannotObserve: ["not read in this run: no catalog source is wired yet"],
    cannotObserveHistory: [
      "which version of an offer applied to an order: the catalog holds validity dates only",
    ],
  },
  OMS: {
    name: "Order manager",
    role: "receives the order and splits it into service orders",
    cannotObserve: ["when each state change happened: the source is a snapshot, not a history"],
    cannotObserveHistory: [
      "when each state change happened: a row holds the current state and its creation time",
    ],
  },
  BPM: {
    name: "Process orchestrator",
    role: "runs the tasks in order and hands some to people",
    cannotObserve: ["not read in this run: no process source is wired yet"],
    cannotObserveHistory: [],
  },
  PROV: {
    name: "Activation system",
    role: "switches the service on in the network; can fail and retry",
    cannotObserve: ["when each attempt changed state: the source is a snapshot, not a history"],
    cannotObserveHistory: [],
  },
};
const SYSTEM_ORDER: SystemId[] = ["CAT", "OMS", "BPM", "PROV"];

interface Prepared {
  sources: AuditSources;
  config: ImpactConfig;
  rawOrders: RawRecord[];
  rawServices: RawRecord[];
  rawAttempts: RawRecord[];
  rawWorkOrders: RawRecord[];
  rawProcesses: RawRecord[];
  rawCatalog: RawRecord[];
  correlation: CorrelationResult;
  quality?: QualityReport;
}

/** Facts per system for the gate, from the mapped records and what the readers dropped. */
async function gateFacts(
  p: Pick<Prepared, "sources" | "correlation" | "rawOrders" | "rawServices" | "rawAttempts"> & {
    rawProcesses: RawRecord[];
    rawCatalog: RawRecord[];
    mapped: { orders: Order[]; serviceOrders: ServiceOrder[]; processes: ProcessInstance[] };
    attempts: ProvisioningAttempt[];
  },
): Promise<SystemFacts[]> {
  const { sources, correlation: c, mapped } = p;
  const reader = new Map((await sources.readerFacts?.())?.map((r) => [r.system, r]));
  const unknown = (system: SystemId) => {
    const out: Record<string, number> = {};
    for (const u of c.unmapped) {
      if (u.system === system) out[u.state] = (out[u.state] ?? 0) + u.count;
    }
    return out;
  };
  const facts = (
    system: SystemId,
    name: string,
    rows: number,
    times: string[],
    children: number,
    orphans: number,
    statesRead: number,
  ): SystemFacts => ({
    system,
    label: name,
    rows,
    duplicateKeys: reader.get(system)?.duplicateKeys ?? 0,
    exactDuplicates: reader.get(system)?.exactDuplicates ?? 0,
    range: rangeOf(times),
    children,
    orphans,
    statesRead,
    unknownStates: unknown(system),
  });
  const list: SystemFacts[] = [
    facts(
      "OMS",
      sources.productOrders.name,
      p.rawOrders.length,
      [...mapped.orders.map((o) => o.submittedAt), ...mapped.serviceOrders.map((o) => o.createdAt)],
      mapped.serviceOrders.length,
      c.unresolved.serviceOrders.length,
      mapped.orders.length + mapped.serviceOrders.length,
    ),
  ];
  if (sources.processes) {
    list.push(facts(
      "BPM",
      sources.processes.name,
      p.rawProcesses.length,
      mapped.processes.map((x) => x.startedAt),
      mapped.processes.length,
      c.unresolved.processes.length,
      mapped.processes.length,
    ));
  }
  list.push(facts(
    "PROV",
    sources.activations.name,
    p.rawAttempts.length,
    p.attempts.map((a) => a.startedAt),
    p.attempts.length,
    c.unresolved.attempts.length,
    p.attempts.length,
  ));
  if (sources.catalog) {
    list.push(facts("CAT", sources.catalog.name, p.rawCatalog.length, [], 0, 0, 0));
  }
  return list;
}

/**
 * Reads the sources, maps them, correlates and, when asked, runs the data-quality gate.
 * Rules are not run here: `checkAudit` stops at this point and `runAudit` goes on.
 */
async function prepare(deps: AuditDeps): Promise<Prepared> {
  const { sources, config } = deps;
  if (!sources || !config) throw new NoEvidenceSourceError();
  const say = deps.onProgress ?? (() => {});

  say("reading product orders (TMF622)");
  const rawOrders = await collect(sources.productOrders);
  say(`reading service orders (TMF641); ${rawOrders.length} orders so far`);
  const rawServices = await collect(sources.serviceOrders);
  say(`reading activations (TMF640); ${rawServices.length} service orders so far`);
  const rawAttempts = await collect(sources.activations);

  const rawWorkOrders = sources.workOrders ? await collect(sources.workOrders) : [];
  const rawProcesses = sources.processes ? await collect(sources.processes) : [];
  const rawCatalog = sources.catalog ? await collect(sources.catalog) : [];

  say("correlating");
  const map: RecordMappers = sources.mappers ?? {
    order: mapProductOrder,
    serviceOrder: mapServiceOrder,
    attempt: mapActivation,
  };
  const orders = rawOrders.map(map.order);
  const serviceOrders = rawServices.map(map.serviceOrder);
  const processes = map.process ? rawProcesses.map(map.process) : undefined;
  const attempts = rawAttempts.map(map.attempt);
  const correlation = correlate({ orders, serviceOrders, processes, attempts });

  const prepared: Prepared = {
    sources,
    config,
    rawOrders,
    rawServices,
    rawAttempts,
    rawWorkOrders,
    rawProcesses,
    rawCatalog,
    correlation,
  };
  if (deps.gate) {
    say("checking the data quality");
    const facts = await gateFacts({
      ...prepared,
      mapped: { orders, serviceOrders, processes: processes ?? [] },
      attempts,
    });
    const quality = assessQuality(facts, {
      thresholds: sources.quality,
      period: sources.period,
    });
    quality.notEvaluable = notEvaluableRules(quality, RULES.map((r) => r.id));
    quality.forced = !quality.passed && deps.gate.force === true;
    prepared.quality = quality;
  }
  return prepared;
}

/** Reads, maps and runs the gate, nothing more (`audit --check`). */
export async function checkAudit(deps: AuditDeps): Promise<{
  quality: QualityReport;
  correlation: CorrelationResult;
  records: AuditResult["records"];
}> {
  const p = await prepare({ ...deps, gate: deps.gate ?? {} });
  return { quality: p.quality!, correlation: p.correlation, records: recordsOf(p) };
}

function recordsOf(p: Prepared): AuditResult["records"] {
  return {
    productOrders: p.rawOrders,
    serviceOrders: p.rawServices,
    activations: p.rawAttempts,
    workOrders: p.rawWorkOrders,
    processes: p.rawProcesses,
    catalog: p.rawCatalog,
  };
}

/**
 * The only entry point of the application: reads the three TMF sources, maps them to the
 * canonical model, correlates, runs every registered rule and returns the report in memory.
 * No format and no I/O beyond the injected sources and clock.
 */
export async function runAudit(
  _options: AuditOptions,
  deps: AuditDeps,
): Promise<AuditResult> {
  const prepared = await prepare(deps);
  const { sources, config, correlation, quality } = prepared;
  const { rawOrders, rawServices, rawAttempts, rawWorkOrders, rawProcesses, rawCatalog } = prepared;
  if (quality && !quality.passed && !quality.forced) throw new QualityGateError(quality);
  const say = deps.onProgress ?? (() => {});
  const skipped: NotEvaluable[] = quality?.notEvaluable ?? [];

  const context: RuleContext = { correlation, catalog: catalogOf(rawCatalog) };
  const findings: Finding[] = [];
  const charges: OrderCharge[] = [];
  for (const rule of RULES) {
    if (skipped.some((n) => n.rule === rule.id)) {
      say(`skipping ${rule.version}: not evaluable`);
      continue;
    }
    say(`running ${rule.version}`);
    const finding = rule.detect(correlation.orders, config, context);
    if (finding) {
      findings.push(finding);
      charges.push(...rule.charges(correlation.orders, config, context));
    }
  }

  // A source that served nothing cannot name its system; take it from the reader's role.
  const described: [EvidenceSource, RawRecord[], SystemId][] = [
    [sources.productOrders, rawOrders, "OMS"],
    [sources.serviceOrders, rawServices, "OMS"],
    [sources.activations, rawAttempts, "PROV"],
  ];
  if (sources.workOrders) described.push([sources.workOrders, rawWorkOrders, "OMS"]);
  if (sources.processes) described.push([sources.processes, rawProcesses, "BPM"]);
  if (sources.catalog) described.push([sources.catalog, rawCatalog, "CAT"]);
  const reportSources = await Promise.all(described.map(([s, rows]) => describeSource(s, rows)));
  described.forEach(([, , system], index) => reportSources[index].system = system);

  const touched = (system: SystemId) =>
    findings.filter((f) => f.evidence.some((e) => e.records.some((r) => r.system === system)))
      .map((f) => f.id);
  const total = correlation.orders.length;
  const withAttempts = correlation.orders.filter((e) => e.attempts.length > 0).length;
  const systems: ReportSystem[] = SYSTEM_ORDER.map((system, index) => {
    const mine = reportSources.filter((s) => s.system === system);
    const read = mine.length > 0;
    return {
      system,
      ...{ name: SYSTEM_INFO[system].name, role: SYSTEM_INFO[system].role },
      position: index + 1,
      read,
      sourceKind: read ? mine[0].kind : null,
      records: mine.reduce((sum, s) => sum + s.records, 0),
      coverage: !read || total === 0 ? null : system === "PROV" ? withAttempts / total : 1,
      cannotObserve: read && mine[0].evidenceKind === "history"
        ? SYSTEM_INFO[system].cannotObserveHistory
        : SYSTEM_INFO[system].cannotObserve,
      findings: touched(system),
    };
  });

  const allJourneys = journeysWithSegments(correlation, []);
  const sampled = [...new Set(findings.flatMap((f) => f.evidence.map((e) => e.orderRef)))]
    .slice(0, REPORT_JOURNEYS_MAX);
  const journeys = sampled.flatMap((ref) => {
    const journey = allJourneys.find((j) => j.orderRef === ref);
    if (!journey) return [];
    return [{
      ...journey,
      findings: findings.filter((f) => f.evidence.some((e) => e.orderRef === ref)).map((f) => f.id),
    }];
  });

  const inputsHash = await sha256(reportSources.map((s) => s.sha256).join("\n"));
  const configHash = await sha256(canonical(config));
  const rulesHash = await sha256(RULES.map((r) => r.version).join("\n"));
  const simulated = reportSources.some((s) => s.simulated);
  const totals = computeTotals(findings, charges);

  const report: AuditReport = {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    run: {
      id: (await sha256(`${inputsHash}\n${configHash}\n${rulesHash}`)).slice(0, 16),
      generatedAt: deps.clock.nowIso(),
      inputsHash,
      configHash,
      rulesHash,
    },
    sources: reportSources,
    labels: {
      // Only a source that labels itself simulated is known to hold invented data.
      syntheticData: simulated,
      simulatedIntegration: simulated,
      estimatedImpact: true,
    },
    config,
    correlation: {
      links: summarizeLinks(correlation.links),
      unresolved: correlation.unresolved.serviceOrders.length +
        correlation.unresolved.processes.length + correlation.unresolved.attempts.length,
      unmapped: correlation.unmapped.reduce((sum, u) => sum + u.count, 0),
    },
    systems,
    findings,
    overlap: totals.overlap,
    totals: { gross: totals.gross, net: totals.net },
    journeys: journeys.map((j) => ({
      ...j,
      story: buildStory(
        correlation.orders.find((e) => e.order.orderRef === j.orderRef)!,
        findings,
      ),
    })),
  };

  return {
    report,
    findings,
    journeys,
    quality,
    correlation,
    records: recordsOf(prepared),
  };
}
