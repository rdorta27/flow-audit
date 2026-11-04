// SPDX-License-Identifier: MIT
/** What every file reader shares: the error that names file, line and field, and the row view. */

import type { Provenance } from "../../domain/model.ts";
import { type BlockMapping, CANONICAL, type IdRule } from "./mapping.ts";
import { readDate } from "./dates.ts";

/** A bad export. The message names the file, the line and, when it is one, the field. */
export class FileError extends Error {
  constructor(file: string, line: number | null, field: string | null, why: string) {
    super(
      `${file}${line === null ? "" : `:${line}`}${
        field === null ? "" : ` field "${field}"`
      }: ${why}`,
    );
    this.name = "FileError";
  }
}

export interface FileSourceOptions {
  /** The directory with the exports. */
  dir: string;
  /** Observation time for provenance; injected so tests are deterministic. */
  now: () => string;
  /** True when the files hold invented data (the demo dataset). */
  simulated: boolean;
}

export function joinPath(dir: string, file: string): string {
  return dir.endsWith("/") ? `${dir}${file}` : `${dir}/${file}`;
}

/** Reads a file and decodes it as the mapping says. */
export async function readFileText(path: string, encoding = "utf-8"): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(path);
  } catch (error) {
    throw new FileError(path, null, null, `cannot read the file: ${(error as Error).message}`);
  }
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new FileError(path, null, null, `is not valid ${encoding} text`);
  }
}

export function provenance(
  options: FileSourceOptions,
  path: string,
  externalId: string,
  kind: Provenance["kind"],
): Provenance {
  return {
    externalId,
    endpoint: path,
    retrievedAt: options.now(),
    simulated: options.simulated,
    kind,
  };
}

/** What was and was not understood in one file: the coverage report (M5-05). */
export interface FileCoverage {
  file: string;
  rows: number;
  /** Rows whose id repeated an earlier row of the same entity (dropped, not lost). */
  repeatedRows: number;
  /** Rows with at least one state value the table did not know (only when `unmapped`). */
  rowsWithUnmappedState: number;
  /** Per state table: how many values were mapped and which ones were not. */
  states: Record<string, { mapped: number; unmapped: number; unknown: Record<string, number> }>;
  /** Canonical fields the mapping declares not observable. */
  notObservable: string[];
}

export function newCoverage(file: string, block: BlockMapping | undefined): FileCoverage {
  return {
    file,
    rows: 0,
    repeatedRows: 0,
    rowsWithUnmappedState: 0,
    states: {},
    notObservable: block
      ? Object.entries(block.columns).filter(([, c]) => c === null).map(([f]) => f)
      : [],
  };
}

function applyId(value: string, rule: IdRule | undefined): string {
  let id = value.trim();
  if (!rule) return id;
  const fold = (t: string) =>
    rule.case === "upper" ? t.toUpperCase() : rule.case === "lower" ? t.toLowerCase() : t;
  id = fold(id);
  if (rule.stripPrefix && id.startsWith(fold(rule.stripPrefix))) {
    id = id.slice(rule.stripPrefix.length);
  }
  if (rule.stripLeadingZeros) id = id.replace(/^0+(?=.)/, "");
  if (rule.addPrefix) id = fold(rule.addPrefix) + id;
  return id;
}

/** One row of a file, read through the mapping: every accessor takes a canonical field name. */
export class RowView {
  unmappedState = false;

  constructor(
    readonly file: string,
    readonly line: number,
    private readonly block: BlockMapping,
    private readonly cell: (client: string) => unknown,
    private readonly coverage: FileCoverage,
    private readonly columns: Record<string, string | null> = block.columns,
  ) {}

  /** Wraps another row (an activity inside a process) under its own field names. */
  with(cell: (client: string) => unknown, columns: Record<string, string | null>): RowView {
    return new RowView(this.file, this.line, this.block, cell, this.coverage, columns);
  }

  /** The raw text of a field; null when not observable, absent or blank. */
  raw(field: string): string | null {
    const column = this.columns[field];
    if (column === null || column === undefined) return null;
    const value = this.cell(column);
    if (value === undefined || value === null) return null;
    if (typeof value === "object") {
      throw new FileError(this.file, this.line, column, "must be a single value");
    }
    const text = String(value).trim();
    return text === "" ? null : text;
  }

  #column(field: string) {
    return this.columns[field] ?? field;
  }

  text(field: string): string | null {
    return this.raw(field);
  }

  requiredText(field: string): string {
    const value = this.raw(field);
    if (value === null) {
      throw new FileError(
        this.file,
        this.line,
        this.#column(field),
        "is required and is empty or missing",
      );
    }
    return value;
  }

  id(field: string, required = false): string | null {
    const value = required ? this.requiredText(field) : this.raw(field);
    return value === null ? null : applyId(value, this.block.ids[field]);
  }

  date(field: string, required = false): string | null {
    const value = required ? this.requiredText(field) : this.raw(field);
    if (value === null) return null;
    const iso = readDate(value, {
      format: this.block.dateFormat,
      offsetMinutes: this.block.offsetMinutes,
    });
    if (iso === null) {
      throw new FileError(
        this.file,
        this.line,
        this.#column(field),
        `"${value}" is not a date in the format ${this.block.dateFormat}`,
      );
    }
    return iso;
  }

  /**
   * A state translated through the block's table (or the canonical names when there is none).
   * Returns the canonical value and the text as the file wrote it. An unknown value fails
   * naming it, or, with `on_unknown_state: "unmapped"`, is counted and returned as `null`.
   */
  state(table: string, field: string): { value: string | null; raw: string } {
    const raw = this.requiredText(field);
    const entry = this.coverage.states[table] ??= { mapped: 0, unmapped: 0, unknown: {} };
    const key = raw.toLowerCase();
    const explicit = this.block.states[table];
    let value: string | undefined;
    if (explicit) value = explicit[key];
    else {
      const canonical = CANONICAL[table];
      value = canonical ? canonical.find((c) => c.toLowerCase() === key) : raw;
    }
    if (value !== undefined) {
      entry.mapped++;
      return { value, raw };
    }
    if (this.block.onUnknownState === "fail") {
      throw new FileError(
        this.file,
        this.line,
        this.#column(field),
        `the state "${raw}" is not in the ${table} state table of the mapping`,
      );
    }
    entry.unmapped++;
    entry.unknown[raw] = (entry.unknown[raw] ?? 0) + 1;
    this.unmappedState = true;
    return { value: null, raw };
  }
}
