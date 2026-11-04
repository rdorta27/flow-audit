// SPDX-License-Identifier: MIT
/**
 * The mapping file (`mapping.json`, M5-05): how one client's exports become the canonical
 * fields. It is configuration, so a new client needs a new file, not new code. The format is
 * documented in `docs/architecture/mapping.md`. Keys are snake_case (D-14); the types here
 * are camelCase. Pure: the text comes in, a validated `Mapping` or a `MappingError` goes out.
 */

import { checkDateFormat, parseOffset } from "./dates.ts";

/** A mapping that cannot be used. The message names the file, the line and the field. */
export class MappingError extends Error {
  constructor(file: string, line: number | null, field: string, why: string) {
    super(`${file}${line === null ? "" : `:${line}`} field "${field}": ${why}`);
    this.name = "MappingError";
  }
}

export interface IdRule {
  case?: "upper" | "lower";
  stripPrefix?: string;
  stripLeadingZeros?: boolean;
  addPrefix?: string;
}

/** Client value (any case) to the canonical value. */
export type StateTable = Record<string, string>;

export type BlockName = "oms" | "bpm" | "prov";

export interface BlockMapping {
  file: string;
  format: "csv" | "jsonl";
  delimiter: string;
  encoding: string;
  evidenceKind: "snapshot" | "history";
  dateFormat: string;
  /** Minutes east of UTC. */
  offsetMinutes: number;
  /** Canonical field to the client's column or key; null declares it not observable. */
  columns: Record<string, string | null>;
  ids: Record<string, IdRule>;
  /** Tables by name: `order`, `service_order`, `work_order_kind`, `work_order`, `process`, `attempt`. */
  states: Record<string, StateTable>;
  /** `fail` stops on a value the table lacks; `unmapped` keeps the row and counts it. */
  onUnknownState: "fail" | "unmapped";
  /** OMS only: every order sells one line, so its item is `<order>-1`. */
  singleLineOrders: boolean;
  /** BPM only: the nested activity fields, canonical to the client's key. */
  activityFields: Record<string, string | null>;
}

export interface CatalogMapping {
  file: string;
  evidenceKind: "snapshot" | "history";
}

export interface Mapping {
  /** True when the files hold invented data; the report then says so. */
  simulated: boolean;
  catalog?: CatalogMapping;
  oms: BlockMapping;
  bpm?: BlockMapping;
  prov: BlockMapping;
}

/** The canonical fields of each block: `true` when the engine cannot run without it. */
export const FIELDS: Record<BlockName, Record<string, boolean>> = {
  oms: {
    order_ref: true,
    submitted_at: true,
    order_state: true,
    offer_id: true,
    offer_version: false,
    replaces_order_ref: false,
    so_ref: true,
    spec_id: true,
    so_state: true,
    so_created_at: true,
    terminal_serial: false,
    wo_ref: false,
    wo_kind: false,
    wo_state: false,
    wo_created_at: false,
  },
  bpm: {
    process_id: true,
    so_ref: false,
    business_key: false,
    state: true,
    started_at: true,
    ended_at: false,
    activities: false,
  },
  prov: {
    attempt_id: true,
    so_ref: false,
    serial: false,
    state: true,
    error_code: false,
    started_at: true,
    ended_at: false,
  },
};

export const ACTIVITY_FIELDS: Record<string, boolean> = {
  sequence: false,
  kind: false,
  name: false,
  actor: false,
  started_at: true,
  ended_at: false,
  timer_expired: false,
};

/** Fields that hold an id, and so may carry id rules. */
export const ID_FIELDS: Record<BlockName, string[]> = {
  oms: ["order_ref", "so_ref", "wo_ref", "terminal_serial", "replaces_order_ref"],
  bpm: ["process_id", "so_ref", "business_key"],
  prov: ["attempt_id", "so_ref", "serial"],
};

const TABLES: Record<BlockName, string[]> = {
  oms: ["order", "service_order", "work_order_kind", "work_order"],
  bpm: ["process"],
  prov: ["attempt"],
};

