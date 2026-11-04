// SPDX-License-Identifier: MIT
/** Styles of the HTML report: the site's palette (docs/architecture/report-style.md), inlined. */
export const REPORT_CSS = `
:root{--bg:#1f1f28;--card:#2a2a37;--tint:#252535;--ink:#dcd7ba;--muted:#a6a69c;--line:#363646;
--crit:#f08a94;--fa:#e6c384;--s-cat:#98bb6c;--s-oms:#7e9cd8;--s-bpm:#957fb8;--s-prov:#ffa066;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--sans:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
@media (prefers-color-scheme:light){:root{--bg:#f2ecbc;--card:#f9f5d7;--tint:#e5ddb0;--ink:#545464;
--muted:#5a5a68;--line:#c9c18e;--crit:#b4232f;--fa:#8a6200;--s-cat:#6f894e;--s-oms:#4d699b;
--s-bpm:#624c83;--s-prov:#cc6d00}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans)}
main{max-width:60rem;margin:0 auto;padding:1rem}
h1,h2,h3{line-height:1.2}h2{margin-top:2rem;border-bottom:1px solid var(--line);padding-bottom:.25rem}
code{font-family:var(--mono);font-size:.9em;overflow-wrap:anywhere}
.brand{color:var(--fa);font-weight:700;margin:0}
.muted,.note,small{color:var(--muted)}
.story{padding-left:1.4rem}.story li{margin:.3rem 0}.story .missing{color:var(--muted);font-style:italic}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.75rem 1rem;margin:.75rem 0}
.labels{display:flex;flex-wrap:wrap;gap:.5rem}
.label{border:1px solid var(--fa);color:var(--fa);border-radius:999px;padding:.1rem .6rem;font-size:.85rem}
.kpis,.grid{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.75rem}
.kpis .card{margin:0}.kpis small{display:block}
.big{font-size:1.6rem;font-weight:700}
.chip{display:inline-block;border:1px solid var(--line);border-left:6px solid var(--muted);border-radius:4px;padding:0 .5rem;font-size:.85rem;font-weight:600}
.s-cat{border-left-color:var(--s-cat)}.s-oms{border-left-color:var(--s-oms)}
.s-bpm{border-left-color:var(--s-bpm)}.s-prov{border-left-color:var(--s-prov)}
.sev{border:1px solid var(--crit);color:var(--crit);border-radius:4px;padding:0 .5rem;font-size:.85rem;text-transform:uppercase}
.formula{background:var(--tint);padding:.5rem;border-radius:4px}
table{width:100%;border-collapse:collapse;display:block;overflow-x:auto}
th,td{border-bottom:1px solid var(--line);padding:.3rem .5rem;text-align:left;vertical-align:top}
.n{text-align:right;font-variant-numeric:tabular-nums}
.flow{list-style:none;padding:0;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.node{border:2px solid var(--muted);border-radius:8px;padding:.5rem 1rem;background:var(--card);font-weight:700}
.node small{display:block;font-weight:400}.node.unread{opacity:.6;border-style:dashed}
.node.s-cat{border-color:var(--s-cat)}.node.s-oms{border-color:var(--s-oms)}
.node.s-bpm{border-color:var(--s-bpm)}.node.s-prov{border-color:var(--s-prov)}
.arrow{color:var(--muted)}
footer{max-width:60rem;margin:0 auto;padding:1rem;color:var(--muted);font-size:.85rem;overflow-wrap:anywhere}
.first{padding:.25rem 0}.first h1{font-size:1.9rem;margin:.4rem 0}
.lead{margin:.4rem 0}.sub{font-size:1.1rem;margin:.8rem 0 .2rem;border:0}
.top li{margin:.2rem 0}.blind{background:var(--tint);border-radius:6px;padding:.5rem .75rem;margin:.6rem 0}
header.top{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;justify-content:space-between}
header.top p{margin:0}
.how{border-left:6px solid var(--fa)}.how h2{margin-top:0;border:0}
.tag{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 .4rem;font-size:.85rem;background:var(--tint)}
abbr.term{text-decoration:underline dotted;cursor:help}
.steps{display:grid;grid-template-columns:11rem 1fr;gap:.4rem 1rem;margin:.5rem 0}
.steps dt{font-weight:700;color:var(--fa)}.steps dd{margin:0}.steps ul{margin:0;padding-left:1.1rem}
@media (max-width:40rem){.steps{grid-template-columns:1fr;gap:0}.steps dd{margin-bottom:.6rem}.first h1{font-size:1.5rem}}
.figure{max-width:30rem;margin:.5rem auto}.story-svg{width:100%;height:auto;display:block}
.story-svg text{font:12px var(--sans);fill:var(--ink);stroke:none}
.story-svg .station rect{fill:var(--card);stroke-width:2}
.story-svg .station text{font-weight:700}
.story-svg .lane{stroke-width:1;stroke-dasharray:3 5;opacity:.5}
.story-svg .hop{stroke-width:2.5}
.story-svg .hop.gap{stroke:var(--crit);stroke-dasharray:6 5}
.story-svg .dot{stroke-width:2}.story-svg .stop text{font-weight:700;fill:var(--bg)}
.story-svg .stop.gap .dot{fill:var(--bg);stroke:var(--crit)}.story-svg .stop.gap text{fill:var(--crit)}
.story-svg .ring{fill:none;stroke:var(--crit);stroke-width:2}
.story-svg .flag{fill:var(--crit);font-size:11px}
.st-cat{stroke:var(--s-cat);fill:var(--s-cat)}.st-oms{stroke:var(--s-oms);fill:var(--s-oms)}
.st-bpm{stroke:var(--s-bpm);fill:var(--s-bpm)}.st-prov{stroke:var(--s-prov);fill:var(--s-prov)}
.story-svg .station.st-cat rect,.story-svg .station.st-oms rect,.story-svg .station.st-bpm rect,.story-svg .station.st-prov rect{fill:var(--card)}
.story-svg line.st-cat,.story-svg line.st-oms,.story-svg line.st-bpm,.story-svg line.st-prov{fill:none}
.gloss dt{font-weight:700;margin-top:.5rem}.gloss dd{margin:0;color:var(--muted)}
main{overflow-wrap:anywhere}details{margin:.4rem 0}summary{cursor:pointer}
a{color:inherit}a.ahr{text-decoration:underline dotted}.cover h3{margin:1rem 0 .3rem;font-size:1.05rem}
`;
