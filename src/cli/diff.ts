// SPDX-License-Identifier: MIT
import { assertFindingsFile, diffFindings, NotAFindingsFileError } from "../domain/diff.ts";
import type { AuditDiff } from "../domain/diff.ts";
import { MESSAGES as M } from "./messages.ts";

const USAGE = `flow-audit diff — compare two audits

Usage:
  deno task diff <before/findings.json> <after/findings.json>

Shows, per rule, the orders that enter or leave the finding first, then the change in the
estimate (hours, with the example rates), then what changed in the configuration or in the
rule versions. Two runs of the same data print "no differences".
A findings.json written before the complete order list only has a sample of orders per
finding; the report says so and the counts stay complete.

Exit codes:
  0  compared (differences or not)
  1  a file could not be read or is not a findings.json
  2  usage error`;

/** The plain-language lines of a comparison. */
export function diffLines(diff: AuditDiff, from: string, to: string): string[] {
  if (diff.same) return [M.diffSame(from, to)];
  const lines = [M.diffHeader(from, to)];
  for (const r of diff.rules) {
    if (!r.changed) continue;
    lines.push(M.diffRule(r.rule, r.versionFrom, r.versionTo, r.ordersFrom, r.ordersTo));
    if (r.entered.length > 0) lines.push(M.diffEntered(r.entered, r.sampled));
    if (r.left.length > 0) lines.push(M.diffLeft(r.left, r.sampled));
    if (r.hoursFrom !== r.hoursTo) {
      lines.push(M.diffHours(r.rule, r.hoursFrom, r.hoursTo));
    }
  }
  if (diff.netHoursFrom !== diff.netHoursTo) {
    lines.push(M.diffNet(diff.netHoursFrom, diff.netHoursTo));
  }
  for (const v of diff.ruleVersions) lines.push(M.diffRuleVersion(v.rule, v.from, v.to));
  for (const c of diff.config) lines.push(M.diffConfig(c.key, c.from, c.to));
  if (diff.engine) lines.push(M.diffEngine(diff.engine.from, diff.engine.to));
  if (diff.inputsDiffer) lines.push(M.diffInputs);
  return lines;
}

async function load(path: string, which: string) {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new NotAFindingsFileError(which, "it is not valid JSON");
  }
  return assertFindingsFile(value, which);
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const files = argv.filter((a) => !a.startsWith("-"));
  if (files.length !== 2 || files.length !== argv.length) {
    for (const line of M.usage("diff needs exactly two findings.json files")) console.error(line);
    return 2;
  }
  try {
    const [a, b] = [await load(files[0], files[0]), await load(files[1], files[1])];
    for (const line of diffLines(diffFindings(a, b), files[0], files[1])) console.log(line);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const line of M.error(message, null, M.nextDiff)) console.error(line);
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
