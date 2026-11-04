// SPDX-License-Identifier: MIT
import { toFileShape } from "../../domain/report_json.ts";
import type { AuditReport } from "../../domain/model.ts";
import type { ReportRenderer } from "../../ports/report_renderer.ts";

/**
 * Rounding rule of `findings.json` (docs/architecture/report-schema.md, "Numbers"): hours
 * to one decimal. It is applied here and nowhere else, so `283.3` never
 * becomes `283.33333333333337` in a file an analyst diffs.
 */
const HOURS_KEYS = new Set([
  "hours",
  "hours_month",
  "hours_low",
  "hours_high",
  "hours_after",
  "hours_at_low",
  "hours_at_high",
  "swing",
]);

export const roundTo = (value: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
};

function normalise(value: unknown, key = "", inConfig = false): unknown {
  if (Array.isArray(value)) return value.map((v) => normalise(v, key, inConfig));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalise(v, k, inConfig || k === "config");
    }
    return out;
  }
  if (typeof value === "number" && !inConfig) {
    if (HOURS_KEYS.has(key)) return roundTo(value, 1);
  }
  return value;
}

/** The text of `findings.json`: snake_case keys in the model's order, two-space indent, final newline. */
export function renderFindingsJson(report: AuditReport): string {
  return JSON.stringify(normalise(toFileShape(report)), null, 2) + "\n";
}

export const jsonRenderer: ReportRenderer = {
  format: "json",
  render: (report) => Promise.resolve(renderFindingsJson(report)),
};
