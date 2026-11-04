// SPDX-License-Identifier: MIT
/**
 * The data-quality gate (M5-10). Before any rule runs it asks, per system, whether the
 * evidence can be trusted: how many records, what time range, how many repeats, how many
 * records have no parent, how many states the mapping did not know. It answers pass or
 * fail, and for every rule whether it can be evaluated at all, so that a missing or thin
 * system reads as `not_evaluable` and never as "0 findings". Pure: the facts come in, a
 * `QualityReport` goes out. See `docs/architecture/quality.md`.
 */

import type { SystemId } from "./model.ts";

export interface QualityThresholds {
  /** A required system with fewer records than this is thin. */
  minRows: number;
  /** Share of the audited window (0..1) a system's records must span. */
  minWindowCoverage: number;
  /** Largest share of child records with no parent. */
  maxOrphanShare: number;
  /** Largest share of state values the mapping did not know. */
  maxUnknownStateShare: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  minRows: 10,
  minWindowCoverage: 0.9,
  maxOrphanShare: 0.1,
  maxUnknownStateShare: 0.01,
};

/** What each registered rule needs to be evaluated; a rule not listed needs the orders. */
export const RULE_SYSTEMS: Readonly<Record<string, readonly SystemId[]>> = {
  R04: ["OMS"],
};

/** Systems the audit cannot run without; the others are optional evidence. */
export const REQUIRED_SYSTEMS: readonly SystemId[] = ["OMS", "PROV"];

export interface Range {
  start: string;
  end: string;
}

/** What a reader saw and then dropped: the repeats the records no longer show. */
export interface ReaderFacts {
  system: SystemId;
  duplicateKeys: number;
  exactDuplicates: number;
}

/** What one system's reader and the mapped records tell the gate. */
export interface SystemFacts {
  system: SystemId;
  /** Where the records came from (a file name or a source name). */
  label: string;
  /** Distinct records, after repeats were dropped. */
  rows: number;
  /** Records that repeated the key of an earlier one and were dropped. */
  duplicateKeys: number;
  /** Of those, the ones identical to the first (the same file loaded twice). */
  exactDuplicates: number;
  /** Oldest and newest timestamp of the records; null with no records. */
  range: Range | null;
  /** Records that point at a parent and the ones whose parent was not found. */
  children: number;
  orphans: number;
  /** State values read and the ones the mapping did not know, by text. */
  statesRead: number;
  unknownStates: Record<string, number>;
}

export interface SystemQuality extends SystemFacts {
  /** Share of the audited window the records span; null when the system is absent. */
  coverage: number | null;
  orphanShare: number;
  unknownShare: number;
}

export interface NotEvaluable {
  rule: string;
  system: SystemId;
  reason: string;
}

export interface QualityReport {
  schema: "quality/1";
  passed: boolean;
  /** True when the gate failed and the run went on because of `--force`. */
  forced: boolean;
  thresholds: QualityThresholds;
  /** The window every system is measured against: the declared period or the order span. */
  window: (Range & { declared: boolean }) | null;
  /** Where every present system has records. */
  commonWindow: Range | null;
  systems: SystemQuality[];
  failures: string[];
  warnings: string[];
  notEvaluable: NotEvaluable[];
}

const ms = (iso: string) => Date.parse(iso);
const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;
const day = (iso: string) => iso.slice(0, 10);
const num = (v: number) => v.toLocaleString("en-US");

/** Oldest and newest of a list of ISO timestamps; null when it is empty. */
export function rangeOf(times: Iterable<string>): Range | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const t of times) {
    if (start === null || t < start) start = t;
    if (end === null || t > end) end = t;
  }
  return start === null || end === null ? null : { start, end };
}

function overlapShare(range: Range, window: Range): number {
  const length = ms(window.end) - ms(window.start);
  if (length <= 0) return 1;
  const from = Math.max(ms(range.start), ms(window.start));
  const to = Math.min(ms(range.end), ms(window.end));
  return Math.max(0, to - from) / length;
}

