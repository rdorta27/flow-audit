// SPDX-License-Identifier: MIT
/**
 * The file form of the report (`findings/2`, M4-01): the engine keeps camelCase objects and
 * this maps them to the snake_case keys of `findings.json` (D-12). Pure: no I/O.
 *
 * Two subtrees keep their keys as they are, because the keys are data and not field names:
 * `config` (printed "as read"; `cost.inputs[].key` points into it, for example
 * `rates.cleanup_minutes`) and `overlap.byOrder` (its keys are order ids).
 */

import { configToFile } from "./data_files.ts";
import type { AuditReport } from "./model.ts";

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Paths (dot-joined, in the file's own names) whose subtree is copied verbatim. */
const VERBATIM = new Set(["config"]);
/** Paths whose own keys are data, but whose values are still converted. */
const DATA_KEYS = new Set(["overlap.by_order"]);

function convert(value: unknown, path: string): unknown {
  if (VERBATIM.has(path)) return value;
  if (Array.isArray(value)) return value.map((v) => convert(v, path));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const name = DATA_KEYS.has(path) ? key : snake(key);
      out[name] = convert(child, path === "" ? name : `${path}.${name}`);
    }
    return out;
  }
  return value;
}

/** Maps the in-memory report to the object that is written as `findings.json`. */
export function toFileShape(report: AuditReport): Record<string, unknown> {
  const file = convert(report, "") as Record<string, unknown>;
  // `config` is printed as the file the engine read: snake_case, as `config.json` has it.
  file.config = configToFile(report.config);
  return file;
}
