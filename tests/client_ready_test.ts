// SPDX-License-Identifier: MIT
/**
 * The client-ready check (M5-06). One command, `deno task audit --dataset data/demo --out <dir>`,
 * reads the four exports through the mapping. This test runs that command and compares the
 * result with `data/demo/expected.json` and the labelled hour estimate in `docs/product.md`.
 * Order counts and the hours that are a rate times a count come from those files. R01 and R03
 * also measure days in the records; those days are not in `expected.json`, so the gross and
 * net totals are the figures the product states, not a second formula.
 */

import { lookup } from "../src/adapters/report/glossary.ts";
import { main } from "../src/cli/main.ts";
import type { AuditReport } from "../src/domain/model.ts";
import { assert, assertEquals } from "./assert.ts";

const shown = (n: number) => Math.round(n * 10) / 10;

const expected = JSON.parse(await Deno.readTextFile("data/demo/expected.json"));
const config = JSON.parse(await Deno.readTextFile("data/demo/config.json"));
const rate = (key: string) => {
  const value = config.rates[key];
  return typeof value === "number" ? value : value.base;
};

const out = await Deno.makeTempDir();
const lines: string[] = [];
const [log, error] = [console.log, console.error];
console.log = (...a: unknown[]) => void lines.push(a.join(" "));
console.error = (...a: unknown[]) => void lines.push(a.join(" "));
let code = 1;
try {
  // The variable is unset, as in the documented command. A stub avoids asking for env permission.
  code = await main(["--dataset", "data/demo", "--out", out], () => undefined);
} finally {
  console.log = log;
  console.error = error;
}

if (code !== 0) {
  throw new Error(`audit exited ${code}\n${lines.join("\n")}`);
}
const findings = JSON.parse(await Deno.readTextFile(`${out}/findings.json`));
const html = await Deno.readTextFile(`${out}/report.html`);
const byId = (id: string) => findings.findings.find((f: { id: string }) => f.id === id);
const article = (id: string) =>
  html.slice(html.indexOf(`id="${id}"`), html.indexOf("</article>", html.indexOf(`id="${id}"`)));

/** Enough of the file for the glossary: rule names come from the findings. */
const glossaryReport = {
  findings: findings.findings.map((f: { id: string; title: string; plain_summary: string }) => ({
    id: f.id,
    title: f.title,
    plainSummary: f.plain_summary,
  })),
  rules: findings.rules.map((r: { id: string; title: string; outcome: string }) => ({
    id: r.id,
    title: r.title,
    outcome: r.outcome,
  })),
} as AuditReport;

Deno.test("the documented command finds the five cohorts in expected.json, orders first", () => {
  assertEquals(code, 0);
  assertEquals(findings.findings.map((f: { id: string }) => f.id), [
    "R01",
    "R02",
    "R03",
    "R04",
    "R05",
  ]);
  const want = expected.findings;
  assertEquals(byId("R01").affected_orders, want.R01.affected_orders);
  assertEquals(byId("R02").affected_orders, want.R02.affected_orders);
  assertEquals(byId("R03").breakdown.expired_timers, want.R03.affected_orders);
  assertEquals(byId("R03").breakdown.stuck, want.R03.stuck_orders);
  assertEquals(byId("R03").affected_orders, want.R03.stuck_orders);
  assertEquals(byId("R04").affected_orders, want.R04.affected_orders);
  assertEquals(byId("R05").affected_orders, want.R05.affected_orders);
  assertEquals(byId("R05").in_total, false);
  assertEquals(byId("R05").breakdown.weak_links, want.R05.affected_orders);

  for (const id of ["R01", "R02", "R04", "R05"]) {
    const section = article(id);
    assert(section.includes(byId(id).affected_orders.toLocaleString("en-US")), `${id} count`);
    assert(section.indexOf("In how many orders") < section.indexOf("<dt>Estimate</dt>"), id);
    assert(section.includes(byId(id).cost.formula.replace(/&/g, "&amp;")), `${id} formula`);
  }
  const r03 = article("R03");
  assert(r03.indexOf("In how many orders") < r03.indexOf("<dt>Estimate</dt>"));
  assert(
    r03.includes(String(want.R03.stuck_orders)) && r03.includes(String(want.R03.affected_orders)),
  );
  assert(r03.includes(byId("R03").cost.formula.replace(/&/g, "&amp;")));
  const r05 = article("R05");
  assert(r05.includes("not in the total"));
  assert(html.includes("not added to the totals"));
});

