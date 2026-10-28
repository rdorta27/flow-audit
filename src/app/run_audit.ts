// SPDX-License-Identifier: MIT
import type { Finding, OrderJourney } from "../domain/model.ts";
import type { Clock } from "../ports/clock.ts";
import type { CatalogSource } from "../ports/catalog_source.ts";
import type { EvidenceSource } from "../ports/evidence_source.ts";

export interface AuditOptions {
  /** Directory with the four exports. */
  dataset?: string;
  lang: "en" | "es";
}

export interface AuditDeps {
  evidence?: EvidenceSource;
  catalog?: CatalogSource;
  clock: Clock;
}

export interface AuditResult {
  eventCount: number;
  journeys: OrderJourney[];
  findings: Finding[];
}

export class NoEvidenceSourceError extends Error {
  constructor() {
    super(
      "no evidence source configured. This is a walking skeleton: the ingest " +
        "adapters arrive in milestone M1, so there is nothing to audit yet.",
    );
    this.name = "NoEvidenceSourceError";
  }
}

/**
 * The only entry point of the application. The walking skeleton wires the
 * pipeline and stops at ingestion; reconstruction and rules arrive in
 * milestones M2 and M3.
 */
export async function runAudit(
  _options: AuditOptions,
  deps: AuditDeps,
): Promise<AuditResult> {
  if (!deps.evidence) {
    throw new NoEvidenceSourceError();
  }

  let eventCount = 0;
  for await (const _record of deps.evidence.read()) {
    eventCount++;
  }

  return { eventCount, journeys: [], findings: [] };
}
