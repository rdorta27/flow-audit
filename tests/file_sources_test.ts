// SPDX-License-Identifier: MIT
import { runAudit } from "../src/app/run_audit.ts";
import { CsvError, parseCsv } from "../src/adapters/ingest/csv.ts";
import { FileError } from "../src/adapters/ingest/file_common.ts";
import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { parseMapping } from "../src/adapters/ingest/mapping.ts";
import { EXPECTED } from "../src/dataset/generator.ts";
import { main, summaryLines } from "../src/cli/main.ts";
import { assert, assertEquals } from "./assert.ts";
import { demoConfig } from "./stub_sources.ts";

const clock = { nowIso: () => "2026-09-01T00:00:00Z" };
const demoMapping = parseMapping(
  await Deno.readTextFile(new URL("../data/demo/mapping.json", import.meta.url)),
  "data/demo/mapping.json",
);
const options = (dir: string) => ({ dir, now: () => "2026-09-30T00:00:00.000Z" });
const sourcesIn = (dir: string) => createFileSources(demoMapping, options(dir));

/** A directory with the given files, removed by the caller through the returned function. */
async function fixture(files: Record<string, string>) {
  const dir = await Deno.makeTempDir();
  for (const [name, text] of Object.entries(files)) {
    await Deno.writeTextFile(`${dir}/${name}`, text);
  }
  return { dir, done: () => Deno.remove(dir, { recursive: true }) };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const rows: T[] = [];
  for await (const row of it) rows.push(row);
  return rows;
}

async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    assert(error instanceof FileError, `expected FileError, got ${error}`);
    return error.message;
  }
  throw new Error("expected a failure");
}

const OMS_HEADER =
  "order_ref,submitted_at,order_state,offer_id,offer_version,so_ref,spec_id,so_state,so_created_at,terminal_serial,wo_ref,wo_kind,wo_state,wo_created_at,replaces_order_ref,so_action";
const OMS_ROW =
  "ORD-1,2026-09-01T00:00:00.000Z,ACTIVE,OFFER-A,v1,SO-1,SPEC-A,ACTIVE,2026-09-01T01:00:00.000Z,SN-1,WO-1,installation,DONE,2026-09-01T02:00:00.000Z,,";

Deno.test("csv: quoted fields keep commas, quotes and line breaks", () => {
  const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","two\nlines"\n\n1,,3');
  assertEquals(rows.map((r) => r.cells), [
    ["a", "b", "c"],
    ["x, y", 'say "hi"', "two\nlines"],
    ["1", "", "3"],
  ]);
  assertEquals(rows.map((r) => r.line), [1, 2, 5]);
  assertEquals(parseCsv("a;b\n1;2", ";")[1].cells, ["1", "2"]);
});

Deno.test("csv: malformed input is an error with its line", () => {
  for (const [text, line] of [['a,b\n"open,1', 2], ['a\nx"y', 2], ['a\n"x"y', 2]] as const) {
    try {
      parseCsv(text);
      throw new Error("expected CsvError");
    } catch (error) {
      assert(error instanceof CsvError, String(error));
      assertEquals(error.line, line);
    }
  }
});

Deno.test("oms: orders, service orders and work orders, repeated rows dropped", async () => {
  const f = await fixture({
    "oms_orders.csv": [
      OMS_HEADER,
      OMS_ROW,
      "ORD-1,2026-09-01T00:00:00.000Z,ACTIVE,OFFER-A,v1,SO-2,SPEC-A,ACTIVE,2026-09-02T01:00:00.000Z,SN-1,,,,,,modify",
    ].join("\n"),
  });
  try {
    const sources = sourcesIn(f.dir);
    const orders = await collect(sources.productOrders.read());
    const sos = await collect(sources.serviceOrders.read());
    const wos = await collect(sources.workOrders!.read());
    assertEquals([orders.length, sos.length, wos.length], [1, 2, 1]);
    assertEquals(orders[0].provenance.kind, "history");
    assertEquals(orders[0].provenance.endpoint, `${f.dir}/oms_orders.csv`);
    assertEquals(sos[1].line, 3);
    assertEquals(sources.mappers.serviceOrder(sos[1]).terminalSerial, "SN-1");
    assertEquals(sources.mappers.serviceOrder(sos[1]).action, "modify");
    assertEquals(sources.mappers.serviceOrder(sos[0]).action, undefined);
  } finally {
    await f.done();
  }
});

Deno.test("oms: a quoted field with a comma is one field", async () => {
  const f = await fixture({
    "oms_orders.csv": [OMS_HEADER, OMS_ROW.replace("OFFER-A", '"OFFER, A"')].join("\n"),
  });
  try {
    const [order] = await collect(sourcesIn(f.dir).productOrders.read());
    assertEquals(order.value.offer_id, "OFFER, A");
  } finally {
    await f.done();
  }
});

Deno.test("oms: a bad line names file, line and field", async () => {
  const f = await fixture({
    "oms_orders.csv": [
      OMS_HEADER,
      OMS_ROW,
      OMS_ROW.replace("ORD-1", "ORD-2").replace("2026-09-01T00:00:00.000Z", "yesterday"),
    ]
      .join("\n"),
  });
  try {
    const message = await failure(() => collect(sourcesIn(f.dir).productOrders.read()));
    assert(message.includes("oms_orders.csv:3"), message);
    assert(message.includes('field "submitted_at"'), message);
  } finally {
    await f.done();
  }
});

