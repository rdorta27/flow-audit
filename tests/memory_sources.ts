// SPDX-License-Identifier: MIT
/** Test helper: evidence sources over domain objects already built, with no file or socket. */

import type { AuditSources } from "../src/app/run_audit.ts";
import type {
  Order,
  ProcessInstance,
  ProvisioningAttempt,
  ServiceOrder,
} from "../src/domain/model.ts";
import type { EvidenceSource, RawRecord } from "../src/ports/evidence_source.ts";

function source(name: string, system: RawRecord["system"], items: object[]): EvidenceSource {
  return {
    name,
    async *read() {
      for (const [index, item] of items.entries()) {
        yield {
          system,
          source: name,
          line: index + 1,
          value: item as RawRecord["value"],
          provenance: {
            externalId: String(index),
            endpoint: name,
            retrievedAt: "2026-09-30T00:00:00.000Z",
            simulated: true,
            kind: "history",
          },
        };
      }
    },
  };
}

export interface MemoryData {
  orders: Order[];
  serviceOrders: ServiceOrder[];
  attempts: ProvisioningAttempt[];
  processes?: ProcessInstance[];
}

/** Sources that serve the given objects as they are; the mappers hand them back unchanged. */
export function memorySources(
  data: MemoryData,
  extra: Partial<AuditSources> = {},
): AuditSources {
  return {
    productOrders: source("memory orders", "OMS", data.orders),
    serviceOrders: source("memory service orders", "OMS", data.serviceOrders),
    activations: source("memory attempts", "PROV", data.attempts),
    processes: data.processes ? source("memory processes", "BPM", data.processes) : undefined,
    mappers: {
      order: (r) => r.value as unknown as Order,
      serviceOrder: (r) => r.value as unknown as ServiceOrder,
      attempt: (r) => r.value as unknown as ProvisioningAttempt,
      process: (r) => r.value as unknown as ProcessInstance,
    },
    ...extra,
  };
}
