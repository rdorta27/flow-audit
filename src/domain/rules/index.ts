// SPDX-License-Identifier: MIT
/**
 * The rule registry. A new rule is a new file under `domain/rules/` and one line here;
 * `runAudit` runs whatever is registered and never names a rule.
 */

import type { CorrelatedOrder, CorrelationResult } from "../correlation.ts";
import type { Catalog, Finding, ImpactConfig } from "../model.ts";
import type { OrderCharge } from "../totals.ts";
import { chargesR01, detectR01, R01_ID, R01_TITLE, R01_VERSION } from "./r01.ts";
import { chargesR02, detectR02, R02_ID, R02_TITLE, R02_VERSION } from "./r02.ts";
import { chargesR03, detectR03, R03_ID, R03_TITLE, R03_VERSION } from "./r03.ts";
import { chargesR04, detectR04, R04_ID, R04_TITLE, R04_VERSION } from "./r04.ts";
import { chargesR05, detectR05, R05_ID, R05_TITLE, R05_VERSION } from "./r05.ts";

/** What a rule may read besides the orders: the whole correlation and the catalog, if any. */
export interface RuleContext {
  correlation?: CorrelationResult;
  catalog?: Catalog;
}

export interface Rule {
  /** For example `R04`. */
  id: string;
  /** The name of the rule, the same as its finding's title. */
  title: string;
  /** For example `R04@2`; changes whenever the rule's logic or formula changes. */
  version: string;
  /** Returns null when the rule finds nothing to report. */
  detect(
    orders: readonly CorrelatedOrder[],
    config: ImpactConfig,
    context?: RuleContext,
  ): Finding | null;
  /** What the rule charges to each order, so the net total can count an order once (M4-05). */
  charges(
    orders: readonly CorrelatedOrder[],
    config: ImpactConfig,
    context?: RuleContext,
  ): OrderCharge[];
}

export const RULES: readonly Rule[] = [
  { id: R01_ID, title: R01_TITLE, version: R01_VERSION, detect: detectR01, charges: chargesR01 },
  { id: R02_ID, title: R02_TITLE, version: R02_VERSION, detect: detectR02, charges: chargesR02 },
  { id: R03_ID, title: R03_TITLE, version: R03_VERSION, detect: detectR03, charges: chargesR03 },
  { id: R04_ID, title: R04_TITLE, version: R04_VERSION, detect: detectR04, charges: chargesR04 },
  { id: R05_ID, title: R05_TITLE, version: R05_VERSION, detect: detectR05, charges: chargesR05 },
];
