// SPDX-License-Identifier: MIT
import { checkAudit, NoEvidenceSourceError, QualityGateError, runAudit } from "../app/run_audit.ts";
import type { AuditResult } from "../app/run_audit.ts";
import { systemClock } from "../adapters/clock/system_clock.ts";
import { TmfError } from "../adapters/ingest/tmf_client.ts";
import { createFileSources } from "../adapters/ingest/file_sources.ts";
import { FileError } from "../adapters/ingest/file_common.ts";
import type { FileCoverage } from "../adapters/ingest/file_common.ts";
import type { QualityReport } from "../domain/quality.ts";
import { qualityToJson } from "../domain/quality.ts";
import { MESSAGES as M } from "./messages.ts";
import { MappingError, parseMapping } from "../adapters/ingest/mapping.ts";
import { createTmfSources, tmfConfigFromEnvOrStub } from "../adapters/ingest/tmf_sources.ts";
import { summarizeLinks } from "../domain/correlation.ts";
import { configFromFile } from "../domain/data_files.ts";
import type { AuditReport, ImpactConfig } from "../domain/model.ts";
import { renderFindingsJson } from "../adapters/report/json_renderer.ts";
import { renderHtml } from "../adapters/report/html_renderer.ts";

const DEFAULT_CONFIG = new URL("../../data/demo/config.json", import.meta.url);
const DEFAULT_MAPPING = new URL("../../data/demo/mapping.json", import.meta.url);

const USAGE = `flow-audit — audit the order-to-activate flow of a BSS

Usage:
  deno task audit --dataset <dir> [--mapping <file>] [--config <file>] [--out <dir>]
                  [--check] [--force] [--quiet]
  deno task audit --source stub [--config <file>] [--out <dir>] [--check] [--force] [--quiet]

Options:
  --source stub    Read the simulated TMF stub (start it with \`deno task stub\`).
                   The connection comes from the same environment variables as
                   \`deno task read\`: FLOW_AUDIT_TMF_BASE_URL (default
                   http://127.0.0.1:8081), FLOW_AUDIT_TMF_TOKEN,
                   FLOW_AUDIT_TMF_TIMEOUT_MS, FLOW_AUDIT_TMF_PAGE_SIZE,
                   FLOW_AUDIT_TMF_MAX_REQUESTS.
  --config <file>  Impact rates and thresholds (default: data/demo/config.json).
  --out <dir>      Write findings.json, report.html and quality.json into this existing
                   directory (with --check, only quality.json). The \`audit\` task may write
                   only under ./out.
  --dataset <dir>  Read the four exports in this directory (catalog.json, oms_orders.csv,
                   bpm_history.jsonl, provisioning.jsonl; the demo is data/demo).
                   Not together with --source.
  --mapping <file> How the exports' columns, states, ids, dates and time zones map to the
                   canonical fields (default: data/demo/mapping.json). See
                   docs/architecture/mapping.md.
  --check          Read, map and run the data-quality gate only. No rule runs and no report
                   is written. Use it first on a new export.
  --force          Run the rules even when the gate fails. The answer says it was forced.
  --quiet          No stage lines on stderr. The result on stdout is unchanged.
  -h, --help       Show this help.

Examples:
  Check a client's export before auditing it:
    deno task audit --dataset ./client-sept --mapping ./client.mapping.json --check
  Audit the demo and write the files:
    deno task audit --dataset data/demo --out out
  Audit the simulated TMF stub (in another terminal: deno task stub):
    deno task audit --source stub

Exit codes:
  0  the audit (or the check) ran and the gate passed, or was forced
  1  run error (source unreachable, bad response, unreadable file); the message on
     stderr says what happened, where (file, line, field) and what to do next
  2  usage error, or no source configured
  3  the data failed the quality gate (see quality.json; --force audits it anyway)`;

class UsageError extends Error {}

interface ParsedArgs {
  help: boolean;
  quiet: boolean;
  check: boolean;
  force: boolean;
  source?: "stub";
  config?: string;
  dataset?: string;
  mapping?: string;
  out?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { help: false, quiet: false, check: false, force: false };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "--quiet":
        parsed.quiet = true;
        break;
      case "--check":
        parsed.check = true;
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--source": {
        const value = argv[++index];
        if (value !== "stub") throw new UsageError("--source must be `stub`");
        parsed.source = value;
        break;
      }
      case "--config": {
        const value = argv[++index];
        if (!value) throw new UsageError("--config needs a file");
        parsed.config = value;
        break;
      }
      case "--out": {
        const value = argv[++index];
        if (!value) throw new UsageError("--out needs a directory");
        parsed.out = value;
        break;
      }
      case "--mapping": {
        const value = argv[++index];
        if (!value) throw new UsageError("--mapping needs a file");
        parsed.mapping = value;
        break;
      }
      case "--dataset": {
        const value = argv[++index];
        if (!value) throw new UsageError("--dataset needs a directory");
        parsed.dataset = value;
        break;
      }
      default:
        throw new UsageError(`unknown option: ${arg}`);
    }
  }

  return parsed;
}

