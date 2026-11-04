// SPDX-License-Identifier: MIT
import { runAudit } from "../src/app/run_audit.ts";
import { readDate } from "../src/adapters/ingest/dates.ts";
import { FileError } from "../src/adapters/ingest/file_common.ts";
import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { MappingError, parseMapping } from "../src/adapters/ingest/mapping.ts";
import { coverageLines, main } from "../src/cli/main.ts";
import { renderFindingsJson } from "../src/adapters/report/json_renderer.ts";
import { assert, assertEquals } from "./assert.ts";
import { demoConfig } from "./stub_sources.ts";

const DEMO = new URL("../data/demo/", import.meta.url).pathname;
const demoText = await Deno.readTextFile(`${DEMO}mapping.json`);
const clock = { nowIso: () => "2026-09-01T00:00:00Z" };
const now = () => "2026-09-30T00:00:00.000Z";

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const demoJson = (): Json => JSON.parse(demoText);

function mappingError(text: string): string {
  try {
    parseMapping(text, "client.mapping.json");
  } catch (error) {
    assert(error instanceof MappingError, String(error));
    return error.message;
  }
  throw new Error("expected a MappingError");
}

async function audit(dir: string, mapping: string) {
  const sources = createFileSources(parseMapping(mapping, "m.json"), { dir, now });
  const result = await runAudit({}, { clock, sources, config: demoConfig });
  return { result, sources };
}

Deno.test("the demo mapping is valid and every block is declared", () => {
  const m = parseMapping(demoText, "data/demo/mapping.json");
  assertEquals([m.oms.file, m.bpm?.file, m.prov.file, m.catalog?.file], [
    "oms_orders.csv",
    "bpm_history.jsonl",
    "provisioning.jsonl",
    "catalog.json",
  ]);
  assertEquals(m.simulated, true);
});

Deno.test("renaming columns in a copy of the export and in the mapping gives the same findings", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const csv = await Deno.readTextFile(`${DEMO}oms_orders.csv`);
    const [header, ...rest] = csv.split("\n");
    const renamed = header.replace("order_ref", "Pedido").replace("so_state", "EstadoOT")
      .replace("terminal_serial", "Serie");
    await Deno.writeTextFile(`${dir}/oms_orders.csv`, [renamed, ...rest].join("\n"));
    for (const f of ["bpm_history.jsonl", "provisioning.jsonl", "catalog.json"]) {
      await Deno.copyFile(`${DEMO}${f}`, `${dir}/${f}`);
    }
    const m = demoJson();
    m.oms.columns.order_ref = "Pedido";
    m.oms.columns.so_state = "EstadoOT";
    m.oms.columns.terminal_serial = "Serie";

    const same = await audit(DEMO, demoText);
    const other = await audit(dir, JSON.stringify(m));
    // The only difference allowed is the directory the files were read from.
    assertEquals(
      renderFindingsJson(other.result.report).replaceAll(dir, "DIR"),
      renderFindingsJson(same.result.report).replaceAll(DEMO.replace(/\/$/, ""), "DIR"),
    );
    assertEquals(
      other.result.findings.find((f) => f.id === "R04")?.affectedOrders,
      20,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an invalid mapping names file, line and field", () => {
  const unknownField = demoJson();
  unknownField.oms.columns.colour = "x";
  let message = mappingError(JSON.stringify(unknownField, null, 2));
  assert(
    message.includes("client.mapping.json:") && message.includes('"oms.columns.colour"'),
    message,
  );
  assert(message.includes("unknown field"), message);

  const undeclared = demoJson();
  delete undeclared.oms.columns.spec_id;
  message = mappingError(JSON.stringify(undeclared, null, 2));
  assert(message.includes("spec_id") && message.includes("not declared"), message);

  const noRequired = demoJson();
  noRequired.prov.fields.attempt_id = null;
  message = mappingError(JSON.stringify(noRequired, null, 2));
  assert(message.includes("required"), message);

  const noFile = demoJson();
  delete noFile.oms.file;
  assert(mappingError(JSON.stringify(noFile)).includes('"oms.file"'));

  const badDate = demoJson();
  badDate.oms.date_format = "dd/MM";
  assert(mappingError(JSON.stringify(badDate, null, 2)).includes("no yyyy"));

  const badZone = demoJson();
  badZone.prov.time_zone = "Mars/Olympus";
  assert(mappingError(JSON.stringify(badZone)).includes("time_zone"));

  const badTarget = demoJson();
  badTarget.oms.states.order.ACTIVE = "LIVE";
  assert(mappingError(JSON.stringify(badTarget)).includes("not a canonical value"));

  assert(mappingError("{ nope").includes("not valid JSON"));
});

