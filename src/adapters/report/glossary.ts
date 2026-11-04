// SPDX-License-Identifier: MIT
/**
 * The words the report uses, with a plain name and one short meaning each (M4-07).
 * Static terms live here; the name and meaning of a rule come from its own finding, so a new
 * rule needs no entry. A code is never printed alone: the renderer pairs it with its plain name.
 */
import type { AuditReport, Finding, SystemId } from "../../domain/model.ts";

export interface GlossaryEntry {
  /** The name for a reader outside telecom. */
  plain: string;
  /** One or two short sentences. */
  means: string;
}

/** Plain names of the systems; the codes stay next to them. */
export const SYSTEM_PLAIN: Record<SystemId, string> = {
  CAT: "Product catalog",
  OMS: "Order manager",
  BPM: "Process orchestrator",
  PROV: "Activation system",
};

/** Plain names of the standard APIs (TM Forum) the sources are read from. */
export const API_PLAIN: Record<string, string> = {
  TMF622: "Product orders",
  TMF641: "Service orders",
  TMF640: "Activations",
};

export const GLOSSARY: Record<string, GlossaryEntry> = {
  CAT: { plain: SYSTEM_PLAIN.CAT, means: "Holds what can be sold and how it is activated." },
  OMS: {
    plain: SYSTEM_PLAIN.OMS,
    means: "Receives the customer's order and splits it into service orders.",
  },
  BPM: {
    plain: SYSTEM_PLAIN.BPM,
    means: "Runs the steps of each order, one after another.",
  },
  PROV: {
    plain: SYSTEM_PLAIN.PROV,
    means: "Turns the service on in the network. Each try is an activation attempt.",
  },
  TMF622: { plain: API_PLAIN.TMF622, means: "The standard way to read customer orders." },
  TMF641: {
    plain: API_PLAIN.TMF641,
    means: "The standard way to read service orders, the technical work behind an order.",
  },
  TMF640: {
    plain: API_PLAIN.TMF640,
    means: "The standard way to read activation attempts.",
  },
  order: { plain: "Order", means: "What a customer bought, as the order manager recorded it." },
  "service order": {
    plain: "Service order",
    means: "The technical work created from one order line. One line should have one.",
  },
  activation: {
    plain: "Activation",
    means: "The moment the service is switched on. A failed attempt is tried again.",
  },
  finding: {
    plain: "Finding",
    means: "One pattern the audit looked for and, when it found it, how many orders it touches.",
  },
  case: {
    plain: "Case",
    means: "One occurrence of the pattern that somebody has to deal with by hand.",
  },
  measured: {
    plain: "Measured",
    means: "Counted in the records. Orders, cases and records are measured.",
  },
  projected: {
    plain: "Projected",
    means: "A what-if worked out from the same orders and rates. It is not a promise.",
  },
  assumed: {
    plain: "Assumed",
    means: "Rests on a number somebody declared, such as minutes per case. Hours are assumed.",
  },
  suspected: {
    plain: "Suspected",
    means: "The records suggest it, but they are a snapshot, so it is not confirmed.",
  },
  assumption: {
    plain: "Assumption",
    means: "A number chosen or declared, such as minutes per case. It was not measured.",
  },
  estimate: {
    plain: "Estimate",
    means: "A figure calculated from measured counts and assumptions. Hours are estimates.",
  },
  rate_assumption: {
    plain: "Rate assumption",
    means: "The minutes per case come from a rate you can change, not from a clock.",
  },
  not_observed: {
    plain: "Not observed",
    means: "The source cannot show it, so it is not counted.",
  },
  hours: {
    plain: "Hours",
    means: "Hours of manual work per month. They are an estimate and never a loss that was booked.",
  },
  proof: {
    plain: "Proof",
    means: "The orders and records the finding rests on, so anyone can look them up.",
  },
  strong: { plain: "Strong evidence", means: "The records say it directly." },
  weak: { plain: "Weak evidence", means: "The records suggest it but do not say it directly." },
  history: { plain: "History evidence", means: "Read from dated changes, not from a snapshot." },
  confirmed: {
    plain: "Confirmed",
    means: "Every link the finding rests on is explicit, named by the record itself.",
  },
  possible: {
    plain: "Possible",
    means: "Some links were inferred by time or serial, so the finding may be wrong.",
  },
  explicit: { plain: "Explicit link", means: "A record names its parent order." },
  inferred: { plain: "Inferred link", means: "Matched by time or serial number, not by name." },
  critical: { plain: "Critical", means: "More than 10% of orders or over 200 h a month." },
  high: { plain: "High", means: "More than 2% of orders or over 50 h a month." },
  medium: { plain: "Medium", means: "Below the high thresholds." },
  recurring: { plain: "Recurring", means: "It happens again every month." },
  one_off: { plain: "One off", means: "Work done once for each case, not repeated." },
  accumulated_to_period_end: {
    plain: "Accumulated",
    means: "Grows each day until the end of the period.",
  },
  formula: {
    plain: "Formula",
    means: "How the hours are calculated: a count times minutes, divided by 60.",
  },
  net: {
    plain: "Net total",
    means: "All findings added, each order counted once, at its largest charge.",
  },
  gross: { plain: "Sum of the rules", means: "All findings added, before removing shared orders." },
  snapshot: {
    plain: "Snapshot",
    means: "The state of the records now, with no history of changes.",
  },
  synthetic: { plain: "Synthetic data", means: "Made-up orders created to test the audit." },
  simulated: {
    plain: "Simulated integration",
    means: "The systems are a stand-in, not a client's.",
  },
};

