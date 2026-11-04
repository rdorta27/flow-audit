// SPDX-License-Identifier: MIT
/**
 * The HTML report (M4-03, M4-07): one self-contained page, inline CSS, no script, no network.
 * Every figure is read from `AuditReport`; a section with no data says why. Hours only, never
 * money. Counts are "measured", hours are "projected" from rates, and the two are never mixed
 * in one figure. Nothing here is specific to one rule: names and advice come from the finding.
 */
import type { AuditReport, Finding, ReportSystem, SystemId } from "../../domain/model.ts";
import type { ReportRenderer } from "../../ports/report_renderer.ts";
import { API_PLAIN, glossaryFor, inputPlain, lookup, SYSTEM_PLAIN } from "./glossary.ts";
import { REPORT_CSS } from "./report_css.ts";
import { storySvg } from "./story_svg.ts";

const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const hours = (n: number) => `${num(Math.round(n * 10) / 10)} h`;
const pct = (share: number) => `${num(Math.round(share * 1000) / 10)}%`;
const words = (s: string) => s.replace(/_/g, " ");

const SYSTEM_CLASS: Record<SystemId, string> = {
  CAT: "cat",
  OMS: "oms",
  BPM: "bpm",
  PROV: "prov",
};

/** The report being rendered, so a term can look up its meaning. Set once per render. */
let current: AuditReport;

/** A word with a meaning in the glossary: marked, so the coverage test can list it. */
function term(key: string, shown?: string): string {
  const e = lookup(current, key);
  return `<abbr class="term" data-term="${esc(key)}"${e ? ` title="${esc(e.means)}"` : ""}>${
    esc(shown ?? e?.plain ?? words(key))
  }</abbr>`;
}

const plain = (system: string) => SYSTEM_PLAIN[system as SystemId] ?? system;

/** A system always shows its plain name with the code beside it. */
const chip = (system: string) => {
  const cls = SYSTEM_CLASS[system as SystemId];
  return `<span class="chip${cls ? ` s-${cls}` : ""}" data-term="${esc(system)}" title="${
    esc(lookup(current, system)?.means ?? "")
  }">${esc(plain(system))} (${esc(system)})</span>`;
};

/** A rule shows its own title with its code beside it. */
const ruleName = (f: Finding) =>
  `<span data-term="${esc(f.id)}">${esc(f.title)} (${esc(f.id)})</span>`;

/** The systems a `where` such as `OMS` or `OMS→PROV` touches. */
const touched = (where: string) => where.split(/→|->/).map((s) => s.trim()).filter(Boolean);

/** "20 measured × 90 min = 1,800 min = 30 h": the arithmetic of one term, from its numbers. */
function arithmetic(t: Finding["cost"]["terms"][number]): string {
  if (t.observed === null || t.observed === 0 || t.hours === 0) return "";
  const minutes = Math.round(t.hours * 60 / t.observed * 100) / 100;
  return `${num(t.observed)} ${term("case", "cases")} × ${num(minutes)} min = ${
    num(Math.round(t.hours * 60 * 100) / 100)
  } min = ${hours(t.hours)}`;
}

