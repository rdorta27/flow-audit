// SPDX-License-Identifier: MIT
/**
 * `deno task explain [out.html]`: writes one self-contained page that follows a single
 * duplicated order through the pipeline, with the real records the engine read (M3-02).
 * Read-only: it serves the synthetic dataset in process and never opens a network port.
 */

import { Tmf622ProductOrderSource } from "../adapters/ingest/tmf622_source.ts";
import { Tmf640ServiceActivationSource } from "../adapters/ingest/tmf640_source.ts";
import { Tmf641ServiceOrderSource } from "../adapters/ingest/tmf641_source.ts";
import { mapActivation, mapProductOrder, mapServiceOrder } from "../adapters/ingest/tmf_mapping.ts";
import { correlate } from "../domain/correlation.ts";
import type { ImpactConfig } from "../domain/model.ts";
import { detectR04 } from "../domain/rules/r04.ts";
import type { RawRecord } from "../ports/evidence_source.ts";
import { loadStubDataset } from "../stub/dataset.ts";
import { buildStubState } from "../stub/mapping.ts";
import { createHandler } from "../stub/router.ts";

async function collect(source: { read(): AsyncIterable<RawRecord> }): Promise<RawRecord[]> {
  const rows: RawRecord[] = [];
  for await (const row of source.read()) rows.push(row);
  return rows;
}

const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (v: unknown) => esc(JSON.stringify(v, null, 2));

