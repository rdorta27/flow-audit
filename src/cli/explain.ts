// SPDX-License-Identifier: MIT
/**
 * `deno task explain [out.html] [--order ORD-1005]`: writes one self-contained page that follows a single
 * duplicated order through the pipeline, with the real records the engine read (M3-02).
 * Read-only: it serves the synthetic dataset in process and never opens a network port.
 */

import { systemClock } from "../adapters/clock/system_clock.ts";
import { createTmfSources } from "../adapters/ingest/tmf_sources.ts";
import { runAudit } from "../app/run_audit.ts";
import { configFromFile } from "../domain/data_files.ts";
import { buildStory } from "../domain/story.ts";
import type { RawRecord } from "../ports/evidence_source.ts";
import { loadStubDataset } from "../stub/dataset.ts";
import { buildStubState } from "../stub/mapping.ts";
import { createHandler } from "../stub/router.ts";

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
    const [name, y, api] of [["Order", lane.order, "TMF622"], [
      "Service order",
      lane.so,
      "TMF641",
    ], ["Activation", lane.act, "TMF640"]] as const
  ) {
    g += `<line class="lane" x1="${L - 10}" x2="${W - 10}" y1="${y - 14}" y2="${y - 14}"/>${
      label(8, y + 14, name)
    }${label(8, y + 28, api, "m")}`;
  }
  const first = L;
  g +=
    `<g data-s="1"><rect class="n" x="${first}" y="${lane.order}" width="150" height="34" rx="6"/>${
      label(first + 8, lane.order + 21, ref + " created")
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
    label((a + b) / 2 - 60, lane.so + 80, `${hours} h until the second attempt`, "m")
  }</g>`;
  const caps = [
    "Read: three read-only GET calls fetch the order, its service orders and its activations.",
    "Join: each record is linked to its order by the id it carries, and each link is marked explicit, inferred or missing.",
    "Rule R04: two service orders come from the same order line. The second does not retry the first, it duplicates it. " +
    note,
    "Cost: cleanup hours plus the duplicate activation. This is the finding you will see in the report.",
  ];
  return `<div class="flow" data-on="1"><div class="steps">${
    ["1 Read", "2 Join", "3 Detect", "4 Cost"].map((t, i) =>
      `<button type="button" aria-pressed="${i === 0}" data-step="${i + 1}">${t}</button>`
    ).join("")
  }</div>
<svg viewBox="0 0 ${W} 330" role="img" aria-label="Flow of order ${
    esc(ref)
  } through the three systems">${g}</svg>
<p class="cap" aria-live="polite">${esc(caps[0])}</p>
<script>(function(){var f=document.currentScript.parentNode,c=${
    JSON.stringify(caps)
  };f.querySelectorAll("button").forEach(function(b){b.onclick=function(){var n=b.dataset.step;f.dataset.on=n;f.querySelectorAll("button").forEach(function(o){o.setAttribute("aria-pressed",o===b)});f.querySelector(".cap").textContent=c[n-1]}})})()</script></div>`;
}

