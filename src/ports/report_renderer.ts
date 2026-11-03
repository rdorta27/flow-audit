// SPDX-License-Identifier: MIT
import type { AuditReport } from "../domain/model.ts";

/**
 * Everything a renderer is allowed to see. `AuditReport` is the `findings/1` schema
 * (`docs/architecture/report-schema.md`); no analysis happens down here.
 */
export type { AuditReport };

export interface ReportRenderer {
  readonly format: "html";
  render(report: AuditReport): Promise<string>;
}