/** What each rate in `config.json` means; an unknown key falls back to its own words. */
export const INPUT_PLAIN: Record<string, string> = {
  "rates.manual_minutes": "Minutes of manual work per case",
  "rates.daily_followup_minutes": "Minutes of follow-up per day",
  "rates.cleanup_minutes": "Minutes to clean up one case",
  "rates.investigation_minutes": "Minutes to investigate one case",
  "thresholds.retry_window_hours": "Hours within which a retry counts",
  "thresholds.stuck_after_hours": "Hours after which an order counts as stuck",
  "thresholds.duplicate_window_minutes":
    "Minutes within which a second order counts as a duplicate",
  orders_per_month: "Orders per month",
};

export function inputPlain(key: string): string {
  if (INPUT_PLAIN[key]) return INPUT_PLAIN[key];
  const last = key.split(".").pop() ?? key;
  const words = last.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A rule that produced no finding is still named: what it looked for and why it is silent. */
function ruleWithoutFinding(r: AuditReport["rules"][number]): string {
  return r.outcome === "not_evaluable"
    ? `Looks for: ${r.title}. It was not evaluated in this run, which is not the same as zero findings.`
    : `Looks for: ${r.title}. It ran and found nothing in these orders.`;
}

/** A rule's entry comes from its finding: nothing here changes when a rule is added. */
export function ruleEntry(f: Finding): GlossaryEntry {
  return { plain: f.title, means: f.plainSummary };
}

export interface GlossaryRow extends GlossaryEntry {
  term: string;
}

/** Every entry the report may point to: the rules of this run first, then the static terms. */
export function glossaryFor(report: AuditReport): GlossaryRow[] {
  const rules = report.findings.map((f) => ({ term: f.id, ...ruleEntry(f) }));
  for (const r of report.rules) {
    if (!rules.some((x) => x.term === r.id)) {
      rules.push({ term: r.id, plain: r.title, means: ruleWithoutFinding(r) });
    }
  }
  const fixed = Object.entries(GLOSSARY).map(([term, e]) => ({ term, ...e }));
  return [...rules, ...fixed];
}

/** The entry for a term of this report, or null when there is none (a gap the test catches). */
export function lookup(report: AuditReport, term: string): GlossaryEntry | null {
  const f = report.findings.find((x) => x.id === term);
  if (f) return ruleEntry(f);
  const r = report.rules.find((x) => x.id === term);
  return r ? { plain: r.title, means: ruleWithoutFinding(r) } : GLOSSARY[term] ?? null;
}
