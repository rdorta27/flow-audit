// SPDX-License-Identifier: MIT
/**
 * The HTML report (M4-03, M4-07): one self-contained page, inline CSS, no script, no network.
 * Every figure is read from `AuditReport`; a section with no data says why. Orders lead (D-23); hours only,
 * never money. Counts are "measured", hours are an "estimate" from assumed rates, and the two are never mixed
 * in one figure. Nothing here is specific to one rule: names and advice come from the finding.
 */
import type {
  AssumptionRow,
  AuditReport,
  Finding,
  ReportSystem,
  SegmentKind,
  StageTime,
  SystemId,
} from "../../domain/model.ts";
import type { QualityReport } from "../../domain/quality.ts";
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

/** Escapes a sentence and puts a chip with the plain name where a system code appears. */
const withChips = (text: string) =>
  esc(text).replace(/\b(CAT|OMS|BPM|PROV)\b/g, (code) => chip(code));

/** The anchor of a row of the assumptions table. */
const rowId = (key: string) => `a-${key.replace(/\./g, "-")}`;

/** An hour figure that links to the row of the assumption it rests on (M4-09). */
const hoursLink = (n: number, keys: readonly string[]) =>
  keys.length === 0
    ? hours(n)
    : `<a class="ahr" href="#${esc(rowId(keys[0]))}" title="Rests on: ${
      esc(keys.map(inputPlain).join("; "))
    }">${hours(n)}</a>`;

/** "20 to 40 h" next to an estimate; says so when the rates are single numbers. */
function rangeText(base: number, low: number, high: number): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return r(low) === r(base) && r(high) === r(base)
    ? "no range: the rates are single numbers"
    : `range ${num(r(low))} to ${hours(high)} with the low and high rates`;
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
  const rate = `${num(minutes)} min`;
  return `${num(t.observed)} ${term("case", "cases")} × ${
    t.inputKeys.length ? `<a class="ahr" href="#${esc(rowId(t.inputKeys[0]))}">${rate}</a>` : rate
  } = ${num(Math.round(t.hours * 60 * 100) / 100)} min = ${hoursLink(t.hours, t.inputKeys)}`;
}

