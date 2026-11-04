// SPDX-License-Identifier: MIT
/**
 * `findings.csv` (M5-09): what a finance team needs to recalculate in a spreadsheet. One row
 * per finding and one per affected order. Figures are hours, an estimate from the rates in the
 * config; no money.
 *
 * Columns: `row_type` (`finding` or `order`), `rule`, `order` (empty on a finding row),
 * `estimated_hours`, `rates` (each rate the finding used, with its source: the text recorded
 * in the config, or `assumed`), `basis` (`measured`, `rate_assumption`, `not_observed`),
 * `orders_listed`, `orders_total`.
 *
 * Order rows come from what each rule charges to each order. For a finding that is not
 * truncated, the order rows add up to the finding's hours. A finding that charges no order
 * (R05, kept out of the total) lists the orders of its evidence sample instead, each with an
 * even share of the hours, so those rows are a sample and add up to less than the finding. At most `CSV_ORDER_LIMIT` order
 * rows are written per finding (largest first); the finding row states how many orders exist
 * (`orders_total`) and how many are listed (`orders_listed`), and its hours always cover all.
 */

import type { Finding } from "../../domain/model.ts";
import type { OrderCharge } from "../../domain/totals.ts";

export const CSV_ORDER_LIMIT = 1000;

export const CSV_COLUMNS = [
  "row_type",
  "rule",
  "order",
  "estimated_hours",
  "rates",
  "basis",
  "orders_listed",
  "orders_total",
] as const;

const field = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Hours with at most four decimals and no trailing zeros, so sums reproduce. */
const hoursText = (value: number) => String(Math.round(value * 10000) / 10000);

const ratesOf = (f: Finding) =>
  f.cost.inputs.map((i) => `${i.key}=${i.value} (${i.source ?? "assumed"})`).join("; ");

const basisOf = (f: Finding) => [...new Set(f.cost.terms.map((t) => t.basis))].join("+");

export function renderFindingsCsv(
  findings: readonly Finding[],
  charges: readonly OrderCharge[],
): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const f of findings) {
    const mine = new Map<string, number>();
    for (const c of charges) {
      if (c.ruleId === f.id) mine.set(c.orderRef, (mine.get(c.orderRef) ?? 0) + c.hours);
    }
    // A finding kept out of the total (R05) charges no order: its rows are the orders of the
    // evidence sample, each with an even share of the finding's hours over `evidence_total`.
    const sampleOnly = mine.size === 0 && f.evidence.length > 0;
    if (sampleOnly) {
      const share = f.cost.hoursMonth / Math.max(f.evidenceTotal, 1);
      for (const e of f.evidence) mine.set(e.orderRef, (mine.get(e.orderRef) ?? 0) + share);
    }
    const orders = [...mine].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
    const listed = orders.slice(0, CSV_ORDER_LIMIT);
    lines.push(
      [
        "finding",
        f.id,
        "",
        hoursText(f.cost.hoursMonth),
        ratesOf(f),
        basisOf(f),
        listed.length,
        sampleOnly ? f.evidenceTotal : orders.length,
      ].map(field).join(","),
    );
    for (const [order, hours] of listed) {
      lines.push(
        ["order", f.id, order, hoursText(hours), ratesOf(f), basisOf(f), "", ""].map(field)
          .join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}
