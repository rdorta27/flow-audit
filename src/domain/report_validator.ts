// SPDX-License-Identifier: MIT
/**
 * Checks a report in its file form (snake_case, see `report_json.ts`) against `findings/2`
 * (`docs/architecture/report-schema.md`). No dependencies. It returns every problem found,
 * each prefixed with the path, so an empty list means the report is valid.
 */

import { EVIDENCE_SAMPLE_MAX, SCHEMA_VERSION } from "./model.ts";

type Obj = Record<string, unknown>;

const SEVERITIES = ["critical", "high", "medium"];
const STATUSES = [
  "detected",
  "suspected",
  "not_detected",
  "insufficient_evidence",
  "not_evaluable",
];
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
  // A rate written as {low, base, high, ...} (M5-07): its value is the base.
  return isObj(node) ? node.base ?? node.value : node;
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
    oneOf(cost, "kind", c, COST_KINDS);
    str(cost, "formula", c);
    num(cost, "hours_month", c);
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
      num(t, "hours", q);
      oneOf(t, "basis", q, BASES);
      if (t.observed !== null && !isNum(t.observed)) err(`${q}.observed`, "number or null");
      if (isNum(t.hours)) sum += t.hours;
      for (const key of list(t, "input_keys", q)) {
        if (!inputKeys.has(String(key))) err(`${q}.input_keys`, `"${key}" is not in cost.inputs`);
      }
    });
    list(cost, "unmeasured", c).forEach((u, j) => {
      if (!isObj(u)) return err(`${c}.unmeasured[${j}]`, "must be an object");
      str(u, "term", `${c}.unmeasured[${j}]`);
      str(u, "reason", `${c}.unmeasured[${j}]`);
    });
    num(cost, "hours_low", c);
    num(cost, "hours_high", c);
    if (
      isNum(cost.hours_month) && isNum(cost.hours_low) && isNum(cost.hours_high) &&
      (cost.hours_low > cost.hours_month + 1e-6 || cost.hours_high < cost.hours_month - 1e-6)
    ) {
      err(`${c}.hours_low`, "must satisfy hours_low <= hours_month <= hours_high");
    }
    const scenario = obj(f, "scenario", p);
    if (scenario) {
      const q = `${p}.scenario`;
      str(scenario, "fix", q);
      str(scenario, "mechanism", q);
      for (const k of ["fixed_orders", "orders_after", "hours_after"]) num(scenario, k, q);
      oneOf(scenario, "kind", q, ["projection"]);
      if (
        isNum(scenario.orders_after) && isNum(f.affected_orders) &&
        scenario.orders_after > f.affected_orders
      ) {
        err(`${q}.orders_after`, "must not exceed affected_orders");
      }
    }
    if (isNum(cost.hours_month) && Math.abs(cost.hours_month - sum) > 1e-6) {
      err(`${c}.hours_month`, `must equal the sum of the terms (${sum})`);
    }
    if (f.in_total === true && isNum(cost.hours_month)) {
      grossHours += cost.hours_month;
    }
  });

  const overlap = obj(report, "overlap", "report");
  if (overlap) {
    obj(overlap, "by_order", "overlap");
    list(overlap, "pairs", "overlap");
  }
  const totals = obj(report, "totals", "report");
  if (totals) {
    const gross = obj(totals, "gross", "totals");
    if (gross) {
      num(gross, "hours", "totals.gross");
      num(gross, "hours_low", "totals.gross");
      num(gross, "hours_high", "totals.gross");
      if (isNum(gross.hours) && Math.abs(gross.hours - grossHours) > 1e-6) {
        err("totals.gross.hours", `must equal the sum of findings with in_total (${grossHours})`);
      }
    }
    const net = obj(totals, "net", "totals");
    if (net) {
      num(net, "hours", "totals.net");
      num(net, "hours_low", "totals.net");
      num(net, "hours_high", "totals.net");
      if (gross && isNum(net.hours) && isNum(gross.hours) && net.hours > gross.hours + 1e-6) {
        err("totals.net.hours", "must not exceed totals.gross.hours");
      }
    }
  }
  const rowKeys = new Set<string>();
  list(report, "assumptions", "report").forEach((a, i) => {
    const p = `assumptions[${i}]`;
    if (!isObj(a)) return err(p, "must be an object");
    str(a, "key", p);
    oneOf(a, "unit", p, ["minutes", "hours"]);
    oneOf(a, "source", p, ["client", "benchmark", "assumption", "example"]);
    for (const k of ["value", "low", "high"]) num(a, k, p);
    for (const k of ["owner", "date"]) {
      if (a[k] !== null && !isStr(a[k])) err(`${p}.${k}`, "must be a string or null");
    }
    list(a, "used_by", p);
    if (isStr(a.key)) {
      rowKeys.add(a.key);
      const found = lookup(keysFrom, a.key);
      if (found === undefined) err(`${p}.key`, `"${a.key}" is not a key of config.json`);
      else if (found !== a.value) err(`${p}.value`, `differs from config.json "${a.key}"`);
    }
  });
  // Every rate a finding uses has its row (M4-09).
  (Array.isArray(report.findings) ? report.findings : []).forEach((f, i) => {
    const inputs = isObj(f) && isObj(f.cost) && Array.isArray(f.cost.inputs) ? f.cost.inputs : [];
    for (const inp of inputs) {
      if (isObj(inp) && isStr(inp.key) && !rowKeys.has(inp.key)) {
        err(`findings[${i}].cost.inputs`, `"${inp.key}" has no row in assumptions`);
      }
    }
  });
  list(report, "sensitivity", "report").forEach((r, i) => {
    const p = `sensitivity[${i}]`;
    if (!isObj(r)) return err(p, "must be an object");
    str(r, "key", p);
    for (const k of ["low", "high", "hours_at_low", "hours_at_high", "swing"]) num(r, k, p);
  });
  list(report, "rules", "report").forEach((r, i) => {
    const p = `rules[${i}]`;
    if (!isObj(r)) return err(p, "must be an object");
    str(r, "id", p);
    str(r, "title", p);
    str(r, "version", p);
    oneOf(r, "outcome", p, ["found", "nothing_found", "not_evaluable"]);
    if (r.reason !== null && !isStr(r.reason)) err(`${p}.reason`, "must be a string or null");
  });
  const scope = obj(report, "scope", "report");
  if (scope) num(scope, "orders", "scope");
  const waiting = obj(report, "waiting", "report");
  if (waiting) checkWaiting(waiting, err);
  list(report, "journeys", "report").forEach((j, i) => {
    const p = `journeys[${i}]`;
    if (!isObj(j)) return err(p, "must be an object");
    str(j, "order_ref", p);
    list(j, "segments", p);
    list(j, "story", p).forEach((step, k) => {
      const q = `${p}.story[${k}]`;
      if (!isObj(step)) return err(q, "must be an object");
      str(step, "what", q);
      if (step.at !== null && !isStr(step.at)) err(`${q}.at`, "must be a string or null");
      if (typeof step.observed !== "boolean") err(`${q}.observed`, "must be true or false");
      if (step.finding !== null && !isStr(step.finding)) {
        err(`${q}.finding`, "must be a string or null");
      }
    });
  });
  return errors;
}

