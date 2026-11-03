// SPDX-License-Identifier: MIT
import type { EvidenceSource, RawRecord } from "../../ports/evidence_source.ts";
import { TmfClient, type TmfClientConfig, TmfError } from "./tmf_client.ts";

/** TMF622 Product Ordering, standard path. The bss-oss-rust dialect is a later mapping. */
export const PRODUCT_ORDER_PATH = "/tmf-api/productOrdering/v4/productOrder";

/**
 * Product orders over HTTP as an `EvidenceSource` (M1-01).
 *
 * Each record is the order exactly as the server sent it; mapping to the
 * canonical model happens downstream. `source` is the page URL and `line` the
 * 1-based position in the whole collection, so a validation error can point at
 * the record that caused it.
 */
export class Tmf622ProductOrderSource implements EvidenceSource {
  readonly name = "TMF622 productOrder";
  readonly #client: TmfClient;
  readonly #signal: AbortSignal | undefined;

  constructor(config: TmfClientConfig, signal?: AbortSignal) {
    this.#client = new TmfClient(config);
    this.#signal = signal;
  }

  async *read(): AsyncIterable<RawRecord> {
    let line = 0;
    for await (const page of this.#client.list(PRODUCT_ORDER_PATH, this.#signal)) {
      for (const item of page.items) {
        line++;
        yield {
          system: "OMS",
          source: page.url,
          line,
          value: validateProductOrder(item, page.url, line),
        };
      }
    }
  }
}

function validateProductOrder(
  item: unknown,
  url: string,
  line: number,
): Readonly<Record<string, unknown>> {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new TmfError(`${url}: record ${line} is not a JSON object`);
  }
  const order = item as Record<string, unknown>;
  for (const field of ["id", "state", "orderDate"]) {
    if (typeof order[field] !== "string" || order[field] === "") {
      throw new TmfError(`${url}: record ${line} has no string "${field}"`);
    }
  }
  if (Number.isNaN(Date.parse(order.orderDate as string))) {
    throw new TmfError(
      `${url}: record ${line} ("${order.id}") has an invalid orderDate "${order.orderDate}"`,
    );
  }
  if (!Array.isArray(order.productOrderItem)) {
    throw new TmfError(`${url}: record ${line} ("${order.id}") has no productOrderItem array`);
  }
  return order;
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
