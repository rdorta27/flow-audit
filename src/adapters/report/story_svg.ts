// SPDX-License-Identifier: MIT
/**
 * The journey of one order as inline SVG (M4-07), in the site's visual language: four
 * stations in their system colours, one numbered stop per step of `journeys[].story`, the
 * path between stops, and the gap (a step the source cannot show, or where a finding starts)
 * in red. Colours come from CSS classes so the drawing follows light and dark. Pure.
 */
import type { StoryStep, SystemId } from "../../domain/model.ts";
import { SYSTEM_PLAIN } from "./glossary.ts";

const ORDER: SystemId[] = ["CAT", "OMS", "BPM", "PROV"];
const W = 420;
const LANE0 = 55;
const LANE_GAP = 103;
const TOP = 80;
const ROW = 30;
/** Extra pitch when a flag sits under the stop, so the next stop does not cover it. */
const FLAG_ROW = 48;
const DOT_R = 11;
/** Clearance a flag keeps from a neighbouring lane line. */
const FLAG_PAD = 8;
/**
 * Width reserved per character of a flag, wider than 11px system-ui, so `textLength`
 * never asks the label to be narrower than a real font would draw it.
 */
const FLAG_ADVANCE = 8;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const laneX = (s: SystemId) => LANE0 + ORDER.indexOf(s) * LANE_GAP;
const gap = (s: StoryStep) => !s.observed || s.finding !== null;
const flagText = (s: StoryStep) => s.finding ? "problem starts here" : "not seen";

function stationName(system: SystemId): string[] {
  const words = SYSTEM_PLAIN[system].split(" ");
  return words.length > 1 ? [words[0], words.slice(1).join(" ")] : words;
}

/**
 * Places a flag under its stop, centered on the lane, and keeps it off the neighbouring
 * lane lines. `textLength` is the width the drawing claims, so a wide font cannot spill.
 */
function flagBox(system: SystemId, text: string): { x: number; width: number } {
  const i = ORDER.indexOf(system);
  const center = laneX(system);
  const leftLine = i === 0 ? 0 : laneX(ORDER[i - 1]);
  const rightLine = i === ORDER.length - 1 ? W : laneX(ORDER[i + 1]);
  const left = leftLine + FLAG_PAD;
  const right = rightLine - FLAG_PAD;
  const width = Math.min(text.length * FLAG_ADVANCE, Math.max(0, right - left));
  let x = center;
  if (x - width / 2 < left) x = left + width / 2;
  if (x + width / 2 > right) x = right - width / 2;
  return { x: Math.round(x * 10) / 10, width: Math.round(width * 10) / 10 };
}

/** Draws the steps in order; `uid` keeps the SVG ids unique and carries no order id (M5-23). A step with `observed: false` or a `finding` is a gap, in red. */
export function storySvg(steps: readonly StoryStep[], orderRef: string, uid = 0): string {
  const ys: number[] = [];
  let cursor = TOP;
  for (const s of steps) {
    ys.push(cursor);
    cursor += gap(s) ? FLAG_ROW : ROW;
  }
  const height = cursor + 6;
  const desc = steps.map((s, i) =>
    `${i + 1}. ${SYSTEM_PLAIN[s.system]}: ${s.what}${s.observed ? "" : " (not seen)"}${
      s.finding ? " (problem starts here)" : ""
    }`
  ).join(" ");
  const out: string[] = [
    `<svg class="story-svg" viewBox="0 0 ${W} ${height}" role="img" ` +
    `aria-labelledby="t-${uid} d-${uid}" xmlns="http://www.w3.org/2000/svg">`,
    `<title id="t-${uid}">Journey of order ${esc(orderRef)}</title>`,
    `<desc id="d-${uid}">${esc(desc)}</desc>`,
  ];
  for (const s of ORDER) {
    const x = laneX(s);
    const cls = s.toLowerCase();
    const lines = stationName(s);
    out.push(
      `<line class="lane st-${cls}" x1="${x}" y1="52" x2="${x}" y2="${height - 4}"/>`,
      `<g class="station st-${cls}"><rect x="${x - 46}" y="4" width="92" height="44" rx="8"/>` +
        lines.map((l, i) =>
          `<text x="${x}" y="${lines.length > 1 ? 21 + i * 15 : 31}" text-anchor="middle">${
            esc(l)
          }</text>`
        ).join("") + `</g>`,
    );
  }
  steps.forEach((s, i) => {
    if (i === 0) return;
    const p = steps[i - 1];
    const bad = !s.observed || !p.observed;
    out.push(
      `<line class="hop${bad ? " gap" : ` st-${s.system.toLowerCase()}`}" x1="${
        laneX(p.system)
      }" ` +
        `y1="${ys[i - 1]}" x2="${laneX(s.system)}" y2="${ys[i]}"/>`,
    );
  });
  steps.forEach((s, i) => {
    const x = laneX(s.system);
    const cls = s.observed ? `st-${s.system.toLowerCase()}` : "gap";
    out.push(
      `<g class="stop ${cls}${s.finding ? " problem" : ""}">` +
        (s.finding ? `<circle class="ring" cx="${x}" cy="${ys[i]}" r="16"/>` : "") +
        `<circle class="dot" cx="${x}" cy="${ys[i]}" r="${DOT_R}"/>` +
        `<text x="${x}" y="${ys[i] + 4}" text-anchor="middle">${i + 1}</text></g>`,
    );
    if (gap(s)) {
      const text = flagText(s);
      const box = flagBox(s.system, text);
      out.push(
        `<text class="flag" x="${box.x}" y="${ys[i] + DOT_R + 14}" text-anchor="middle" ` +
          `textLength="${box.width}" lengthAdjust="spacingAndGlyphs">${esc(text)}</text>`,
      );
    }
  });
  out.push("</svg>");
  return out.join("");
}