Deno.test("oms: a missing column and a short row are named", async () => {
  const f = await fixture({ "oms_orders.csv": OMS_HEADER.replace("spec_id,", "") + "\n" });
  try {
    const message = await failure(() => collect(sourcesIn(f.dir).productOrders.read()));
    assert(message.includes('field "spec_id"') && message.includes("missing"), message);
  } finally {
    await f.done();
  }
  const g = await fixture({ "oms_orders.csv": [OMS_HEADER, "ORD-1,2026"].join("\n") });
  try {
    const message = await failure(() => collect(sourcesIn(g.dir).productOrders.read()));
    assert(message.includes(":2") && message.includes("2 fields"), message);
  } finally {
    await g.done();
  }
});

Deno.test("a missing file is named", async () => {
  const message = await failure(() => collect(sourcesIn("/nonexistent").activations.read()));
  assert(message.includes("/nonexistent/provisioning.jsonl"), message);
});

Deno.test("jsonl: a bad line and a missing field are named", async () => {
  const f = await fixture({
    "provisioning.jsonl":
      '{"attempt_id":"A1","so_ref":null,"serial":"SN","state":"failed","started_at":"2026-09-01T00:00:00Z"}\n{oops\n',
    "bpm_history.jsonl": '{"process_id":"P1","state":"DONE"}\n',
  });
  try {
    const sources = sourcesIn(f.dir);
    const message = await failure(() => collect(sources.activations.read()));
    assert(message.includes("provisioning.jsonl:2") && message.includes("not valid JSON"), message);
    const bpm = await failure(() => collect(sources.processes!.read()));
    assert(bpm.includes("bpm_history.jsonl:1") && bpm.includes('field "started_at"'), bpm);
  } finally {
    await f.done();
  }
});

const DEMO = new URL("../data/demo/", import.meta.url).pathname;

Deno.test("full-size run over data/demo: counts, links and R04 as on the stub", async () => {
  const sources = sourcesIn(DEMO);
  const result = await runAudit({}, { clock, sources, config: demoConfig });
  const r = result.records;
  assertEquals(r.productOrders.length, EXPECTED.orders);
  assertEquals(r.serviceOrders.length, EXPECTED.service_orders);
  assertEquals(r.workOrders.length, EXPECTED.work_orders);
  assertEquals(r.processes.length, EXPECTED.processes);
  assertEquals(r.activations.length, EXPECTED.attempts);
  assertEquals(result.findings.map((f) => f.id), ["R01", "R02", "R04", "R05"]);
  assert(summaryLines(result).includes("R04@2 · 20 orders · 30 h"));
  const attempts = result.report.correlation.links["attempt->service_order"];
  assertEquals(attempts.explicit, EXPECTED.attempts - 300);
  assertEquals(attempts.inferred + attempts.ambiguous, 300);
  assert(result.report.sources.every((s) => s.evidenceKind === "history" && s.kind === "file"));
});

Deno.test("the CLI reads --dataset and refuses --source with it", async () => {
  const logs: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  console.error = () => {};
  try {
    assertEquals(await main(["--dataset", DEMO, "--quiet"]), 0);
    assertEquals(await main(["--dataset", DEMO, "--source", "stub"]), 2);
    assertEquals(await main(["--dataset", "/nonexistent", "--quiet"]), 1);
  } finally {
    console.log = log;
    console.error = error;
  }
  assert(logs.includes("R04@2 · 20 orders · 30 h"), logs.join("\n"));
});

Deno.test("oms: a client's item columns give a two-line order and a service order per line", async () => {
  const json = JSON.parse(
    await Deno.readTextFile(new URL("../data/demo/mapping.json", import.meta.url)),
  );
  Object.assign(json.oms.columns, {
    item_ref: "line",
    item_offer_id: "line_offer",
    item_action: "line_action",
    parent_item_ref: "line_parent",
  });
  const mapping = parseMapping(JSON.stringify(json), "mapping.json");
  const header = `${OMS_HEADER},line,line_offer,line_action,line_parent`;
  const rows = [
    `${OMS_ROW},L1,BUNDLE,add,`,
    OMS_ROW.replace("SO-1", "SO-2").replace("SN-1", "SN-2") + ",L2,ROUTER,modify,L1",
  ];
  const f = await fixture({ "oms_orders.csv": [header, ...rows].join("\n") });
  try {
    const sources = createFileSources(mapping, options(f.dir));
    const orders = await collect(sources.productOrders.read());
    assertEquals(orders.length, 1);
    const order = sources.mappers.order(orders[0]);
    assertEquals(order.itemRefs, ["L1", "L2"]);
    assertEquals(order.items?.[1], {
      itemRef: "L2",
      offerId: "ROUTER",
      action: "modify",
      parentItem: "L1",
    });
    const sos = await collect(sources.serviceOrders.read());
    assertEquals(
      sos.map((s) => sources.mappers.serviceOrder(s).productOrderItemRef),
      ["L1", "L2"],
    );
  } finally {
    await f.done();
  }
});
