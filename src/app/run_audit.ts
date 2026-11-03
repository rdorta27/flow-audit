// SPDX-License-Identifier: MIT
import { mapActivation, mapProductOrder, mapServiceOrder } from "../adapters/ingest/tmf_mapping.ts";
import { correlate, type CorrelationResult, summarizeLinks } from "../domain/correlation.ts";
import { journeysWithSegments } from "../domain/segments.ts";
import {
  type AuditReport,
  type Finding,
  type ImpactConfig,
  type OrderJourney,
  type ReportSource,
  type ReportSystem,
  SCHEMA_VERSION,
  type SystemId,
} from "../domain/model.ts";
import { RULES } from "../domain/rules/index.ts";
import type { Clock } from "../ports/clock.ts";
import type { EvidenceSource, RawRecord } from "../ports/evidence_source.ts";

/** Version of the engine, written in every report. Bumped with the release. */
export const ENGINE_VERSION = "0.3.1";

/** How many orders the report draws as journeys. */
export const REPORT_JOURNEYS_MAX = 3;

export interface AuditOptions {
  /** Directory with the exports; reserved for the file sources (M5-02). */
  dataset?: string;
}

/** The three sources the audit reads today: TMF622, TMF641 and TMF640. */
export interface AuditSources {
  productOrders: EvidenceSource;
  serviceOrders: EvidenceSource;
  activations: EvidenceSource;
}

export interface AuditDeps {
  sources?: AuditSources;
  /** The impact rates and thresholds; the caller reads them from `config.json`. */
  config?: ImpactConfig;
  clock: Clock;
  /** Progress lines for the caller to show; the application layer prints nothing itself. */
  onProgress?: (message: string) => void;
}

export interface AuditResult {
  /** The in-memory `findings/1` report (written to disk by M4-02). */
  report: AuditReport;
  findings: Finding[];
  /** The journeys the report draws (see `REPORT_JOURNEYS_MAX`), not every order. */
  journeys: OrderJourney[];
  /** The full correlation: every order with its linked records. */
  correlation: CorrelationResult;
  /** The records as the sources served them, for callers that show the proof. */
  records: { productOrders: RawRecord[]; serviceOrders: RawRecord[]; activations: RawRecord[] };
}

export class NoEvidenceSourceError extends Error {
  constructor() {
    super(
      "no evidence source configured. Pass --source stub (the simulated TMF stub, " +
        "see `deno task stub`); file sources arrive in milestone M5-02.",
    );
    this.name = "NoEvidenceSourceError";
  }
}

async function collect(source: EvidenceSource): Promise<RawRecord[]> {
  const rows: RawRecord[] = [];
  for await (const row of source.read()) rows.push(row);
  return rows;
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
  { name: string; role: string; cannotObserve: string[] }
> = {
  CAT: {
    name: "Product catalog",
    role: "lists what is sold and the technical data needed to switch it on",
    cannotObserve: ["not read in this run: no catalog source is wired yet"],
  },
  OMS: {
    name: "Order manager",
    role: "receives the order and splits it into service orders",
    cannotObserve: ["when each state change happened: the source is a snapshot, not a history"],
  },
  BPM: {
    name: "Process orchestrator",
    role: "runs the tasks in order and hands some to people",
    cannotObserve: ["not read in this run: no process source is wired yet"],
  },
  PROV: {
    name: "Activation system",
    role: "switches the service on in the network; can fail and retry",
    cannotObserve: ["when each attempt changed state: the source is a snapshot, not a history"],
  },
};
const SYSTEM_ORDER: SystemId[] = ["CAT", "OMS", "BPM", "PROV"];

/**
 * The only entry point of the application: reads the three TMF sources, maps them to the
 * canonical model, correlates, runs every registered rule and returns the report in memory.
 * No format and no I/O beyond the injected sources and clock.
 */
export async function runAudit(
  _options: AuditOptions,
  deps: AuditDeps,
): Promise<AuditResult> {
  const { sources, config } = deps;
  if (!sources || !config) throw new NoEvidenceSourceError();
  const say = deps.onProgress ?? (() => {});

  say("reading product orders (TMF622)");
  const rawOrders = await collect(sources.productOrders);
  say(`reading service orders (TMF641); ${rawOrders.length} orders so far`);
  const rawServices = await collect(sources.serviceOrders);
  say(`reading activations (TMF640); ${rawServices.length} service orders so far`);
  const rawAttempts = await collect(sources.activations);

  say("correlating");
  const orders = rawOrders.map(mapProductOrder);
  const correlation = correlate({
    orders,
    serviceOrders: rawServices.map(mapServiceOrder),
    attempts: rawAttempts.map(mapActivation),
  });

  const findings: Finding[] = [];
  for (const rule of RULES) {
    say(`running ${rule.version}`);
    const finding = rule.detect(correlation.orders, config);
    if (finding) findings.push(finding);
  }

  const reportSources = await Promise.all([
    describeSource(sources.productOrders, rawOrders),
    describeSource(sources.serviceOrders, rawServices),
    describeSource(sources.activations, rawAttempts),
  ]);
  // A source that served nothing cannot name its system; take it from the reader's role.
  reportSources[0].system = "OMS";
  reportSources[1].system = "OMS";
  reportSources[2].system = "PROV";

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
      cannotObserve: SYSTEM_INFO[system].cannotObserve,
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
  const inTotal = findings.filter((f) => f.inTotal);

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
      unmapped: 0,
    },
    systems,
    findings,
    overlap: { byOrder: {} },
    totals: {
      gross: {
        hours: inTotal.reduce((sum, f) => sum + f.cost.hoursMonth, 0),
        amount: inTotal.reduce((sum, f) => sum + f.cost.amountMonth, 0),
      },
      net: null,
    },
    journeys: journeys.map((j) => ({ ...j, story: null })),
  };

  return {
    report,
    findings,
    journeys,
    correlation,
    records: { productOrders: rawOrders, serviceOrders: rawServices, activations: rawAttempts },
  };
}
