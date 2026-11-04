// SPDX-License-Identifier: MIT
/** The process orchestrator history (`bpm_history.jsonl`) and the activation history (`provisioning.jsonl`). */

import type { EvidenceSource, RawRecord } from "../../ports/evidence_source.ts";
import {
  FileError,
  type FileSourceOptions,
  joinPath,
  optionalDate,
  optionalText,
  provenance,
  readFileText,
  requiredDate,
  requiredText,
} from "./file_common.ts";

export const BPM_FILE = "bpm_history.jsonl";
export const PROV_FILE = "provisioning.jsonl";

type Row = Record<string, unknown>;

/** One JSON object per line; a line that is not one fails naming file and line. */
async function* jsonLines(path: string): AsyncIterable<{ line: number; row: Row }> {
  const text = await readFileText(path);
  const lines = text.split(/\r?\n/);
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

/** Processes with their activities nested, one process per line (D-05). */
export class FileBpmSource implements EvidenceSource {
  readonly name = "BPM processes (file)";
  readonly path: string;
  constructor(private readonly options: FileSourceOptions, file = BPM_FILE) {
    this.path = joinPath(options.dir, file);
  }

  async *read(): AsyncIterable<RawRecord> {
    const file = this.path;
    for await (const { line, row } of jsonLines(file)) {
      const id = requiredText(file, line, row, "process_id");
      const activities = row.activities ?? [];
      if (!Array.isArray(activities)) {
        throw new FileError(file, line, "activities", "must be a list");
      }
      activities.forEach((activity, index) => {
        if (activity === null || typeof activity !== "object") {
          throw new FileError(file, line, `activities[${index}]`, "must be an object");
        }
        requiredDate(file, line, activity as Row, "started_at");
      });
      yield {
        system: "BPM",
        source: file,
        line,
        value: {
          process_id: id,
          so_ref: optionalText(file, line, row, "so_ref"),
          business_key: optionalText(file, line, row, "business_key"),
          state: requiredText(file, line, row, "state"),
          started_at: requiredDate(file, line, row, "started_at"),
          ended_at: optionalDate(file, line, row, "ended_at"),
          activities,
        },
        provenance: provenance(this.options, file, id),
      };
    }
  }
}

/** Activation attempts, one per line. */
export class FileProvisioningSource implements EvidenceSource {
  readonly name = "PROV activation attempts (file)";
  readonly path: string;
  constructor(private readonly options: FileSourceOptions, file = PROV_FILE) {
    this.path = joinPath(options.dir, file);
  }

  async *read(): AsyncIterable<RawRecord> {
    const file = this.path;
    for await (const { line, row } of jsonLines(file)) {
      const id = requiredText(file, line, row, "attempt_id");
      yield {
        system: "PROV",
        source: file,
        line,
        value: {
          attempt_id: id,
          so_ref: optionalText(file, line, row, "so_ref"),
          serial: optionalText(file, line, row, "serial"),
          state: requiredText(file, line, row, "state"),
          error_code: optionalText(file, line, row, "error_code"),
          started_at: requiredDate(file, line, row, "started_at"),
          ended_at: optionalDate(file, line, row, "ended_at"),
        },
        provenance: provenance(this.options, file, id),
      };
    }
  }
}