function findingSection(f: Finding): string {
  const c = f.cost;
  const counted = c.terms.map((t) => {
    const math = arithmetic(t);
    return `<li><strong>${esc(t.name)}:</strong> ${math ? `${math}` : hours(t.hours)} · ${
      term(t.basis)
    }</li>`;
  }).join("");
  const unmeasured = c.unmeasured.map((u) =>
    `<li><strong>${esc(u.term)}</strong> ${term("not_observed", "not counted")}: ${
      esc(u.reason)
    }</li>`
  ).join("");
  const minutes = c.inputs.map((i) =>
    `<li>${esc(inputPlain(i.key))}: <strong>${num(i.value)}</strong> (<code>${esc(i.key)}</code>${
      i.source ? `, ${esc(i.source)}` : ""
    })</li>`
  ).join("");
  const sample = f.evidence.slice(0, 5).map((e) =>
    `<li><code>${esc(e.orderRef)}</code>${e.note ? ` ${esc(words(e.note))}` : ""}</li>`
  ).join("");
  const breakdown = f.breakdown
    ? `<p class="note">${
      Object.entries(f.breakdown).map(([k, v]) =>
        `${esc(k.replace(/([A-Z])/g, " $1").toLowerCase())} ${num(v)}`
      ).join(" · ")
    }</p>`
    : "";
  return `<article class="card finding" id="${esc(f.id)}" data-rule="${esc(f.ruleVersion)}">
<header><h3>${esc(f.title)} (${esc(f.id)})</h3>
<p class="chips">${touched(f.where).map(chip).join("")} <span class="sev sev-${esc(f.severity)}">${
    term(f.severity)
  }</span>${f.inTotal ? "" : ` <span class="note">not in the total</span>`}</p></header>
<dl class="steps">
<dt>What happens</dt><dd>${esc(f.plainSummary)}</dd>
<dt>In how many orders</dt><dd><span class="tag">${term("measured")}</span> <strong>${
    num(f.affectedOrders)
  }</strong> orders, ${pct(f.shareOfOrders)} of those read.</dd>
<dt>How many hours</dt><dd><span class="tag">${term("projected")}</span> <span class="big">${
    hours(c.hoursMonth)
  }</span> a month${c.kind === "recurring" ? "" : ` · ${term(c.kind)}`}${
    c.normalisation ? ` · ${esc(c.normalisation)}` : ""
  }</dd>
<dt>How it is counted</dt><dd><ul>${counted}</ul>${
    unmeasured ? `<ul class="note">${unmeasured}</ul>` : ""
  }<p class="formula">${term("formula")}: <code>${esc(c.formula)}</code></p>
<details><summary>Minutes used (you can change them)</summary><ul>${minutes}</ul></details></dd>
<dt>Proof</dt><dd>${term("proof", "Orders")} found in the records: ${num(f.evidenceTotal)}. ${
    term(f.evidenceLevel)
  }, ${term(f.confidence.level)}; ${pct(f.confidence.inferredLinkShare)} of its links are ${
    term("inferred", "inferred")
  }.<details><summary>${num(f.evidence.length)} of ${
    num(f.evidenceTotal)
  } orders shown</summary><ul>${sample}</ul>${breakdown}</details></dd>
<dt>What to do</dt><dd>${esc(f.recommendation)}</dd>
</dl>
</article>`;
}

function systemCard(s: ReportSystem): string {
  const cover = s.coverage === null ? "not read" : `${pct(s.coverage)} of orders`;
  return `<li class="card sys">
<p>${s.position}. ${chip(s.system)}</p>
<p class="muted">${esc(s.role)}</p>
<p>${s.read ? `${num(s.records)} records · ${esc(cover)}` : "Not read in this run"}${
    s.findings.length
      ? ` · findings: ${
        s.findings.map((id) => {
          const f = current.findings.find((x) => x.id === id);
          return f ? ruleName(f) : esc(id);
        }).join(", ")
      }`
      : ""
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
    } (${esc(s.system)})<small>${s.read ? "read" : "not read"}</small></li>`
  ).join('<li class="arrow" aria-hidden="true">→</li>');
  return `<ol class="flow">${nodes}</ol>`;
}

