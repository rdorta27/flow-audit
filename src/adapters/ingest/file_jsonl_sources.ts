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
  readFileText,
  RowView,
} from "./file_common.ts";
import type { BlockMapping } from "./mapping.ts";

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
    for await (const { line, row } of jsonLines(this.path, this.block.encoding)) {
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

/** Processes with their activities nested, one process per line (D-05). */
export class FileBpmSource extends JsonlSource {
  readonly name = "BPM processes (file)";
  protected readonly system = "BPM" as const;

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
        activities,
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
      },
    };
  }
}
