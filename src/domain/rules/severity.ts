// SPDX-License-Identifier: MIT
import type { Severity } from "../model.ts";

/** Severity is derived from impact, never declared by hand (rules.md). */
export function severityFor(shareOfOrders: number, hoursMonth: number): Severity {
  if (shareOfOrders > 0.1 || hoursMonth > 200) return "critical";
  if (shareOfOrders > 0.02 || hoursMonth > 50) return "high";
  return "medium";
}
