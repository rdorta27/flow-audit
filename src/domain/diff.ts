// SPDX-License-Identifier: MIT
/**
 * The difference between two `findings.json` files (M5-14): the measured before-and-after of a
 * fix or a migration. Orders first, then the estimate per rule, then what changed in the
 * configuration or the rule versions. Pure: it reads two parsed files and does no I/O.
 *
 * `findings.json` lists a sample of at most `EVIDENCE_SAMPLE_MAX` orders per finding and says
 * how many exist, so the orders that enter or leave are those of the sample; the counts
 * (`affected_orders`) are always complete.
 */

type Json = Record<string, unknown>;

export interface RuleDiff {
  rule: string;
  /** `R04@1` / `R04@2`, or null when the rule had no finding in that run. */
  versionFrom: string | null;
  versionTo: string | null;
  ordersFrom: number;
  ordersTo: number;
  hoursFrom: number;
  hoursTo: number;
  /** Orders in the sample of B and not in A, and the other way round. */
  entered: string[];
  left: string[];
  /** True when either side lists fewer orders than it affects (a sample). */
  sampled: boolean;
  changed: boolean;
}

export interface ConfigChange {
  key: string;
  from: unknown;
  to: unknown;
}

export interface AuditDiff {
  rules: RuleDiff[];
  netHoursFrom: number;
  netHoursTo: number;
  config: ConfigChange[];
  /** Rule versions that differ, for example `R04@1 -> R04@2`. */
  ruleVersions: { rule: string; from: string | null; to: string | null }[];
  engine: { from: string; to: string } | null;
  /** True when the records read (their fingerprints) are not the same. */
  inputsDiffer: boolean;
  /** True when nothing differs. */
  same: boolean;
}

export class NotAFindingsFileError extends Error {
  constructor(readonly which: string, why: string) {
    super(`${which} is not a findings.json: ${why}`);
    this.name = "NotAFindingsFileError";
  }
}

const isObject = (v: unknown): v is Json =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const round1 = (v: number) => Math.round((v + Number.EPSILON) * 10) / 10;

/** Throws `NotAFindingsFileError` unless the value has the shape this diff reads. */
export function assertFindingsFile(value: unknown, which: string): Json {
  if (!isObject(value)) throw new NotAFindingsFileError(which, "the top level is not an object");
  const version = value.schema_version;
  if (typeof version !== "string" || !version.startsWith("findings/")) {
    throw new NotAFindingsFileError(which, "it has no schema_version `findings/<n>`");
  }
  if (!Array.isArray(value.findings)) throw new NotAFindingsFileError(which, "it has no findings");
  return value;
}

function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(value) && value.some((v) => isObject(v) || Array.isArray(v))) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else {
    out.set(prefix, value);
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface FindingView {
  version: string;
  orders: number;
  hours: number;
  sample: Set<string>;
  listed: number;
}

function findingsOf(file: Json): Map<string, FindingView> {
  const map = new Map<string, FindingView>();
  for (const f of file.findings as unknown[]) {
    if (!isObject(f) || typeof f.id !== "string") continue;
    const evidence = Array.isArray(f.evidence) ? f.evidence : [];
    const sample = new Set(
      evidence.filter(isObject).map((e) => String(e.order_ref)),
    );
    const cost = isObject(f.cost) ? f.cost : {};
    map.set(f.id, {
      version: String(f.rule_version ?? f.id),
      orders: Number(f.affected_orders ?? 0),
      hours: Number(cost.hours_month ?? 0),
      sample,
      listed: sample.size,
    });
  }
  return map;
}

/** Compares two parsed `findings.json` files; `a` is before, `b` is after. */
export function diffFindings(a: Json, b: Json): AuditDiff {
  const fa = findingsOf(a);
  const fb = findingsOf(b);
  const ids = [...new Set([...fa.keys(), ...fb.keys()])].sort();

  const rules: RuleDiff[] = ids.map((rule) => {
    const x = fa.get(rule);
    const y = fb.get(rule);
    const before = x?.sample ?? new Set<string>();
    const after = y?.sample ?? new Set<string>();
    const entered = [...after].filter((o) => !before.has(o)).sort();
    const left = [...before].filter((o) => !after.has(o)).sort();
    const d: RuleDiff = {
      rule,
      versionFrom: x?.version ?? null,
      versionTo: y?.version ?? null,
      ordersFrom: x?.orders ?? 0,
      ordersTo: y?.orders ?? 0,
      hoursFrom: round1(x?.hours ?? 0),
      hoursTo: round1(y?.hours ?? 0),
      entered,
      left,
      sampled: (x !== undefined && x.listed < x.orders) || (y !== undefined && y.listed < y.orders),
      changed: false,
    };
    d.changed = entered.length > 0 || left.length > 0 || d.ordersFrom !== d.ordersTo ||
      d.hoursFrom !== d.hoursTo || d.versionFrom !== d.versionTo;
    return d;
  });

  const ca = new Map<string, unknown>();
  const cb = new Map<string, unknown>();
  flatten(a.config, "", ca);
  flatten(b.config, "", cb);
  const config: ConfigChange[] = [...new Set([...ca.keys(), ...cb.keys()])].sort()
    .filter((k) => !same(ca.get(k), cb.get(k)))
    .map((key) => ({ key, from: ca.get(key) ?? null, to: cb.get(key) ?? null }));

  const ruleVersions = rules.filter((r) => r.versionFrom !== r.versionTo)
    .map((r) => ({ rule: r.rule, from: r.versionFrom, to: r.versionTo }));

  const netOf = (f: Json) => {
    const totals = isObject(f.totals) ? f.totals : {};
    const net = isObject(totals.net) ? totals.net : {};
    return round1(Number(net.hours ?? 0));
  };
  const engineA = String(a.engine_version ?? "");
  const engineB = String(b.engine_version ?? "");
  const sources = (f: Json) =>
    (Array.isArray(f.sources) ? f.sources : []).filter(isObject).map((s) => [s.name, s.sha256]);

  const diff: AuditDiff = {
    rules,
    netHoursFrom: netOf(a),
    netHoursTo: netOf(b),
    config,
    ruleVersions,
    engine: engineA !== engineB ? { from: engineA, to: engineB } : null,
    inputsDiffer: !same(sources(a), sources(b)),
    same: false,
  };
  diff.same = rules.every((r) => !r.changed) && config.length === 0 &&
    diff.netHoursFrom === diff.netHoursTo && diff.engine === null && !diff.inputsDiffer;
  return diff;
}
