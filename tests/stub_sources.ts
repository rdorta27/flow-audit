// SPDX-License-Identifier: MIT
/** Test helper: the audit over the demo stub, in process, with no socket. */

import { runAudit } from "../src/app/run_audit.ts";
import { createTmfSources } from "../src/adapters/ingest/tmf_sources.ts";
import type { ImpactConfig } from "../src/domain/model.ts";
import { loadStubDataset } from "../src/stub/dataset.ts";
import { buildStubState } from "../src/stub/mapping.ts";
import { createHandler } from "../src/stub/router.ts";

const dataDir = new URL("../data/demo/", import.meta.url);
export const demoConfig = JSON.parse(
  await Deno.readTextFile(new URL("config.json", dataDir)),
) as ImpactConfig;
const stubData = await loadStubDataset(dataDir);
const handle = createHandler({
  state: buildStubState(
    stubData.catalog,
    stubData.orders,
    stubData.serviceOrders,
    stubData.attempts,
  ),
});

/** The three TMF sources over the stub handler, in process: no socket. */
export function stubSources() {
  return createTmfSources({
    baseUrl: "http://127.0.0.1:8081",
    now: () => NOW,
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      handle(new Request(String(input), init))) as typeof fetch,
  });
}

const NOW = "2026-09-30T00:00:00.000Z";
const clock = { nowIso: () => "2026-09-01T00:00:00Z" };

export async function auditStub() {
  return await runAudit({}, { clock, sources: stubSources(), config: demoConfig });
}
