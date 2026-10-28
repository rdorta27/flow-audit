// SPDX-License-Identifier: MIT
import { NoEvidenceSourceError, runAudit } from "../app/run_audit.ts";
import { systemClock } from "../adapters/clock/system_clock.ts";
import type { AuditOptions } from "../app/run_audit.ts";

const USAGE = `flow-audit — audit the order-to-activate flow of a BSS

Usage:
  deno task audit [--dataset <dir>] [--lang en|es]

Options:
  --dataset <dir>  Directory with the four exports (CAT, OMS, BPM, PROV).
  --lang <lang>    Report language: en (default) or es.
  -h, --help       Show this help.

Status: walking skeleton. The ingest adapters arrive in phase 4, so the
command currently exits with a clear message instead of pretending to audit.`;

class UsageError extends Error {}

interface ParsedArgs extends AuditOptions {
  help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { lang: "en", help: false };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "--dataset": {
        const value = argv[++index];
        if (!value) throw new UsageError("--dataset needs a directory");
        parsed.dataset = value;
        break;
      }
      case "--lang": {
        const value = argv[++index];
        if (value !== "en" && value !== "es") {
          throw new UsageError("--lang must be en or es");
        }
        parsed.lang = value;
        break;
      }
      default:
        throw new UsageError(`unknown option: ${arg}`);
    }
  }

  return parsed;
}

export async function main(argv: readonly string[]): Promise<number> {
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

  try {
    const result = await runAudit(
      { dataset: options.dataset, lang: options.lang },
      { clock: systemClock },
    );
    console.log(
      `flow-audit: ${result.eventCount} events, ${result.journeys.length} journeys, ` +
        `${result.findings.length} findings`,
    );
    return 0;
  } catch (error) {
    if (error instanceof NoEvidenceSourceError) {
      console.error(`flow-audit: ${error.message}`);
      return 2;
    }
    console.error(`flow-audit: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
