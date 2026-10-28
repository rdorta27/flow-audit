// SPDX-License-Identifier: MIT
/**
 * The TMF stub over the synthetic dataset (M0-11).
 *
 * The handler is called directly with Request objects — no socket, no
 * ephemeral port — so the tests need only the read permission `deno task
 * test` already grants. State comes from the committed exports in
 * data/demo/, the same files the stub serves in production.
 */

import { EXPECTED, generateDemoDataset } from "../src/dataset/generator.ts";
import { loadStubDataset } from "../src/stub/dataset.ts";
import { buildStubState, serviceOrderItemId } from "../src/stub/mapping.ts";
import { createHandler, MAX_LIMIT } from "../src/stub/router.ts";
import { assert, assertEquals } from "./assert.ts";

const datasetUrl = new URL("../data/demo/", import.meta.url);
const stubDataset = await loadStubDataset(datasetUrl);
const state = buildStubState(
  stubDataset.catalog,
  stubDataset.orders,
  stubDataset.serviceOrders,
  stubDataset.attempts,
);
const handle = createHandler({ state });
const handleWithAuth = createHandler({ state, bearerToken: "stub-test-token" });

const BASE = "http://127.0.0.1";

async function get(path: string, handler = handle): Promise<Response> {
  return await handler(new Request(`${BASE}${path}`));
}

/** Pages through a collection, asserting the pagination contract as it goes. */
async function fetchAll<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  let total: string | null = null;
  while (true) {
    const res = await get(`${path}?offset=${offset}&limit=${MAX_LIMIT}`);
    assertEquals(res.status, 200, `${path}: page at offset ${offset} failed`);
    if (total === null) total = res.headers.get("X-Total-Count");
    else assertEquals(res.headers.get("X-Total-Count"), total, `${path}: total changed mid-list`);
    const batch = (await res.json()) as T[];
    rows.push(...batch);
    if (batch.length < MAX_LIMIT) break;
    offset += MAX_LIMIT;
  }
  assertEquals(Number(total), rows.length, `${path}: X-Total-Count does not match the pages`);
  return rows;
}

Deno.test("the stub serves the demo dataset with the golden counts", () => {
  assertEquals(state.productOrders.length, EXPECTED.orders);
  assertEquals(state.serviceOrders.length, EXPECTED.service_orders);
  assertEquals(state.activations.length, EXPECTED.attempts);
});

Deno.test("product order list paginates and counts itself", async () => {
  const res = await get(
    "/tmf-api/productOrdering/v4/productOrder?offset=10&limit=5",
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("X-Total-Count"), String(EXPECTED.orders));
  assertEquals(res.headers.get("X-Result-Count"), "5");
  const rows = (await res.json()) as { id: string }[];
  assertEquals(rows.length, 5);
  // Dataset order: by first submission, ORD-1000 first.
  assertEquals(rows[0].id, "ORD-1010");
});

Deno.test("product order detail carries item, offering and end-of-window state", async () => {
  const res = await get("/tmf-api/productOrdering/v4/productOrder/ORD-1000");
  assertEquals(res.status, 200);
  const order = (await res.json()) as Record<string, unknown>;
  assertEquals(order["@type"], "ProductOrder");
  assertEquals(order["state"], "COMPLETED"); // ACTIVE at window end
  assertEquals(order["href"], "/tmf-api/productOrdering/v4/productOrder/ORD-1000");
  const items = order["productOrderItem"] as {
    id: string;
    action: string;
    state: string;
    productOffering: { id: string; href: string; name: string };
  }[];
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "ORD-1000-1");
  assertEquals(items[0].action, "add");
  assertEquals(items[0].state, "COMPLETED");
  assertEquals(items[0].productOffering.id, "OFFER-SKYHOME-50");
  assertEquals(items[0].productOffering.name, "SkyHome 50");
  assert(items[0].productOffering.href.endsWith("/productOffering/OFFER-SKYHOME-50"));
});

