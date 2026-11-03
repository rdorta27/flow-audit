// SPDX-License-Identifier: MIT
import type { TmfClientConfig } from "./tmf_client.ts";
import { TmfError } from "./tmf_client.ts";
import { TmfListSource, validateOrderEnvelope } from "./tmf_list_source.ts";

/** TMF622 Product Ordering, standard path. The bss-oss-rust dialect is a later mapping. */
export const PRODUCT_ORDER_PATH = "/tmf-api/productOrdering/v4/productOrder";

/** Product orders over HTTP as an `EvidenceSource` (M1-01). */
export class Tmf622ProductOrderSource extends TmfListSource {
  readonly name = "TMF622 productOrder";

  constructor(config: TmfClientConfig, signal?: AbortSignal) {
    super(config, signal, PRODUCT_ORDER_PATH, "OMS", (item, url, line) => {
      const order = validateOrderEnvelope(item, url, line);
      if (!Array.isArray(order.productOrderItem)) {
        throw new TmfError(`${url}: record ${line} ("${order.id}") has no productOrderItem array`);
      }
      return order;
    });
  }
}

/** Reads the connection from environment variables, so the token never appears in argv. */
export function tmfConfigFromEnv(get: (name: string) => string | undefined): TmfClientConfig {
  const baseUrl = get("FLOW_AUDIT_TMF_BASE_URL");
  if (!baseUrl) {
    throw new TmfError("FLOW_AUDIT_TMF_BASE_URL is not set, for example http://127.0.0.1:8081");
  }
  const number = (name: string): number | undefined => {
    const raw = get(name);
    if (raw === undefined || raw === "") return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      throw new TmfError(`${name} must be a whole number, got "${raw}"`);
    }
    return value;
  };
  return {
    baseUrl,
    token: get("FLOW_AUDIT_TMF_TOKEN") || undefined,
    timeoutMs: number("FLOW_AUDIT_TMF_TIMEOUT_MS"),
    pageSize: number("FLOW_AUDIT_TMF_PAGE_SIZE"),
    maxRequests: number("FLOW_AUDIT_TMF_MAX_REQUESTS"),
  };
}
