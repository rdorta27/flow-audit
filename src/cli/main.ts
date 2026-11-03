// SPDX-License-Identifier: MIT
import { NoEvidenceSourceError, runAudit } from "../app/run_audit.ts";
import type { AuditResult } from "../app/run_audit.ts";
import { systemClock } from "../adapters/clock/system_clock.ts";
import { TmfError } from "../adapters/ingest/tmf_client.ts";
import { createTmfSources, tmfConfigFromEnvOrStub } from "../adapters/ingest/tmf_sources.ts";
import { configFromFile } from "../domain/data_files.ts";
import type { AuditReport, ImpactConfig } from "../domain/model.ts";
import { renderFindingsJson } from "../adapters/report/json_renderer.ts";
import { renderHtml } from "../adapters/report/html_renderer.ts";

const DEFAULT_CONFIG = new URL("../../data/demo/config.json", import.meta.url);

const USAGE = `flow-audit — audit the order-to-activate flow of a BSS

Usage:
  deno task audit --source stub [--config <file>] [--out <dir>] [--quiet]

Options:
  --source stub    Read the simulated TMF stub (start it with \`deno task stub\`).
                   The connection comes from the same environment variables as
                   \`deno task read\`: FLOW_AUDIT_TMF_BASE_URL (default
                   http://127.0.0.1:8081), FLOW_AUDIT_TMF_TOKEN,
                   FLOW_AUDIT_TMF_TIMEOUT_MS, FLOW_AUDIT_TMF_PAGE_SIZE,
                   FLOW_AUDIT_TMF_MAX_REQUESTS.
  --config <file>  Impact rates and thresholds (default: data/demo/config.json).
  --out <dir>      Write findings.json and report.html into this existing directory.
                   The \`audit\` task may write only under ./out.
  --dataset <dir>  Directory with exports; file sources arrive in M5-02.
  --quiet          No progress lines on stderr. The result on stdout is unchanged.
  -h, --help       Show this help.

Exit codes:
  0  the audit ran
  1  run error (source unreachable, bad response, unreadable config); the message on
     stderr names the URL or file, and the line and field when the record is at fault
  2  usage error, or no source configured
  3  the data failed the quality gate (reserved: arrives with M5-10)`;

class UsageError extends Error {}

interface ParsedArgs {
  help: boolean;
  quiet: boolean;
  source?: "stub";
  config?: string;
  dataset?: string;
  out?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { help: false, quiet: false };

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
        `${n(Math.round(f.cost.hoursMonth * 10) / 10)} h`,
    );
  }
  return lines;
}

export async function main(
  argv: readonly string[],
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): Promise<number> {
  let options: ParsedArgs;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`flow-audit: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Run `deno task audit --help` for usage.");
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
    if (options.source === "stub") {
      const tmf = tmfConfigFromEnvOrStub(env);
      progress(`reading from ${tmf.baseUrl}`);
      sources = createTmfSources(tmf);
      config = await readConfig(options.config);
    }
    const result = await runAudit(
      { dataset: options.dataset },
      { sources, config, clock: systemClock, onProgress: progress },
    );
    for (const line of summaryLines(result)) console.log(line);
    if (options.out) {
      for (const path of await writeReports(options.out, result.report)) progress(`wrote ${path}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof NoEvidenceSourceError) {
      console.error(`flow-audit: ${error.message}`);
      return 2;
    }
    console.error(`flow-audit: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof TmfError) console.error("Is the source running? Try: deno task stub");
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