function findingSection(f: Finding): string {
  const c = f.cost;
  const counted = c.terms.map((t) => {
    const math = arithmetic(t);
    return `<li><strong>${esc(t.name)}:</strong> ${
      math ? `${math}` : hoursLink(t.hours, t.inputKeys)
    } (${term("assumed", "assumed")}) · ${term(t.basis)}</li>`;
  }).join("");
  const unmeasured = c.unmeasured.map((u) =>
    `<li><strong>${esc(u.term)}</strong> ${term("not_observed", "not counted")}: ${
      esc(u.reason)
    }</li>`
  ).join("");
  const minutes = c.inputs.map((i) =>
    `<li><a href="#${esc(rowId(i.key))}">${esc(inputPlain(i.key))}</a>: <strong>${
      num(i.value)
    }</strong> (<code>${esc(i.key)}</code>, ${esc(i.source ?? "example")})</li>`
  ).join("");
  const sc = f.scenario;
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
<dt>In how many orders</dt><dd><span class="tag">${term("measured")}</span> <span class="big">${
    num(f.affectedOrders)
  }</span> orders, ${pct(f.shareOfOrders)} of those read.</dd>
<dt>Proof</dt><dd>${term("proof", "Orders")} found in the records: ${num(f.evidenceTotal)}. ${
    term(f.evidenceLevel)
  }, ${term(f.confidence.level)}; ${pct(f.confidence.inferredLinkShare)} of its links are ${
    term("inferred", "inferred")
  }.<details><summary>${num(f.evidence.length)} of ${
    num(f.evidenceTotal)
  } orders shown</summary><ul>${sample}</ul>${breakdown}</details></dd>
<dt>What to do</dt><dd>${esc(f.recommendation)}</dd>
<dt>Estimate</dt><dd><span class="tag">${term("assumed")}</span> <span class="big">${
    hoursLink(c.hoursMonth, c.inputs.map((i) => i.key).filter((k) => k.startsWith("rates.")))
  }</span> a month (${rangeText(c.hoursMonth, c.hoursLow, c.hoursHigh)}), ${
    term("estimate", "an estimate")
  } from ${term("assumption", "assumptions")}${c.kind === "recurring" ? "" : ` · ${term(c.kind)}`}${
    c.normalisation ? ` · ${esc(c.normalisation)}` : ""
  }<ul>${counted}</ul>${
    unmeasured ? `<ul class="note">${unmeasured}</ul>` : ""
  }<p class="formula">${term("formula")}: <code>${esc(c.formula)}</code></p>
<details><summary>Minutes used (you can change them)</summary><ul>${minutes}</ul></details></dd>
<dt>If the cause is fixed</dt><dd><span class="tag">${term("projected")}</span> Fix: ${
    esc(sc.fix)
  }. Orders drop from <strong>${num(f.affectedOrders)}</strong> to <strong>${
    num(sc.ordersAfter)
  }</strong> and the estimate from ${hours(c.hoursMonth)} to ${
    hours(sc.hoursAfter)
  }. <span class="note">A projection, not a promise: ${
    esc(sc.mechanism)
  }. Flow Audit finds the problem; making the fix is the operator's work.</span></dd>
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
        `<li${st.observed ? "" : ' class="missing"'}>${chip(st.system)} ${esc(st.what)}${
          st.at ? ` <time>${esc(st.at)}</time>` : ""
        }${
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
<div class="figure">${storySvg(j.story, j.orderRef, n)}</div>
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
    `<tr><td>${ruleName(f)}</td><td class="n">${
      hoursLink(
        f.cost.hoursMonth,
        f.cost.inputs.map((i) => i.key).filter((k) => k.startsWith("rates.")),
      )
    }</td><td class="n">${num(Math.round(f.cost.hoursLow * 10) / 10)} to ${
      hours(f.cost.hoursHigh)
    }</td></tr>`
  ).join("");
  const shared = Object.keys(report.overlap.byOrder).length;
  const why = shared === 0
    ? "No order is charged by more than one finding, so the net total equals the sum."
    : `${num(shared)} order${shared === 1 ? " is" : "s are"} charged by more than one finding (${
      report.overlap.pairs.map((p) =>
        `${
          p.rules.map((r) => {
            const f = report.findings.find((x) => x.id === r);
            return f ? ruleName(f) : esc(r);
          }).join(" and ")
        }: ${num(p.orders)}`
      ).join("; ")
    }). Each such order is counted once, at its largest charge; the ${
      hours(gross.hours - net.hours)
    } difference is the smaller charges removed, order by order in the findings file.`;
  return `<table><thead><tr><th>Per finding</th><th class="n">Hours (estimate)</th><th class="n">Range</th></tr></thead><tbody>${rows}
<tr><td>${term("gross")}</td><td class="n">${hours(gross.hours)}</td><td class="n">${
    num(Math.round(gross.hoursLow * 10) / 10)
  } to ${hours(gross.hoursHigh)}</td></tr>
<tr><th>${term("net")}, each order counted once</th><th class="n">${
    hours(net.hours)
  }</th><th class="n">${num(Math.round(net.hoursLow * 10) / 10)} to ${
    hours(net.hoursHigh)
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

/** Orders with at least one finding, each counted once, from the overlap data. */
function distinctAffected(report: AuditReport): number {
  const detected = report.findings.filter((f) => f.status === "detected");
  const ids = new Set(detected.map((f) => f.id));
  const sum = detected.reduce((a, f) => a + f.affectedOrders, 0);
  const repeats = Object.values(report.overlap.byOrder).reduce(
    (a, rules) => a + Math.max(0, rules.filter((r) => ids.has(r)).length - 1),
    0,
  );
  return sum - repeats;
}

const SOURCE_PLAIN: Record<AssumptionRow["source"], string> = {
  client: "given by the client",
  benchmark: "from a benchmark",
  assumption: "an assumption someone declared",
  example: "example, no source declared",
};

/** Each rate and threshold a finding used: value, range, source, owner, date and users. */
function assumptionsBox(report: AuditReport): string {
  const rows = report.assumptions;
  const body = rows.map((r) => {
    const unit = r.unit === "hours" ? "h" : "min";
    const ranged = r.low !== r.value || r.high !== r.value;
    return `<tr id="${esc(rowId(r.key))}"><td>${esc(inputPlain(r.key))}</td><td class="n">${
      num(r.value)
    } ${unit}</td><td>${
      ranged ? `${num(r.low)} to ${num(r.high)} ${unit}` : "a single number"
    }</td><td>${esc(SOURCE_PLAIN[r.source])}${r.owner ? `, owner ${esc(r.owner)}` : ""}${
      r.date ? `, ${esc(r.date)}` : ""
    }</td><td>${
      r.usedBy.map((id) => {
        const f = report.findings.find((x) => x.id === id);
        return f ? ruleName(f) : esc(id);
      }).join(", ")
    }</td></tr>`;
  }).join("");
  const per = report.period;
  const periodRow = per
    ? `<tr id="assume-period"><td>Audited period</td><td class="n">${esc(day(per.start))} to ${
      esc(day(per.end))
    }</td><td>a single range</td><td>${
      per.declared ? "declared in the mapping" : "the span of the order records"
    }</td><td>every rule; waiting that never ended is counted up to ${esc(day(per.end))}</td></tr>`
    : "";
  const anyRange = rows.some((r) => r.low !== r.value || r.high !== r.value);
  const t = report.totals.net;
  return `<aside class="card assume" aria-labelledby="as"><h2 id="as">Assumptions behind the hours</h2>
<p><span class="tag">${term("assumed")}</span> <strong>Estimate with these assumptions: ${
    hours(t.hours)
  } a month</strong> (${
    rangeText(t.hours, t.hoursLow, t.hoursHigh)
  }), each order counted once. It is ${
    term("estimate", "an estimate")
  }, not a measurement and not money. Change a rate and it changes. Every hour figure in this report links to its row here.${
    anyRange ? "" : " No rate was given a low and a high value, so the range equals the estimate."
  }</p>
<table><thead><tr><th>Parameter (${
    term("assumption", "assumption")
  })</th><th class="n">Value</th><th>Range</th><th>Source, owner and date</th><th>Used by</th></tr></thead><tbody>${body}${periodRow}</tbody></table></aside>`;
}

/** Waiting time read from dated history; never part of the estimate. */
function waitingBlock(report: AuditReport): string {
  const rows: string[] = [];
  for (const f of report.findings) {
    if (f.evidenceLevel !== "history" || f.status !== "detected") continue;
    for (const t of f.cost.terms) {
      if (!t.inputKeys.includes("rates.daily_followup_minutes") || !t.observed) continue;
      rows.push(
        `<li>${ruleName(f)}: <strong>${num(Math.round(t.observed * 10) / 10)} days</strong> in ${
          num(f.affectedOrders)
        } orders, from dated history.</li>`,
      );
    }
  }
  if (rows.length === 0) return "";
  return `<aside class="card wait" aria-labelledby="wt"><h2 id="wt">Measured waiting time</h2>
<p><span class="tag">${
    term("measured")
  }</span> Days orders waited, read from dated changes in the records. It is not part of the estimate.</p><ul>${
    rows.join("")
  }</ul></aside>`;
}

/** What a rule's caveats are, computed from its fields; nothing is typed per rule. */
function caveats(f: Finding): string[] {
  const out: string[] = [];
  if (!f.inTotal) out.push("not added to the totals");
  if (f.breakdown?.weakLinks !== undefined) {
    out.push("counts weak links, not orders; a person had to infer each one");
  }
  if (f.status === "suspected") {
    out.push("suspected: the evidence is a snapshot, so the days and hours are not certain");
  }
  if (f.evidenceLevel === "weak" && f.status !== "suspected") out.push("weak evidence");
  if (f.cost.unmeasured.length) {
    out.push(
      `${num(f.cost.unmeasured.length)} term(s) not counted: ${
        f.cost.unmeasured.map((u) => u.term).join("; ")
      }`,
    );
  }
  return out;
}

const day = (iso: string) => iso.slice(0, 10);

/** The audited dates, what was removed to fit them, and whether the hours were rescaled (M5-19). */
function periodText(report: AuditReport): string {
  const p = report.period;
  if (!p) return "";
  const removed = p.removed;
  const gone = removed.orders + removed.serviceOrders + removed.processes + removed.attempts;
  const range = `${esc(day(p.start))} to ${esc(day(p.end))}`;
  const first = p.declared
    ? `<strong>Period audited: ${range}</strong>, declared in the mapping. ${
      gone === 0
        ? "No record fell outside it."
        : `Removed before the rules ran: ${num(removed.orders)} orders, ${
          num(removed.serviceOrders)
        } service orders, ${num(removed.processes)} processes and ${
          num(removed.attempts)
        } activation attempts.`
    }`
    : `<strong>Period audited: ${range}</strong>. No period was declared, so this is the span of the order records and nothing was removed.`;
  const sc = report.scaling;
  const second = !sc
    ? ""
    : Math.abs(sc.factor - 1) <= 0.01
    ? ` The period is about a month (${
      num(Math.round(sc.periodDays))
    } days), so the hours are the hours found in the records and were not rescaled.`
    : ` The hours are the hours found in this period and were <strong>not rescaled</strong> to a month: the period holds ${
      num(sc.ordersInPeriod)
    } orders against ${num(sc.ordersPerMonth)} a month.`;
  return `<p>${first}${second}</p>`;
}

/** The data-quality gate as the reader sees it: verdict, every system's measures, what failed (M5-21). */
function qualitySection(q: QualityReport | undefined): string {
  if (!q) return "";
  const verdict = q.passed
    ? "The data passed the quality gate."
    : q.forced
    ? "<strong>The data failed the quality gate and the audit was forced to run.</strong> Read every finding with that in mind."
    : "<strong>The data failed the quality gate.</strong>";
  const rows = q.systems.map((s) =>
    `<tr><td>${chip(s.system)}</td><td class="n">${num(s.rows)}</td><td>${
      s.range ? `${esc(day(s.range.start))} to ${esc(day(s.range.end))}` : "no dates"
    }</td><td class="n">${s.coverage === null ? "n/a" : pct(s.coverage)}</td><td class="n">${
      pct(s.orphanShare)
    }</td><td class="n">${pct(s.unknownShare)}</td></tr>`
  ).join("");
  const list = (title: string, items: string[]) =>
    items.length
      ? `<h3>${title}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : "";
  const window = q.window
    ? `Audited window: ${esc(day(q.window.start))} to ${esc(day(q.window.end))} (${
      q.window.declared ? "declared in the mapping" : "the span of the order records"
    }).`
    : "";
  const common = q.commonWindow
    ? ` Every system has records between ${esc(day(q.commonWindow.start))} and ${
      esc(day(q.commonWindow.end))
    }. The rules still run on every record, not only inside that overlap, so a system that starts late or ends early shows as less than 100% in the table.`
    : "";
  return `<section class="quality" id="quality" aria-labelledby="qh"><h2 id="qh">Data quality</h2>
<p>${verdict} ${window}${common}</p>
<table><thead><tr><th>System</th><th class="n">Records</th><th>Dates</th><th class="n">Window covered</th><th class="n">Orphan records</th><th class="n">Unknown states</th></tr></thead><tbody>${rows}</tbody></table>
${list("Failed", q.failures)}${list("Warnings", q.warnings)}${
    q.notEvaluable.length
      ? list("Not evaluated", q.notEvaluable.map((n) => `${n.system}: ${n.reason}`))
      : ""
  }</section>`;
}

/** Everything on the cover is read from the report, so the same claims can be rebuilt from the file. */
function cover(report: AuditReport): string {
  const notRead = report.systems.filter((s) => !s.read);
  const sysRows = [...report.systems].sort((a, b) => a.position - b.position).map((s) =>
    `<tr><td>${chip(s.system)}</td><td>${
      s.read ? `read, ${num(s.records)} records` : "<strong>NOT READ</strong>"
    }</td><td class="n">${s.coverage === null ? "n/a" : pct(s.coverage)}</td><td>${
      s.findings.length
        ? s.findings.map((id) => {
          const f = report.findings.find((x) => x.id === id);
          return f ? ruleName(f) : esc(id);
        }).join(", ")
        : "none"
    }</td></tr>`
  ).join("");
  const skipped = report.rules.filter((r) => r.outcome === "not_evaluable");
  const empty = report.rules.filter((r) => r.outcome === "nothing_found");
  const ran = report.rules.filter((r) => r.outcome !== "not_evaluable");
  const ruleLabel = (id: string) => {
    const f = report.findings.find((x) => x.id === id);
    if (f) return ruleName(f);
    const r = report.rules.find((x) => x.id === id);
    return `<span data-term="${esc(id)}">${esc(r?.title ?? id)} (${esc(id)})</span>`;
  };
  const findingRows = report.findings.map((f) =>
    `<tr><td>${ruleName(f)}</td><td>${
      term(f.status === "suspected" ? "suspected" : f.confidence.level)
    }, ${pct(f.confidence.inferredLinkShare)} of links ${
      term("inferred", "inferred")
    }</td><td class="n">${num(f.affectedOrders)}</td><td class="n">${
      hoursLink(
        f.cost.hoursMonth,
        f.cost.inputs.map((i) => i.key).filter((k) => k.startsWith("rates.")),
      )
    } (${num(Math.round(f.cost.hoursLow * 10) / 10)} to ${hours(f.cost.hoursHigh)})</td><td>${
      caveats(f).map(esc).join("; ") || "none"
    }</td></tr>`
  ).join("");
  const sens = report.sensitivity.length === 0
    ? `<p class="note">No rate has a low and a high value, so no rate can move the total: the range equals the estimate.</p>`
    : `<table><thead><tr><th>Rate, from low to high</th><th class="n">Net total at low</th><th class="n">at high</th><th class="n">Moves the total by</th></tr></thead><tbody>${
      report.sensitivity.map((r) =>
        `<tr><td><a href="#${esc(rowId(r.key))}">${esc(inputPlain(r.key))}</a>: ${num(r.low)} to ${
          num(r.high)
        } min</td><td class="n">${hours(r.hoursAtLow)}</td><td class="n">${
          hours(r.hoursAtHigh)
        }</td><td class="n">${hours(r.swing)}</td></tr>`
      ).join("")
    }</tbody></table>`;
  const t = report.totals.net;
  return `<section class="cover" id="cover" aria-labelledby="cv"><h2 id="cv">What this audit covers</h2>
<h3>What was audited</h3>
<p>${num(report.scope.orders)} orders, read from ${
    num(report.systems.length - notRead.length)
  } of ${num(report.systems.length)} systems. ${num(ran.length)} of ${
    num(report.rules.length)
  } rules ran: ${num(report.findings.length)} found something, ${num(empty.length)} found nothing${
    empty.length ? ` (${empty.map((r) => ruleLabel(r.id)).join(", ")})` : ""
  }.</p>
${periodText(report)}
<table><thead><tr><th>System</th><th>Read</th><th class="n">Orders with a record</th><th>Findings that touch it</th></tr></thead><tbody>${sysRows}</tbody></table>
<h3>What was not audited</h3>
${
    notRead.length === 0 && skipped.length === 0
      ? `<p>Every system was read and every rule was evaluated.</p>`
      : `<ul>${
        notRead.map((s) =>
          `<li>${chip(s.system)} was not read, so nothing it holds was checked.</li>`
        )
          .join("")
      }${
        skipped.map((r) =>
          `<li>${ruleLabel(r.id)} was <strong>not evaluated</strong>: ${
            withChips(r.reason ?? "its data is missing")
          }. This is not "0 findings".</li>`
        ).join("")
      }</ul>`
  }
<h3>How confident</h3>
<table><thead><tr><th>Finding</th><th>Confidence</th><th class="n">Orders (${
    term("measured")
  })</th><th class="n">Hours (${term("assumed")})</th><th>Caveats</th></tr></thead><tbody>${
    findingRows || `<tr><td colspan="5">No finding.</td></tr>`
  }</tbody></table>
<p><span class="tag">${
    term("measured")
  }</span> orders, records and links are counted in the records. <span class="tag">${
    term("assumed")
  }</span> every hour rests on a minute rate from the <a href="#as">assumptions table</a>. Net total: <strong>${
    hours(t.hours)
  }</strong> a month (${
    rangeText(t.hours, t.hoursLow, t.hoursHigh)
  }). Orders lead; hours follow from them.</p>
<h3>Which rate moves the total most</h3>
${sens}
</section>`;
}

function firstScreen(report: AuditReport): string {
  const orders = report.scope.orders;
  const top = [...report.findings].filter((f) => f.status === "detected")
    .sort((a, b) => b.affectedOrders - a.affectedOrders).slice(0, 3);
  const sys = report.systems.filter((s) => s.read).map((s) => plain(s.system));
  const headline = top.length === 0
    ? "No problem pattern was detected in these orders"
    : `${num(distinctAffected(report))} of ${
      num(orders)
    } orders have a problem that a person has to fix by hand`;
  const list = top.length === 0
    ? ""
    : `<ol class="top">${
      top.map((f) =>
        `<li><a href="#${esc(f.id)}">${esc(f.title)} (${esc(f.id)})</a> <span class="tag">${
          term("measured")
        }</span> <strong>${num(f.affectedOrders)}</strong> orders: ${esc(f.plainSummary)}</li>`
      ).join("")
    }</ol>`;
  const blind = blindSpots(report).slice(0, 3);
  const start = top[0];
  const when = report.period
    ? ` Period: ${day(report.period.start)} to ${day(report.period.end)}.`
    : "";
  const readFirst = `<ul class="readfirst">
<li><strong>What was audited.</strong> ${
    num(orders)
  } internet orders (a customer's request to get an internet service installed and switched on), read from ${
    esc(sys.join(", ") || "no system")
  }.${esc(when)}</li>
<li><strong>What went wrong.</strong> ${
    start
      ? `${
        num(distinctAffected(report))
      } of them needed a person to fix something by hand. The most common problem is ${
        esc(start.title)
      } (${esc(start.id)}), in ${num(start.affectedOrders)} orders.`
      : "No problem pattern was detected in these orders."
  }</li>
<li><strong>Where to start.</strong> ${
    start
      ? `<a href="#${esc(start.id)}">${esc(start.title)}</a>: ${esc(start.recommendation)}`
      : "Nothing to fix from this audit. See what it could not see, below."
  }</li>
</ul>`;
  return `<section class="first" id="first" aria-labelledby="h">
<h1 id="h">${esc(headline)}</h1>
<p class="lead">Flow Audit read ${num(orders)} orders from ${esc(sys.join(", ") || "no system")} (${
    num(report.sources.length)
  } sources) and looked for ${num(report.findings.length)} pattern${
    report.findings.length === 1 ? "" : "s"
  } that make people redo work by hand. ${
    term("measured")
  }: the orders and records counted in the data. Hours are ${
    term("estimate", "an estimate")
  } that only helps rank what to fix first; they rest on the assumptions below. Flow Audit finds and measures; fixing the cause is the operator's work.</p>
${readFirst}
${list ? `<h2 class="sub">Most orders affected</h2>${list}` : ""}
${assumptionsBox(report)}
${waitingBlock(report)}
${
    blind.length
      ? `<p class="blind"><strong>What it could not see.</strong> ${blind.map(esc).join(" ")}</p>`
      : ""
  }
</section>`;
}

function howToRead(): string {
  return `<aside class="card how" aria-labelledby="how"><h2 id="how">How to read this report</h2>
<p>The top says how many orders have a problem. Each finding below is written in the same order: what happens, in how many orders, the proof, what to do and, last, an estimate of the hours. Counts of orders are <strong>measured</strong> in the records; hours are an <strong>estimate</strong> from assumed minutes you can change. The drawing of one order shows its path through the systems and marks in red what could not be seen and where the problem starts. Words with a dotted underline are explained in the <a href="#glossary">glossary</a>, and long lists are folded away.</p></aside>`;
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

const STAGE_PLAIN: Record<string, string> = {
  no_evidence: "no record",
  timer_expired: "timer expired",
};

function stagePlain(stage: string): string {
  return STAGE_PLAIN[stage] ?? stage.replace(/_/g, " ");
}

const KIND_LABEL: Record<SegmentKind, string> = {
  work: "Work",
  wait: "Wait",
  queue: "Queue",
  gap: "Gap",
};

/** Measured hours. Not linked to a rate: waiting is never part of the estimate. */
const measuredHours = (n: number) => `${num(Math.round(n * 10) / 10)} h`;

const cell = (n: number | null) => n === null ? "—" : measuredHours(n);

function stageChart(stage: StageTime, index: number): string {
  const kinds: SegmentKind[] = ["work", "wait", "queue", "gap"];
  const medians = kinds.map((k) => stage[k].medianHours).filter((n): n is number => n !== null);
  const max = medians.length === 0 ? 0 : Math.max(...medians);
  if (max <= 0) return "";
  const width = 280;
  const labelW = 52;
  const barMax = 150;
  const row = 16;
  const height = kinds.length * row + 2;
  const hatch = `gap-hatch-${index}`;
  const bars = kinds.map((kind, i) => {
    const median = stage[kind].medianHours;
    const y = i * row;
    const w = median === null
      ? 0
      : Math.max(median > 0 ? 1 : 0, Math.round((median / max) * barMax));
    const fill = kind === "gap"
      ? `fill="url(#${hatch})" class="gap-bar"`
      : `class="bar st-${SYSTEM_CLASS[stage.system]}"`;
    return `<text x="0" y="${y + 11}">${KIND_LABEL[kind]}</text>${
      w > 0 ? `<rect x="${labelW}" y="${y + 2}" width="${w}" height="10" ${fill}/>` : ""
    }<text x="${width}" y="${y + 11}" text-anchor="end">${esc(cell(median))}</text>`;
  }).join("");
  return `<svg class="stage-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${
    esc(stagePlain(stage.stage))
  }"><defs><pattern id="${hatch}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--crit)" stroke-width="2"/></pattern></defs>${bars}</svg>`;
}

