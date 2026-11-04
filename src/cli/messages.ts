// SPDX-License-Identifier: MIT
/**
 * Everything the CLI says, in one table (M5-18). A message is a function from facts to a
 * plain line, so a translation (backlog L-01) replaces this file and nothing else. Figures
 * are hours. No message carries a stack trace.
 */

const n = (value: number) => value.toLocaleString("en-US");
const hours = (value: number) => `${n(Math.round(value * 10) / 10)} h`;
const plural = (count: number, one: string, many = `${one}s`) =>
  `${n(count)} ${count === 1 ? one : many}`;

export const MESSAGES = {
  // Stages, one plain line each.
  readingFiles: (dir: string) => `reading the exports in ${dir}`,
  readingSource: (url: string) => `reading from ${url}`,
  readFile: (file: string, rows: number) => `read ${plural(rows, "row")} from ${file}`,
  readOrders: (orders: number, serviceOrders: number, activations: number) =>
    `read ${plural(orders, "order")}, ${plural(serviceOrders, "service order")} and ${
      plural(activations, "activation")
    }`,
  joined: (orders: number, sure: number, inferred: number, notJoined: number) =>
    `joined ${plural(orders, "order")}: ${plural(sure, "link")} sure, ${n(inferred)} inferred, ${
      n(notJoined)
    } not joined`,
  gatePassed: (warnings: number) =>
    warnings === 0 ? "gate passed" : `gate passed with ${plural(warnings, "warning")}`,
  gateFailed: (problems: number) => `gate failed: ${plural(problems, "problem")}`,
  gateForced: (problems: number) =>
    `gate failed: ${plural(problems, "problem")}; running anyway because of --force`,
  ruleFound: (version: string, orders: number, hoursMonth: number) =>
    `${version} found ${plural(orders, "order")} (estimate ${
      hours(hoursMonth)
    } with the example rates)`,
  ruleNone: (version: string) => `${version} found nothing`,
  ruleNotEvaluable: (rule: string, reason: string) =>
    `${rule} not evaluated: ${reason}; this is not "0 findings"`,
  wrote: (path: string) => `wrote ${path}`,
  checked: "check finished: nothing was audited and no rule was run",

  // Result lines on stdout.
  noFindings: "No findings.",
  qualityHeader: (passed: boolean, forced: boolean) =>
    `Quality gate: ${passed ? "passed" : forced ? "FAILED (forced)" : "FAILED"}`,
  qualitySystem: (
    system: string,
    label: string,
    rows: number,
    range: string,
    coverage: string,
    extra: string[],
  ) =>
    `Quality ${system} ${label}: ${plural(rows, "record")} · ${range} · window covered ${coverage}${
      extra.length ? ` · ${extra.join(" · ")}` : ""
    }`,
  qualityRepeats: (keys: number, exact: number) =>
    `${plural(keys, "repeated record")} dropped by key (${n(exact)} identical)`,
  qualityOrphans: (orphans: number, children: number) =>
    `${n(orphans)} of ${n(children)} with no parent`,
  qualityUnknown: (list: string) => `states not in the mapping: ${list}`,
  qualityProblem: (text: string) => `Problem: ${text}`,
  qualityWarning: (text: string) => `Warning: ${text}`,
  qualityNotEvaluable: (rule: string, reason: string) => `Not evaluable: ${rule}: ${reason}`,

  // `diff` (M5-14): orders first, then the estimate, then configuration and versions.
  diffSame: (a: string, b: string) => `No differences between ${a} and ${b}.`,
  diffHeader: (a: string, b: string) => `Differences between ${a} (before) and ${b} (after)`,
  diffRule: (rule: string, from: string | null, to: string | null, before: number, after: number) =>
    `${rule}${from !== to ? ` (${from ?? "not reported"} -> ${to ?? "not reported"})` : ""}: ` +
    `${plural(before, "order")} before, ${plural(after, "order")} after ` +
    `(${after - before >= 0 ? "+" : "-"}${n(Math.abs(after - before))})`,
  diffEntered: (orders: string[], sampled: boolean) =>
    `  enter: ${orders.join(", ")}${sampled ? " (from the sample the file lists)" : ""}`,
  diffLeft: (orders: string[], sampled: boolean) =>
    `  leave: ${orders.join(", ")}${sampled ? " (from the sample the file lists)" : ""}`,
  diffHours: (rule: string, from: number, to: number) =>
    `  estimate ${rule}: ${hours(from)} -> ${hours(to)} (${to - from >= 0 ? "+" : "-"}${
      hours(Math.abs(to - from))
    }, example rates)`,
  diffNet: (from: number, to: number) =>
    `Estimate, each order once: ${hours(from)} -> ${hours(to)} (${to - from >= 0 ? "+" : "-"}${
      hours(Math.abs(to - from))
    })`,
  diffRuleVersion: (rule: string, from: string | null, to: string | null) =>
    `Rule version ${rule}: ${from ?? "not reported"} -> ${to ?? "not reported"}`,
  diffConfig: (key: string, from: unknown, to: unknown) =>
    `Config ${key}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`,
  diffEngine: (from: string, to: string) => `Engine version: ${from} -> ${to}`,
  diffInputs: "The records read are not the same (their fingerprints differ).",
  nextDiff: "pass two findings.json files written by `deno task audit --out <dir>`",

  // Errors: what happened, where, what to do next.
  error: (what: string, where: string | null, next: string): string[] => [
    `flow-audit: error: ${what}`,
    ...(where ? [`  where: ${where}`] : []),
    `  next:  ${next}`,
  ],
  nextMissingFile:
    "check that --dataset points at the folder with the exports and that the file names in the mapping (`file`) match",
  nextUnknownState: (table: string) =>
    `add the value to states.${table} in the mapping, or set on_unknown_state to "unmapped" to keep the row and see it in the gate`,
  nextBadRow:
    "fix that line in the export, or correct the column name or date_format in the mapping",
  nextMapping: "fix the mapping file; docs/architecture/mapping.md lists every field",
  nextConfig: "fix the config file or omit --config to use data/demo/config.json",
  nextTmf: "is the source running? start it with `deno task stub`",
  nextOut: "create the directory first, or choose another one with --out",
  nextGate:
    "fix the export and run again, or run with --force to audit it anyway (the answer says it was forced)",
  nextUnknown: "run `deno task audit --help`; if it persists, keep the message above and report it",
  gateFailedWhat: (problems: number) =>
    `the data failed the quality gate (${plural(problems, "problem")})`,
  usage: (why: string) => [`flow-audit: ${why}`, "Run `deno task audit --help` for usage."],
};