const KIND_KEYS = ["work", "wait", "queue", "gap"];

function checkWaiting(waiting: Obj, err: (path: string, message: string) => void): void {
  if (typeof waiting.measurable !== "boolean") {
    err("waiting.measurable", "must be a boolean");
  }
  if (waiting.reason !== null && !isStr(waiting.reason)) {
    err("waiting.reason", "must be a string or null");
  }
  const stages = Array.isArray(waiting.stages) ? waiting.stages : [];
  if (!Array.isArray(waiting.stages)) err("waiting.stages", "must be an array");
  stages.forEach((stage, i) => {
    const p = `waiting.stages[${i}]`;
    if (!isObj(stage)) return err(p, "must be an object");
    oneOfStage(stage, "system", p, err);
    if (!isNonEmpty(stage.stage)) err(`${p}.stage`, "must be a non-empty string");
    if (!isNum(stage.orders)) err(`${p}.orders`, "must be a number");
    if (!isNum(stage.waiting_hours)) err(`${p}.waiting_hours`, "must be a number");
    for (const kind of KIND_KEYS) {
      const block = stage[kind];
      if (!isObj(block)) {
        err(`${p}.${kind}`, "must be an object");
        continue;
      }
      for (const k of ["median_hours", "p90_hours"]) {
        if (block[k] !== null && !isNum(block[k])) {
          err(`${p}.${kind}.${k}`, "must be a number or null");
        }
      }
    }
  });
  if (waiting.most_waiting !== null) {
    if (!isObj(waiting.most_waiting)) {
      err("waiting.most_waiting", "must be an object or null");
    } else {
      oneOfStage(waiting.most_waiting, "system", "waiting.most_waiting", err);
      if (!isNonEmpty(waiting.most_waiting.stage)) {
        err("waiting.most_waiting.stage", "must be a non-empty string");
      }
      if (!isNum(waiting.most_waiting.waiting_hours)) {
        err("waiting.most_waiting.waiting_hours", "must be a number");
      }
      if (!Array.isArray(waiting.most_waiting.findings)) {
        err("waiting.most_waiting.findings", "must be an array");
      }
    }
  }
  if (waiting.measurable === false && waiting.reason !== "not measurable") {
    err("waiting.reason", 'must be "not measurable" when the source cannot show it');
  }
}

function oneOfStage(
  o: Obj,
  k: string,
  path: string,
  err: (path: string, message: string) => void,
): void {
  if (!SYSTEMS.includes(String(o[k]))) err(`${path}.${k}`, `must be one of ${SYSTEMS.join(", ")}`);
}