Deno.test("a mapping that points at a missing file fails naming it", async () => {
  const m = demoJson();
  m.prov.file = "nothing.jsonl";
  try {
    await audit(DEMO, JSON.stringify(m));
    throw new Error("expected a failure");
  } catch (error) {
    assert(error instanceof FileError, String(error));
    assert(error.message.includes("nothing.jsonl"), error.message);
  }
});

Deno.test("dates: patterns, offsets, and impossible days", () => {
  const utc = { offsetMinutes: 0 };
  assertEquals(
    readDate("15/09/2026 08:30", { format: "dd/MM/yyyy HH:mm", ...utc }),
    "2026-09-15T08:30:00.000Z",
  );
  assertEquals(
    readDate("15/09/2026 08:30", { format: "dd/MM/yyyy HH:mm", offsetMinutes: -300 }),
    "2026-09-15T13:30:00.000Z",
  );
  assertEquals(
    readDate("2026-09-15T08:30:00", { format: "iso8601", offsetMinutes: 120 }),
    "2026-09-15T06:30:00.000Z",
  );
  assertEquals(
    readDate("2026-09-15T08:30:00-05:00", { format: "iso8601", offsetMinutes: 0 }),
    "2026-09-15T13:30:00.000Z",
  );
  assertEquals(readDate("31/02/2026 08:30", { format: "dd/MM/yyyy HH:mm", ...utc }), null);
  assertEquals(readDate("yesterday", { format: "iso8601", ...utc }), null);
});

/** A one-order export in a client's style: other names, delimiter, ids, states and dates. */
async function clientExport() {
  const dir = await Deno.makeTempDir();
  const csv = [
    "Pedido;Fecha;Estado;Oferta;OT;Spec;EstadoOT;FechaOT;Serie",
    "0007;15/09/2026 08:30;Completado;OFFER-A;ot-1;SPEC-A;Terminada;15/09/2026 10:00;sn-1",
    "0007;15/09/2026 08:30;Completado;OFFER-A;ot-2;SPEC-A;Terminada;15/09/2026 11:00;sn-1",
  ].join("\r\n");
  const bytes = new TextEncoder().encode(csv);
  await Deno.writeFile(`${dir}/pedidos.csv`, bytes);
  await Deno.writeTextFile(
    `${dir}/activaciones.jsonl`,
    '{"id":"A1","ot":"OT-1","serie":"SN-1","estado":"OK","inicio":"15/09/2026 10:05","fin":null}\n',
  );
  const mapping = {
    oms: {
      file: "pedidos.csv",
      format: "csv",
      delimiter: ";",
      date_format: "dd/MM/yyyy HH:mm",
      time_zone: "-05:00",
      single_line_orders: true,
      columns: {
        order_ref: "Pedido",
        submitted_at: "Fecha",
        order_state: "Estado",
        offer_id: "Oferta",
        offer_version: null,
        replaces_order_ref: null,
        so_ref: "OT",
        spec_id: "Spec",
        so_state: "EstadoOT",
        so_created_at: "FechaOT",
        terminal_serial: "Serie",
        wo_ref: null,
        wo_kind: null,
        wo_state: null,
        wo_created_at: null,
      },
      ids: {
        order_ref: { strip_leading_zeros: true, add_prefix: "ORD-" },
        so_ref: { case: "upper" },
        terminal_serial: { case: "upper" },
      },
      states: {
        order: { Completado: "ACTIVE" },
        service_order: { Terminada: "ACTIVE" },
      },
    },
    prov: {
      file: "activaciones.jsonl",
      format: "jsonl",
      date_format: "dd/MM/yyyy HH:mm",
      time_zone: "-05:00",
      fields: {
        attempt_id: "id",
        so_ref: "ot",
        serial: "serie",
        state: "estado",
        error_code: null,
        started_at: "inicio",
        ended_at: "fin",
      },
      ids: { so_ref: { case: "upper" }, serial: { case: "upper" } },
      states: { attempt: { OK: "succeeded" } },
    },
  };
  return { dir, mapping };
}

