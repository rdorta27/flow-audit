// SPDX-License-Identifier: MIT
/**
 * The HTML report (M4-03): one self-contained page, inline CSS, no script, no network.
 * Every figure is read from `AuditReport`; a section with no data says why.
 */
import type { AuditReport, Finding, ReportSystem, SystemId } from "../../domain/model.ts";
import type { ReportRenderer } from "../../ports/report_renderer.ts";
import { REPORT_CSS } from "./report_css.ts";

const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const money = (c: string, n: number) => `${c} ${num(n)}`;
const hours = (n: number) => `${num(Math.round(n * 10) / 10)} h`;
const pct = (share: number) => `${num(Math.round(share * 1000) / 10)}%`;

const SYSTEM_CLASS: Record<SystemId, string> = {
  CAT: "cat",
  OMS: "oms",
  BPM: "bpm",
  PROV: "prov",
};

/** Plain names shown to readers; the codes stay in the data and in tooltips. */
const PLAIN: Record<SystemId, string> = {
  CAT: "Product catalog",
  OMS: "Order manager",
  BPM: "Process orchestrator",
  PROV: "Activation system",
};
const plain = (system: string) => PLAIN[system as SystemId] ?? system;

const chip = (system: string) => {
  const cls = SYSTEM_CLASS[system as SystemId];
  return `<span class="chip${cls ? ` s-${cls}` : ""}" title="${esc(system)}">${
    esc(plain(system))
  }</span>`;
};

/** The systems a `where` such as `OMS` or `OMS→PROV` touches. */
const touched = (where: string) => where.split(/→|->/).map((s) => s.trim()).filter(Boolean);

function findingSection(f: Finding): string {
  const c = f.cost;
  const terms = c.terms.map((t) =>
    `<tr><td>${esc(t.name)}</td><td class="n">${esc(money(c.currency, t.amount))}</td>` +
    `<td>${esc(t.basis.replace("_", " "))}${
      t.observed === null ? "" : `, observed ${num(t.observed)}`
    }</td></tr>`
  ).join("");
  const unmeasured = c.unmeasured.map((u) =>
    `<li><strong>${esc(u.term)}</strong> not counted: ${esc(u.reason)}</li>`
  ).join("");
  const inputs = c.inputs.map((i) =>
    `<li><code>${esc(i.key)}</code> = ${num(i.value)}${i.source ? ` (${esc(i.source)})` : ""}</li>`
  ).join("");
  const sample = f.evidence.slice(0, 5).map((e) =>
    `<li><code>${esc(e.orderRef)}</code>${e.note ? ` ${esc(e.note)}` : ""}</li>`
  ).join("");
  const risk = c.revenueAtRisk.basis === null
    ? ""
    : `<p class="note">${esc(money(c.currency, c.revenueAtRisk.amount))} ${
      esc(c.revenueAtRisk.label)
    }; not part of the amount above.</p>`;
  return `<article class="card finding" id="${esc(f.id)}" data-rule="${esc(f.ruleVersion)}">
<header><h3>${esc(f.id)} · ${esc(f.title)}</h3>
<p class="chips">${touched(f.where).map(chip).join("")} <span class="sev sev-${esc(f.severity)}">${
    esc(f.severity)
  }</span></p></header>
<p>${esc(f.plainSummary)}</p>
<p class="cost"><span class="big">${esc(money(c.currency, c.amountMonth))}</span> · ${
    hours(c.hoursMonth)
  } · ${esc(c.kind.replace(/_/g, " "))}${c.normalisation ? ` · ${esc(c.normalisation)}` : ""}</p>
<p class="formula"><code>${esc(c.formula)}</code></p>
<table><thead><tr><th>Term</th><th class="n">Amount</th><th>Basis</th></tr></thead><tbody>${terms}</tbody></table>
${unmeasured ? `<ul class="note">${unmeasured}</ul>` : ""}
<details open><summary>Inputs (rates you can change)</summary><ul>${inputs}</ul></details>
<p>${num(f.affectedOrders)} orders affected (${pct(f.shareOfOrders)}) · evidence ${
    esc(f.evidenceLevel)
  } · ${esc(f.confidence.level)} · inferred links ${pct(f.confidence.inferredLinkShare)}${
    f.inTotal ? "" : " · not in the total"
  }</p>
<details><summary>Evidence: ${num(f.evidence.length)} of ${
    num(f.evidenceTotal)
  } orders shown</summary><ul>${sample}</ul></details>
${risk}<p><strong>What to do.</strong> ${esc(f.recommendation)}</p>
</article>`;
}

