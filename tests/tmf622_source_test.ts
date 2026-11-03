// SPDX-License-Identifier: MIT
/**
 * The TMF622 product order adapter (M1-01).
 *
 * `fetch` is replaced by a function, so nothing opens a socket. One test runs
 * the adapter against the real stub handler, to prove the two fit.
 */

import {
  Tmf622ProductOrderSource,
  tmfConfigFromEnv,
} from "../src/adapters/ingest/tmf622_source.ts";
import { TmfError } from "../src/adapters/ingest/tmf_client.ts";
import { EXPECTED } from "../src/dataset/generator.ts";
import { loadStubDataset } from "../src/stub/dataset.ts";
import { buildStubState } from "../src/stub/mapping.ts";
import { createHandler } from "../src/stub/router.ts";
import type { RawRecord } from "../src/ports/evidence_source.ts";
import { assert, assertEquals } from "./assert.ts";

const BASE = "http://127.0.0.1:8081";

function order(n: number): Record<string, unknown> {
  return {
    "@type": "ProductOrder",
    id: `ORD-${n}`,
    href: `${BASE}/x/${n}`,
    state: "COMPLETED",
    orderDate: "2026-09-01T10:00:00.000Z",
    productOrderItem: [],
  };
}

interface Call {
  url: string;
  method: string | undefined;
  auth: string | null;
}

/** A fake server: serves `all` with offset/limit and records what was asked. */
function fakeServer(all: unknown[], options: { total?: boolean; status?: number } = {}) {
  const calls: Call[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    calls.push({
      url: String(input),
      method: init?.method,
      auth: new Headers(init?.headers).get("Authorization"),
    });
    if (options.status) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "boom", status: options.status }), {
          status: options.status,
        }),
      );
    }
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.total !== false) headers["X-Total-Count"] = String(all.length);
    return Promise.resolve(
      new Response(JSON.stringify(all.slice(offset, offset + limit)), { headers }),
    );
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