Deno.test("a client's names, delimiter, ids, states, dates and time zone map to the canonical model", async () => {
  const { dir, mapping } = await clientExport();
  try {
    const { result, sources } = await audit(dir, JSON.stringify(mapping));
    const order = result.correlation.orders[0];
    assertEquals(result.correlation.orders.length, 1);
    assertEquals(order.order.orderRef, "ORD-7");
    assertEquals(order.order.state, "ACTIVE");
    assertEquals(order.order.submittedAt, "2026-09-15T13:30:00.000Z");
    assertEquals(order.serviceOrders.map((l) => l.item.soRef), ["OT-1", "OT-2"]);
    assertEquals(order.serviceOrders[0].item.terminalSerial, "SN-1");
    assertEquals(order.attempts.length, 1);
    assertEquals(order.attempts[0].item.state, "succeeded");
    assertEquals(result.records.productOrders.length, 1, "the repeated order row is merged");
    assertEquals(result.findings.map((f) => f.id), ["R04"]);

    const [oms, prov] = await sources.coverage();
    assertEquals([oms.rows, oms.repeatedRows], [2, 1]);
    assert(oms.notObservable.includes("wo_ref"));
    assertEquals(prov.states.attempt.mapped, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an unknown state value fails naming it; 'unmapped' keeps the row and counts it", async () => {
  const { dir, mapping } = await clientExport();
  try {
    await Deno.writeTextFile(
      `${dir}/activaciones.jsonl`,
      '{"id":"A1","ot":"OT-1","serie":"SN-1","estado":"RARO","inicio":"15/09/2026 10:05","fin":null}\n',
    );
    try {
      await audit(dir, JSON.stringify(mapping));
      throw new Error("expected a failure");
    } catch (error) {
      assert(error instanceof FileError, String(error));
      assert(error.message.includes("activaciones.jsonl:1"), error.message);
      assert(
        error.message.includes('"RARO"') && error.message.includes('field "estado"'),
        error.message,
      );
    }

    (mapping.prov as Json).on_unknown_state = "unmapped";
    const { result, sources } = await audit(dir, JSON.stringify(mapping));
    assertEquals(result.correlation.orders[0].attempts[0].item.state, "unmapped");
    assertEquals(result.correlation.orders[0].attempts[0].item.rawState, "RARO");
    const lines = coverageLines((await sources.coverage()).slice(1));
    assert(
      lines[0].includes("0% with every state mapped") && lines[0].includes('"RARO" x1'),
      lines[0],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a bad date names file, line and column", async () => {
  const { dir, mapping } = await clientExport();
  try {
    const csv = (await Deno.readTextFile(`${dir}/pedidos.csv`)).replace(
      "15/09/2026 10:00",
      "2026-09-15",
    );
    await Deno.writeTextFile(`${dir}/pedidos.csv`, csv);
    try {
      await audit(dir, JSON.stringify(mapping));
      throw new Error("expected a failure");
    } catch (error) {
      assert(error instanceof FileError, String(error));
      assert(
        error.message.includes("pedidos.csv:2") && error.message.includes('"FechaOT"'),
        error.message,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the CLI takes --mapping and reports a mapping error with exit 1", async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const [log, err] = [console.log, console.error];
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  console.error = (...a: unknown[]) => void errors.push(a.join(" "));
  try {
    assertEquals(await main(["--dataset", DEMO, "--mapping", `${DEMO}mapping.json`]), 0);
    assert(
      logs.some((l) => l.startsWith("Coverage ") && l.includes("oms_orders.csv")),
      logs.join("\n"),
    );
    assertEquals(await main(["--dataset", DEMO, "--mapping", "/nonexistent.json", "--quiet"]), 1);
    assert(errors.some((e) => e.includes("/nonexistent.json")), errors.join("\n"));
    assertEquals(await main(["--mapping", `${DEMO}mapping.json`]), 2);
  } finally {
    console.log = log;
    console.error = err;
  }
});