/** The canonical values a state table may translate to; other tables are free text. */
export const CANONICAL: Record<string, readonly string[]> = {
  order: [
    "DRAFT",
    "SUBMITTED",
    "VALIDATED",
    "DECOMPOSED",
    "SCHEDULED",
    "INSTALLED",
    "PROVISIONING",
    "ACTIVE",
    "FAILED",
    "CANCELLED",
    "REJECTED",
    "HELD",
    "PARTIAL",
    "CANCELLING",
  ],
  service_order: [],
  work_order_kind: ["installation", "activation", "recovery"],
  attempt: ["pending", "failed", "succeeded"],
};
CANONICAL.service_order = CANONICAL.order;

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The 1-based line of the last key of `path`, searched in order so repeated names resolve. */
function lineOf(text: string, path: readonly string[]): number | null {
  let from = 0;
  for (const key of path) {
    const at = text.indexOf(`"${key}"`, from);
    if (at < 0) return null;
    from = at;
  }
  return text.slice(0, from).split("\n").length;
}

/** Parses and validates the text of a mapping file; `where` is the path shown in errors. */
export function parseMapping(text: string, where: string): Mapping {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new MappingError(where, null, "(file)", `not valid JSON: ${(error as Error).message}`);
  }
  const fail = (path: string[], why: string): never => {
    throw new MappingError(where, lineOf(text, path), path.join("."), why);
  };

  const object = (value: unknown, path: string[], allowed: readonly string[]) => {
    if (!isObj(value)) return fail(path, "must be an object");
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) fail([...path, key], "unknown field");
    }
    return value;
  };
  const str = (value: unknown, path: string[]): string => {
    if (typeof value !== "string" || value === "") fail(path, "must be a non-empty text");
    return value as string;
  };
  const oneOf = <T extends string>(value: unknown, path: string[], list: readonly T[]): T => {
    if (!list.includes(value as T)) fail(path, `must be one of ${list.join(", ")}`);
    return value as T;
  };
  const kind = (value: unknown, path: string[]) =>
    value === undefined ? "history" as const : oneOf(value, path, ["snapshot", "history"]);

  const fieldMap = (
    value: unknown,
    path: string[],
    fields: Record<string, boolean>,
  ): Record<string, string | null> => {
    const map = object(value, path, Object.keys(fields));
    const out: Record<string, string | null> = {};
    for (const [field, required] of Object.entries(fields)) {
      const v = map[field];
      if (v === undefined) {
        fail(
          path,
          `"${field}" is not declared: name its column, or null if the system does not have it`,
        );
      }
      if (v === null) {
        if (required) fail([...path, field], "is required and cannot be null");
        out[field] = null;
      } else out[field] = str(v, [...path, field]);
    }
    return out;
  };

  const top = object(raw, [], ["simulated", "catalog", "oms", "bpm", "prov"]);
  if (top.oms === undefined) fail([], 'the block "oms" is required');
  if (top.prov === undefined) fail([], 'the block "prov" is required');

  const block = (name: BlockName, value: unknown): BlockMapping => {
    const allowed = [
      "file",
      "format",
      "delimiter",
      "encoding",
      "evidence_kind",
      "date_format",
      "time_zone",
      "columns",
      "fields",
      "ids",
      "states",
      "on_unknown_state",
      ...(name === "oms" ? ["single_line_orders"] : []),
      ...(name === "bpm" ? ["activity_fields"] : []),
    ];
    const b = object(value, [name], allowed);
    const format = oneOf(b.format, [name, "format"], name === "oms" ? ["csv"] : ["jsonl"]);
    const dateFormat = b.date_format === undefined
      ? "iso8601"
      : str(b.date_format, [name, "date_format"]);
    const badFormat = checkDateFormat(dateFormat);
    if (badFormat) fail([name, "date_format"], badFormat);
    const zone = b.time_zone === undefined ? "UTC" : str(b.time_zone, [name, "time_zone"]);
    const offset = parseOffset(zone);
    if (offset === null) {
      fail([name, "time_zone"], `"${zone}" is not UTC or an offset like -05:00`);
    }
    const offsetMinutes = offset as number;
    const encoding = b.encoding === undefined ? "utf-8" : str(b.encoding, [name, "encoding"]);
    try {
      new TextDecoder(encoding);
    } catch {
      fail([name, "encoding"], `"${encoding}" is not an encoding this runtime reads`);
    }
    const delimiter = b.delimiter === undefined ? "," : str(b.delimiter, [name, "delimiter"]);
    if (delimiter.length !== 1) fail([name, "delimiter"], "must be one character");

    const columnsKey = name === "oms" ? "columns" : "fields";
    const wrong = name === "oms" ? "fields" : "columns";
    if (b[wrong] !== undefined) {
      fail([name, wrong], `unknown field: this block uses "${columnsKey}"`);
    }
    const columns = fieldMap(b[columnsKey], [name, columnsKey], FIELDS[name]);

    const ids: Record<string, IdRule> = {};
    if (b.ids !== undefined) {
      const idObj = object(b.ids, [name, "ids"], ID_FIELDS[name]);
      for (const [field, ruleRaw] of Object.entries(idObj)) {
        const path = [name, "ids", field];
        const r = object(ruleRaw, path, [
          "case",
          "strip_prefix",
          "strip_leading_zeros",
          "add_prefix",
        ]);
        const rule: IdRule = {};
        if (r.case !== undefined) {
          rule.case = oneOf(r.case, [...path, "case"], ["upper", "lower"] as const);
        }
        if (r.strip_prefix !== undefined) {
          rule.stripPrefix = str(r.strip_prefix, [...path, "strip_prefix"]);
        }
        if (r.add_prefix !== undefined) rule.addPrefix = str(r.add_prefix, [...path, "add_prefix"]);
        if (r.strip_leading_zeros !== undefined) {
          if (typeof r.strip_leading_zeros !== "boolean") {
            fail([...path, "strip_leading_zeros"], "must be true or false");
          }
          rule.stripLeadingZeros = r.strip_leading_zeros as boolean;
        }
        ids[field] = rule;
      }
    }

    const states: Record<string, StateTable> = {};
    if (b.states !== undefined) {
      const tables = object(b.states, [name, "states"], TABLES[name]);
      for (const [table, rows] of Object.entries(tables)) {
        const path = [name, "states", table];
        const t = object(rows, path, Object.keys(isObj(rows) ? rows : {}));
        const lower: StateTable = {};
        for (const [from, to] of Object.entries(t)) {
          const target = str(to, [...path, from]);
          const allowed = CANONICAL[table];
          const canonical = allowed?.find((a) => a.toLowerCase() === target.toLowerCase());
          if (allowed && !canonical) {
            fail([...path, from], `"${target}" is not a canonical value (${allowed.join(", ")})`);
          }
          lower[from.trim().toLowerCase()] = canonical ?? target;
        }
        states[table] = lower;
      }
    }

    let activityFields: Record<string, string | null> = {};
    if (name === "bpm") {
      activityFields = b.activity_fields === undefined
        ? Object.fromEntries(Object.keys(ACTIVITY_FIELDS).map((f) => [f, f]))
        : fieldMap(b.activity_fields, [name, "activity_fields"], ACTIVITY_FIELDS);
    }

    return {
      file: str(b.file, [name, "file"]),
      format,
      delimiter,
      encoding,
      evidenceKind: kind(b.evidence_kind, [name, "evidence_kind"]),
      dateFormat,
      offsetMinutes,
      columns,
      ids,
      states,
      onUnknownState: b.on_unknown_state === undefined
        ? "fail"
        : oneOf(b.on_unknown_state, [name, "on_unknown_state"], ["fail", "unmapped"]),
      singleLineOrders: name === "oms" && b.single_line_orders === true,
      activityFields,
    };
  };

  if (top.simulated !== undefined && typeof top.simulated !== "boolean") {
    fail(["simulated"], "must be true or false");
  }
  const mapping: Mapping = {
    simulated: top.simulated === true,
    oms: block("oms", top.oms),
    prov: block("prov", top.prov),
  };
  if (top.bpm !== undefined) mapping.bpm = block("bpm", top.bpm);
  if (top.catalog !== undefined) {
    const c = object(top.catalog, ["catalog"], ["file", "format", "evidence_kind"]);
    if (c.format !== undefined) oneOf(c.format, ["catalog", "format"], ["json"]);
    mapping.catalog = {
      file: str(c.file, ["catalog", "file"]),
      evidenceKind: kind(c.evidence_kind, ["catalog", "evidence_kind"]),
    };
  }
  return mapping;
}