function systemCard(s: ReportSystem): string {
  const cover = s.coverage === null ? "not read" : `${pct(s.coverage)} of orders`;
  return `<li class="card sys">
<p>${s.position}. ${chip(s.system)} <strong>${esc(s.name)}</strong></p>
<p class="muted">${esc(s.role)}</p>
<p>${s.read ? `${num(s.records)} records · ${esc(cover)}` : "Not read in this run"}${
    s.findings.length ? ` · findings: ${esc(s.findings.join(", "))}` : ""
  }</p>
${
    s.cannotObserve.length
      ? `<ul class="note">${s.cannotObserve.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
      : ""
  }
</li>`;
}

function flowMap(systems: ReportSystem[]): string {
  const nodes = [...systems].sort((a, b) => a.position - b.position).map((s) =>
    `<li class="node s-${SYSTEM_CLASS[s.system]}${s.read ? "" : " unread"}">${
      esc(plain(s.system))
    }<small>${s.read ? "read" : "not read"}</small></li>`
  ).join('<li class="arrow" aria-hidden="true">→</li>');
  return `<ol class="flow">${nodes}</ol>`;
}

function journeys(report: AuditReport): string {
  if (report.journeys.length === 0) {
    return `<p class="note">No order was selected to draw: no finding has evidence to follow.</p>`;
  }
  return report.journeys.map((j) => {
    const body = j.segments.length === 0
      ? `<p class="note">Timeline unavailable: ${
        esc(j.segmentsUnavailable ?? "the source gave no history for this order")
      }</p>`
      : `<table><thead><tr><th>System</th><th>From</th><th>To</th><th>Kind</th><th>State</th></tr></thead><tbody>${
        j.segments.map((s) =>
          `<tr><td>${chip(s.system)}</td><td>${esc(s.from)}</td><td>${esc(s.to)}</td><td>${
            esc(s.kind)
          }</td><td>${esc(s.state)}</td></tr>`
        ).join("")
      }</tbody></table>`;
    const story = `<ol class="story">${
      j.story.map((st) =>
        `<li${st.observed ? "" : ' class="missing"'}>${chip(st.system)} ${
          st.at ? `<time>${esc(st.at)}</time> ` : ""
        }${esc(st.what)}${
          st.observed
            ? st.record
              ? ` <small class="muted">${esc(st.record.id)} · ${esc(st.record.endpoint)}</small>`
              : ""
            : ` <small class="muted">(${esc(st.reason ?? "not observed")})</small>`
        }${
          st.finding ? ` <span class="sev sev-medium">${esc(st.finding)} starts here</span>` : ""
        }</li>`
      ).join("")
    }</ol>`;
    return `<article class="card"><h3>Order <code>${esc(j.orderRef)}</code></h3>
<p>Findings: ${j.findings.map(esc).join(", ") || "none"}</p>${story}${body}${
      j.correlation.gaps.length
        ? `<ul class="note">${j.correlation.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>`
        : ""
    }</article>`;
  }).join("\n");
}

function totalsBlock(report: AuditReport, cur: string): string {
  const { gross, net } = report.totals;
  const rows = report.findings.map((f) =>
    `<tr><td>${esc(f.id)} · ${esc(f.title)}</td><td class="n">${
      hours(f.cost.hoursMonth)
    }</td><td class="n">${esc(money(cur, f.cost.amountMonth))}</td></tr>`
  ).join("");
  const shared = Object.keys(report.overlap.byOrder).length;
  const why = shared === 0
    ? "No order is charged by more than one rule, so the net total equals the sum."
    : `${num(shared)} order${shared === 1 ? " is" : "s are"} charged by more than one rule (${
      report.overlap.pairs.map((p) => `${esc(p.rules.join(" and "))}: ${num(p.orders)}`).join("; ")
    }). Each such order is counted once, at its largest charge; the ${
      esc(money(cur, gross.amount - net.amount))
    } difference is the smaller charges removed, order by order in <code>overlap.by_order</code>.`;
  return `<table><thead><tr><th>Per rule</th><th class="n">Hours</th><th class="n">Cost</th></tr></thead><tbody>${rows}
<tr><td>Sum of the rules (gross)</td><td class="n">${hours(gross.hours)}</td><td class="n">${
    esc(money(cur, gross.amount))
  }</td></tr>
<tr><th>Net total, each order counted once</th><th class="n">${
    hours(net.hours)
  }</th><th class="n">${esc(money(cur, net.amount))}</th></tr></tbody></table>
<p class="note">${why}</p>`;
}

function correlation(report: AuditReport): string {
  const rows = Object.entries(report.correlation.links).map(([kind, counts]) =>
    `<tr><td>${esc(kind)}</td>${
      ["explicit", "inferred", "ambiguous", "missing", "conflicting"].map((k) =>
        `<td class="n">${num(counts[k] ?? 0)}</td>`
      ).join("")
    }</tr>`
  ).join("");
  return `<p>Links between records are <strong>explicit</strong> when a record names its parent, and
<strong>inferred</strong> when matched by time or serial. ${
    num(report.correlation.unresolved)
  } records could not be placed under exactly one order; ${
    num(report.correlation.unmapped)
  } had a state that was not recognised.</p>
<table><thead><tr><th>Link</th><th class="n">Explicit</th><th class="n">Inferred</th><th class="n">Ambiguous</th><th class="n">Missing</th><th class="n">Conflicting</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function sources(report: AuditReport): string {
  const rows = report.sources.map((s) =>
    `<tr><td>${chip(s.system)}</td><td>${esc(s.name)}${s.simulated ? " (simulated)" : ""}</td><td>${
      esc(s.kind)
    }, ${esc(s.evidenceKind)}</td><td class="n">${num(s.rowsRead)} read, ${
      num(s.rowsDiscarded)
    } discarded</td><td><code>${esc(s.endpoint)}</code></td><td><code>${
      esc(s.sha256.slice(0, 12))
    }</code></td></tr>`
  ).join("");
  return `<table><thead><tr><th>System</th><th>Reader</th><th>Kind</th><th class="n">Rows</th><th>Endpoint</th><th>SHA-256</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function summary(report: AuditReport): string {
  const cur = report.config.currency;
  const orders = report.sources.find((s) => s.name.includes("622"))?.records ??
    report.config.ordersPerMonth;
  const top = [...report.findings].filter((f) => f.status === "detected")
    .sort((a, b) => b.cost.amountMonth - a.cost.amountMonth).slice(0, 3);
  const list = top.length === 0
    ? "<p>No finding was detected in this run.</p>"
    : `<ol>${
      top.map((f) =>
        `<li><a href="#${esc(f.id)}">${esc(f.title)}</a>: ${esc(money(cur, f.cost.amountMonth))} (${
          hours(f.cost.hoursMonth)
        })</li>`
      ).join("")
    }</ol>`;
  return `<p>Flow Audit read ${num(orders)} orders from ${
    num(report.sources.length)
  } sources and checked them against ${num(report.findings.length)} rule${
    report.findings.length === 1 ? "" : "s"
  }. The estimated cost is <strong>${esc(money(cur, report.totals.gross.amount))}</strong> (${
    hours(report.totals.gross.hours)
  }). It is an estimate built from the rates in this report, not a measured loss.</p>
<h3>Fix first</h3>${list}`;
}

export function renderHtml(report: AuditReport): string {
  const cur = report.config.currency;
  const l = report.labels;
  const labels = [
    l.syntheticData && "Synthetic data",
    l.simulatedIntegration && "Simulated integration",
    l.estimatedImpact && "Estimated impact",
  ].filter(Boolean).map((t) => `<span class="label">${esc(t)}</span>`).join("");
  const unavailable = report.journeys.some((j) => j.segments.length === 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Flow Audit report ${esc(report.run.id)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
<header class="top">
<p class="brand">Flow Audit</p>
<h1>Order-to-activate audit</h1>
<p class="labels">${labels}</p>
<p class="muted">Generated ${esc(report.run.generatedAt)} · run ${esc(report.run.id)} · engine ${
    esc(report.engineVersion)
  } · schema ${esc(report.schemaVersion)}</p>
</header>
<section aria-labelledby="kpi"><h2 id="kpi">At a glance</h2>
<ul class="kpis">
<li class="card"><span class="big">${
    esc(money(cur, report.totals.net.amount))
  }</span><small>estimated cost, each order counted once</small></li>
<li class="card"><span class="big">${
    hours(report.totals.net.hours)
  }</span><small>of manual work</small></li>
<li class="card"><span class="big">${num(report.findings.length)}</span><small>finding${
    report.findings.length === 1 ? "" : "s"
  }</small></li>
<li class="card"><span class="big">${
    num(report.sources.length)
  }</span><small>sources read</small></li>
</ul>
${totalsBlock(report, cur)}
</section>
<section aria-labelledby="sum"><h2 id="sum">Executive summary</h2>${summary(report)}</section>
<section aria-labelledby="find"><h2 id="find">Findings</h2>${
    report.findings.map(findingSection).join("\n") || `<p class="note">No findings.</p>`
  }</section>
<section aria-labelledby="map"><h2 id="map">Flow map</h2>${flowMap(report.systems)}
<p class="note">Colours are fixed per system. Greyed systems were not read in this run.</p></section>
<section aria-labelledby="sys"><h2 id="sys">Systems</h2><ul class="grid">${
    report.systems.map(systemCard).join("")
  }</ul></section>
<section aria-labelledby="tl"><h2 id="tl">Timeline</h2>${
    unavailable
      ? `<p class="note">Timelines are unavailable when the source serves snapshots: a snapshot has no history of state changes (<code>segmentsUnavailable</code>).</p>`
      : ""
  }${journeys(report)}</section>
<section aria-labelledby="cor"><h2 id="cor">Correlation limits</h2>${correlation(report)}</section>
<section aria-labelledby="src"><h2 id="src">Sources and provenance</h2>${sources(report)}</section>
</main>
<footer>
<p>Run <code>${esc(report.run.id)}</code> · inputs <code>${
    esc(report.run.inputsHash)
  }</code> · config <code>${esc(report.run.configHash)}</code> · rules <code>${
    esc(report.run.rulesHash)
  }</code></p>
<p>Flow Audit ${esc(report.engineVersion)}. ${
    report.labels.syntheticData ? "Synthetic data. " : ""
  }Impact is an estimate from configurable rates.</p>
</footer>
</body>
</html>
`;
}

export const htmlRenderer: ReportRenderer = {
  format: "html",
  render: (report) => Promise.resolve(renderHtml(report)),
};
