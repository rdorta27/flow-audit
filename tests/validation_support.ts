// SPDX-License-Identifier: MIT
/** Test helpers for the independent validation (M6-02): a data directory, edited and audited. */

import { type AuditResult, runAudit } from "../src/app/run_audit.ts";
import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { parseMapping } from "../src/adapters/ingest/mapping.ts";
import { configFromFile } from "../src/domain/data_files.ts";

export const DEMO = new URL("../data/demo/", import.meta.url).pathname;
export const VALIDATION = new URL("./golden/validation/", import.meta.url).pathname;
export const FILES = ["oms_orders.csv", "bpm_history.jsonl", "provisioning.jsonl", "catalog.json"];

export type Edits = Record<string, (text: string) => string>;

/** Rows of a text file: the header (first line) and the non-empty lines after it. */
export function split(text: string, header = false): { head: string[]; rows: string[] } {
  const lines = text.split("\n").filter((l) => l !== "");
  return header ? { head: lines.slice(0, 1), rows: lines.slice(1) } : { head: [], rows: lines };
}
export const join = (head: string[], rows: string[]) => [...head, ...rows].join("\n") + "\n";

/** Audits a copy of `from` where `edit` has changed the named files; the gate always runs. */
export async function auditCopy(
  from: string,
  edit: Edits = {},
  options: { mapping?: (text: string) => string; force?: boolean } = {},
): Promise<AuditResult> {
  const dir = await Deno.makeTempDir();
  try {
    for (const name of FILES) {
      let text: string;
      try {
        text = await Deno.readTextFile(`${from}${name}`);
      } catch {
        continue;
      }
      await Deno.writeTextFile(`${dir}/${name}`, edit[name] ? edit[name](text) : text);
    }
    const mappingText = await Deno.readTextFile(`${from}mapping.json`);
    const config = configFromFile(JSON.parse(await Deno.readTextFile(`${from}config.json`)));
    const sources = createFileSources(
      parseMapping(options.mapping ? options.mapping(mappingText) : mappingText, "mapping.json"),
      { dir, now: () => "2026-09-30T00:00:00.000Z" },
    );
    return await runAudit({}, {
      clock: { nowIso: () => "2026-09-01T00:00:00Z" },
      sources,
      config,
      gate: { force: options.force ?? true },
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** What a run found, in a form two runs can be compared by: per rule, the orders and the hours. */
export function digest(result: AuditResult) {
  return result.findings.map((f) => ({
    id: f.id,
    affected: f.affectedOrders,
    hours: f.cost.hoursMonth,
    orders: f.evidence.map((e) => e.orderRef).sort(),
  }));
}

export const affected = (result: AuditResult) =>
  Object.fromEntries(result.findings.map((f) => [f.id, f.affectedOrders]));
