// SPDX-License-Identifier: MIT
/**
 * `deno task read`: connects to a TMF source, reads product orders, service
 * orders and activation attempts, joins them and prints counts and how sure each join is
 * (M1-01, M1-05a, M1-05b, M2-02).
 *
 * This is a data check, not an audit: it counts what the source served and says
 * nothing about whether it is a problem. Findings arrive with the rules (M3).
 */

import { mapActivation, mapProductOrder, mapServiceOrder } from "../adapters/ingest/tmf_mapping.ts";
import { correlate, summarizeLinks } from "../domain/correlation.ts";
import { deriveOrderStates } from "../domain/order_state.ts";
import { createTmfSources, tmfConfigFromEnvOrStub } from "../adapters/ingest/tmf_sources.ts";
import { TmfError } from "../adapters/ingest/tmf_client.ts";
import type { EvidenceSource } from "../ports/evidence_source.ts";

export interface ReadSummary {
  productOrders: number;
  serviceOrders: number;
  activations: number;
  /** Product orders that ended up with more than one service order. */
  productOrdersWithSeveralServiceOrders: number;
  /** How sure each join is, by kind of link (M2-02). */
  links: ReturnType<typeof summarizeLinks>;
  /** Orders whose own state disagrees with their service orders (M2-06); informational. */
  ordersWithInconsistentState: number;
}

export async function summarize(
  productOrders: EvidenceSource,
  serviceOrders: EvidenceSource,
  activations: EvidenceSource,
): Promise<ReadSummary> {
  const orders = [];
  for await (const record of productOrders.read()) orders.push(mapProductOrder(record));
  const services = [];
  for await (const record of serviceOrders.read()) services.push(mapServiceOrder(record));
  const attempts = [];
  for await (const record of activations.read()) attempts.push(mapActivation(record));

  const result = correlate({ orders, serviceOrders: services, attempts });
  return {
    productOrders: orders.length,
    serviceOrders: services.length,
    activations: attempts.length,
    productOrdersWithSeveralServiceOrders:
      result.orders.filter((entry) => entry.serviceOrders.length > 1).length,
    links: summarizeLinks(result.links),
    ordersWithInconsistentState: deriveOrderStates(result).filter((s) => s.disagrees).length,
  };
}

const LINK_LABELS: [keyof ReadSummary["links"], string][] = [
  ["service_order->order", "service order -> product order"],
  ["attempt->service_order", "activation -> service order"],
];

async function main(): Promise<number> {
  const get = (name: string) => Deno.env.get(name);
  try {
    const config = tmfConfigFromEnvOrStub(get);
    console.log(`Reading from ${config.baseUrl}`);
    const sources = createTmfSources(config);
    const summary = await summarize(
      sources.productOrders,
      sources.serviceOrders,
      sources.activations,
    );
    const rows: [string, number][] = [
      ["Product orders (TMF622)", summary.productOrders],
      ["Service orders (TMF641)", summary.serviceOrders],
      ["Activation attempts (TMF640)", summary.activations],
      [
        "Product orders with more than one service order",
        summary.productOrdersWithSeveralServiceOrders,
      ],
    ];
    const width = Math.max(...rows.map(([label]) => label.length));
    for (const [label, value] of rows) {
      console.log(`${label.padEnd(width)}  ${value.toLocaleString("en-US")}`);
    }
    console.log("\nHow sure each join is (anything but explicit is a correlation gap):");
    for (const [kind, label] of LINK_LABELS) {
      const counts = Object.entries(summary.links[kind])
        .filter(([, n]) => n > 0)
        .map(([confidence, n]) => `${confidence} ${n.toLocaleString("en-US")}`);
      console.log(`  ${label.padEnd(32)}${counts.join(" · ") || "none"}`);
    }
    console.log(
      `\n${summary.ordersWithInconsistentState.toLocaleString("en-US")} orders whose state ` +
        "disagrees with their service orders (informational, not a finding)",
    );
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
