// SPDX-License-Identifier: MIT
import type { EvidenceSource } from "../../ports/evidence_source.ts";
import type { TmfClientConfig } from "./tmf_client.ts";
import { Tmf622ProductOrderSource, tmfConfigFromEnv } from "./tmf622_source.ts";
import { Tmf640ServiceActivationSource } from "./tmf640_source.ts";
import { Tmf641ServiceOrderSource } from "./tmf641_source.ts";

/** Where the TMF stub listens by default (`deno task stub`). */
export const DEFAULT_TMF_BASE_URL = "http://127.0.0.1:8081";

/** The connection from `FLOW_AUDIT_TMF_*`, falling back to the local stub for the base URL. */
export function tmfConfigFromEnvOrStub(get: (name: string) => string | undefined) {
  return tmfConfigFromEnv((name) =>
    name === "FLOW_AUDIT_TMF_BASE_URL" ? get(name) ?? DEFAULT_TMF_BASE_URL : get(name)
  );
}

/** The three TMF sources the audit reads over one connection. */
export function createTmfSources(config: TmfClientConfig): {
  productOrders: EvidenceSource;
  serviceOrders: EvidenceSource;
  activations: EvidenceSource;
} {
  return {
    productOrders: new Tmf622ProductOrderSource(config),
    serviceOrders: new Tmf641ServiceOrderSource(config),
    activations: new Tmf640ServiceActivationSource(config),
  };
}
