// SPDX-License-Identifier: MIT
import { NoEvidenceSourceError, runAudit } from "../src/app/run_audit.ts";
import { assert, assertEquals } from "./assert.ts";

const clock = { nowIso: () => "2026-09-01T00:00:00Z" };

Deno.test("audit fails with a clear message when no evidence source exists", async () => {
  let caught: unknown;
  try {
    await runAudit({}, { clock });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof NoEvidenceSourceError, "expected NoEvidenceSourceError");
  assert(
    caught.message.includes("no evidence source"),
    `message should name the missing source: ${caught.message}`,
  );
});

import { auditStub, demoConfig, stubSources } from "./stub_sources.ts";
import { EXPECTED } from "../src/dataset/generator.ts";
import { main, summaryLines } from "../src/cli/main.ts";

Deno.test("the pipeline over the stub gives exactly one finding, R04, USD 1,590", async () => {
  const progress: string[] = [];
  const result = await runAudit({}, {
    clock,
    sources: stubSources(),
    config: demoConfig,
    onProgress: (m) => progress.push(m),
  });

  assertEquals(result.records.productOrders.length, EXPECTED.orders);
  assertEquals(result.records.serviceOrders.length, EXPECTED.service_orders);
  assertEquals(result.records.activations.length, EXPECTED.attempts);
  assertEquals(result.findings.length, 1);
  const finding = result.findings[0];
  assertEquals(finding.id, "R04");
  assertEquals(finding.ruleVersion, "R04@1");
  assertEquals(finding.affectedOrders, EXPECTED.findings.R04.affected_orders);
  assertEquals(finding.cost.hoursMonth, 30);
  assertEquals(finding.cost.amountMonth, 1590);
  assertEquals(result.report.totals.gross, { hours: 30, amount: 1590 });
  assertEquals(result.report.run.generatedAt, "2026-09-01T00:00:00Z");
  assert(progress.some((m) => m.includes("R04@1")), "progress should name the rule");
  assertEquals(
    summaryLines(result).at(-1),
    "R04@1 \u00b7 20 orders \u00b7 30 h \u00b7 USD 1,590",
  );
});

Deno.test("the report counts links as the demo expects (300 activations without a reference)", async () => {
  const { report } = await auditStub();
  const links = report.correlation.links["attempt->service_order"];
  assertEquals(links.explicit, EXPECTED.attempts - 300);
  assertEquals(links.missing, 300);
  assertEquals(report.sources.map((s) => s.records), [
    EXPECTED.orders,
    EXPECTED.service_orders,
    EXPECTED.attempts,
  ]);
  assertEquals(report.labels.simulatedIntegration, true);
});

Deno.test("the audit is deterministic and one changed byte changes inputsHash", async () => {
  const a = await auditStub();
  const b = await auditStub();
  assertEquals(a.report, b.report);

  const sources = stubSources();
  const altered = {
    ...sources,
    activations: {
      name: sources.activations.name,
      read: async function* () {
        let first = true;
        for await (const row of sources.activations.read()) {
          if (first) {
            first = false;
            yield { ...row, value: { ...row.value, errorCode: "CHANGED" } };
          } else yield row;
        }
      },
    },
  };
  const c = await runAudit({}, { clock, sources: altered, config: demoConfig });
  assert(c.report.run.inputsHash !== a.report.run.inputsHash, "inputsHash must change");
  assertEquals(c.report.run.configHash, a.report.run.configHash);
});

Deno.test("audit with no source exits 2 with the clear message", async () => {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    assertEquals(await main([]), 2);
    assertEquals(await main(["--source", "nope"]), 2);
  } finally {
    console.error = original;
  }
  assert(lines.some((l) => l.includes("no evidence source configured")));
});
