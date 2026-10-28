// SPDX-License-Identifier: MIT
/**
 * The stub's HTTP behavior, as a pure request → response function (M0-11).
 *
 * No server lives here: `createHandler` takes the derived state and returns a
 * handler that tests can call directly (no socket, no ephemeral port), while
 * `main.ts` wires the same handler into `Deno.serve`. Behavior:
 *
 * - GET only; every other method answers 405 with an `Allow: GET` header.
 * - Collections paginate with `offset` (default 0) and `limit` (default 50,
 *   maximum 200); invalid values answer 400. Lists carry `X-Total-Count`
 *   (whole collection after filtering) and `X-Result-Count` (this page).
 * - `?state=<TMF state>` filters collections on the derived end-of-window
 *   state; that is the only filter.
 * - Detail by id; unknown ids answer 404. Every non-2xx body is the same JSON
 *   shape `{ "error": <message>, "status": <code> }`.
 * - Setting `bearerToken` turns on an `Authorization: Bearer` check (the
 *   adapter's auth path); unset, no auth is required.
 * - Every response marks itself `X-Flow-Audit-Source: simulated`.
 * - Deterministic: same dataset, same bytes, same order (the dataset's own).
 */

import type { StubState } from "./mapping.ts";
import { PRODUCT_ORDER_PATH, SERVICE_ACTIVATION_PATH, SERVICE_ORDER_PATH } from "./mapping.ts";
import type { StubError, TmfProductOrder, TmfServiceActivation, TmfServiceOrder } from "./tmf.ts";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const SIMULATED_HEADER = "X-Flow-Audit-Source: simulated";

export interface StubOptions {
  state: StubState;
  /** When set, every request must present `Authorization: Bearer <token>`. */
  bearerToken?: string;
}

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Flow-Audit-Source": "simulated",
      ...(headers ?? {}),
    },
  });
}

function errorResponse(message: string, status: number, headers?: HeadersInit): Response {
  const body: StubError = { error: message, status };
  return jsonResponse(body, status, headers);
}

function page<T>(all: readonly T[], url: URL): { page: T[]; total: number } {
  const offsetRaw = url.searchParams.get("offset") ?? "0";
  const limitRaw = url.searchParams.get("limit") ?? String(DEFAULT_LIMIT);
  const offset = Number(offsetRaw);
  const limit = Number(limitRaw);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadQuery(`offset must be a whole number >= 0, got "${offsetRaw}"`);
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new BadQuery(`limit must be a whole number >= 1, got "${limitRaw}"`);
  }
  if (limit > MAX_LIMIT) {
    throw new BadQuery(`limit ${limit} exceeds the maximum of ${MAX_LIMIT}`);
  }
  return { page: all.slice(offset, offset + limit), total: all.length };
}

class BadQuery extends Error {}

interface Collection {
  states: Set<string>;
  list: readonly (TmfProductOrder | TmfServiceOrder | TmfServiceActivation)[];
}

export function createHandler(
  options: StubOptions,
): (request: Request) => Promise<Response> {
  const { state } = options;
  const collections = new Map<string, Collection>([
    [PRODUCT_ORDER_PATH, {
      list: state.productOrders,
      states: new Set(state.productOrders.map((o) => o.state)),
    }],
    [SERVICE_ORDER_PATH, {
      list: state.serviceOrders,
      states: new Set(state.serviceOrders.map((o) => o.state)),
    }],
    [SERVICE_ACTIVATION_PATH, {
      list: state.activations,
      states: new Set(state.activations.map((o) => o.state)),
    }],
  ]);

  return async (request: Request): Promise<Response> => {
    if (options.bearerToken !== undefined) {
      const expected = `Bearer ${options.bearerToken}`;
      if (request.headers.get("Authorization") !== expected) {
        return errorResponse(
          "missing or invalid bearer token; this stub requires Authorization: Bearer <token>",
          401,
        );
      }
    }

    if (request.method !== "GET") {
      return errorResponse(`method ${request.method} is not allowed; the stub is read-only`, 405, {
        Allow: "GET",
      });
    }

    const url = new URL(request.url);
    for (const [basePath, collection] of collections) {
      if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) continue;

      const id = url.pathname === basePath
        ? undefined
        : decodeURIComponent(url.pathname.slice(basePath.length + 1));
      if (id === undefined) {
        const filtered = filterByState(collection, url.searchParams.get("state"));
        try {
          const { page: rows, total } = page(filtered, url);
          return jsonResponse(rows, 200, {
            "X-Total-Count": String(total),
            "X-Result-Count": String(rows.length),
          });
        } catch (error) {
          if (error instanceof BadQuery) return errorResponse(error.message, 400);
          throw error;
        }
      }

      const found = collection.list.find((resource) => resource.id === id);
      if (!found) {
        return errorResponse(`no resource with id ${id} under ${basePath}`, 404);
      }
      return jsonResponse(found, 200);
    }

    return errorResponse(`no stub collection at ${url.pathname}`, 404);
  };
}

function filterByState(
  collection: Collection,
  state: string | null,
): readonly (TmfProductOrder | TmfServiceOrder | TmfServiceActivation)[] {
  if (state === null || state === "") return collection.list;
  return collection.list.filter((resource) => resource.state === state);
}