export async function buildExplainPage(dataDir: URL): Promise<string> {
  const data = await loadStubDataset(dataDir);
  const handle = createHandler({
    state: buildStubState(data.catalog, data.orders, data.serviceOrders, data.attempts),
  });
  const config = {
    baseUrl: "http://stub.local",
    fetch:
      ((input: string | URL | Request, init?: RequestInit) =>
        handle(new Request(String(input), init))) as typeof fetch,
  };
  const rawOrders = await collect(new Tmf622ProductOrderSource(config));
  const rawServices = await collect(new Tmf641ServiceOrderSource(config));
  const rawAttempts = await collect(new Tmf640ServiceActivationSource(config));
  const result = correlate({
    orders: rawOrders.map(mapProductOrder),
    serviceOrders: rawServices.map(mapServiceOrder),
    attempts: rawAttempts.map(mapActivation),
  });
  const impact = JSON.parse(
    await Deno.readTextFile(new URL("config.json", dataDir)),
  ) as ImpactConfig;
  const finding = detectR04(result.orders, impact);
  if (!finding) throw new Error("no duplicated order in this data");

  const ref = finding.evidence[0].orderRef;
  const entry = result.orders.find((o) => o.order.orderRef === ref)!;
  const soIds = new Set(entry.serviceOrders.map((l) => l.item.soRef));
  const pick = (rows: RawRecord[], id: (r: RawRecord) => string) =>
    rows.filter((r) => id(r) === ref || soIds.has(id(r)));
  const rawO = rawOrders.filter((r) => r.provenance.externalId === ref);
  const rawS = rawServices.filter((r) => soIds.has(r.provenance.externalId));
  const rawA = pick(
    rawAttempts,
    (r) => String((r.value as { serviceOrder?: { id?: string } }).serviceOrder?.id ?? ""),
  );
  const box = (title: string, sub: string, body: string, cls = "") =>
    `<section class="box ${cls}"><h3>${esc(title)}</h3><p class="sub">${sub}</p>${body}</section>`;
  const rec = (r: RawRecord) =>
    `<details><summary>${esc(r.provenance.externalId)} <small>${
      esc(r.provenance.endpoint)
    }</small></summary><pre>${json(r.value)}</pre></details>`;
  const ev = finding.evidence[0];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Un pedido, paso a paso</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#d8d8d8;--bad:#b3261e;--badbg:#fde8e6;--ok:#1b6e3c;--card:#f6f6f6}
@media(prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--mut:#9a9a9a;--line:#333;--bad:#ff8a80;--badbg:#3a1f1d;--ok:#6fcf97;--card:#202020}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:1.5rem}h3{margin:.2rem 0}.sub{color:var(--mut);margin:.2rem 0 .6rem}
.box{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:14px 16px;margin:12px 0}
.arrow{text-align:center;color:var(--mut);font-size:.9rem}
.bad{border-color:var(--bad);background:var(--badbg)}
pre{overflow:auto;background:var(--bg);border:1px solid var(--line);padding:8px;font-size:.8rem}
summary{cursor:pointer;margin:4px 0}small{color:var(--mut)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:640px){.pair{grid-template-columns:1fr}}
.tag{display:inline-block;background:var(--bad);color:#fff;border-radius:4px;padding:0 6px;font-size:.8rem}
</style></head><body>
<h1>Un pedido, paso a paso: ${esc(ref)}</h1>
<p>Datos reales del dataset de prueba (sintético). Cada caja es un paso; abre los registros para ver el JSON tal como llegó.</p>
${
    box(
      "1. Se lee",
      "Tres llamadas GET, solo lectura. Cada registro guarda de dónde salió y cuándo.",
      `<p>Pedido comercial (TMF622):</p>${
        rawO.map(rec).join("")
      }<p>Órdenes de servicio (TMF641), hay <b>${rawS.length}</b>:</p>${
        rawS.map(rec).join("")
      }<p>Activaciones (TMF640):</p>${rawA.map(rec).join("") || "<p>(ninguna enlazada)</p>"}`,
    )
  }
<div class="arrow">▼ se unen por el id que llevan</div>
${
    box(
      "2. Se une",
      "Cada enlace dice qué tan seguro es.",
      `<ul>${
        entry.serviceOrders.map((l) =>
          `<li>${esc(l.item.soRef)} → ${esc(ref)}: <b>${esc(l.link.confidence)}</b> (${
            esc(l.link.basis)
          })</li>`
        ).join("")
      }</ul>`,
    )
  }
<div class="arrow">▼ se aplica la regla R04</div>
${
    box(
      "3. Dónde está el error",
      "Dos órdenes de servicio salen de la misma línea del pedido.",
      `<div class="pair">${
        entry.serviceOrders.map((l) =>
          `<div><b>${esc(l.item.soRef)}</b><br>estado ${esc(l.item.state)}<br>línea <code>${
            esc(l.item.productOrderItemRef ?? "?")
          }</code><br>creada ${esc(l.item.createdAt)}</div>`
        ).join("")
      }</div><p><span class="tag">error</span> ${esc(ev.note ?? "")}</p>`,
      "bad",
    )
  }
<div class="arrow">▼ se calcula el costo</div>
${
    box(
      "4. Hallazgo",
      `${esc(finding.id)} · severidad ${esc(finding.severity)}`,
      `<p>${finding.affectedOrders} pedidos de 5.000 (${
        (finding.shareOfOrders * 100).toFixed(1)
      } %). Impacto: <b>${finding.impact.hoursMonth} h</b> y <b>USD ${
        finding.impact.usdMonth.toLocaleString("en-US")
      }</b> al mes.</p><p>${
        esc(finding.recommendation)
      }</p><details><summary>Cuenta</summary><pre>horas = ${finding.affectedOrders} × ${impact.rates.cleanupMinutes} min / 60 = ${finding.impact.hoursMonth}\nusd = ${finding.impact.hoursMonth} h × ${impact.loadedHourUsd} + activaciones duplicadas × ${impact.rates.duplicateActivationCostUsd}</pre></details>`,
    )
  }
</body></html>`;
}

if (import.meta.main) {
  const out = Deno.args[0] ?? "explain.html";
  await Deno.writeTextFile(
    out,
    await buildExplainPage(new URL("../../data/demo/", import.meta.url)),
  );
  console.log(`Wrote ${out}. Open it in a browser.`);
}
