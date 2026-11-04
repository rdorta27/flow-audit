// SPDX-License-Identifier: MIT
/** The process orchestrator history and the activation history, one JSON object per line. */

import type { EvidenceSource, RawRecord } from "../../ports/evidence_source.ts";
import {
  type FileCoverage,
  FileError,
  type FileSourceOptions,
  joinPath,
  newCoverage,
  provenance,
  raws,
  readFileText,
  RowView,
} from "./file_common.ts";
import type { BlockMapping, JoinMapping } from "./mapping.ts";

type Row = Record<string, unknown>;

/** One JSON object per line; a line that is not one fails naming file and line. */
async function* jsonLines(
  path: string,
  encoding: string,
): AsyncIterable<{ line: number; row: Row }> {
  const text = await readFileText(path, encoding);
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    let row: unknown;
    try {
      row = JSON.parse(lines[i]);
    } catch (error) {
      throw new FileError(path, i + 1, null, `not valid JSON: ${(error as Error).message}`);
    }
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new FileError(path, i + 1, null, "is not a JSON object");
    }
    yield { line: i + 1, row: row as Row };
  }
}

/** The rows of one joined file, grouped by the join key; a row without the key fails by line. */
async function loadJoin(
  dir: string,
  join: JoinMapping,
  encoding: string,
): Promise<Map<string, Row[]>> {
  const path = joinPath(dir, join.file);
  const byKey = new Map<string, Row[]>();
  for await (const { line, row } of jsonLines(path, encoding)) {
    const value = row[join.key];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new FileError(path, line, join.key, "is missing: the join needs it on every row");
    }
    const key = String(value);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return byKey;
}

/** The main row with the rows of every joined file attached (M5-24). */
function joined(
  row: Row,
  line: number,
  path: string,
  joins: readonly JoinMapping[],
  loaded: readonly Map<string, Row[]>[],
): Row {
  if (joins.length === 0) return row;
  const out: Row = { ...row };
  joins.forEach((join, n) => {
    const value = row[join.key];
    const matches = value === undefined || value === null ? [] : loaded[n].get(String(value)) ?? [];
    if (join.as !== undefined) {
      out[join.as] = matches;
    } else if (matches.length > 1) {
      throw new FileError(
        path,
        line,
        join.key,
        `has ${matches.length} rows in ${join.file}; set "as" on the join to keep them as a list`,
      );
    } else if (matches.length === 1) {
      for (const [k, v] of Object.entries(matches[0])) if (!(k in out)) out[k] = v;
    }
  });
  return out;
}

abstract class JsonlSource implements EvidenceSource {
  abstract readonly name: string;
  readonly path: string;
  readonly coverage: FileCoverage;

  constructor(
    protected readonly options: FileSourceOptions,
    protected readonly block: BlockMapping,
  ) {
    this.path = joinPath(options.dir, block.file);
    this.coverage = newCoverage(this.path, block);
  }

  protected abstract record(view: RowView, row: Row): { id: string; value: Row };
  protected abstract readonly system: "BPM" | "PROV";

  async *read(): AsyncIterable<RawRecord> {
    const seen = new Map<string, string>();
    const joins = this.block.joins ?? [];
    const loaded = await Promise.all(
      joins.map((join) => loadJoin(this.options.dir, join, this.block.encoding)),
    );
    for await (const { line, row: main } of jsonLines(this.path, this.block.encoding)) {
      const row = joined(main, line, this.path, joins, loaded);
      const view = new RowView(this.path, line, this.block, (key) => row[key], this.coverage);
      this.coverage.rows++;
      const { id, value } = this.record(view, row);
      if (view.unmappedState) this.coverage.rowsWithUnmappedState++;
      const text = JSON.stringify(value);
      if (seen.has(id)) {
        this.coverage.repeatedRows++;
        this.coverage.repeatedKeys++;
        if (seen.get(id) === text) this.coverage.exactRepeats++;
        continue;
      }
      seen.set(id, text);
      yield {
        system: this.system,
        source: this.path,
        line,
        value,
        provenance: provenance(this.options, this.path, id, this.block.evidenceKind),
      };
    }
  }
}

