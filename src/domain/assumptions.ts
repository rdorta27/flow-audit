// SPDX-License-Identifier: MIT
/**
 * The assumptions table, the hour ranges and the sensitivity of the total (M4-09, M5-07). Pure.
 *
 * Every rate or threshold a rule reads appears in `cost.inputs` of its finding; this module
 * turns those inputs into one table with the value, the range, the source, the owner and the
 * date, and re-runs the rules with the rates moved to find the range and the sensitivity. It
 * invents no number: a rate without a declared source is labelled `example`.
 */

import type {
  AssumptionRow,
  Finding,
  ImpactConfig,
  ImpactRates,
  ParameterMeta,
  SensitivityRow,
} from "./model.ts";

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export type RatePick = "low" | "base" | "high";

/** The base value of a key such as `rates.cleanup_minutes` or `thresholds.stuck_after_hours`. */
export function baseOf(config: ImpactConfig, key: string): number | undefined {
  const [group, name] = key.split(".");
  const table = (config as unknown as Record<string, Record<string, number> | undefined>)[group];
  return table?.[camel(name ?? "")];
}

function bounds(config: ImpactConfig, key: string): { low: number; high: number } {
  const base = baseOf(config, key) ?? 0;
  const meta: ParameterMeta | undefined = config.parameters?.[key];
  return { low: meta?.low ?? base, high: meta?.high ?? base };
}

/** The keys of the rates in the config, in file form. */
export function rateKeys(config: ImpactConfig): string[] {
  return Object.keys(config.rates).map((k) =>
    `rates.${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`
  );
}

/**
 * The config with each rate at the point `pick` names (thresholds stay at base: they change
 * which orders count, not how long each takes). A rate without a range is the same at all three.
 */
export function configAt(config: ImpactConfig, pick: (key: string) => RatePick): ImpactConfig {
  const rates = { ...config.rates } as unknown as Record<string, number>;
  for (const key of rateKeys(config)) {
    const p = pick(key);
    const { low, high } = bounds(config, key);
    rates[camel(key.slice("rates.".length))] = p === "low"
      ? low
      : p === "high"
      ? high
      : baseOf(config, key)!;
  }
  return { ...config, rates: rates as unknown as ImpactRates };
}

function unitOf(key: string): AssumptionRow["unit"] {
  return key.endsWith("_hours") ? "hours" : "minutes";
}

/** One row per distinct input the findings use, ordered by key. */
export function buildAssumptions(
  config: ImpactConfig,
  findings: readonly Finding[],
): AssumptionRow[] {
  const used = new Map<string, Set<string>>();
  for (const f of findings) {
    for (const i of f.cost.inputs) {
      const ids = used.get(i.key) ?? new Set<string>();
      ids.add(f.id);
      used.set(i.key, ids);
    }
  }
  return [...used].sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => {
    const meta = config.parameters?.[key];
    const { low, high } = bounds(config, key);
    return {
      key,
      unit: unitOf(key),
      value: baseOf(config, key) ?? 0,
      low,
      high,
      source: meta?.source ?? "example",
      owner: meta?.owner ?? null,
      date: meta?.date ?? null,
      usedBy: [...ids].sort(),
    };
  });
}

/** Fills source, owner and date of each input from the config; what is not declared stays null. */
export function fillInputs(config: ImpactConfig, finding: Finding): void {
  for (const i of finding.cost.inputs) {
    const meta = config.parameters?.[i.key];
    i.source = meta?.source ?? null;
    i.owner = meta?.owner ?? null;
    i.date = meta?.date ?? null;
  }
}

/**
 * Moves one rate at a time to its low and to its high value and reads the net total each time.
 * Only rates the findings use and that have a range are listed; the largest swing comes first.
 */
export function buildSensitivity(
  config: ImpactConfig,
  rows: readonly AssumptionRow[],
  netHours: (config: ImpactConfig) => number,
): SensitivityRow[] {
  return rows.filter((r) => r.key.startsWith("rates.") && r.low !== r.high)
    .map((r) => {
      const at = (p: RatePick) => netHours(configAt(config, (k) => (k === r.key ? p : "base")));
      const hoursAtLow = at("low");
      const hoursAtHigh = at("high");
      return {
        key: r.key,
        low: r.low,
        high: r.high,
        hoursAtLow,
        hoursAtHigh,
        swing: hoursAtHigh - hoursAtLow,
      };
    })
    .sort((a, b) => b.swing - a.swing || a.key.localeCompare(b.key));
}
