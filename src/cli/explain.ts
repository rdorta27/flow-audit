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

interface DiagramEntry {
  serviceOrders: { item: { soRef: string; state: string; createdAt: string } }[];
  attempts: {
    item: { attemptId: string; soRef: string | null; state: string; startedAt: string };
  }[];
}

/** A swimlane drawing in inline SVG: one lane per system, time runs left to right. */
function buildDiagram(entry: DiagramEntry, ref: string, note: string): string {
  const sos = entry.serviceOrders.map((l) => l.item).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  const times = [
    ...sos.map((x) => Date.parse(x.createdAt)),
    ...entry.attempts.map((a) => Date.parse(a.item.startedAt)),
  ];
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const W = 860, L = 110, R = 40, span = Math.max(t1 - t0, 1);
  const x = (t: string) => L + ((Date.parse(t) - t0) / span) * (W - L - R - 120);
  const lane = { order: 60, so: 150, act: 240 };
  const hours = Math.round((Date.parse(sos[1].createdAt) - Date.parse(sos[0].createdAt)) / 3.6e6);
  const label = (t: number, y: number, a: string, cls = "") =>
    `<text x="${t}" y="${y}" class="${cls}">${esc(a)}</text>`;
  let g = "";
  for (
    const [name, y, api] of [["Pedido", lane.order, "TMF622"], [
      "Orden de servicio",
      lane.so,
      "TMF641",
    ], ["Activación", lane.act, "TMF640"]] as const
  ) {
    g += `<line class="lane" x1="${L - 10}" x2="${W - 10}" y1="${y - 14}" y2="${y - 14}"/>${
      label(8, y + 14, name)
    }${label(8, y + 28, api, "m")}`;
  }
  const first = L;
  g +=
    `<g data-s="1"><rect class="n" x="${first}" y="${lane.order}" width="150" height="34" rx="6"/>${
      label(first + 8, lane.order + 21, ref + " creado")
    }</g>`;
  sos.forEach((so, i) => {
    const bad = i > 0;
    const cx = x(so.createdAt);
    g += `<g data-s="1"><path class="ln" d="M${first + 75} ${lane.order + 34} L${
      cx + 55
    } ${lane.so}"/><rect class="${
      bad ? "e" : "n"
    }" x="${cx}" y="${lane.so}" width="110" height="34" rx="6"/>${
      label(cx + 8, lane.so + 15, so.soRef)
    }${label(cx + 8, lane.so + 29, so.state, "m")}</g>`;
  });
  entry.attempts.forEach((a) => {
    const ax = x(a.item.startedAt);
    const dup = sos.length > 1 && a.item.soRef === sos[1].soRef;
    g += `<g data-s="1"><path class="ln" d="M${ax + 40} ${lane.act}"/><rect class="${
      dup ? "e" : "n"
    }" x="${ax}" y="${lane.act}" width="80" height="34" rx="6"/>${
      label(ax + 8, lane.act + 15, a.item.attemptId)
    }${label(ax + 8, lane.act + 29, a.item.state, "m")}</g>`;
    if (a.item.soRef) {
      const so = sos.findIndex((s) => s.soRef === a.item.soRef);
      if (so >= 0) {
        g += `<path data-s="2" class="ln" d="M${x(sos[so].createdAt) + 55} ${lane.so + 34} L${
          ax + 40
        } ${lane.act}"/>`;
      }
    }
  });
  const a = x(sos[0].createdAt) + 110, b = x(sos[1].createdAt);
  g += `<g data-s="3"><path class="hot" d="M${x(sos[0].createdAt) + 55} ${lane.order + 34} L${
    b + 55
  } ${lane.so}"/><path class="hot" d="M${a} ${lane.so + 17} H${b}"/>${
    label((a + b) / 2 - 60, lane.so + 80, `${hours} h hasta el segundo intento`, "m")
  }</g>`;
  const caps = [
    "Se lee: tres llamadas GET de solo lectura traen el pedido, sus órdenes de servicio y sus activaciones.",
    "Se une: cada registro se enlaza con su pedido por el id que lleva, y cada enlace queda marcado como explícito, inferido o faltante.",
    "La regla R04: dos órdenes de servicio salen de la misma línea del pedido. La segunda no reintenta la primera, la duplica. " +
    note,
    "Se calcula el costo: horas de limpieza más la activación duplicada. Es el hallazgo que verás en el informe.",
  ];
  return `<div class="flow" data-on="1"><div class="steps">${
    ["1 Leer", "2 Unir", "3 Detectar", "4 Costo"].map((t, i) =>
      `<button type="button" aria-pressed="${i === 0}" data-step="${i + 1}">${t}</button>`
    ).join("")
  }</div>
<svg viewBox="0 0 ${W} 330" role="img" aria-label="Flujo del pedido ${
    esc(ref)
  } por los tres sistemas">${g}</svg>
<p class="cap" aria-live="polite">${esc(caps[0])}</p>
<script>(function(){var f=document.currentScript.parentNode,c=${
    JSON.stringify(caps)
  };f.querySelectorAll("button").forEach(function(b){b.onclick=function(){var n=b.dataset.step;f.dataset.on=n;f.querySelectorAll("button").forEach(function(o){o.setAttribute("aria-pressed",o===b)});f.querySelector(".cap").textContent=c[n-1]}})})()</script></div>`;
}

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
  const diagram = buildDiagram(entry, ref, finding.evidence[0].note ?? "");
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
.flow{margin:16px 0}.steps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}.steps button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:6px 12px;cursor:pointer}.steps button[aria-pressed=true]{border-color:var(--brand);outline:2px solid var(--brand)}
.flow svg{width:100%;height:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}
.flow text{fill:var(--fg);font:12px system-ui,sans-serif}.flow .m{fill:var(--mut)}.flow .lane{stroke:var(--line)}.flow .n{fill:var(--bg);stroke:var(--fg)}.flow .e{fill:var(--badbg);stroke:var(--bad);stroke-width:2}.flow .ln{stroke:var(--mut);stroke-width:1.5;fill:none}.flow .hot{stroke:var(--bad);stroke-width:2.5;stroke-dasharray:5 4;fill:none}
.flow [data-s]{opacity:.12;transition:opacity .3s}.flow[data-on="1"] [data-s="1"],.flow[data-on="2"] [data-s="1"],.flow[data-on="2"] [data-s="2"],.flow[data-on="3"] [data-s],.flow[data-on="4"] [data-s]{opacity:1}.flow .cap{min-height:3em;margin:8px 0;color:var(--fg)}
:root{--brand:#3b6fd8}.tag{display:inline-block;background:var(--bad);color:#fff;border-radius:4px;padding:0 6px;font-size:.8rem}
</style></head><body>
<h1>Un pedido, paso a paso: ${esc(ref)}</h1>
<p>Datos reales del dataset de prueba (sintético). Pulsa los pasos para recorrer el flujo; debajo está el JSON tal como llegó.</p>
${diagram}
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
