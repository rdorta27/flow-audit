// SPDX-License-Identifier: MIT
/**
 * `deno task read`: connects to a TMF source, reads product orders, service
 * orders and activation attempts and prints counts (M1-01, M1-05a, M1-05b).
 *
 * This is a data check, not an audit: it counts what the source served and says
 * nothing about whether it is a problem. Findings arrive with the rules (M3).
 */

import { Tmf622ProductOrderSource, tmfConfigFromEnv } from "../adapters/ingest/tmf622_source.ts";
import { Tmf640ServiceActivationSource } from "../adapters/ingest/tmf640_source.ts";
import { Tmf641ServiceOrderSource } from "../adapters/ingest/tmf641_source.ts";
import { TmfError } from "../adapters/ingest/tmf_client.ts";
import type { EvidenceSource } from "../ports/evidence_source.ts";

const DEFAULT_BASE_URL = "http://127.0.0.1:8081";

export interface ReadSummary {
  productOrders: number;
  serviceOrders: number;
  /** Product orders that have more than one service order. */
  productOrdersWithSeveralServiceOrders: number;
  activations: number;
  /** Activation attempts that carry no link to a service order. */
  activationsWithoutServiceOrder: number;
}

type Item = { productOrderItem?: { productOrderId?: string } };

export async function summarize(
  productOrders: EvidenceSource,
  serviceOrders: EvidenceSource,
  activations: EvidenceSource,
): Promise<ReadSummary> {
  let products = 0;
  for await (const _ of productOrders.read()) products++;

  let services = 0;
  const perProductOrder = new Map<string, number>();
  for await (const record of serviceOrders.read()) {
    services++;
    const items = (record.value.serviceOrderItem ?? []) as Item[];
    // One service order counts once per product order it decomposes.
    const parents = new Set(items.map((i) => i.productOrderItem?.productOrderId));
    for (const parent of parents) {
      if (parent) perProductOrder.set(parent, (perProductOrder.get(parent) ?? 0) + 1);
    }
  }
  let attempts = 0;
  let unlinked = 0;
  for await (const record of activations.read()) {
    attempts++;
    if (!(record.value.serviceOrder as { id?: string } | undefined)?.id) unlinked++;
  }
  return {
    productOrders: products,
    serviceOrders: services,
    productOrdersWithSeveralServiceOrders: [...perProductOrder.values()].filter((n) => n > 1)
      .length,
    activations: attempts,
    activationsWithoutServiceOrder: unlinked,
  };
}

async function main(): Promise<number> {
  const get = (name: string) => Deno.env.get(name);
  try {
    const config = tmfConfigFromEnv((name) =>
      name === "FLOW_AUDIT_TMF_BASE_URL" ? get(name) ?? DEFAULT_BASE_URL : get(name)
    );
    console.log(`Reading from ${config.baseUrl}`);
    const summary = await summarize(
      new Tmf622ProductOrderSource(config),
      new Tmf641ServiceOrderSource(config),
      new Tmf640ServiceActivationSource(config),
    );
    const rows: [string, number][] = [
      ["Product orders (TMF622)", summary.productOrders],
      ["Service orders (TMF641)", summary.serviceOrders],
      [
        "Product orders with more than one service order",
        summary.productOrdersWithSeveralServiceOrders,
      ],
      ["Activation attempts (TMF640)", summary.activations],
      ["Activation attempts with no service order link", summary.activationsWithoutServiceOrder],
    ];
    const width = Math.max(...rows.map(([label]) => label.length));
    for (const [label, value] of rows) {
      console.log(`${label.padEnd(width)}  ${value.toLocaleString("en-US")}`);
    }
    console.log("\nCounts only: this is not an audit and reports no findings.");
    return 0;
  } catch (error) {
    if (error instanceof TmfError) {
      console.error(`error: ${error.message}`);
      console.error("Is the source running? Try: deno task stub");
      return 1;
    }
    throw error;
  }
}

if (import.meta.main) Deno.exit(await main());