async function readMapping(path: string | undefined) {
  const where = path ?? "data/demo/mapping.json";
  let raw: string;
  try {
    raw = await Deno.readTextFile(path ?? DEFAULT_MAPPING);
  } catch (error) {
    throw new MappingError(
      where,
      null,
      "(file)",
      `cannot read the mapping: ${(error as Error).message}`,
    );
  }
  return parseMapping(raw, where);
}

/** The coverage report: what the mapping understood in each file and what it could not see. */
export function coverageLines(coverage: readonly FileCoverage[]): string[] {
  return coverage.map((c) => {
    const mappedRows = c.rows - c.rowsWithUnmappedState;
    const percent = c.rows === 0 ? 100 : Math.round((mappedRows / c.rows) * 1000) / 10;
    const parts = [
      `${c.file}: ${n(c.rows)} rows · ${percent}% with every state mapped`,
    ];
    for (const [table, s] of Object.entries(c.states)) {
      const total = s.mapped + s.unmapped;
      const unknown = Object.entries(s.unknown).map(([v, k]) => `"${v}" x${k}`).join(", ");
      parts.push(
        `${table} states ${total === 0 ? 100 : Math.round((s.mapped / total) * 1000) / 10}% mapped${
          unknown ? ` (not mapped: ${unknown})` : ""
        }`,
      );
    }
    if (c.repeatedRows > 0) parts.push(`${n(c.repeatedRows)} repeated rows merged`);
    if (c.notObservable.length > 0) parts.push(`not observable: ${c.notObservable.join(", ")}`);
    return `Coverage ${parts.join(" · ")}`;
  });
}

async function readConfig(path: string | undefined): Promise<ImpactConfig> {
  const where = path ?? "data/demo/config.json";
  let raw: string;
  try {
    raw = await Deno.readTextFile(path ?? DEFAULT_CONFIG);
  } catch (error) {
    throw new Error(`cannot read the config ${where}: ${(error as Error).message}`);
  }
  try {
    return configFromFile(JSON.parse(raw));
  } catch (error) {
    throw new Error(`${where}: not a valid impact config: ${(error as Error).message}`);
  }
}

/** Writes `findings.json` and `report.html`; the directory must already exist and be writable. */
export async function writeReports(dir: string, report: AuditReport): Promise<string[]> {
  try {
    if (!(await Deno.stat(dir)).isDirectory) throw new Error("not a directory");
  } catch (error) {
    throw new Error(
      `cannot write the report: output directory ${dir} is not usable: ${(error as Error).message}`,
    );
  }
  const files: [string, string][] = [
    [`${dir}/findings.json`, renderFindingsJson(report)],
    [`${dir}/report.html`, renderHtml(report)],
  ];
  for (const [path, text] of files) {
    try {
      await Deno.writeTextFile(path, text);
    } catch (error) {
      throw new Error(`cannot write ${path}: ${(error as Error).message}`);
    }
  }
  return files.map(([path]) => path);
}

const n = (value: number) => value.toLocaleString("en-US");