Deno.test("a stuck order is still IN_PROGRESS at window end", async () => {
  // The stuck cohort (50 orders) is marked PROVISIONING in the dataset.
  const stuck = state.productOrders.find((o) => o.state === "IN_PROGRESS");
  assert(stuck !== undefined, "the dataset should keep 50 orders IN_PROGRESS");
  const res = await get(`/tmf-api/productOrdering/v4/productOrder/${stuck.id}`);
  assertEquals(res.status, 200);
  const order = (await res.json()) as { state: string; productOrderItem: { state: string }[] };
  assertEquals(order.state, "IN_PROGRESS");
  assertEquals(order.productOrderItem[0].state, "IN_PROGRESS");
});

Deno.test("unknown product order answers 404 with a consistent JSON body", async () => {
  const res = await get("/tmf-api/productOrdering/v4/productOrder/ORD-999999");
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("X-Flow-Audit-Source"), "simulated");
  const body = (await res.json()) as { error: string; status: number };
  assertEquals(body.status, 404);
  assert(body.error.includes("ORD-999999"));
});

Deno.test("invalid pagination answers 400 with the same body shape", async () => {
  for (const query of ["limit=201", "limit=abc", "offset=-1", "limit=0"]) {
    const res = await get(`/tmf-api/productOrdering/v4/productOrder?${query}`);
    assertEquals(res.status, 400, `expected 400 for ${query}`);
    const body = (await res.json()) as { error: string; status: number };
    assertEquals(body.status, 400);
    assertEquals(res.headers.get("X-Flow-Audit-Source"), "simulated");
  }
});

Deno.test("non-GET methods answer 405 with Allow: GET", async () => {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const res = await handlerFor(method);
    assertEquals(res.status, 405, method);
    assertEquals(res.headers.get("Allow"), "GET");
    const body = (await res.json()) as { error: string; status: number };
    assertEquals(body.status, 405);
    assertEquals(res.headers.get("X-Flow-Audit-Source"), "simulated");
  }
});

async function handlerFor(method: string): Promise<Response> {
  return await handle(
    new Request(`${BASE}/tmf-api/productOrdering/v4/productOrder`, { method }),
  );
}

Deno.test("service order links to its product order item", async () => {
  const res = await get("/tmf-api/serviceOrdering/v4/serviceOrder/SO-20000");
  assertEquals(res.status, 200);
  const so = (await res.json()) as {
    "@type": string;
    id: string;
    state: string;
    orderDate: string;
    serviceOrderItem: {
      id: string;
      action: string;
      state: string;
      productOrderItem: { id: string; href: string; productOrderId: string };
    }[];
  };
  assertEquals(so["@type"], "ServiceOrder");
  assertEquals(so.state, "FAILED"); // the duplicated order's first service order
  assertEquals(so.orderDate, "2026-09-01T02:32:27.000Z");
  assertEquals(so.serviceOrderItem.length, 1);
  assertEquals(so.serviceOrderItem[0].id, serviceOrderItemId("SO-20000"));
  assertEquals(so.serviceOrderItem[0].productOrderItem, {
    id: "ORD-1000-1",
    href: "/tmf-api/productOrdering/v4/productOrder/ORD-1000",
    productOrderId: "ORD-1000",
  });
});

Deno.test("R04: exactly the duplicated orders appear as two service orders on one item", async () => {
  const rows = await fetchAll<{
    id: string;
    serviceOrderItem: { productOrderItem: { id: string; productOrderId: string } }[];
  }>("/tmf-api/serviceOrdering/v4/serviceOrder");
  assertEquals(rows.length, EXPECTED.service_orders);

  // Group service orders by the product order item they decompose.
  const byProductOrderItem = new Map<string, string[]>();
  for (const row of rows) {
    for (const item of row.serviceOrderItem) {
      const list = byProductOrderItem.get(item.productOrderItem.id) ?? [];
      list.push(row.id);
      byProductOrderItem.set(item.productOrderItem.id, list);
    }
  }

  const duplicated = [...byProductOrderItem.entries()].filter(([, sos]) => sos.length > 1);
  assertEquals(
    duplicated.length,
    EXPECTED.findings.R04.affected_orders,
    "the R04 cohort size must match the golden numbers",
  );
  for (const [item, sos] of duplicated) {
    assertEquals(sos.length, 2, `${item}: R04 duplicates come in pairs`);
  }

  // The parents are exactly the generator's deliberate duplicates.
  const parents = duplicated.map(([item]) => item.replace(/-\d+$/, "")).sort();
  const expectedParents = generateDemoDataset().defects.duplicates.slice().sort();
  assertEquals(parents, expectedParents);
});

