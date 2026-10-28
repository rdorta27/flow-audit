// SPDX-License-Identifier: MIT
/**
 * Loads the synthetic Ortelis dataset from the exported files in data/demo/
 * (M0-11). The exports are the same event history the file ingest will read
 * in M5-02: the stub proves they are enough to answer TMF-shaped queries.
 *
 * Rows keep their file order, which is the generator's deterministic order
 * (by order, oldest first); the stub does not re-sort.
 */

import type {
  Catalog,
  Order,
  OrderState,
  ProvisioningAttempt,
  ServiceOrder,
} from "../domain/model.ts";

export interface StubDataset {
  catalog: Catalog;
  orders: Order[];
  serviceOrders: ServiceOrder[];
  attempts: ProvisioningAttempt[];
}

/** Minimal CSV reader: the exports only quote fields that contain commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

async function readText(root: URL, name: string): Promise<string> {
  return await Deno.readTextFile(new URL(name, root));
}

/** One line of oms_orders.csv: an order row joined with one of its service orders. */
interface OmsRow {
  orderRef: string;
  submittedAt: string;
  orderState: OrderState;
  offerId: string;
  soRef: string;
  specId: string;
  soState: OrderState;
  soCreatedAt: string;
}

function parseOms(text: string): OmsRow[] {
  const rows = parseCsv(text);
  const header = rows[0];
  const column = new Map<string, number>(header.map((name, index) => [name, index]));
  const pick = (row: string[], name: string): string => row[column.get(name) as number];
  return rows.slice(1).map((row) => ({
    orderRef: pick(row, "order_ref"),
    submittedAt: pick(row, "submitted_at"),
    orderState: pick(row, "order_state") as OrderState,
    offerId: pick(row, "offer_id"),
    soRef: pick(row, "so_ref"),
    specId: pick(row, "spec_id"),
    soState: pick(row, "so_state") as OrderState,
    soCreatedAt: pick(row, "so_created_at"),
  }));
}

function parseAttempts(text: string): ProvisioningAttempt[] {
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => {
    const raw = JSON.parse(line) as Record<string, unknown>;
    return {
      attemptId: raw.attempt_id as string,
      soRef: (raw.so_ref as string | null) ?? null,
      serial: raw.serial as string,
      state: raw.state as ProvisioningAttempt["state"],
      errorCode: (raw.error_code as string | null) ?? null,
      startedAt: raw.started_at as string,
      endedAt: (raw.ended_at as string | null) ?? null,
    };
  });
}

export async function loadStubDataset(root: URL): Promise<StubDataset> {
  const catalog = JSON.parse(await readText(root, "catalog.json")) as Catalog;
  const oms = parseOms(await readText(root, "oms_orders.csv"));
  const attempts = parseAttempts(await readText(root, "provisioning.jsonl"));

  // First appearance wins: the export repeats the order fields on every row
  // and lists a duplicate order's service orders right after the first.
  const orders = new Map<string, Order>();
  const serviceOrders = new Map<string, ServiceOrder>();
  for (const row of oms) {
    if (!orders.has(row.orderRef)) {
      orders.set(row.orderRef, {
        orderRef: row.orderRef,
        submittedAt: row.submittedAt,
        state: row.orderState,
        offerId: row.offerId,
        offerVersion: "v1",
      });
    }
    if (!serviceOrders.has(row.soRef)) {
      serviceOrders.set(row.soRef, {
        soRef: row.soRef,
        orderRef: row.orderRef,
        specId: row.specId,
        state: row.soState,
        createdAt: row.soCreatedAt,
      });
    }
  }

  return {
    catalog,
    orders: [...orders.values()],
    serviceOrders: [...serviceOrders.values()],
    attempts,
  };
}
