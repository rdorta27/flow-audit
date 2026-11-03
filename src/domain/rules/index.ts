// SPDX-License-Identifier: MIT
/**
 * The rule registry. A new rule is a new file under `domain/rules/` and one line here;
 * `runAudit` runs whatever is registered and never names a rule.
 */

import type { CorrelatedOrder } from "../correlation.ts";
import type { Finding, ImpactConfig } from "../model.ts";
import type { OrderCharge } from "../totals.ts";
import { chargesR04, detectR04, R04_ID, R04_VERSION } from "./r04.ts";

export interface Rule {
  /** For example `R04`. */
  id: string;
  /** For example `R04@1`; changes whenever the rule's logic or formula changes. */
  version: string;
  /** Returns null when the rule finds nothing to report. */
  detect(orders: readonly CorrelatedOrder[], config: ImpactConfig): Finding | null;
  /** What the rule charges to each order, so the net total can count an order once (M4-05). */
  charges(orders: readonly CorrelatedOrder[], config: ImpactConfig): OrderCharge[];
}

export const RULES: readonly Rule[] = [
  { id: R04_ID, version: R04_VERSION, detect: detectR04, charges: chargesR04 },
];
