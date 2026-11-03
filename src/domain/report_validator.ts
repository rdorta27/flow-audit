// SPDX-License-Identifier: MIT
/**
 * Checks a report in its file form (snake_case, see `report_json.ts`) against `findings/1`
 * (`docs/architecture/report-schema.md`). No dependencies. It returns every problem found,
 * each prefixed with the path, so an empty list means the report is valid.
 */

import { EVIDENCE_SAMPLE_MAX, SCHEMA_VERSION } from "./model.ts";

type Obj = Record<string, unknown>;

const SEVERITIES = ["critical", "high", "medium"];
const STATUSES = ["detected", "not_detected", "insufficient_evidence", "not_evaluable"];
const EVIDENCE_LEVELS = ["strong", "weak", "history"];
const COST_KINDS = ["recurring", "one_off", "accumulated_to_period_end"];
const BASES = ["measured", "rate_assumption", "not_observed"];
const SYSTEMS = ["CAT", "OMS", "BPM", "PROV"];

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNonEmpty = (v: unknown): v is string => isStr(v) && v.trim() !== "";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Reads a dotted key such as `rates.cleanup_minutes` from the config; undefined when absent. */
function lookup(config: unknown, key: string): unknown {
  let node: unknown = config;
  for (const part of key.split(".")) {
    if (!isObj(node) || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * @param report the parsed `findings.json`
 * @param config the parsed `config.json` the run used; defaults to the report's own `config`
 */
export function validateReport(report: unknown, config?: unknown): string[] {
  const errors: string[] = [];
  const err = (path: string, message: string) => errors.push(`${path}: ${message}`);
  const str = (o: Obj, k: string, path: string) => {
    if (!isNonEmpty(o[k])) err(`${path}.${k}`, "must be a non-empty string");
  };
  const num = (o: Obj, k: string, path: string) => {
    if (!isNum(o[k])) err(`${path}.${k}`, "must be a number");
  };
  const bool = (o: Obj, k: string, path: string) => {
    if (typeof o[k] !== "boolean") err(`${path}.${k}`, "must be a boolean");
  };
  const oneOf = (o: Obj, k: string, path: string, allowed: string[]) => {
    if (!allowed.includes(String(o[k]))) {
      err(`${path}.${k}`, `must be one of ${allowed.join(", ")}`);
    }
  };
  const list = (o: Obj, k: string, path: string): unknown[] => {
    const v = o[k];
    if (!Array.isArray(v)) {
      err(`${path}.${k}`, "must be an array");
      return [];
    }
    return v;
  };
  const obj = (o: Obj, k: string, path: string): Obj | null => {
    const v = o[k];
    if (!isObj(v)) {
      err(`${path}.${k}`, "must be an object");
      return null;
    }
    return v;
  };

  if (!isObj(report)) return ["report: must be an object"];
  if (report.schema_version !== SCHEMA_VERSION) {
    err("schema_version", `must be "${SCHEMA_VERSION}"`);
  }
  str(report, "engine_version", "report");
  const run = obj(report, "run", "report");
  if (run) {
    for (const k of ["id", "generated_at", "inputs_hash", "config_hash", "rules_hash"]) {
      str(run, k, "run");
    }
  }
  list(report, "sources", "report").forEach((s, i) => {
    const p = `sources[${i}]`;
    if (!isObj(s)) return err(p, "must be an object");
    oneOf(s, "system", p, SYSTEMS);
    for (const k of ["name", "endpoint", "sha256"]) str(s, k, p);
    oneOf(s, "kind", p, ["tmf-api", "file"]);
    oneOf(s, "evidence_kind", p, ["snapshot", "history"]);
    bool(s, "simulated", p);
    for (const k of ["records", "rows_read", "rows_discarded"]) num(s, k, p);
    if (isStr(s.sha256) && !/^[0-9a-f]{64}$/.test(s.sha256)) err(`${p}.sha256`, "must be 64 hex");
  });
  const labels = obj(report, "labels", "report");
  if (labels) {
    for (const k of ["synthetic_data", "simulated_integration", "estimated_impact"]) {
      bool(labels, k, "labels");
    }
  }
  const reportConfig = obj(report, "config", "report");
  const keysFrom = config ?? reportConfig;
  const correlation = obj(report, "correlation", "report");
  if (correlation) {
    obj(correlation, "links", "correlation");
    num(correlation, "unresolved", "correlation");
    num(correlation, "unmapped", "correlation");
  }
  list(report, "systems", "report").forEach((s, i) => {
    const p = `systems[${i}]`;
    if (!isObj(s)) return err(p, "must be an object");
    oneOf(s, "system", p, SYSTEMS);
    str(s, "name", p);
    str(s, "role", p);
    num(s, "position", p);
    bool(s, "read", p);
    num(s, "records", p);
    if (s.coverage !== null && !isNum(s.coverage)) err(`${p}.coverage`, "must be a number or null");
    list(s, "cannot_observe", p);
    list(s, "findings", p);
  });

  let grossAmount = 0;
  let grossHours = 0;
  list(report, "findings", "report").forEach((f, i) => {
    const p = `findings[${i}]`;
    if (!isObj(f)) return err(p, "must be an object");
    for (const k of ["id", "rule_version", "title", "plain_summary", "where", "recommendation"]) {
      str(f, k, p);
    }
    oneOf(f, "severity", p, SEVERITIES);
    oneOf(f, "status", p, STATUSES);
    oneOf(f, "evidence_level", p, EVIDENCE_LEVELS);
    num(f, "affected_orders", p);
    if (!isNum(f.share_of_orders) || f.share_of_orders < 0 || f.share_of_orders > 1) {
      err(`${p}.share_of_orders`, "must be a number between 0 and 1");
    }
    bool(f, "in_total", p);
    const evidence = list(f, "evidence", p);
    if (evidence.length > EVIDENCE_SAMPLE_MAX) {
      err(`${p}.evidence`, `has more than ${EVIDENCE_SAMPLE_MAX} entries`);
    }
    if (!isNum(f.evidence_total) || f.evidence_total < evidence.length) {
      err(`${p}.evidence_total`, "must be a number not smaller than the sample");
    }
    evidence.forEach((e, j) => {
      const q = `${p}.evidence[${j}]`;
      if (!isObj(e)) return err(q, "must be an object");
      str(e, "order_ref", q);
      list(e, "event_ids", q);
      list(e, "records", q).forEach((r, k) => {
        if (!isObj(r)) return err(`${q}.records[${k}]`, "must be an object");
        oneOf(r, "system", `${q}.records[${k}]`, SYSTEMS);
        str(r, "external_id", `${q}.records[${k}]`);
        str(r, "endpoint", `${q}.records[${k}]`);
      });
    });
    const confidence = obj(f, "confidence", p);
    if (confidence) {
      oneOf(confidence, "level", `${p}.confidence`, ["confirmed", "possible"]);
      num(confidence, "inferred_link_share", `${p}.confidence`);
    }

    const cost = obj(f, "cost", p);
    if (!cost) return;
    const c = `${p}.cost`;
    if (cost.currency !== "USD") err(`${c}.currency`, 'must be "USD"');
    oneOf(cost, "kind", c, COST_KINDS);
    str(cost, "formula", c);
    num(cost, "hours_month", c);
    num(cost, "amount_month", c);
    if (cost.period_days !== null && !isNum(cost.period_days)) {
      err(`${c}.period_days`, "must be a number or null");
    }
    if (cost.normalisation !== null && !isStr(cost.normalisation)) {
      err(`${c}.normalisation`, "must be a string or null");
    }
    const inputKeys = new Set<string>();
    list(cost, "inputs", c).forEach((inp, j) => {
      const q = `${c}.inputs[${j}]`;
      if (!isObj(inp)) return err(q, "must be an object");
      str(inp, "key", q);
      num(inp, "value", q);
      for (const k of ["source", "owner", "date"]) {
        if (inp[k] !== null && !isStr(inp[k])) err(`${q}.${k}`, "must be a string or null");
      }
      if (isStr(inp.key)) {
        inputKeys.add(inp.key);
        const found = lookup(keysFrom, inp.key);
        if (found === undefined) err(`${q}.key`, `"${inp.key}" is not a key of config.json`);
        else if (found !== inp.value) err(`${q}.value`, `differs from config.json "${inp.key}"`);
      }
    });
    let sum = 0;
    list(cost, "terms", c).forEach((t, j) => {
      const q = `${c}.terms[${j}]`;
      if (!isObj(t)) return err(q, "must be an object");
      str(t, "name", q);
      num(t, "amount", q);
      oneOf(t, "basis", q, BASES);
      if (t.observed !== null && !isNum(t.observed)) err(`${q}.observed`, "number or null");
      if (isNum(t.amount)) sum += t.amount;
      if (isStr(t.name) && /revenue/i.test(t.name)) err(`${q}.name`, "revenue is not a cost term");
      for (const key of list(t, "input_keys", q)) {
        if (!inputKeys.has(String(key))) err(`${q}.input_keys`, `"${key}" is not in cost.inputs`);
      }
    });
    list(cost, "unmeasured", c).forEach((u, j) => {
      if (!isObj(u)) return err(`${c}.unmeasured[${j}]`, "must be an object");
      str(u, "term", `${c}.unmeasured[${j}]`);
      str(u, "reason", `${c}.unmeasured[${j}]`);
    });
    const revenue = obj(cost, "revenue_at_risk", c);
    if (revenue) {
      num(revenue, "amount", `${c}.revenue_at_risk`);
      str(revenue, "label", `${c}.revenue_at_risk`);
      if (revenue.basis !== null && revenue.basis !== "arpu_assumption") {
        err(`${c}.revenue_at_risk.basis`, 'must be "arpu_assumption" or null');
      }
    }
    if (isNum(cost.amount_month) && Math.abs(cost.amount_month - sum) > 1e-6) {
      err(
        `${c}.amount_month`,
        `must equal the sum of the terms (${sum}); revenue at risk never enters it`,
      );
    }
    if (f.in_total === true && isNum(cost.amount_month) && isNum(cost.hours_month)) {
      grossAmount += cost.amount_month;
      grossHours += cost.hours_month;
    }
  });

  const overlap = obj(report, "overlap", "report");
  if (overlap) obj(overlap, "by_order", "overlap");
  const totals = obj(report, "totals", "report");
  if (totals) {
    const gross = obj(totals, "gross", "totals");
    if (gross) {
      num(gross, "hours", "totals.gross");
      num(gross, "amount", "totals.gross");
      if (isNum(gross.amount) && Math.abs(gross.amount - grossAmount) > 1e-6) {
        err("totals.gross.amount", `must equal the sum of findings with in_total (${grossAmount})`);
      }
      if (isNum(gross.hours) && Math.abs(gross.hours - grossHours) > 1e-6) {
        err("totals.gross.hours", `must equal the sum of findings with in_total (${grossHours})`);
      }
    }
    if (totals.net !== null) {
      const net = obj(totals, "net", "totals");
      if (net) {
        num(net, "hours", "totals.net");
        num(net, "amount", "totals.net");
      }
    }
  }
  list(report, "journeys", "report").forEach((j, i) => {
    const p = `journeys[${i}]`;
    if (!isObj(j)) return err(p, "must be an object");
    str(j, "order_ref", p);
    list(j, "segments", p);
    if (j.story !== null && !isStr(j.story)) err(`${p}.story`, "must be a string or null");
  });
  return errors;
}
