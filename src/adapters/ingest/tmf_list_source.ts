// SPDX-License-Identifier: MIT
import type { EvidenceSource, RawRecord } from "../../ports/evidence_source.ts";
import type { SystemId } from "../../domain/model.ts";
import { TmfClient, type TmfClientConfig, TmfError } from "./tmf_client.ts";

/** Checks one record; throws `TmfError` naming the URL and position when it is malformed. */
export type RecordValidator = (
  item: unknown,
  url: string,
  line: number,
) => Readonly<Record<string, unknown>>;

/**
 * An `EvidenceSource` over one TMF collection. Each record is the resource exactly as
 * the server sent it; mapping to the canonical model happens downstream. `source` is
 * the page URL and `line` the 1-based position in the whole collection, so a
 * validation error can point at the record that caused it.
 */
export abstract class TmfListSource implements EvidenceSource {
  abstract readonly name: string;
  readonly #client: TmfClient;
  readonly #signal: AbortSignal | undefined;

  constructor(
    config: TmfClientConfig,
    signal: AbortSignal | undefined,
    private readonly path: string,
    private readonly system: SystemId,
    private readonly validate: RecordValidator,
  ) {
    this.#client = new TmfClient(config);
    this.#signal = signal;
  }

  async *read(): AsyncIterable<RawRecord> {
    let line = 0;
    for await (const page of this.#client.list(this.path, this.#signal)) {
      for (const item of page.items) {
        line++;
        const value = this.validate(item, page.url, line);
        yield {
          system: this.system,
          source: page.url,
          line,
          value,
          provenance: {
            externalId: String(value.id),
            endpoint: page.endpoint,
            retrievedAt: page.retrievedAt,
            simulated: page.simulated,
          },
        };
      }
    }
  }
}

/** The part every order shares: an object with string `id`, `state` and a parseable `orderDate`. */
export function validateOrderEnvelope(
  item: unknown,
  url: string,
  line: number,
): Record<string, unknown> {
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
  return order;
}