/** The lines printed on stdout: counts, how sure the joins are, one line per finding. */
export function summaryLines(result: AuditResult): string[] {
  const { report } = result;
  const links = report.correlation.links;
  const lines = [
    `Orders read: ${n(result.records.productOrders.length)} · service orders: ${
      n(result.records.serviceOrders.length)
    } · activations: ${n(result.records.activations.length)}`,
  ];
  for (const [kind, counts] of Object.entries(links)) {
    const shown = Object.entries(counts).filter(([, count]) => count > 0)
      .map(([confidence, count]) => `${confidence} ${n(count)}`);
    lines.push(`Links ${kind}: ${shown.join(" · ") || "none"}`);
  }
  if (result.findings.length === 0) lines.push("No findings.");
  for (const f of result.findings) {
    lines.push(
      `${f.ruleVersion} · ${n(f.affectedOrders)} orders · ` +
        `estimate ${n(Math.round(f.cost.hoursMonth * 10) / 10)} h`,
    );
  }
  if (result.findings.length > 0) {
    const ids = new Set(result.findings.map((f) => f.id));
    const sum = result.findings.reduce((a, f) => a + f.affectedOrders, 0);
    const repeats = Object.values(report.overlap.byOrder).reduce(
      (a, rules) => a + Math.max(0, rules.filter((r) => ids.has(r)).length - 1),
      0,
    );
    lines.push(
      `${n(sum - repeats)} of ${n(result.records.productOrders.length)} orders have a problem ` +
        `(estimate ${n(Math.round(report.totals.net.hours * 10) / 10)} h with the example rates, ` +
        `each order once)`,
    );
  }
  const { workOrders, processes } = result.records;
  if (workOrders.length > 0 || processes.length > 0) {
    lines.splice(
      1,
      0,
      `Work orders read: ${n(workOrders.length)} · processes: ${n(processes.length)}`,
    );
  }
  return lines;
}

/** The gate's answer in plain lines: one per system, then problems, warnings and skipped rules. */
export function qualityLines(quality: QualityReport): string[] {
  const lines = [M.qualityHeader(quality.passed, quality.forced)];
  const day = (iso: string) => iso.slice(0, 10);
  for (const s of quality.systems) {
    const extra: string[] = [];
    if (s.duplicateKeys > 0) extra.push(M.qualityRepeats(s.duplicateKeys, s.exactDuplicates));
    if (s.orphans > 0) extra.push(M.qualityOrphans(s.orphans, s.children));
    const unknown = Object.entries(s.unknownStates).map(([v, k]) => `"${v}" x${k}`).join(", ");
    if (unknown) extra.push(M.qualityUnknown(unknown));
    lines.push(M.qualitySystem(
      s.system,
      s.label,
      s.rows,
      s.range ? `${day(s.range.start)} to ${day(s.range.end)}` : "no dates",
      s.coverage === null ? "n/a" : `${Math.round(s.coverage * 1000) / 10}%`,
      extra,
    ));
  }
  for (const f of quality.failures) lines.push(M.qualityProblem(f));
  for (const w of quality.warnings) lines.push(M.qualityWarning(w));
  for (const e of quality.notEvaluable) lines.push(M.qualityNotEvaluable(e.rule, e.reason));
  return lines;
}

/** Writes `quality.json` into an existing directory. */
export async function writeQuality(dir: string, quality: QualityReport): Promise<string> {
  const path = `${dir}/quality.json`;
  try {
    await Deno.writeTextFile(path, JSON.stringify(qualityToJson(quality), null, 2) + "\n");
  } catch (error) {
    throw new OutputError(path, error);
  }
  return path;
}

class OutputError extends Error {
  constructor(readonly path: string, cause: unknown) {
    super(`cannot write ${path}: ${(cause as Error).message}`);
    this.name = "OutputError";
  }
}

/**
 * The lines the reader sees for a failure: what happened, where, what to do next. Never a
 * stack trace. Returns the exit code too.
 */
export function explainError(error: unknown): { lines: string[]; code: number } {
  if (error instanceof NoEvidenceSourceError || error instanceof UsageError) {
    return { lines: M.usage(error.message), code: 2 };
  }
  if (error instanceof QualityGateError) {
    return {
      lines: [
        ...M.error(
          M.gateFailedWhat(error.quality.failures.length),
          "the Quality lines above (and quality.json with --out)",
          M.nextGate,
        ),
      ],
      code: 3,
    };
  }
  if (error instanceof FileError) {
    const where = `${error.file}${error.line === null ? "" : `:${error.line}`}${
      error.field === null ? "" : ` field "${error.field}"`
    }`;
    const next = error.code === "missing_file"
      ? M.nextMissingFile
      : error.code === "unknown_state"
      ? M.nextUnknownState(/ in the (\w+) state table/.exec(error.why)?.[1] ?? "<table>")
      : M.nextBadRow;
    return { lines: M.error(error.why, where, next), code: 1 };
  }
  if (error instanceof MappingError) {
    return { lines: M.error(error.message, null, M.nextMapping), code: 1 };
  }
  if (error instanceof TmfError) {
    return { lines: M.error(error.message, null, M.nextTmf), code: 1 };
  }
  if (error instanceof OutputError) {
    return { lines: M.error(error.message, error.path, M.nextOut), code: 1 };
  }
  const message = error instanceof Error ? error.message : String(error);
  const next = /config/.test(message)
    ? M.nextConfig
    : /output directory/.test(message)
    ? M.nextOut
    : M.nextUnknown;
  return { lines: M.error(message, null, next), code: 1 };
}

