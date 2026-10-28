// SPDX-License-Identifier: MIT
/**
 * `deno task stub` — serve data/demo/ as read-only, standard-TMF-shaped APIs
 * on loopback (M0-11). GET only, every response marked simulated.
 *
 * Environment:
 * - STUB_PORT: port to bind (default 8081; bss-oss-rust keeps 8080).
 * - STUB_BEARER_TOKEN: when set, requests must present
 *   `Authorization: Bearer <value>`; when unset, the stub serves without
 *   auth. An environment variable instead of a flag so the token never shows
 *   up in `ps` or shell history, and so `deno task stub` needs no arguments.
 *   This exists to exercise the adapter's auth path locally — it is a demo
 *   guard, not security.
 *
 * Usage (from core/):
 *   deno task stub
 */

import { loadStubDataset } from "./dataset.ts";
import { buildStubState } from "./mapping.ts";
import { createHandler } from "./router.ts";

const ROOT = new URL("../../data/demo/", import.meta.url);
const DEFAULT_PORT = 8081;

const port = Number(Deno.env.get("STUB_PORT") ?? "") || DEFAULT_PORT;
const bearerToken = Deno.env.get("STUB_BEARER_TOKEN") || undefined;

const dataset = await loadStubDataset(ROOT);
const state = buildStubState(
  dataset.catalog,
  dataset.orders,
  dataset.serviceOrders,
  dataset.attempts,
);
const handler = createHandler({ state, bearerToken });

console.error(
  `stub: ${state.productOrders.length} product orders, ${state.serviceOrders.length} ` +
    `service orders, ${state.activations.length} activations; ` +
    `http://127.0.0.1:${port} (auth: ${bearerToken === undefined ? "off" : "bearer on"})`,
);

Deno.serve({ port, hostname: "127.0.0.1" }, handler);
