import type { Finding, ImpactConfig, OrderJourney } from "../domain/model.ts";

/** Everything a renderer is allowed to see. No analysis happens down here. */
export interface AuditReport {
  generatedAt: string;
  /** Fingerprint of dataset, config and rules, printed in the report footer. */
  runHash: string;
  config: ImpactConfig;
  findings: Finding[];
  journeys: OrderJourney[];
}

export interface ReportRenderer {
  readonly format: "html";
  render(report: AuditReport): Promise<string>;
}
