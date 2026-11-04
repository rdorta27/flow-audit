// SPDX-License-Identifier: MIT
/** R02@1: a declared activation requirement missing from the spec, with its manual task. */

import { runAudit } from "../src/app/run_audit.ts";
import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { parseMapping } from "../src/adapters/ingest/mapping.ts";
import { configFromFile } from "../src/domain/data_files.ts";
import type { Catalog, ImpactConfig, ProcessTask } from "../src/domain/model.ts";
import { detectR02, scanR02 } from "../src/domain/rules/r02.ts";
import { assert, assertEquals } from "./assert.ts";
import { config, order, process, so, world } from "./rules_fixture.ts";
import { auditStub } from "./stub_sources.ts";

const attr = (name: string) => ({
  name,
  type: "string" as const,
  required: true,
  usedBy: ["PROV" as const],
});
const catalog = (specAttributes: string[], validTo: string | null = null): Catalog => ({
  specs: [{
    specId: "SPEC-1",
    name: "spec",
    serviceType: "x",
    attributes: specAttributes.map(attr),
  }],
  offers: [{
    offerId: "OFFER-1",
    name: "offer",
    family: "f",
    status: "active",
    versions: [{
      version: "v1",
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo,
      priceUsd: 0,
      specId: "SPEC-1",
    }],
  }],
});
const human: ProcessTask[] = [{ name: "capacity_check", actor: "human" as const }];

function run(
  attributes: string[],
  tasks: ProcessTask[],
  extra: { offerVersion?: string; cfg?: ImpactConfig } = {},
) {
  const result = world({
    orders: [order("O1", { offerVersion: extra.offerVersion ?? "v1" })],
    serviceOrders: [so("S1", "O1")],
    processes: [process("P1", "S1", tasks)],
    attempts: [],
  });
  return {
    orders: result.orders,
    context: { catalog: catalog(attributes) },
    cfg: extra.cfg ?? config,
  };
}

Deno.test("R02 fires when the attribute is absent and the human task ran: 5 min each", () => {
  const { orders, context, cfg } = run(["terminal_model"], human);
  const f = detectR02(orders, cfg, context)!;
  assertEquals([f.id, f.ruleVersion, f.affectedOrders], ["R02", "R02@1", 1]);
  assert(Math.abs(f.cost.hoursMonth - 5 / 60) < 1e-9);
  assertEquals(f.confidence.level, "confirmed");
});

Deno.test("R02 does not fire when the attribute is present", () => {
  const { orders, context, cfg } = run(["terminal_model", "capacity_profile"], human);
  assertEquals(detectR02(orders, cfg, context), null);
});

Deno.test("R02 does not fire on a human task with another purpose, or an automatic one", () => {
  const other = run(["terminal_model"], [{ name: "engineering_approval", actor: "human" }]);
  assertEquals(detectR02(other.orders, other.cfg, other.context), null);
  assertEquals(scanR02(other.orders, other.cfg, other.context).missingWithoutTask, 1);
  const auto = run(["terminal_model"], [{ name: "capacity_check", actor: "system" }]);
  assertEquals(detectR02(auto.orders, auto.cfg, auto.context), null);
});

Deno.test("R02 ignores an offer version nobody bought in the period", () => {
  const { orders, context, cfg } = run(["terminal_model"], human);
  const unsold: Catalog = JSON.parse(JSON.stringify(context.catalog));
  unsold.offers[0].versions.push({
    ...unsold.offers[0].versions[0],
    version: "v0",
    specId: "SPEC-OLD",
  });
  unsold.specs.push({ specId: "SPEC-OLD", name: "old", serviceType: "x", attributes: [] });
  // The order is on v1, which has the attribute; v0 has none but no order is on it.
  unsold.specs[0].attributes.push(attr("capacity_profile"));
  assertEquals(detectR02(orders, cfg, { catalog: unsold }), null);
});

Deno.test("R02 falls back to the version valid at submission (inferred) or to unknown", () => {
  const inferred = run(["terminal_model"], human, { offerVersion: "unknown" });
  const f = detectR02(inferred.orders, inferred.cfg, inferred.context)!;
  assertEquals(f.confidence.level, "possible");
  assertEquals(f.breakdown?.specInferred, 1);

  // v1 ended before the order: no version applies, so the order is unmeasured, not counted.
  const expired = run(["terminal_model"], human, { offerVersion: "unknown" });
  const context = { catalog: catalog(["terminal_model"], "2026-08-01T00:00:00.000Z") };
  const scan = scanR02(expired.orders, expired.cfg, context);
  assertEquals([scan.hits.length, scan.unknownSpec], [0, 1]);
});

Deno.test("R02 needs the catalog and a declared requirement", () => {
  const { orders, cfg, context } = run(["terminal_model"], human);
  assertEquals(detectR02(orders, cfg), null);
  assertEquals(
    detectR02(orders, { ...cfg, rules: { r02: { activationRequirements: [] } } }, context),
    null,
  );
});

Deno.test("demo over the files: 4,167 orders, 347.3 h, sample capped, none on v2", async () => {
  const dir = new URL("../data/demo/", import.meta.url).pathname;
  const mapping = parseMapping(
    await Deno.readTextFile(`${dir}mapping.json`),
    "data/demo/mapping.json",
  );
  const sources = createFileSources(mapping, { dir, now: () => "2026-09-30T00:00:00.000Z" });
  const demo = configFromFile(JSON.parse(await Deno.readTextFile(`${dir}config.json`)));
  const { findings } = await runAudit({}, {
    clock: { nowIso: () => "2026-09-01T00:00:00Z" },
    sources,
    config: demo,
  });
  const r02 = findings.find((f) => f.id === "R02")!;
  assertEquals(r02.affectedOrders, 4167);
  assertEquals(Math.round(r02.cost.hoursMonth * 10) / 10, 347.3);
  assertEquals(r02.evidenceTotal, 4167);
  assertEquals(r02.evidence.length, 20);
  assertEquals(r02.breakdown?.unknownSpec, 0);
});

Deno.test("over the stub R02 does not run: no catalog and no process tasks are served", async () => {
  const { findings } = await auditStub();
  assertEquals(findings.some((f) => f.id === "R02"), false);
});
