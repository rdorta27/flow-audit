// SPDX-License-Identifier: MIT
/** The HTML report (M4-03). */

import { renderHtml } from "../src/adapters/report/html_renderer.ts";
import { assert, assertEquals } from "./assert.ts";
import { auditStub } from "./stub_sources.ts";

const GOLDEN = new URL("./golden/r04_section.html", import.meta.url);
const { report } = await auditStub();
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
