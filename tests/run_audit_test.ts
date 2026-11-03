// SPDX-License-Identifier: MIT
import { NoEvidenceSourceError, runAudit } from "../src/app/run_audit.ts";
import type { RawRecord } from "../src/ports/evidence_source.ts";
import { assert, assertEquals } from "./assert.ts";

const clock = { nowIso: () => "2026-09-01T00:00:00Z" };

Deno.test("audit fails with a clear message when no evidence source exists", async () => {
  let caught: unknown;
  try {
    await runAudit({ lang: "en" }, { clock });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof NoEvidenceSourceError, "expected NoEvidenceSourceError");
  assert(
    caught.message.includes("no evidence source"),
    `message should name the missing source: ${caught.message}`,
  );
});

const NOW = "2026-09-30T00:00:00.000Z";

Deno.test("walking skeleton reads every record and returns no findings yet", async () => {
  const records: RawRecord[] = [
    {
      system: "OMS",
      source: "oms.csv",
      line: 2,
      value: { order_ref: "ORD-1" },
      provenance: {
        externalId: "ORD-1",
        endpoint: "oms.csv",
        retrievedAt: NOW,
        simulated: false,
        kind: "history",
      },
    },
    {
      system: "PROV",
      source: "prov.jsonl",
      line: 1,
      value: { serial: "SN-1" },
      provenance: {
        externalId: "SN-1",
        endpoint: "prov.jsonl",
        retrievedAt: NOW,
        simulated: false,
        kind: "history",
      },
    },
  ];

  const evidence = {
    name: "test",
    read: async function* (): AsyncIterable<RawRecord> {
      for (const record of records) yield record;
    },
  };

  const result = await runAudit({ lang: "en" }, { clock, evidence });

  assertEquals(result.eventCount, 2);
  assertEquals(result.journeys, []);
  assertEquals(result.findings, []);
});