export async function buildExplainPage(dataDir: URL, orderRef?: string): Promise<string> {
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
  const impact = configFromFile(
    JSON.parse(await Deno.readTextFile(new URL("config.json", dataDir))),
  );
  const audit = await runAudit({}, {
    sources: createTmfSources(config),
    config: impact,
    clock: systemClock,
  });
  const result = audit.correlation;
  const { productOrders: rawOrders, serviceOrders: rawServices, activations: rawAttempts } =
    audit.records;
  const finding = audit.findings.find((f) => f.id === "R04");
  if (!finding && !orderRef) throw new Error("no duplicated order in this data");

  const ref = orderRef ?? finding!.evidence[0].orderRef;
  const entry = result.orders.find((o) => o.order.orderRef === ref);
  if (!entry) throw new Error(`order ${ref} is not in this data`);
  const steps = buildStory(entry, audit.findings);
  const story = `<h2>The story</h2><ol class="story">${
    steps.map((st) =>
      `<li${st.observed ? "" : ' style="color:var(--mut);font-style:italic"'}>${
        st.at ? `<small>${esc(st.at)}</small> ` : ""
      }<b>${esc(st.system)}</b> ${esc(st.what)}${
        st.observed
          ? st.record ? ` <small>${esc(st.record.id)} · ${esc(st.record.endpoint)}</small>` : ""
          : ` <small>(${esc(st.reason)})</small>`
      }${st.finding ? ` <span class="tag">${esc(st.finding)}</span>` : ""}</li>`
    ).join("")
  }</ol>`;
  const ev = finding?.evidence.find((e) => e.orderRef === ref);
  if (!finding || !ev) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>One order, step by step</title>
<style>:root{--mut:#666;--bad:#b3261e}body{font:16px/1.5 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:24px 16px}small{color:var(--mut)}.tag{background:var(--bad);color:#fff;border-radius:4px;padding:0 6px;font-size:.8rem}</style></head><body>
<h1>One order, step by step: ${esc(ref)}</h1>${story}</body></html>`;
  }
  const soIds = new Set(entry.serviceOrders.map((l) => l.item.soRef));
  const pick = (rows: RawRecord[], id: (r: RawRecord) => string) =>
    rows.filter((r) => id(r) === ref || soIds.has(id(r)));
  const rawO = rawOrders.filter((r) => r.provenance.externalId === ref);
  const rawS = rawServices.filter((r) => soIds.has(r.provenance.externalId));
  const rawA = pick(
    rawAttempts,
    (r) => String((r.value as { serviceOrder?: { id?: string } }).serviceOrder?.id ?? ""),
  );
  const diagram = buildDiagram(entry, ref, ev.note ?? "");
  const box = (title: string, sub: string, body: string, cls = "") =>
    `<section class="box ${cls}"><h3>${esc(title)}</h3><p class="sub">${sub}</p>${body}</section>`;
  const rec = (r: RawRecord) =>
    `<details><summary>${esc(r.provenance.externalId)} <small>${
      esc(r.provenance.endpoint)
    }</small></summary><pre>${json(r.value)}</pre></details>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>One order, step by step</title>
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
<h1>One order, step by step: ${esc(ref)}</h1>
<p>Real records from the test dataset (synthetic). Click the steps to walk through the flow; below is the JSON as it arrived.</p>
${story}
${diagram}
${
    box(
      "1. Read",
      "Three read-only GET calls. Each record keeps where it came from and when.",
      `<p>Product order (TMF622):</p>${
        rawO.map(rec).join("")
      }<p>Service orders (TMF641), there are <b>${rawS.length}</b>:</p>${
        rawS.map(rec).join("")
      }<p>Activations (TMF640):</p>${rawA.map(rec).join("") || "<p>(none linked)</p>"}`,
    )
  }
<div class="arrow">▼ joined by the id they carry</div>
${
    box(
      "2. Join",
      "Each link says how sure it is.",
      `<ul>${
        entry.serviceOrders.map((l) =>
          `<li>${esc(l.item.soRef)} → ${esc(ref)}: <b>${esc(l.link.confidence)}</b> (${
            esc(l.link.basis)
          })</li>`
        ).join("")
      }</ul>`,
    )
  }
<div class="arrow">▼ rule R04 applies</div>
${
    box(
      "3. Where the error is",
      "Two service orders come from the same order line.",
      `<div class="pair">${
        entry.serviceOrders.map((l) =>
          `<div><b>${esc(l.item.soRef)}</b><br>state ${esc(l.item.state)}<br>line <code>${
            esc(l.item.productOrderItemRef ?? "?")
          }</code><br>created ${esc(l.item.createdAt)}</div>`
        ).join("")
      }</div><p><span class="tag">error</span> ${esc(ev.note ?? "")}</p>`,
      "bad",
    )
  }
<div class="arrow">▼ cost is computed</div>
${
    box(
      "4. Finding",
      `${esc(finding.ruleVersion)} · severity ${esc(finding.severity)}`,
      `<p>${finding.affectedOrders} orders of 5,000 (${
        (finding.shareOfOrders * 100).toFixed(1)
      }%). Impact: <b>${finding.cost.hoursMonth} h</b> per month.</p><p>${
        esc(finding.recommendation)
      }</p><details><summary>Calculation</summary><pre>hours = ${finding.affectedOrders} × ${impact.rates.cleanupMinutes} min / 60 = ${finding.cost.hoursMonth}</pre></details>`,
    )
  }
</body></html>`;
}

const EXPLAIN_USAGE = `deno task explain [out.html] [--order <ref>]

Writes one self-contained page that follows a single order through the pipeline, with the
real records the engine read. It uses the synthetic demo data and opens no network port.

  out.html        Where to write the page (default: explain.html in the current folder).
  --order <ref>   The order to follow, for example ORD-1005 (default: a duplicated order).
  -h, --help      Show this help.

Example:
  deno task explain explain.html --order ORD-1005`;

if (import.meta.main) {
  const args = [...Deno.args];
  if (args.includes("-h") || args.includes("--help")) {
    console.log(EXPLAIN_USAGE);
    Deno.exit(0);
  }
  const unknown = args.find((a, k) =>
    a.startsWith("-") && a !== "--order" && args[k - 1] !== "--order"
  );
  if (unknown) {
    console.error(`explain: unknown option ${unknown}. Run \`deno task explain --help\`.`);
    Deno.exit(2);
  }
  const at = args.indexOf("--order");
  let order: string | undefined;
  if (at >= 0) {
    order = args[at + 1];
    if (!order) {
      console.error("explain: --order needs an order reference, for example ORD-1005");
      Deno.exit(2);
    }
    args.splice(at, 2);
  }
  const out = args[0] ?? "explain.html";
  const data = new URL("../../data/demo/", import.meta.url);
  try {
    await Deno.writeTextFile(out, await buildExplainPage(data, order));
  } catch (error) {
    console.error(`explain: ${(error as Error).message}`);
    Deno.exit(1);
  }
  console.log(`Wrote ${out}. Open it in a browser.`);
}