Deno.test("hours that are a rate times a count come from config and expected.json", () => {
  const hours = (orders: number, minutes: number) => orders * minutes / 60;
  const input = (id: string, key: string) =>
    byId(id).cost.inputs.find((i: { key: string }) => i.key === key).value;
  // The file rounds hours to one decimal. The labelled figure is that rounding of the formula.
  assertEquals(input("R02", "rates.manual_minutes"), rate("manual_minutes"));
  assertEquals(input("R04", "rates.cleanup_minutes"), rate("cleanup_minutes"));
  assertEquals(input("R05", "rates.investigation_minutes"), rate("investigation_minutes"));
  assertEquals(
    byId("R02").cost.hours_month,
    shown(hours(expected.findings.R02.affected_orders, rate("manual_minutes"))),
  );
  assertEquals(
    byId("R04").cost.hours_month,
    shown(hours(expected.findings.R04.affected_orders, rate("cleanup_minutes"))),
  );
  assertEquals(
    byId("R05").cost.hours_month,
    shown(hours(expected.findings.R05.affected_orders, rate("investigation_minutes"))),
  );
  assertEquals(shown(byId("R05").cost.hours_month), 225);
  const inTotal = findings.findings.filter((f: { in_total: boolean }) => f.in_total)
    .reduce((sum: number, f: { cost: { hours_month: number } }) => sum + f.cost.hours_month, 0);
  assertEquals(findings.totals.gross.hours, inTotal);
  assert(findings.totals.net.hours < findings.totals.gross.hours);
  assert(
    !findings.findings.filter((f: { in_total: boolean }) => f.in_total)
      .some((f: { id: string }) => f.id === "R05"),
  );
});

Deno.test("the labelled estimate is 977.6 h gross and 925.9 h net, R05 apart", () => {
  // R01's wait days and R03's days stuck are measured in the records. They are not in
  // expected.json, so this asserts the product's labelled estimate rather than recomputing it.
  assertEquals(shown(findings.totals.gross.hours), 977.6);
  assertEquals(shown(findings.totals.net.hours), 925.9);
  const flat = html.replace(/<[^>]+>/g, " ");
  assert(flat.includes("977.6 h"), "gross on the page");
  assert(flat.includes("925.9 h"), "net on the page");
  assert(flat.includes("225 h"), "R05 apart on the page");
  assert(flat.includes("estimate") && flat.includes("Assumptions behind the hours"));
  const assumptions = html.slice(
    html.indexOf('id="as"'),
    html.indexOf("</aside>", html.indexOf('id="as"')),
  );
  for (const key of Object.keys(config.rates)) {
    assert(assumptions.includes(key) || assumptions.includes(key.replace(/_/g, " ")), key);
  }
});

Deno.test("the file report passes the explanation checks", () => {
  assert(!/(src|href)\s*=\s*["']https?:/i.test(html), "external resource");
  assert(!/url\(\s*["']?https?:/i.test(html), "external css url");
  assert(!/<script|@import|<link/i.test(html), "script, import or link");
  assert(!/USD|\$|€/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), "money");
  assert(html.includes("How to read this report"));
  assert(html.includes('id="glossary"'));
  const drawn = html.indexOf('id="tl"');
  const journey = html.slice(drawn, html.indexOf("</section>", drawn));
  assertEquals(journey.match(/<summary>Order <code>([^<]+)<\/code>/)?.[1], "ORD-1005");

  const visible = html.replace(/<style>[\s\S]*?<\/style>/, "");
  const text = visible.replace(/<[^>]+>/g, " ");
  const terms = new Set([...html.matchAll(/data-term="([^"]+)"/g)].map((m) => m[1]));
  for (const m of text.matchAll(/\b(R\d{2}|CAT|OMS|BPM|PROV)\b/g)) terms.add(m[1]);
  for (const t of terms) {
    assert(lookup(glossaryReport, t) !== null, `no glossary entry: ${t}`);
  }
  for (const m of text.matchAll(/\b(R\d{2}|CAT|OMS|BPM|PROV)\b/g)) {
    const near = text.slice(Math.max(0, m.index! - 80), m.index! + 80);
    const name = lookup(glossaryReport, m[1])?.plain;
    assert(name !== undefined && near.includes(name), `${m[1]} appears without its plain name`);
  }
  const links = [...html.matchAll(/<a class="ahr" href="#([^"]+)"/g)].map((m) => m[1]);
  const anchors = new Set([...html.matchAll(/<tr id="(a-[^"]+)"/g)].map((m) => m[1]));
  assert(links.length > 5 && anchors.size >= 3);
  for (const link of links) assert(anchors.has(link), `no assumptions row ${link}`);
  const waiting = html.slice(
    html.indexOf('id="wait-stages"'),
    html.indexOf("</section>", html.indexOf('id="wait-stages"')),
  );
  assert(!waiting.includes('class="ahr"'), "waiting time is not an estimate link");
});