function stageTable(stages: readonly StageTime[]): string {
  const head = ["Work", "Wait", "Queue", "Gap"].map((k) =>
    `<th class="n">${k} median</th><th class="n">90th</th>`
  ).join("");
  const rows = stages.map((s) =>
    `<tr><td>${chip(s.system)}</td><td>${esc(stagePlain(s.stage))}</td><td class="n">${
      num(s.orders)
    }</td><td class="n">${cell(s.work.medianHours)}</td><td class="n">${
      cell(s.work.p90Hours)
    }</td><td class="n">${cell(s.wait.medianHours)}</td><td class="n">${
      cell(s.wait.p90Hours)
    }</td><td class="n">${cell(s.queue.medianHours)}</td><td class="n">${
      cell(s.queue.p90Hours)
    }</td><td class="n">${cell(s.gap.medianHours)}</td><td class="n">${
      cell(s.gap.p90Hours)
    }</td><td class="n">${measuredHours(s.waitingHours)}</td></tr>`
  ).join("");
  return `<table><thead><tr><th>System</th><th>Stage</th><th class="n">Orders</th>${head}<th class="n">Waiting</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Measured waiting per stage. Never mixed into the hour estimate. */
function waitingStages(report: AuditReport): string {
  const waiting = report.waiting;
  if (!waiting.measurable) {
    return `<section id="wait-stages" aria-labelledby="ws"><h2 id="ws">Where orders wait</h2>
<p>Waiting time is not measurable: a snapshot has no record of when each step ran, so work, wait, queue and gap cannot be timed.</p></section>`;
  }
  const most = waiting.mostWaiting;
  const named = most?.findings.map((id) => {
    const f = report.findings.find((x) => x.id === id);
    return f ? `<a href="#${esc(id)}">${ruleName(f)}</a>` : esc(id);
  }) ?? [];
  const explain = named.length === 0
    ? "No finding concentrates its orders on this stage."
    : `${named.join(", ")} ${named.length === 1 ? "explains" : "explain"} it.`;
  const line = most
    ? `<p data-stage="${esc(most.system)}:${esc(most.stage)}">` +
      `The most waiting accumulates at ${chip(most.system)}, stage ` +
      `<strong>${esc(stagePlain(most.stage))}</strong>: ` +
      `<strong>${
        measuredHours(most.waitingHours)
      }</strong> of wait, queue and gap across the orders. ` +
      `It is ${
        term("measured")
      }. It is not multiplied by a minute rate and it is not part of the estimate. ` +
      `${explain}</p>`
    : `<p>No stage has waiting time.</p>`;
  const charts = waiting.stages.map((s, i) => {
    const chart = stageChart(s, i);
    return chart
      ? `<figure>${chart}<figcaption>${chip(s.system)} · ${
        esc(stagePlain(s.stage))
      }</figcaption></figure>`
      : "";
  }).join("");
  return `<section id="wait-stages" aria-labelledby="ws"><h2 id="ws">Where orders wait</h2>
<p><span class="tag">${
    term("measured")
  }</span> Median and 90th percentile of work, wait, queue and gap at each stage, read from dated history. The gap is hatched red. Waiting is wait, queue and gap added up. It is not multiplied by a minute rate and it is not part of the estimate.</p>
${line}
${stageTable(waiting.stages)}
<div class="bars">${charts}</div></section>`;
}

export function renderHtml(report: AuditReport, quality?: QualityReport): string {
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
${cover(report)}
${qualitySection(quality)}
${howToRead()}
<section aria-labelledby="find"><h2 id="find">Findings</h2>${
    report.findings.map(findingSection).join("\n") || `<p class="note">No findings.</p>`
  }</section>
${waitingStages(report)}
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
<p>Flow Audit ${esc(report.engineVersion)}. It finds; the fix is the operator's. ${
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
