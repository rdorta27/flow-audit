// SPDX-License-Identifier: MIT
import type { TmfClientConfig } from "./tmf_client.ts";
import { TmfError } from "./tmf_client.ts";
import { TmfListSource } from "./tmf_list_source.ts";

/** TMF640 Service Activation and Configuration, standard path. */
export const SERVICE_ACTIVATION_PATH =
  "/tmf-api/serviceActivationAndConfiguration/v4/serviceActivation";

/**
 * Provisioning activation attempts over HTTP as an `EvidenceSource` (M1-05b).
 *
 * Unlike a service order, an activation **may have no link** to its service order: the
 * attempt that only carries a terminal serial is exactly what R05 reports. So a missing
 * `serviceOrder` is kept as it is, not rejected; correlation (M2-02) labels it `missing`.
 * A link that is present must be well formed, because a half-link would be misread.
 */
export class Tmf640ServiceActivationSource extends TmfListSource {
  readonly name = "TMF640 serviceActivation";

  constructor(config: TmfClientConfig, signal?: AbortSignal) {
    super(config, signal, SERVICE_ACTIVATION_PATH, "PROV", (item, url, line) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new TmfError(`${url}: record ${line} is not a JSON object`);
      }
      const activation = item as Record<string, unknown>;
      for (const field of ["id", "state", "activationDate"]) {
        if (typeof activation[field] !== "string" || activation[field] === "") {
          throw new TmfError(`${url}: record ${line} has no string "${field}"`);
        }
      }
      for (const field of ["activationDate", "completionDate"]) {
        const value = activation[field];
        if (value !== undefined && Number.isNaN(Date.parse(String(value)))) {
          throw new TmfError(
            `${url}: record ${line} ("${activation.id}") has an invalid ${field} "${value}"`,
          );
        }
      }
      const link = activation.serviceOrder as { id?: unknown } | undefined;
      if (link !== undefined && (typeof link?.id !== "string" || link.id === "")) {
        throw new TmfError(
          `${url}: record ${line} ("${activation.id}") has a serviceOrder link with no id`,
        );
      }
      return activation;
    });
  }
}
