// SPDX-License-Identifier: MIT
/** The HTML report (M4-03). */

import { renderHtml } from "../src/adapters/report/html_renderer.ts";
import { selectJourneyRefs } from "../src/app/run_audit.ts";
import { glossaryFor, lookup } from "../src/adapters/report/glossary.ts";
import { storySvg } from "../src/adapters/report/story_svg.ts";
import { buildStory } from "../src/domain/story.ts";
import type { StoryStep, SystemId } from "../src/domain/model.ts";
import { assert, assertEquals } from "./assert.ts";
import { auditStub } from "./stub_sources.ts";

const FIRST_GOLDEN = new URL("./golden/first_screen.html", import.meta.url);
const GOLDEN = new URL("./golden/r04_section.html", import.meta.url);
const audit = await auditStub();
const { report } = audit;
const html = renderHtml(report);

Deno.test("the HTML has no external resource reference and no script", () => {
  assert(!/(src|href)\s*=\s*["']https?:/i.test(html), "external resource");
  assert(!/url\(\s*["']?https?:/i.test(html), "external css url");
  assert(!/<script|@import|<link/i.test(html), "script, import or link");
});

Deno.test("every finding's hours appear next to its formula", () => {
  for (const f of report.findings) {
    const start = html.indexOf(`id="${f.id}"`);
    const section = html.slice(start, html.indexOf("</article>", start));
    const shown = (n: number) => `${Math.round(n * 10) / 10} h`;
    assert(section.includes(shown(f.cost.hoursMonth)), "hours");
    assert(section.includes(f.cost.formula.replace(/&/g, "&amp;")), "formula");
    for (const t of f.cost.terms) {
      assert(section.includes(shown(t.hours)), `term ${t.name}`);
    }
  }
});

Deno.test("the page labels the data, says why the timeline is missing and shows the run hash", () => {
  for (const label of ["Synthetic data", "Simulated integration", "Estimated impact"]) {
    assert(html.includes(label), label);
  }
  assert(html.includes("snapshot"), "timeline reason");
  assert(html.includes(report.run.inputsHash), "run hash in the footer");
  assert(html.includes("prefers-color-scheme:light") && html.includes("viewport"));
});

Deno.test("the R04 section matches its snapshot", async () => {
  const start = html.indexOf('<article class="card finding" id="R04"');
  const section = html.slice(start, html.indexOf("</article>", start) + 10) + "\n";
  if (Deno.env.get("UPDATE_GOLDEN")) await Deno.writeTextFile(GOLDEN, section);
  assertEquals(section, await Deno.readTextFile(GOLDEN));
  assert(section.includes("30 h") && !section.includes("USD"));
});

const visible = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(
  /<title>[\s\S]*?<\/title>/g,
  "",
);
const text = visible.replace(/<[^>]+>/g, " ");

Deno.test("every term and code the report prints has a glossary entry and a plain name", () => {
  const terms = new Set([...html.matchAll(/data-term="([^"]+)"/g)].map((m) => m[1]));
  // The codes in the text, wherever they appear.
  for (const m of text.matchAll(/\b(R\d{2}|CAT|OMS|BPM|PROV|TMF\d{3})\b/g)) terms.add(m[1]);
  // Every value of the report that is printed as a word.
  for (const f of report.findings) {
    for (const k of [f.id, f.severity, f.evidenceLevel, f.confidence.level, f.cost.kind]) {
      terms.add(k);
    }
    for (const t of f.cost.terms) terms.add(t.basis);
  }
  for (const s of report.sources) terms.add(s.evidenceKind === "snapshot" ? "snapshot" : "history");
  assert(terms.size > 10, "terms were found");
  const rows = new Map(glossaryFor(report).map((e) => [e.term, e]));
  for (const t of terms) {
    const e = lookup(report, t);
    assert(e !== null && e.plain.length > 0 && e.means.length > 0, `no glossary entry: ${t}`);
    assert(rows.has(t), `not listed in the glossary section: ${t}`);
    assert(html.includes(`id="g-${t}"`), `glossary section lacks ${t}`);
  }
  // A code is never alone: its plain name is within the same sentence.
  for (const m of text.matchAll(/\b(R\d{2}|CAT|OMS|BPM|PROV)\b/g)) {
    const near = text.slice(Math.max(0, m.index! - 80), m.index! + 80);
    const name = lookup(report, m[1])!.plain;
    assert(near.includes(name), `${m[1]} appears without "${name}": ${near}`);
  }
});

Deno.test("a rule the glossary does not know still gets its name from its finding", () => {
  const other = structuredClone(report);
  other.findings[0].id = "R99";
  other.findings[0].title = "Stuck order";
  other.findings[0].plainSummary = "An order waits.";
  assertEquals(lookup(other, "R99")?.plain, "Stuck order");
  assert(renderHtml(other).includes("Stuck order (R99)"));
});

Deno.test("each finding reads in the fixed order and money never appears", () => {
  const labels = [
    "What happens",
    "In how many orders",
    "Proof",
    "What to do",
    "Estimate",
  ];
  const start = html.indexOf('id="R04"');
  const sec = html.slice(start, html.indexOf("</article>", start));
  let at = -1;
  for (const l of labels) {
    const i = sec.indexOf(`<dt>${l}</dt>`);
    assert(i > at, `${l} out of order`);
    at = i;
  }
  assert(
    /20 cases × 90 min = 1,800 min = 30 h/.test(sec.replace(/<[^>]+>/g, "")),
    "example minutes",
  );
  assert(!/USD|\$|€/.test(text), "money");
});

Deno.test("the first screen matches its snapshot", async () => {
  const start = html.indexOf('<section class="first"');
  const section = html.slice(start, html.indexOf("</section>", start) + 10) + "\n";
  if (Deno.env.get("UPDATE_GOLDEN")) await Deno.writeTextFile(FIRST_GOLDEN, section);
  assertEquals(section, await Deno.readTextFile(FIRST_GOLDEN));
  assert(section.includes("measured") || section.includes("Measured"));
  assert(section.includes("could not see"));
});

/** Lane lines, and each flag's claimed span (`textLength`, middle-anchored). */
function flagSpans(svg: string): { text: string; x1: number; x2: number }[] {
  return [...svg.matchAll(
    /<text class="flag" x="([^"]+)"[^>]*textLength="([^"]+)"[^>]*>([^<]*)<\/text>/g,
  )].map((m) => {
    const x = Number(m[1]);
    const width = Number(m[2]);
    return { text: m[3], x1: x - width / 2, x2: x + width / 2 };
  });
}

function laneLines(svg: string): number[] {
  return [...svg.matchAll(/class="lane [^"]*" x1="([^"]+)"/g)].map((m) => Number(m[1]));
}

/** A flag crosses a lane line when that line lies inside its span and is not its own lane. */
function assertFlagsInsideLanes(svg: string): void {
  const lanes = laneLines(svg);
  const flags = flagSpans(svg);
  assert(flags.length > 0, "flags");
  for (const flag of flags) {
    const own = lanes.reduce((best, lane) =>
      Math.abs(lane - (flag.x1 + flag.x2) / 2) < Math.abs(best - (flag.x1 + flag.x2) / 2)
        ? lane
        : best
    );
    for (const lane of lanes) {
      if (lane === own) continue;
      assert(
        lane < flag.x1 || lane > flag.x2,
        `"${flag.text}" crosses the lane at ${lane} (span ${flag.x1} to ${flag.x2})`,
      );
    }
  }
}

Deno.test("ORD-1005 is drawn before an order that carries the same findings", () => {
  const evidence = (refs: string[]) =>
    refs.map((orderRef) => ({ orderRef, eventIds: [], records: [] }));
  const refs = selectJourneyRefs(
    [{ evidence: evidence(["ORD-1000", "ORD-1005"]) }] as never,
    [],
    ["ORD-1000", "ORD-1005"],
  );
  assertEquals(refs[0], "ORD-1005");
  const absent = selectJourneyRefs(
    [{ evidence: evidence(["ORD-1000", "ORD-1001"]) }] as never,
    [],
    ["ORD-1000", "ORD-1001"],
  );
  assertEquals(absent[0], "ORD-1000");
});

Deno.test("a snapshot source says waiting time is not measurable", () => {
  assertEquals(report.waiting.measurable, false);
  assertEquals(report.waiting.reason, "not measurable");
  const start = html.indexOf('id="wait-stages"');
  const section = html.slice(start, html.indexOf("</section>", start));
  assert(section.includes("not measurable"), section);
  assert(!section.includes('class="ahr"'), "waiting is not linked to a rate");
});

Deno.test("the example order drawn in the report is ORD-1005", () => {
  assertEquals(report.journeys[0].orderRef, "ORD-1005");
  const start = html.indexOf('id="tl"');
  const section = html.slice(start, html.indexOf("</section>", start));
  const summary = section.match(/<summary>Order <code>([^<]+)<\/code>/);
  assertEquals(summary?.[1], "ORD-1005");
  assert(section.includes('details class="card" open'), "the example is the open drawing");
});

Deno.test("the story of ORD-1005 is drawn: four stations, six stops, the gap in red", () => {
  const entry = audit.correlation.orders.find((o) => o.order.orderRef === "ORD-1005")!;
  const steps = buildStory(entry, audit.findings);
  const svg = storySvg(steps, "ORD-1005");
  assert(svg.startsWith("<svg") && svg.endsWith("</svg>"));
  for (const c of ["st-cat", "st-oms", "st-bpm", "st-prov"]) assert(svg.includes(`station ${c}`));
  assertEquals((svg.match(/class="stop /g) ?? []).length, steps.length);
  assertEquals(
    (svg.match(/class="stop gap/g) ?? []).length,
    steps.filter((s) => !s.observed).length,
  );
  assertEquals((svg.match(/class="ring"/g) ?? []).length, 1);
  assert(svg.includes("problem starts here") && svg.includes("not seen"));
  assertFlagsInsideLanes(svg);
  assert(!/https?:/.test(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")));
});

Deno.test("the problem label stays inside its lane on every system", () => {
  const step = (system: SystemId): StoryStep => ({
    at: "2026-09-01T00:00:00.000Z",
    system,
    what: "A second service order was created for line 1, which already had one.",
    record: null,
    finding: "R04",
    observed: true,
    reason: null,
  });
  for (const system of ["CAT", "OMS", "BPM", "PROV"] as const) {
    const svg = storySvg([step(system)], "ORD-1005");
    assert(svg.includes("problem starts here"), system);
    assertFlagsInsideLanes(svg);
  }
});

// The cover and the links to the assumptions (M4-09, M5-13) -------------------------------

const coverOf = (h: string) =>
  h.slice(
    h.indexOf('<section class="cover"'),
    h.indexOf("</section>", h.indexOf('<section class="cover"')),
  );

Deno.test("every hour figure links to a row of the assumptions table", () => {
  const rows = new Set([...html.matchAll(/<tr id="(a-[^"]+)"/g)].map((m) => m[1]));
  assert(rows.size >= 3, "rows");
  const links = [...html.matchAll(/<a class="ahr" href="#([^"]+)"/g)].map((m) => m[1]);
  assert(links.length > 5, "links");
  for (const l of links) assert(rows.has(l), `no row ${l}`);
  for (const a of report.assumptions) assert(rows.has(`a-${a.key.replace(/\./g, "-")}`), a.key);
});

Deno.test("the cover is computed from the report: counts, ranges, caveats and sensitivity", () => {
  const cover = coverOf(html);
  const flat = cover.replace(/<[^>]+>/g, " ");
  assert(flat.includes(`${report.scope.orders.toLocaleString("en-US")} orders`));
  for (const f of report.findings) {
    assert(cover.includes(`id="`) || cover.includes(f.id), f.id);
    assert(flat.includes(f.id), `${f.id} on the cover`);
  }
  assert(flat.includes("not added to the totals"), "R05 caveat");
  assert(flat.includes("counts weak links, not orders"), "R05 caveat");
  const top = report.sensitivity[0];
  assert(top && cover.includes(`href="#a-${top.key.replace(/\./g, "-")}"`), "sensitivity");
  assert(flat.includes("finds") || html.includes("Flow Audit finds"), "who fixes");
});

Deno.test("a rule that is not evaluable is told apart from one that found nothing", () => {
  const cover = coverOf(html).replace(/<[^>]+>/g, " ");
  const skipped = report.rules.filter((r) => r.outcome === "not_evaluable");
  assert(skipped.length >= 1, "the stub has no catalog or processes");
  assert(cover.includes("not evaluated") && cover.includes('not "0 findings"'));
  for (const r of skipped) assert(cover.includes(r.id));
});

Deno.test("a report with a missing system shows it on the cover", () => {
  const copy = structuredClone(report);
  copy.systems.find((s) => s.system === "PROV")!.read = false;
  const cover = coverOf(renderHtml(copy)).replace(/<[^>]+>/g, " ");
  assert(cover.includes("NOT READ") && cover.includes("Activation system"));
  assertEquals(renderHtml(report) === renderHtml(copy), false);
});

Deno.test("the first screen says what was audited, what went wrong and where to start", () => {
  const first = html.slice(
    html.indexOf('id="first"'),
    html.indexOf("</section>", html.indexOf('id="first"')),
  );
  const top = [...report.findings].filter((f) => f.status === "detected")
    .sort((a, b) => b.affectedOrders - a.affectedOrders)[0];
  assert(first.includes("What was audited."), "what was audited");
  assert(first.includes("a customer's request to get an internet service"), "defines the order");
  assert(first.includes("What went wrong."), "what went wrong");
  assert(first.includes("Where to start."), "where to start");
  assert(first.includes(`href="#${top.id}"`), "links the biggest finding");
  assert(first.includes(top.recommendation.replace(/&/g, "&amp;")), "shows its recommendation");
});
