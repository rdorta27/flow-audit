// SPDX-License-Identifier: MIT
/** The TMF641 service order adapter (M1-05a): same client, plus the explicit item link R04 needs. */

import { Tmf641ServiceOrderSource } from "../src/adapters/ingest/tmf641_source.ts";
import { TmfError } from "../src/adapters/ingest/tmf_client.ts";
import { EXPECTED } from "../src/dataset/generator.ts";
import { loadStubDataset } from "../src/stub/dataset.ts";
import { buildStubState } from "../src/stub/mapping.ts";
import { createHandler } from "../src/stub/router.ts";
import type { RawRecord } from "../src/ports/evidence_source.ts";
import { assert, assertEquals } from "./assert.ts";

const BASE = "http://127.0.0.1:8081";

function serviceOrder(n: number, link: unknown = { id: `ORD-${n}-1`, productOrderId: `ORD-${n}` }) {
  return {
    "@type": "ServiceOrder",
    id: `SO-${n}`,
    state: "COMPLETED",
    orderDate: "2026-09-01T10:00:00.000Z",
    serviceOrderItem: [{
      id: `SO-${n}-1`,
      action: "add",
      state: "COMPLETED",
      productOrderItem: link,
    }],
  };
}

const serve = (rows: unknown[]) =>
  (() => Promise.resolve(new Response(JSON.stringify(rows)))) as typeof fetch;

async function collect(source: Tmf641ServiceOrderSource): Promise<RawRecord[]> {
  const rows: RawRecord[] = [];
  for await (const row of source.read()) rows.push(row);
  return rows;
}

async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    assert(error instanceof TmfError, `expected a TmfError, got ${error}`);
    return error.message;
  }
  throw new Error("expected a TmfError, nothing was thrown");
}

Deno.test("reads service orders and keeps the item link as sent", async () => {
  const rows = await collect(
    new Tmf641ServiceOrderSource({
      baseUrl: BASE,
      fetch: serve([serviceOrder(1), serviceOrder(2)]),
    }),
  );
  assertEquals(rows.map((r) => r.value.id), ["SO-1", "SO-2"]);
  assertEquals(rows[0].system, "OMS");
  assert(rows[0].source.includes("/serviceOrdering/v4/serviceOrder"));
});

Deno.test("an item without the product order link fails and says which item", async () => {
  for (const link of [null, {}, { id: "ORD-1-1" }, { productOrderId: "ORD-1" }]) {
    const message = await failure(() =>
      collect(
        new Tmf641ServiceOrderSource({ baseUrl: BASE, fetch: serve([serviceOrder(1, link)]) }),
      )
    );
    assert(message.includes("SO-1") && message.includes("item 1"), message);
    assert(message.includes("productOrderItem"), message);
  }
});

Deno.test("a service order with no items array fails", async () => {
  const broken = { ...serviceOrder(1), serviceOrderItem: undefined };
  const message = await failure(() =>
    collect(new Tmf641ServiceOrderSource({ baseUrl: BASE, fetch: serve([broken]) }))
  );
  assert(message.includes("serviceOrderItem array"), message);
});

Deno.test("against the TMF stub it reads all service orders, every item linked", async () => {
  const data = await loadStubDataset(new URL("../data/demo/", import.meta.url));
  const state = buildStubState(data.catalog, data.orders, data.serviceOrders, data.attempts);
  const handle = createHandler({ state });
  const viaStub =
    ((input: string | URL | Request, init?: RequestInit) =>
      handle(new Request(String(input), init))) as typeof fetch;

  const rows = await collect(new Tmf641ServiceOrderSource({ baseUrl: BASE, fetch: viaStub }));
  assertEquals(rows.length, EXPECTED.service_orders);

  const perProductOrder = new Map<string, number>();
  for (const row of rows) {
    const items = row.value.serviceOrderItem as { productOrderItem: { productOrderId: string } }[];
    const parent = items[0].productOrderItem.productOrderId;
    perProductOrder.set(parent, (perProductOrder.get(parent) ?? 0) + 1);
  }
  const duplicated = [...perProductOrder.values()].filter((n) => n > 1).length;
  assertEquals(duplicated, 20, "the R04 cohort must be visible as 20 duplicated orders");
});

Deno.test("read summary counts orders, service orders and the duplicated cohort", async () => {
  const { summarize } = await import("../src/cli/read.ts");
  const { Tmf622ProductOrderSource } = await import("../src/adapters/ingest/tmf622_source.ts");
  const data = await loadStubDataset(new URL("../data/demo/", import.meta.url));
  const state = buildStubState(data.catalog, data.orders, data.serviceOrders, data.attempts);
  const handle = createHandler({ state });
  const viaStub =
    ((input: string | URL | Request, init?: RequestInit) =>
      handle(new Request(String(input), init))) as typeof fetch;

  const { Tmf640ServiceActivationSource } = await import(
    "../src/adapters/ingest/tmf640_source.ts"
  );
  const summary = await summarize(
    new Tmf622ProductOrderSource({ baseUrl: BASE, fetch: viaStub }),
    new Tmf641ServiceOrderSource({ baseUrl: BASE, fetch: viaStub }),
    new Tmf640ServiceActivationSource({ baseUrl: BASE, fetch: viaStub }),
  );
  assertEquals(summary, {
    productOrders: EXPECTED.orders,
    serviceOrders: EXPECTED.service_orders,
    productOrdersWithSeveralServiceOrders: 20,
    activations: EXPECTED.attempts,
    activationsWithoutServiceOrder: 300,
  });
});
