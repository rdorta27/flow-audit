// SPDX-License-Identifier: MIT
import type { TmfClientConfig } from "./tmf_client.ts";
import { TmfError } from "./tmf_client.ts";
import { TmfListSource, validateOrderEnvelope } from "./tmf_list_source.ts";

/** TMF641 Service Ordering, standard path. */
export const SERVICE_ORDER_PATH = "/tmf-api/serviceOrdering/v4/serviceOrder";

/**
 * Service orders over HTTP as an `EvidenceSource` (M1-05a).
 *
 * Every `serviceOrderItem` must carry `productOrderItem.productOrderId` and
 * `productOrderItem.id`: that explicit item link is what R04 correlates on (the stub
 * adds it; TMF641 v4 itself defines none, see ADR 0003). A server that does not send it
 * fails here with a clear message instead of producing orders that silently correlate
 * with nothing.
 */
export class Tmf641ServiceOrderSource extends TmfListSource {
  readonly name = "TMF641 serviceOrder";

  constructor(config: TmfClientConfig, signal?: AbortSignal) {
    super(config, signal, SERVICE_ORDER_PATH, "OMS", (item, url, line) => {
      const order = validateOrderEnvelope(item, url, line);
      if (!Array.isArray(order.serviceOrderItem)) {
        throw new TmfError(`${url}: record ${line} ("${order.id}") has no serviceOrderItem array`);
      }
      order.serviceOrderItem.forEach((entry: unknown, index: number) => {
        const link = (entry as { productOrderItem?: Record<string, unknown> } | null)
          ?.productOrderItem;
        if (
          typeof link?.id !== "string" || typeof link?.productOrderId !== "string" ||
          link.id === "" || link.productOrderId === ""
        ) {
          throw new TmfError(
            `${url}: record ${line} ("${order.id}") item ${index + 1} has no ` +
              `productOrderItem {id, productOrderId} link to a product order`,
          );
        }
      });
      return order;
    });
  }
}