/** The optional fields a mapping declares: text ones and date ones; absent ones are left out. */
function extras(view: RowView, texts: string[], dates: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of texts) {
    const v = view.text(f);
    if (v !== null) out[f] = v;
  }
  for (const f of dates) {
    const v = view.date(f);
    if (v !== null) out[f] = v;
  }
  return out;
}

/** Processes with their activities nested, one process per line (D-05). */
export class FileBpmSource extends JsonlSource {
  readonly name = "BPM processes (file)";
  protected readonly system = "BPM" as const;

  /** Incidents nested under the declared key: a list of {type, created_at, resolved_at, message}. */
  private incidents(view: RowView, row: Row): { incidents?: Row[] } {
    const key = this.block.columns.incidents;
    if (key === null || key === undefined) return {};
    const list = row[key] ?? [];
    if (!Array.isArray(list)) throw new FileError(this.path, view.line, key, "must be a list");
    return {
      incidents: list.map((i, n) => {
        if (i === null || typeof i !== "object") {
          throw new FileError(this.path, view.line, `${key}[${n}]`, "must be an object");
        }
        const o = i as Row;
        return {
          type: String(o.type ?? "incident"),
          created_at: view.with((k) => o[k], { created_at: "created_at" }).date("created_at"),
          resolved_at: view.with((k) => o[k], { resolved_at: "resolved_at" }).date("resolved_at"),
          message: o.message === undefined ? null : String(o.message),
        };
      }),
    };
  }

  protected record(view: RowView, row: Row) {
    const id = view.id("process_id", true)!;
    const key = this.block.columns.activities;
    const list = key === null ? [] : row[key] ?? [];
    if (!Array.isArray(list)) {
      throw new FileError(this.path, view.line, key, "must be a list");
    }
    const activities = list.map((activity, index) => {
      if (activity === null || typeof activity !== "object") {
        throw new FileError(this.path, view.line, `${key}[${index}]`, "must be an object");
      }
      const a = view.with(
        (k) => (activity as Row)[k],
        this.block.activityFields,
      );
      return {
        sequence: a.text("sequence"),
        kind: a.text("kind"),
        name: a.text("name"),
        actor: a.text("actor"),
        started_at: a.date("started_at", true),
        ended_at: a.date("ended_at"),
        timer_expired: a.text("timer_expired"),
        ...extras(a, [
          "timer_kind",
          "interrupting",
          "attached_to",
          "next_activity_id",
          "task_id",
          "assignee",
          "candidate_group",
          "event_subprocess",
        ], ["due_date", "fired_at", "created_at", "claimed_at", "due_at"]),
      };
    });
    const state = view.state("process", "state");
    return {
      id,
      value: {
        process_id: id,
        so_ref: view.id("so_ref"),
        business_key: view.id("business_key"),
        state: state.value,
        state_raw: state.raw,
        started_at: view.date("started_at", true),
        ended_at: view.date("ended_at"),
        ...raws(view, "started_at"),
        activities,
        ...extras(view, [
          "suspended",
          "end_reason",
          "parent_process_id",
          "root_process_id",
          "process_definition_key",
          "process_definition_version",
          "loop_index",
        ], []),
        ...this.incidents(view, row),
      },
    };
  }
}

/** Activation attempts, one per line. */
export class FileProvisioningSource extends JsonlSource {
  readonly name = "PROV activation attempts (file)";
  protected readonly system = "PROV" as const;

  protected record(view: RowView) {
    const id = view.id("attempt_id", true)!;
    const state = view.state("attempt", "state");
    return {
      id,
      value: {
        attempt_id: id,
        so_ref: view.id("so_ref"),
        serial: view.id("serial"),
        state: state.value,
        state_raw: state.raw,
        error_code: view.text("error_code"),
        started_at: view.date("started_at", true),
        ended_at: view.date("ended_at"),
        ...raws(view, "started_at", "ended_at"),
      },
    };
  }
}
