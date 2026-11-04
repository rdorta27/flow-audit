// SPDX-License-Identifier: MIT
/**
 * The order manager export: one CSV, three views of it.
 *
 * Each row is an order joined with one of its service orders and, on the row that opens it,
 * a work order. The order fields repeat on every row, so a key seen again is dropped (the
 * first row wins): orders by `order_ref`, service orders by `so_ref`, work orders by `wo_ref`.
 * Columns, ids, dates and states are read through the mapping (`mapping.ts`).
 */

import type { EvidenceSource, RawRecord } from "../../ports/evidence_source.ts";
import { parseCsv } from "./csv.ts";
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
import type { BlockMapping } from "./mapping.ts";

type Value = Record<string, unknown>;
interface Parsed {
  line: number;
  order: { id: string; value: Value };
  serviceOrder: { id: string; value: Value };
  workOrder: { id: string; value: Value } | null;
  /** The order line this row's service order decomposes, when the export names one (M2-08). */
  item: Value | null;
}

type Kind = "order" | "service_order" | "work_order";

export class OmsFile {
  readonly path: string;
  readonly coverage: FileCoverage;
  #parsed: Promise<Parsed[]> | undefined;

  constructor(private readonly options: FileSourceOptions, private readonly block: BlockMapping) {
    this.path = joinPath(options.dir, block.file);
    this.coverage = newCoverage(this.path, block);
  }

  #load(): Promise<Parsed[]> {
    this.#parsed ??= this.#parse();
    return this.#parsed;
  }

  async #parse(): Promise<Parsed[]> {
    const { block, path } = this;
    const text = await readFileText(path, block.encoding);
    let table;
    try {
      table = parseCsv(text, block.delimiter);
    } catch (error) {
      throw new FileError(
        path,
        (error as { line?: number }).line ?? null,
        null,
        (error as Error).message.replace(/^line \d+: /, ""),
      );
    }
    if (table.length === 0) throw new FileError(path, null, null, "the file is empty");
    const header = table[0].cells.map((h) => h.trim());
    for (const [field, column] of Object.entries(block.columns)) {
      if (column !== null && !header.includes(column)) {
        throw new FileError(
          path,
          table[0].line,
          column,
          `the column is missing (mapped from ${field})`,
        );
      }
    }
    const hasWork = block.columns.wo_ref !== null;
    const parsed: Parsed[] = [];
    for (const row of table.slice(1)) {
      if (row.cells.length !== header.length) {
        throw new FileError(
          path,
          row.line,
          null,
          `has ${row.cells.length} fields, the header has ${header.length}`,
        );
      }
      const byName = new Map(header.map((h, i) => [h, row.cells[i]]));
      const view = new RowView(path, row.line, block, (c) => byName.get(c), this.coverage);
      this.coverage.rows++;

      const orderRef = view.id("order_ref", true)!;
      const orderState = view.state("order", "order_state");
      const soState = view.state("service_order", "so_state");
      const soRef = view.id("so_ref", true)!;
      if (view.unmappedState) this.coverage.rowsWithUnmappedState++;

      const woRef = hasWork ? view.id("wo_ref") : null;
      const itemRef = view.id("item_ref");
      parsed.push({
        item: itemRef === null ? null : {
          item_ref: itemRef,
          offer_id: view.text("item_offer_id"),
          spec_id: view.text("item_spec_id"),
          action: view.text("item_action"),
          parent_item: view.id("parent_item_ref"),
          replaces_item: view.id("replaces_item_ref"),
        },
        line: row.line,
        order: {
          id: orderRef,
          value: {
            order_ref: orderRef,
            submitted_at: view.date("submitted_at", true),
            ...raws(view, "submitted_at"),
            order_state: orderState.value,
            order_state_raw: orderState.raw,
            offer_id: view.requiredText("offer_id"),
            offer_version: view.text("offer_version"),
            replaces_order_ref: view.id("replaces_order_ref"),
            single_line: block.singleLineOrders,
          },
        },
        serviceOrder: {
          id: soRef,
          value: {
            so_ref: soRef,
            order_ref: orderRef,
            spec_id: view.requiredText("spec_id"),
            so_state: soState.value,
            so_state_raw: soState.raw,
            so_action: view.text("so_action"),
            item_ref: itemRef,
            so_created_at: view.date("so_created_at", true),
            ...raws(view, "so_created_at"),
            terminal_serial: view.id("terminal_serial"),
            single_line: block.singleLineOrders,
          },
        },
        workOrder: woRef === null ? null : this.#workOrder(view, woRef, soRef),
      });
    }
    return parsed;
  }

  #workOrder(view: RowView, woRef: string, soRef: string) {
    const kind = this.block.columns.wo_kind === null
      ? null
      : view.state("work_order_kind", "wo_kind");
    const state = this.block.columns.wo_state === null
      ? null
      : view.state("work_order", "wo_state");
    return {
      id: woRef,
      value: {
        wo_ref: woRef,
        so_ref: soRef,
        wo_kind: kind?.value ?? null,
        wo_state: state?.value ?? null,
        wo_created_at: view.date("wo_created_at", true),
      },
    };
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
    const all = await this.#load();
    // The lines of each order, from the rows that name an item; first mention of an item wins.
    const lines = new Map<string, Map<string, Value>>();
    for (const parsed of all) {
      if (parsed.item === null) continue;
      const own = lines.get(parsed.order.id) ?? new Map<string, Value>();
      const ref = String(parsed.item.item_ref);
      if (!own.has(ref)) own.set(ref, parsed.item);
      lines.set(parsed.order.id, own);
    }
    for (const parsed of all) {
      const entry = kind === "order"
        ? parsed.order
        : kind === "service_order"
        ? parsed.serviceOrder
        : parsed.workOrder;
      if (entry === null || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const own = kind === "order" ? lines.get(entry.id) : undefined;
      yield {
        system: "OMS",
        source: this.path,
        line: parsed.line,
        value: own ? { ...entry.value, items: [...own.values()] } : entry.value,
        provenance: provenance(this.options, this.path, entry.id, this.block.evidenceKind),
      };
    }
  }

  /** Call after reading: the rows that repeated an order are the rows minus its distinct orders. */
  async finishCoverage(): Promise<FileCoverage> {
    const parsed = await this.#load();
    this.coverage.repeatedRows = parsed.length - new Set(parsed.map((p) => p.order.id)).size;
    // The key of the export is the service order: a second row of one is a repeat.
    const first = new Map<string, string>();
    this.coverage.repeatedKeys = 0;
    this.coverage.exactRepeats = 0;
    for (const p of parsed) {
      const text = JSON.stringify([p.order.value, p.serviceOrder.value, p.workOrder?.value]);
      const before = first.get(p.serviceOrder.id);
      if (before === undefined) first.set(p.serviceOrder.id, text);
      else {
        this.coverage.repeatedKeys++;
        if (before === text) this.coverage.exactRepeats++;
      }
    }
    return this.coverage;
  }
}