async function collect(source: Tmf622ProductOrderSource): Promise<RawRecord[]> {
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

Deno.test("reads every page and numbers the records across pages", async () => {
  const server = fakeServer([order(1), order(2), order(3), order(4), order(5)]);
  const rows = await collect(
    new Tmf622ProductOrderSource({ baseUrl: BASE, pageSize: 2, fetch: server.fetcher }),
  );
  assertEquals(rows.map((r) => r.value.id), ["ORD-1", "ORD-2", "ORD-3", "ORD-4", "ORD-5"]);
  assertEquals(rows.map((r) => r.line), [1, 2, 3, 4, 5]);
  assertEquals(rows[0].system, "OMS");
  assertEquals(server.calls.length, 3);
  assert(rows[0].source.includes("offset=0") && rows[4].source.includes("offset=4"));
});

Deno.test("an empty collection yields nothing after one request", async () => {
  const server = fakeServer([]);
  const rows = await collect(
    new Tmf622ProductOrderSource({ baseUrl: BASE, fetch: server.fetcher }),
  );
  assertEquals(rows.length, 0);
  assertEquals(server.calls.length, 1);
});

Deno.test("without X-Total-Count it stops on a short page", async () => {
  const server = fakeServer([order(1), order(2), order(3)], { total: false });
  const rows = await collect(
    new Tmf622ProductOrderSource({ baseUrl: BASE, pageSize: 2, fetch: server.fetcher }),
  );
  assertEquals(rows.length, 3);
  assertEquals(server.calls.length, 2);
});

Deno.test("only GET is ever sent, and the token goes in a bearer header", async () => {
  const server = fakeServer([order(1), order(2), order(3)]);
  await collect(
    new Tmf622ProductOrderSource({
      baseUrl: BASE,
      token: "secret",
      pageSize: 1,
      fetch: server.fetcher,
    }),
  );
  assert(server.calls.length === 3);
  for (const call of server.calls) {
    assertEquals(call.method, "GET");
    assertEquals(call.auth, "Bearer secret");
    assert(!call.url.includes("secret"), "the token must not appear in the URL");
  }
});

Deno.test("no write method exists on the client or the source", () => {
  const source = new Tmf622ProductOrderSource({ baseUrl: BASE });
  const names = new Set<string>();
  for (
    let proto = Object.getPrototypeOf(source);
    proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    Object.getOwnPropertyNames(proto).forEach((name) => names.add(name));
  }
  names.delete("constructor");
  assertEquals([...names].sort(), ["read"]);
});

Deno.test("an HTTP error names the URL, the status and the server's message", async () => {
  const server = fakeServer([], { status: 500 });
  const message = await failure(() =>
    collect(new Tmf622ProductOrderSource({ baseUrl: BASE, fetch: server.fetcher }))
  );
  assert(message.includes("/productOrder?offset=0") && message.includes("500"));
  assert(message.includes("boom"));
});

Deno.test("a body that is not JSON, or not an array, fails clearly", async () => {
  const notJson = (() => Promise.resolve(new Response("<html>"))) as typeof fetch;
  const notArray = (() => Promise.resolve(new Response('{"id":1}'))) as typeof fetch;
  const a = await failure(() =>
    collect(new Tmf622ProductOrderSource({ baseUrl: BASE, fetch: notJson }))
  );
  const b = await failure(() =>
    collect(new Tmf622ProductOrderSource({ baseUrl: BASE, fetch: notArray }))
  );
  assert(a.includes("valid JSON"), a);
  assert(b.includes("expected a JSON array"), b);
});

Deno.test("a malformed record names its position and the missing field", async () => {
  const bad = { ...order(2), orderDate: "yesterday" };
  const missing = { ...order(3) } as Record<string, unknown>;
  delete missing.state;
  const dates = await failure(() =>
    collect(
      new Tmf622ProductOrderSource({ baseUrl: BASE, fetch: fakeServer([order(1), bad]).fetcher }),
    )
  );
  const fields = await failure(() =>
    collect(
      new Tmf622ProductOrderSource({ baseUrl: BASE, fetch: fakeServer([missing]).fetcher }),
    )
  );
  assert(dates.includes("record 2") && dates.includes("ORD-2") && dates.includes("orderDate"));
  assert(fields.includes("record 1") && fields.includes('"state"'));
});

Deno.test("a runaway source stops at the request limit", async () => {
  // Always a full page and a total that never ends.
  const endless = (() =>
    Promise.resolve(
      new Response(JSON.stringify([order(1)]), { headers: { "X-Total-Count": "999999" } }),
    )) as typeof fetch;
  const message = await failure(() =>
    collect(
      new Tmf622ProductOrderSource({ baseUrl: BASE, pageSize: 1, maxRequests: 3, fetch: endless }),
    )
  );
  assert(message.includes("request limit of 3"), message);
});

Deno.test("cancellation and timeout are reported as such", async () => {
  const hang = ((_: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;

  const controller = new AbortController();
  const cancelled = failure(() =>
    collect(new Tmf622ProductOrderSource({ baseUrl: BASE, fetch: hang }, controller.signal))
  );
  controller.abort();
  assert((await cancelled).includes("cancelled"));

  const timedOut = await failure(() =>
    collect(new Tmf622ProductOrderSource({ baseUrl: BASE, timeoutMs: 20, fetch: hang }))
  );
  assert(timedOut.includes("timed out after 20 ms"), timedOut);
});

Deno.test("a bad baseUrl or limit is rejected before any request", () => {
  for (
    const config of [
      { baseUrl: "not a url" },
      { baseUrl: "ftp://host" },
      { baseUrl: BASE, pageSize: 0 },
      { baseUrl: BASE, timeoutMs: -1 },
    ]
  ) {
    let thrown = false;
    try {
      new Tmf622ProductOrderSource(config);
    } catch (error) {
      thrown = error instanceof TmfError;
    }
    assert(thrown, `accepted ${JSON.stringify(config)}`);
  }
});

Deno.test("configuration comes from environment variables", () => {
  const env: Record<string, string> = {
    FLOW_AUDIT_TMF_BASE_URL: BASE,
    FLOW_AUDIT_TMF_TOKEN: "t",
    FLOW_AUDIT_TMF_TIMEOUT_MS: "500",
  };
  const config = tmfConfigFromEnv((name) => env[name]);
  assertEquals(
    [config.baseUrl, config.token, config.timeoutMs, config.pageSize],
    [BASE, "t", 500, undefined],
  );
  let message = "";
  try {
    tmfConfigFromEnv(() => undefined);
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes("FLOW_AUDIT_TMF_BASE_URL"));
});

Deno.test("against the TMF stub it reads all 5000 orders, simulated, with auth", async () => {
  const data = await loadStubDataset(new URL("../data/demo/", import.meta.url));
  const state = buildStubState(data.catalog, data.orders, data.serviceOrders, data.attempts);
  const handle = createHandler({ state, bearerToken: "stub-token" });
  const viaStub =
    ((input: string | URL | Request, init?: RequestInit) =>
      handle(new Request(String(input), init))) as typeof fetch;

  const rows = await collect(
    new Tmf622ProductOrderSource({ baseUrl: BASE, token: "stub-token", fetch: viaStub }),
  );
  assertEquals(rows.length, EXPECTED.orders);
  assertEquals(new Set(rows.map((r) => r.value.id)).size, EXPECTED.orders);

  const denied = await failure(() =>
    collect(new Tmf622ProductOrderSource({ baseUrl: BASE, token: "wrong", fetch: viaStub }))
  );
  assert(denied.includes("401"), denied);
});
