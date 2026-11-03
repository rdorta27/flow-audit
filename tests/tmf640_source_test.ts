// SPDX-License-Identifier: MIT
/** The TMF640 activation adapter (M1-05b): an unlinked attempt is evidence, not an error. */

import { Tmf640ServiceActivationSource } from "../src/adapters/ingest/tmf640_source.ts";
import { TmfError } from "../src/adapters/ingest/tmf_client.ts";
import { EXPECTED } from "../src/dataset/generator.ts";
import { loadStubDataset } from "../src/stub/dataset.ts";
import { buildStubState } from "../src/stub/mapping.ts";
import { createHandler } from "../src/stub/router.ts";
import type { RawRecord } from "../src/ports/evidence_source.ts";
import { assert, assertEquals } from "./assert.ts";

const BASE = "http://127.0.0.1:8081";

function activation(n: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "@type": "ServiceActivation",
    id: `ACT-${n}`,
    state: "FAILED",
    activationDate: "2026-09-01T10:00:00.000Z",
    completionDate: "2026-09-01T10:05:00.000Z",
    serviceOrder: { id: `SO-${n}`, href: `/x/SO-${n}` },
    ...extra,
  };
}

const serve = (rows: unknown[]) =>
  (() => Promise.resolve(new Response(JSON.stringify(rows)))) as typeof fetch;

async function collect(source: Tmf640ServiceActivationSource): Promise<RawRecord[]> {
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

Deno.test("reads activations as PROV evidence with provenance", async () => {
  const rows = await collect(
    new Tmf640ServiceActivationSource({
      baseUrl: BASE,
      fetch: serve([activation(1), activation(2)]),
    }),
  );
  assertEquals(rows.map((r) => r.provenance.externalId), ["ACT-1", "ACT-2"]);
  assertEquals(rows[0].system, "PROV");
  assert(rows[0].provenance.endpoint.endsWith("/serviceActivation"));
});

Deno.test("an activation with no service order link is kept, not rejected", async () => {
  const unlinked = activation(1, { serviceOrder: undefined });
  const pending = activation(2, { state: "PENDING", completionDate: undefined });
  const rows = await collect(
    new Tmf640ServiceActivationSource({ baseUrl: BASE, fetch: serve([unlinked, pending]) }),
  );
  assertEquals(rows.length, 2);
  assertEquals(rows[0].value.serviceOrder, undefined);
});

Deno.test("a half-formed link or a bad date fails and names the record", async () => {
  const link = await failure(() =>
    collect(
      new Tmf640ServiceActivationSource({
        baseUrl: BASE,
        fetch: serve([activation(1, { serviceOrder: { href: "/x" } })]),
      }),
    )
  );
  const date = await failure(() =>
    collect(
      new Tmf640ServiceActivationSource({
        baseUrl: BASE,
        fetch: serve([activation(1, { completionDate: "later" })]),
      }),
    )
  );
  const field = await failure(() =>
    collect(
      new Tmf640ServiceActivationSource({
        baseUrl: BASE,
        fetch: serve([activation(1, { state: undefined })]),
      }),
    )
  );
  assert(link.includes("ACT-1") && link.includes("serviceOrder link"), link);
  assert(date.includes("completionDate"), date);
  assert(field.includes('"state"'), field);
});

Deno.test("against the TMF stub it reads every attempt and the 300 unlinked ones", async () => {
  const data = await loadStubDataset(new URL("../data/demo/", import.meta.url));
  const state = buildStubState(data.catalog, data.orders, data.serviceOrders, data.attempts);
  const handle = createHandler({ state });
  const viaStub =
    ((input: string | URL | Request, init?: RequestInit) =>
      handle(new Request(String(input), init))) as typeof fetch;

  const rows = await collect(new Tmf640ServiceActivationSource({ baseUrl: BASE, fetch: viaStub }));
  assertEquals(rows.length, EXPECTED.attempts);
  assertEquals(rows.filter((r) => !r.value.serviceOrder).length, 300);
});