export function assessQuality(
  facts: readonly SystemFacts[],
  options: { thresholds?: Partial<QualityThresholds>; period?: Range } = {},
): QualityReport {
  const thresholds = { ...DEFAULT_THRESHOLDS };
  for (const [k, v] of Object.entries(options.thresholds ?? {})) {
    if (v !== undefined) (thresholds as Record<string, number>)[k] = v;
  }
  const oms = facts.find((f) => f.system === "OMS");
  const reference: Range | null = options.period ?? oms?.range ?? null;
  const window = reference ? { ...reference, declared: options.period !== undefined } : null;

  const systems: SystemQuality[] = facts.map((f) => ({
    ...f,
    coverage: f.rows === 0 || !f.range ? null : window ? overlapShare(f.range, window) : 1,
    orphanShare: f.children === 0 ? 0 : f.orphans / f.children,
    unknownShare: f.statesRead === 0
      ? 0
      : Object.values(f.unknownStates).reduce((a, b) => a + b, 0) / f.statesRead,
  }));

  const failures: string[] = [];
  const warnings: string[] = [];
  for (const s of systems) {
    const required = REQUIRED_SYSTEMS.includes(s.system);
    if (s.rows === 0) {
      if (required) failures.push(`${s.system} (${s.label}): no records were read`);
      continue;
    }
    if (required && s.rows < thresholds.minRows) {
      failures.push(
        `${s.system} (${s.label}): only ${
          num(s.rows)
        } records, the gate needs at least ${thresholds.minRows}`,
      );
    }
    if (s.coverage !== null && s.system !== "OMS" && s.range && window) {
      if (s.coverage === 0) {
        warnings.push(
          `${s.system} and the audited window do not overlap: ${day(s.range.start)} to ${
            day(s.range.end)
          } against ${day(window.start)} to ${day(window.end)}`,
        );
      }
      if (s.coverage < thresholds.minWindowCoverage) {
        failures.push(
          `${s.system} (${s.label}) covers ${pct(s.coverage)} of the audited window ` +
            `${day(window.start)} to ${day(window.end)}: its records run ${day(s.range.start)} ` +
            `to ${day(s.range.end)}; the gate needs ${pct(thresholds.minWindowCoverage)}`,
        );
      }
    }
    if (s.orphanShare > thresholds.maxOrphanShare) {
      failures.push(
        `${s.system} (${s.label}): ${num(s.orphans)} of ${num(s.children)} records (${
          pct(s.orphanShare)
        }) point at a parent that was not found; the gate allows ${pct(thresholds.maxOrphanShare)}`,
      );
    }
    if (s.unknownShare > thresholds.maxUnknownStateShare) {
      const list = Object.entries(s.unknownStates).map(([v, c]) => `"${v}" x${c}`).join(", ");
      failures.push(
        `${s.system} (${s.label}): ${pct(s.unknownShare)} of the states are not in the mapping ` +
          `(${list}); the gate allows ${pct(thresholds.maxUnknownStateShare)}`,
      );
    }
    if (s.duplicateKeys > 0) {
      warnings.push(
        `${s.system} (${s.label}): ${s.duplicateKeys} repeated records dropped by key ` +
          `(${s.exactDuplicates} identical to the first)`,
      );
    }
    if (s.unknownShare > 0 && s.unknownShare <= thresholds.maxUnknownStateShare) {
      const list = Object.entries(s.unknownStates).map(([v, c]) => `"${v}" x${c}`).join(", ");
      warnings.push(`${s.system} (${s.label}): states not in the mapping: ${list}`);
    }
  }

  const present = systems.filter((s) => s.range);
  let common: Range | null = null;
  if (present.length > 0) {
    const start = present.map((s) => s.range!.start).reduce((a, b) => (a > b ? a : b));
    const end = present.map((s) => s.range!.end).reduce((a, b) => (a < b ? a : b));
    common = start <= end ? { start, end } : null;
  }

  return {
    schema: "quality/1",
    passed: failures.length === 0,
    forced: false,
    thresholds,
    window,
    commonWindow: common,
    systems,
    failures,
    warnings,
    notEvaluable: [],
  };
}

/**
 * The rules that cannot be evaluated: a system they need is absent or thin. A rule without
 * an entry in `needs` (and not in `RULE_SYSTEMS`) needs the orders.
 */
export function notEvaluableRules(
  quality: QualityReport,
  rules: readonly string[],
  needs: Readonly<Record<string, readonly SystemId[]>> = RULE_SYSTEMS,
): NotEvaluable[] {
  const out: NotEvaluable[] = [];
  for (const rule of rules) {
    for (const system of needs[rule] ?? ["OMS"]) {
      const s = quality.systems.find((q) => q.system === system);
      const thin = s !== undefined && s.rows > 0 && s.rows < quality.thresholds.minRows;
      const short = s !== undefined && s.coverage !== null &&
        s.coverage < quality.thresholds.minWindowCoverage && system !== "OMS";
      if (!s || s.rows === 0) {
        out.push({ rule, system, reason: `${system} was not read` });
      } else if (thin) {
        out.push({ rule, system, reason: `${system} has only ${s.rows} records` });
      } else if (short) {
        out.push({
          rule,
          system,
          reason: `${system} covers ${pct(s.coverage!)} of the audited window`,
        });
      }
    }
  }
  return out;
}

/** `quality.json`: the gate's answer, keys in snake_case (D-14), stable order. */
export function qualityToJson(quality: QualityReport): Record<string, unknown> {
  return {
    schema: quality.schema,
    passed: quality.passed,
    forced: quality.forced,
    thresholds: {
      min_rows: quality.thresholds.minRows,
      min_window_coverage: quality.thresholds.minWindowCoverage,
      max_orphan_share: quality.thresholds.maxOrphanShare,
      max_unknown_state_share: quality.thresholds.maxUnknownStateShare,
    },
    window: quality.window,
    common_window: quality.commonWindow,
    systems: quality.systems.map((s) => ({
      system: s.system,
      source: s.label,
      rows: s.rows,
      duplicate_keys: s.duplicateKeys,
      exact_duplicates: s.exactDuplicates,
      range: s.range,
      coverage: s.coverage,
      children: s.children,
      orphans: s.orphans,
      states_read: s.statesRead,
      unknown_states: s.unknownStates,
    })),
    failures: quality.failures,
    warnings: quality.warnings,
    not_evaluable: quality.notEvaluable,
  };
}