Deno.test("every service order item resolves to an existing product order item", async () => {
  const productOrderItems = new Set(
    state.productOrders.flatMap((po) => po.productOrderItem.map((item) => item.id)),
  );
  for (const so of state.serviceOrders) {
    for (const item of so.serviceOrderItem) {
      assert(
        productOrderItems.has(item.productOrderItem.id),
        `${so.id}: dangling productOrderItem ${item.productOrderItem.id}`,
      );
    }
  }
});

Deno.test("state filter narrows collections", async () => {
  const res = await get("/tmf-api/serviceOrdering/v4/serviceOrder?state=FAILED");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("X-Total-Count"), String(EXPECTED.findings.R04.affected_orders));
  const rows = (await res.json()) as { state: string }[];
  assertEquals(rows.length, EXPECTED.findings.R04.affected_orders);
  assert(rows.every((row) => row.state === "FAILED"));
});

Deno.test("activations reference their service order; weak links stay orphans", async () => {
  const activations = await fetchAll<{
    id: string;
    state: string;
    activationDate: string;
    completionDate?: string;
    serviceOrder?: { id: string; href: string };
    serviceOrderItem?: { id: string; href: string };
  }>("/tmf-api/serviceActivationAndConfiguration/v4/serviceActivation");
  assertEquals(activations.length, EXPECTED.attempts);

  const serviceOrderIds = new Set(state.serviceOrders.map((so) => so.id));
  let orphans = 0;
  for (const activation of activations) {
    if (activation.serviceOrder === undefined) {
      orphans++;
      assert(activation.serviceOrderItem === undefined, `${activation.id}: half-linked`);
      continue;
    }
    assert(
      serviceOrderIds.has(activation.serviceOrder.id),
      `${activation.id}: links to unknown service order ${activation.serviceOrder.id}`,
    );
    assertEquals(activation.serviceOrderItem?.id, serviceOrderItemId(activation.serviceOrder.id));
  }
  assertEquals(orphans, 300);
  assertEquals(orphans, EXPECTED.findings.R05.affected_orders);
});

Deno.test("pending activations have no completionDate; ended ones do", async () => {
  const pending = state.activations.find((a) => a.state === "PENDING");
  assert(pending !== undefined, "the dataset keeps 50 attempts pending");
  assertEquals(pending.completionDate, undefined);
  const completed = state.activations.find((a) => a.state === "COMPLETED");
  assert(completed?.completionDate !== undefined, "ended attempts carry completionDate");
});

Deno.test("bearer mode: wrong or missing token answers 401, the right one 200", async () => {
  const denied = await handleWithAuth(
    new Request(`${BASE}/tmf-api/productOrdering/v4/productOrder`),
  );
  assertEquals(denied.status, 401);
  const bad = await handleWithAuth(
    new Request(`${BASE}/tmf-api/productOrdering/v4/productOrder`, {
      headers: { Authorization: "Bearer nope" },
    }),
  );
  assertEquals(bad.status, 401);
  const ok = await handleWithAuth(
    new Request(`${BASE}/tmf-api/productOrdering/v4/productOrder`, {
      headers: { Authorization: "Bearer stub-test-token" },
    }),
  );
  assertEquals(ok.status, 200);
  // The default handler stays open: bearer is opt-in.
  const open = await get("/tmf-api/productOrdering/v4/productOrder");
  assertEquals(open.status, 200);
});

Deno.test("responses are byte-deterministic", async () => {
  const a = await get("/tmf-api/productOrdering/v4/productOrder?limit=7");
  const b = await get("/tmf-api/productOrdering/v4/productOrder?limit=7");
  assertEquals(await a.clone().text(), await b.clone().text());
  assertEquals([...a.headers.entries()], [...b.headers.entries()]);
  const detailA = await get("/tmf-api/serviceOrdering/v4/serviceOrder/SO-20000");
  const detailB = await get("/tmf-api/serviceOrdering/v4/serviceOrder/SO-20000");
  assertEquals(await detailA.text(), await detailB.text());
});