export async function main(
  argv: readonly string[],
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): Promise<number> {
  let options: ParsedArgs;
  try {
    options = parseArgs(argv);
  } catch (error) {
    for (const line of explainError(error).lines) console.error(line);
    return 2;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const progress = (message: string) => {
    if (!options.quiet) console.error(`flow-audit: ${message}`);
  };

  try {
    let sources;
    let config: ImpactConfig | undefined;
    if (options.source && options.dataset) {
      throw new UsageError("--source and --dataset cannot be used together");
    }
    let fileSources: ReturnType<typeof createFileSources> | undefined;
    if (options.mapping && !options.dataset) {
      throw new UsageError("--mapping goes with --dataset");
    }
    if (options.dataset) {
      progress(M.readingFiles(options.dataset));
      fileSources = createFileSources(await readMapping(options.mapping), {
        dir: options.dataset,
        now: () => new Date().toISOString(),
      });
      sources = fileSources;
      config = await readConfig(options.config);
    } else if (options.source === "stub") {
      const tmf = tmfConfigFromEnvOrStub(env);
      progress(M.readingSource(tmf.baseUrl));
      sources = createTmfSources(tmf);
      config = await readConfig(options.config);
    }
    const deps = { sources, config, clock: systemClock, gate: { force: options.force } };

    const stageLines = async (
      records: {
        productOrders: unknown[];
        serviceOrders: unknown[];
        activations: unknown[];
      },
      links: AuditReport["correlation"]["links"],
      orders: number,
    ) => {
      if (fileSources) {
        for (const c of await fileSources.coverage()) progress(M.readFile(c.file, c.rows));
      } else {
        progress(M.readOrders(
          records.productOrders.length,
          records.serviceOrders.length,
          records.activations.length,
        ));
      }
      let sure = 0, inferred = 0, notJoined = 0;
      for (const counts of Object.values(links)) {
        sure += counts.explicit;
        inferred += counts.inferred;
        notJoined += counts.ambiguous + counts.missing;
      }
      progress(M.joined(orders, sure, inferred, notJoined));
    };
    const gateStage = (q: QualityReport) => {
      if (q.passed) progress(M.gatePassed(q.warnings.length));
      else progress(q.forced ? M.gateForced(q.failures.length) : M.gateFailed(q.failures.length));
    };

    if (options.check) {
      const checked = await checkAudit(deps);
      const quality = checked.quality;
      await stageLines(
        checked.records,
        summarizeLinks(checked.correlation.links),
        checked.correlation.orders.length,
      );
      gateStage(quality);
      for (const line of qualityLines(quality)) console.log(line);
      if (options.out) progress(M.wrote(await writeQuality(options.out, quality)));
      progress(M.checked);
      return quality.passed || quality.forced ? 0 : 3;
    }

    const result = await runAudit({ dataset: options.dataset }, deps);
    const quality = result.quality;
    await stageLines(
      result.records,
      result.report.correlation.links,
      result.correlation.orders.length,
    );
    if (quality) gateStage(quality);
    for (const f of result.findings) {
      progress(
        M.ruleFound(f.ruleVersion, f.affectedOrders, Math.round(f.cost.hoursMonth * 10) / 10),
      );
    }
    for (const e of quality?.notEvaluable ?? []) progress(M.ruleNotEvaluable(e.rule, e.reason));
    for (const line of summaryLines(result)) console.log(line);
    if (quality) { for (const line of qualityLines(quality)) console.log(line); }
    if (fileSources) {
      for (const line of coverageLines(await fileSources.coverage())) console.log(line);
    }
    if (options.out) {
      for (const path of await writeReports(options.out, result.report)) progress(M.wrote(path));
      if (quality) progress(M.wrote(await writeQuality(options.out, quality)));
    }
    return 0;
  } catch (error) {
    if (error instanceof QualityGateError) {
      // The reader needs the gate's answer before the error that names it.
      for (const line of qualityLines(error.quality)) console.log(line);
      if (options.out) {
        try {
          progress(M.wrote(await writeQuality(options.out, error.quality)));
        } catch (writeError) {
          for (const line of explainError(writeError).lines) console.error(line);
        }
      }
    }
    const { lines, code } = explainError(error);
    for (const line of lines) console.error(line);
    return code;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
