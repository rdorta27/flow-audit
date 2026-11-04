// SPDX-License-Identifier: MIT
/** Confidential mode (M5-12). */

import { main } from "../src/cli/main.ts";
import { addConfidentialBanner, collectIds, Redactor } from "../src/adapters/export/redaction.ts";
import { parseMapping } from "../src/adapters/ingest/mapping.ts";
import { assert, assertEquals } from "./assert.ts";

async function audit(argv: string[], env: Record<string, string> = {}) {
  const [log, error] = [console.log, console.error];
  console.log = () => {};
  console.error = () => {};
  try {
    return await main(argv, (name) => env[name]);
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** Every id the demo input carries: orders, service orders, work orders, processes, attempts, serials. */
async function inputIds(): Promise<string[]> {
  const ids = new Set<string>();
  const oms = (await Deno.readTextFile("data/demo/oms_orders.csv")).trim().split("\n").slice(1);
  for (const line of oms) {
    const c = line.split(",");
    for (const i of [0, 5, 9, 10]) if (c[i]) ids.add(c[i]);
  }
  for (const f of ["bpm_history.jsonl", "provisioning.jsonl"]) {
    for (const line of (await Deno.readTextFile(`data/demo/${f}`)).trim().split("\n")) {
      const o = JSON.parse(line);
      for (const k of ["process_id", "attempt_id", "so_ref", "serial", "business_key"]) {
        if (o[k]) ids.add(o[k]);
      }
    }
  }
  return [...ids];
}

const SECRET = { FLOW_AUDIT_REDACT_SECRET: "test-secret" };
const FILES = ["findings.json", "findings.csv", "report.html", "quality.json"];

Deno.test("a redacted run contains no raw id, carries the banner and a reversing table", async () => {
  const [a, b, plain] = await Promise.all([1, 2, 3].map(() => Deno.makeTempDir()));
  try {
    const args = ["--dataset", "data/demo", "--quiet", "--redact", "--client", "Acme Telco"];
    assertEquals(await audit([...args, "--out", a], SECRET), 0);
    assertEquals(await audit([...args, "--out", b], SECRET), 0);
    assertEquals(await audit(["--dataset", "data/demo", "--quiet", "--out", plain]), 0);

    const ids = await inputIds();
    assert(ids.length > 5000);
    for (const f of FILES) {
      const text = await Deno.readTextFile(`${a}/${f}`);
      const tokens = new Set(text.match(/[A-Za-z0-9_.:-]+/g));
      const leaked = ids.filter((id) => tokens.has(id));
      assertEquals(leaked.length, 0, `${f} leaks ${leaked.slice(0, 3)}`);
    }

    // Same input and secret, same pseudonyms.
    for (const f of ["findings.csv", "redaction_table.csv"]) {
      assertEquals(await Deno.readTextFile(`${a}/${f}`), await Deno.readTextFile(`${b}/${f}`), f);
    }
    // Another secret, other pseudonyms.
    const c = await Deno.makeTempDir();
    await audit(["--dataset", "data/demo", "--quiet", "--redact", "--client", "x", "--out", c], {
      FLOW_AUDIT_REDACT_SECRET: "another",
    });
    assert(
      (await Deno.readTextFile(`${c}/redaction_table.csv`)) !==
        (await Deno.readTextFile(`${a}/redaction_table.csv`)),
    );
    await Deno.remove(c, { recursive: true });

    // The banner, with the client and the date.
    const html = await Deno.readTextFile(`${a}/report.html`);
    const date = JSON.parse(await Deno.readTextFile(`${a}/findings.json`)).run.generated_at
      .slice(0, 10);
    assert(html.includes(`Confidential — Acme Telco · ${date}`));
    assert(!(await Deno.readTextFile(`${plain}/report.html`)).includes("Confidential"));

    // The table reverses the pseudonyms; it is not in any report file.
    const table = (await Deno.readTextFile(`${a}/redaction_table.csv`)).trim().split("\n").slice(1)
      .map((l) => l.split(","));
    assert(table.length >= ids.length);
    let back = await Deno.readTextFile(`${a}/findings.csv`);
    for (const [pseudonym, original] of table) back = back.replaceAll(pseudonym, original);
    assertEquals(back, await Deno.readTextFile(`${plain}/findings.csv`));
    for (const f of FILES) {
      assert(!(await Deno.readTextFile(`${a}/${f}`)).includes("redaction_table"), f);
    }
  } finally {
    for (const d of [a, b, plain]) await Deno.remove(d, { recursive: true });
  }
});

Deno.test("--redact needs --client and a whole id is replaced, never part of a word", async () => {
  assertEquals(await audit(["--dataset", "data/demo", "--redact", "--quiet"]), 2);
  const r = await Redactor.create(new Map([["ORD-1", "order" as const]]), "s");
  const p = r.entries[0].pseudonym;
  assertEquals(r.text("ORD-1, ORD-10 and xORD-1 and ORD-1."), `${p}, ORD-10 and xORD-1 and ${p}.`);
  assertEquals(
    [...collectIds({ orderRef: "A-1", records: [{ externalId: "B-2" }], other: "C-3" })].length,
    2,
  );
  assert(addConfidentialBanner("<body class=x><h1>", "A<b>", "2026-01-01").includes("A&lt;b&gt;"));
});

Deno.test("fields marked pii: true never reach the report", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const mapping = JSON.parse(await Deno.readTextFile("data/demo/mapping.json"));
    mapping.oms.pii = { terminal_serial: true };
    mapping.prov.pii = { serial: true };
    const file = `${dir}/client.mapping.json`;
    await Deno.writeTextFile(file, JSON.stringify(mapping));
    const out = `${dir}/out`;
    await Deno.mkdir(out);
    assertEquals(
      await audit(["--dataset", "data/demo", "--mapping", file, "--out", out, "--quiet"]),
      0,
    );
    for (const f of FILES) {
      const text = await Deno.readTextFile(`${out}/${f}`);
      assert(!/SN-\d+/.test(text), `${f} holds a serial`);
    }
    // A required field cannot be dropped.
    mapping.oms.pii = { order_ref: true };
    let message = "";
    try {
      parseMapping(JSON.stringify(mapping), "m.json");
    } catch (error) {
      message = (error as Error).message;
    }
    assert(message.includes("required field cannot be dropped"), message);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
