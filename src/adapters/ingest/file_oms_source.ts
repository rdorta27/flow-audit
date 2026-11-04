// SPDX-License-Identifier: MIT
/**
 * The order manager export (`oms_orders.csv`): one CSV, three views of it.
 *
 * Each row is an order joined with one of its service orders and, on the row that opens it,
 * a work order. The order fields repeat on every row, so a key seen again is dropped (the
 * first row wins): orders by `order_ref`, service orders by `so_ref`, work orders by `wo_ref`.
 */

import type { EvidenceSource, RawRecord } from "../../ports/evidence_source.ts";
import { type CsvRow, parseCsv } from "./csv.ts";
import {
  FileError,
  type FileSourceOptions,
  joinPath,
  optionalText,
  provenance,
  readFileText,
  requiredDate,
  requiredText,
} from "./file_common.ts";

export const OMS_FILE = "oms_orders.csv";

const REQUIRED_COLUMNS = [
  "order_ref",
  "submitted_at",
  "order_state",
  "offer_id",
  "so_ref",
  "spec_id",
  "so_state",
  "so_created_at",
];

type Kind = "order" | "service_order" | "work_order";

export class OmsFile {
  readonly path: string;
  #rows: Promise<{ line: number; cells: Record<string, string> }[]> | undefined;

  constructor(private readonly options: FileSourceOptions, file = OMS_FILE) {
    this.path = joinPath(options.dir, file);
  }

  #load() {
    this.#rows ??= (async () => {
      const text = await readFileText(this.path);
      let table: CsvRow[];
      try {
        table = parseCsv(text);
      } catch (error) {
        throw new FileError(
          this.path,
          (error as { line?: number }).line ?? null,
          null,
          (error as Error).message.replace(/^line \d+: /, ""),
        );
      }
      if (table.length === 0) throw new FileError(this.path, null, null, "the file is empty");
      const header = table[0].cells.map((h) => h.trim());
      for (const column of REQUIRED_COLUMNS) {
        if (!header.includes(column)) {
          throw new FileError(this.path, table[0].line, column, "the column is missing");
        }
      }
      return table.slice(1).map((row) => {
        if (row.cells.length !== header.length) {
          throw new FileError(
            this.path,
            row.line,
            null,
            `has ${row.cells.length} fields, the header has ${header.length}`,
          );
        }
        return {
          line: row.line,
          cells: Object.fromEntries(header.map((h, i) => [h, row.cells[i]])),
        };
      });
    })();
    return this.#rows;
  }

  source(kind: Kind): EvidenceSource {
    const names = {
      order: "OMS orders (file)",
      service_order: "OMS service orders (file)",
      work_order: "OMS work orders (file)",
    };
    return { name: names[kind], read: () => this.#read(kind) };
  }

  async *#read(kind: Kind): AsyncIterable<RawRecord> {
    const seen = new Set<string>();
    const file = this.path;
    for (const { line, cells: row } of await this.#load()) {
      let id: string;
      let value: Record<string, unknown>;
      if (kind === "order") {
        id = requiredText(file, line, row, "order_ref");
        if (seen.has(id)) continue;
        value = {
          order_ref: id,
          submitted_at: requiredDate(file, line, row, "submitted_at"),
          order_state: requiredText(file, line, row, "order_state"),
          offer_id: requiredText(file, line, row, "offer_id"),
          offer_version: optionalText(file, line, row, "offer_version"),
          replaces_order_ref: optionalText(file, line, row, "replaces_order_ref"),
        };
      } else if (kind === "service_order") {
        id = requiredText(file, line, row, "so_ref");
        if (seen.has(id)) continue;
        value = {
          so_ref: id,
          order_ref: requiredText(file, line, row, "order_ref"),
          spec_id: requiredText(file, line, row, "spec_id"),
          so_state: requiredText(file, line, row, "so_state"),
          so_created_at: requiredDate(file, line, row, "so_created_at"),
          terminal_serial: optionalText(file, line, row, "terminal_serial"),
        };
      } else {
        const ref = optionalText(file, line, row, "wo_ref");
        if (ref === null || seen.has(ref)) continue;
        id = ref;
        value = {
          wo_ref: id,
          so_ref: requiredText(file, line, row, "so_ref"),
          wo_kind: requiredText(file, line, row, "wo_kind"),
          wo_state: requiredText(file, line, row, "wo_state"),
          wo_created_at: requiredDate(file, line, row, "wo_created_at"),
        };
      }
      seen.add(id);
      yield {
        system: "OMS",
        source: file,
        line,
        value,
        provenance: provenance(this.options, file, id),
      };
    }
  }
}
