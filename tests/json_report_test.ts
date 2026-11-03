// SPDX-License-Identifier: MIT
/** The JSON report (M4-02): golden file, determinism and the output directory. */

import { renderFindingsJson } from "../src/adapters/report/json_renderer.ts";
import { main } from "../src/cli/main.ts";
import { validateReport } from "../src/domain/report_validator.ts";
import { assert, assertEquals } from "./assert.ts";
import { auditStub } from "./stub_sources.ts";

const GOLDEN = new URL("./golden/findings.demo.json", import.meta.url);
const configJson = JSON.parse(
  await Deno.readTextFile(new URL("../data/demo/config.json", import.meta.url)),
);

/** Replaces the two fields allowed to change between runs. */
const stable = (text: string) =>
  text.replace(/"id": "[0-9a-f]{16}"/, '"id": "<run>"').replace(
    /"generated_at": "[^"]*"/,
    '"generated_at": "<time>"',
  );

Deno.test("findings.json matches the golden file and validates against findings/1", async () => {
  const text = renderFindingsJson((await auditStub()).report);
  assertEquals(validateReport(JSON.parse(text), configJson), []);
  if (Deno.env.get("UPDATE_GOLDEN")) await Deno.writeTextFile(GOLDEN, stable(text));
  assertEquals(stable(text), await Deno.readTextFile(GOLDEN));
});

Deno.test("findings.json carries the labels and R04's USD 1,590", async () => {
  const file = JSON.parse(renderFindingsJson((await auditStub()).report));
  assertEquals(file.labels, {
    synthetic_data: true,
    simulated_integration: true,
    estimated_impact: true,
  });
  const [r04] = file.findings;
  assertEquals(r04.cost.terms.map((t: { amount: number }) => t.amount), [1350, 240]);
  assertEquals(r04.cost.amount_month, 1590);
  assertEquals(r04.cost.hours_month, 30);
  assertEquals(file.correlation.links["attempt->service_order"].inferred, 0);
});

Deno.test("two runs on the same input give the same bytes", async () => {
  const a = renderFindingsJson((await auditStub()).report);
  const b = renderFindingsJson((await auditStub()).report);
  assertEquals(a, b);
});

Deno.test("--out names a directory that is missing: the run fails clearly", async () => {
  const dir = `${await Deno.makeTempDir()}/missing`;
  const original = console.error;
  const messages: string[] = [];
  console.error = (m: string) => messages.push(String(m));
  try {
    // The stub is not served here, so the run stops at the source; the writer is tested directly.
    const { writeReports } = await import("../src/cli/main.ts");
    let caught = "";
    try {
      await writeReports(dir, (await auditStub()).report);
    } catch (error) {
      caught = (error as Error).message;
    }
    assert(caught.includes("output directory") && caught.includes(dir), caught);
    assert(typeof main === "function");
  } finally {
    console.error = original;
  }
});

Deno.test("writeReports writes findings.json and report.html", async () => {
  const dir = await Deno.makeTempDir();
  const { writeReports } = await import("../src/cli/main.ts");
  const report = (await auditStub()).report;
  const paths = await writeReports(dir, report);
  assertEquals(paths.length, 2);
  assertEquals(await Deno.readTextFile(`${dir}/findings.json`), renderFindingsJson(report));
  assert((await Deno.readTextFile(`${dir}/report.html`)).startsWith("<!doctype html>"));
  await Deno.remove(dir, { recursive: true });
});