function journeys(report: AuditReport): string {
  if (report.journeys.length === 0) {
    return `<p class="note">No order was selected to draw: no finding has evidence to follow.</p>`;
  }
  return report.journeys.map((j, n) => {
    const body = j.segments.length === 0
      ? `<p class="note">Time segments unavailable: ${
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
          st.finding
            ? ` <span class="sev sev-medium">${
              esc(report.findings.find((f) => f.id === st.finding)?.title ?? "Problem")
            } (${esc(st.finding)}) starts here</span>`
            : ""
        }</li>`
      ).join("")
    }</ol>`;
    const flagged = j.findings.map((id) => {
      const f = report.findings.find((x) => x.id === id);
      return f ? ruleName(f) : esc(id);
    }).join(", ") || "none";
    return `<details class="card"${n === 0 ? " open" : ""}><summary>Order <code>${
      esc(j.orderRef)
    }</code> · findings: ${flagged}</summary>
<div class="figure">${storySvg(j.story, j.orderRef)}</div>
<p class="note">Colours are fixed per system. A red dashed line or circle is a step the source cannot show, or where a finding starts.</p>${story}<details><summary>Time segments</summary>${body}</details>${
      j.correlation.gaps.length
        ? `<ul class="note">${j.correlation.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>`
        : ""
    }</details>`;
  }).join("\n");
}

function totalsBlock(report: AuditReport): string {
  const { gross, net } = report.totals;
  const rows = report.findings.map((f) =>
    `<tr><td>${ruleName(f)}</td><td class="n">${hours(f.cost.hoursMonth)}</td></tr>`
  ).join("");
  const shared = Object.keys(report.overlap.byOrder).length;
  const why = shared === 0
    ? "No order is charged by more than one finding, so the net total equals the sum."
    : `${num(shared)} order${shared === 1 ? " is" : "s are"} charged by more than one finding (${
      report.overlap.pairs.map((p) => `${esc(p.rules.join(" and "))}: ${num(p.orders)}`).join("; ")
    }). Each such order is counted once, at its largest charge; the ${
      hours(gross.hours - net.hours)
    } difference is the smaller charges removed, order by order in the findings file.`;
  return `<table><thead><tr><th>Per finding</th><th class="n">Hours (projected)</th></tr></thead><tbody>${rows}
<tr><td>${term("gross")}</td><td class="n">${hours(gross.hours)}</td></tr>
<tr><th>${term("net")}, each order counted once</th><th class="n">${
    hours(net.hours)
  }</th></tr></tbody></table>
<p class="note">${why}</p>`;
}

function correlation(report: AuditReport): string {
  const rows = Object.entries(report.correlation.links).map(([kind, counts]) =>
    `<tr><td>${esc(words(kind))}</td>${
      ["explicit", "inferred", "ambiguous", "missing", "conflicting"].map((k) =>
        `<td class="n">${num(counts[k] ?? 0)}</td>`
      ).join("")
    }</tr>`
  ).join("");
  return `<p>Links between records are ${
    term("explicit", "explicit")
  } when a record names its parent, and
${term("inferred", "inferred")} when matched by time or serial. ${
    num(report.correlation.unresolved)
  } records could not be placed under exactly one order; ${
    num(report.correlation.unmapped)
  } had a state that was not recognised.</p>
<table><thead><tr><th>Link</th><th class="n">Explicit</th><th class="n">Inferred</th><th class="n">Ambiguous</th><th class="n">Missing</th><th class="n">Conflicting</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** A reader name such as `TMF622 productOrder` gets its plain name in front. */
function sourceName(name: string): string {
  const m = name.match(/TMF\d{3}/);
  const plainName = m ? API_PLAIN[m[0]] : undefined;
  return plainName
    ? `${esc(plainName)} (<span data-term="${m![0]}">${esc(name)}</span>)`
    : esc(name);
}

function sources(report: AuditReport): string {
  const rows = report.sources.map((s) =>
    `<tr><td>${chip(s.system)}</td><td>${sourceName(s.name)}${
      s.simulated ? " (simulated)" : ""
    }</td><td>${esc(s.kind)}, ${term(s.evidenceKind)}</td><td class="n">${num(s.rowsRead)} read, ${
      num(s.rowsDiscarded)
    } discarded</td><td><code>${esc(s.endpoint)}</code></td><td><code>${
      esc(s.sha256.slice(0, 12))
    }</code></td></tr>`
  ).join("");
  return `<table><thead><tr><th>System</th><th>Reader</th><th>Kind</th><th class="n">Rows</th><th>Endpoint</th><th>Fingerprint</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** What the engine could not see: systems not read, and what a read system cannot show. */
function blindSpots(report: AuditReport): string[] {
  const unread = report.systems.filter((s) => !s.read).map((s) => plain(s.system));
  const out: string[] = [];
  if (unread.length) {
    out.push(`${unread.join(" and ")} ${unread.length === 1 ? "was" : "were"} not read.`);
  }
  const seen = new Set<string>();
  for (const s of report.systems.filter((x) => x.read)) {
    for (const x of s.cannotObserve) {
      if (!seen.has(x)) {
        seen.add(x);
        out.push(`${plain(s.system)}: ${x}.`);
      }
    }
  }
  return out;
}

function firstScreen(report: AuditReport): string {
  const orders = report.sources.find((s) => s.name.includes("622"))?.records ??
    report.config.ordersPerMonth;
  const top = [...report.findings].filter((f) => f.status === "detected")
    .sort((a, b) => b.cost.hoursMonth - a.cost.hoursMonth).slice(0, 3);
  const sys = report.systems.filter((s) => s.read).map((s) => plain(s.system));
  const headline = top.length === 0
    ? "No problem pattern was detected in these orders"
    : `Orders cost about ${hours(report.totals.net.hours)} of manual rework a month`;
  const list = top.length === 0
    ? ""
    : `<ol class="top">${
      top.map((f) =>
        `<li><a href="#${esc(f.id)}">${esc(f.title)} (${esc(f.id)})</a> <span class="tag">${
          hours(f.cost.hoursMonth)
        }</span> in ${num(f.affectedOrders)} orders</li>`
      ).join("")
    }</ol>`;
  const blind = blindSpots(report).slice(0, 3);
  return `<section class="first" id="first" aria-labelledby="h">
<h1 id="h">${esc(headline)}</h1>
<p class="lead">Flow Audit read ${num(orders)} orders from ${esc(sys.join(", ") || "no system")} (${
    num(report.sources.length)
  } sources) and looked for ${num(report.findings.length)} pattern${
    report.findings.length === 1 ? "" : "s"
  } that make people redo work by hand. ${term("measured")}: ${num(orders)} orders, ${
    num(report.findings.reduce((a, f) => a + f.affectedOrders, 0))
  } with a finding. ${term("projected")}: ${
    hours(report.totals.net.hours)
  } a month, from minutes you can change; not money, not a booked loss.</p>
${list ? `<h2 class="sub">Where the hours go</h2>${list}` : ""}
${
    blind.length
      ? `<p class="blind"><strong>What it could not see.</strong> ${blind.map(esc).join(" ")}</p>`
      : ""
  }
</section>`;
}

function howToRead(): string {
  return `<aside class="card how" aria-labelledby="how"><h2 id="how">How to read this report</h2>
<p>The top says where the hours go. Each finding below is written in the same order: what happens, in how many orders, how many hours, how they were counted, the proof and what to do. Counts of orders are <strong>measured</strong> in the records; hours are <strong>projected</strong> from minutes you can change, so they are an estimate. The drawing of one order shows its path through the systems and marks in red what could not be seen and where the problem starts. Words with a dotted underline are explained in the <a href="#glossary">glossary</a>, and long lists are folded away.</p></aside>`;
}

function glossary(report: AuditReport): string {
  return `<dl class="gloss">${
    glossaryFor(report).map((e) =>
      `<dt id="g-${esc(e.term)}">${esc(e.plain)}${
        e.term !== e.plain && /^[A-Z]/.test(e.term) ? ` (${esc(e.term)})` : ""
      }</dt><dd>${esc(e.means)}</dd>`
    ).join("")
  }</dl>`;
}

export function renderHtml(report: AuditReport): string {
  current = report;
  const l = report.labels;
  const labels = [
    l.syntheticData && ["synthetic", "Synthetic data"],
    l.simulatedIntegration && ["simulated", "Simulated integration"],
    l.estimatedImpact && ["", "Estimated impact"],
  ].filter(Boolean).map((t) => {
    const [key, text] = t as [string, string];
    return `<span class="label">${key ? term(key, text) : esc(text)}</span>`;
  }).join("");
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
<p class="brand">Flow Audit · order-to-activate audit</p>
<p class="labels">${labels}</p>
</header>
${firstScreen(report)}
${howToRead()}
<section aria-labelledby="find"><h2 id="find">Findings</h2>${
    report.findings.map(findingSection).join("\n") || `<p class="note">No findings.</p>`
  }</section>
<section aria-labelledby="tl"><h2 id="tl">One order, drawn</h2>${
    unavailable
      ? `<p class="note">Time segments are unavailable when the source serves a ${
        term("snapshot", "snapshot")
      }: it has no history of state changes.</p>`
      : ""
  }${journeys(report)}</section>
<section aria-labelledby="det"><h2 id="det">Details</h2>
<details><summary>Totals and shared orders</summary>${totalsBlock(report)}</details>
<details><summary>Flow map and systems</summary>${flowMap(report.systems)}
<p class="note">Colours are fixed per system. Greyed systems were not read in this run.</p><ul class="grid">${
    report.systems.map(systemCard).join("")
  }</ul></details>
<details><summary>Correlation limits</summary>${correlation(report)}</details>
<details><summary>Sources and provenance</summary>${sources(report)}</details>
</section>
<section aria-labelledby="glossary"><h2 id="glossary">Glossary</h2>${glossary(report)}</section>
</main>
<footer>
<p>Generated ${esc(report.run.generatedAt)} · run <code>${esc(report.run.id)}</code> · engine ${
    esc(report.engineVersion)
  } · schema ${esc(report.schemaVersion)}</p>
<p>Inputs <code>${esc(report.run.inputsHash)}</code> · config <code>${
    esc(report.run.configHash)
  }</code> · rules <code>${esc(report.run.rulesHash)}</code></p>
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
