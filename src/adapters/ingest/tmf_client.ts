// SPDX-License-Identifier: MIT
/**
 * Read-only HTTP client for TM Forum list endpoints (M1-01).
 *
 * It knows three things: how to ask for a page (`offset` / `limit`), how to
 * stop (`X-Total-Count`, or a short page when the server sends none) and how to
 * fail (one error type with the URL in the message). It sends `GET` and nothing
 * else: there is no method parameter, so a write cannot be added by accident.
 *
 * Zero dependencies: `fetch` is injectable so tests never touch the network.
 */

export const DEFAULT_PAGE_SIZE = 200;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_REQUESTS = 1_000;

export interface TmfClientConfig {
  /** For example `http://127.0.0.1:8081`, no trailing path. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer <token>` when set. */
  token?: string;
  /** Per request. */
  timeoutMs?: number;
  pageSize?: number;
  /** Hard cap on requests per `list` call, so a runaway source cannot loop forever. */
  maxRequests?: number;
  fetch?: typeof fetch;
}

/** Every failure of the client: transport, HTTP status, shape, limits, cancellation. */
export class TmfError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TmfError";
  }
}

export interface TmfPage {
  /** The URL that produced these items, kept for provenance. */
  url: string;
  items: readonly unknown[];
}

export class TmfClient {
  readonly #baseUrl: string;
  readonly #token: string | undefined;
  readonly #timeoutMs: number;
  readonly #pageSize: number;
  readonly #maxRequests: number;
  readonly #fetch: typeof fetch;

  constructor(config: TmfClientConfig) {
    let base: URL;
    try {
      base = new URL(config.baseUrl);
    } catch {
      throw new TmfError(`baseUrl is not a valid URL: "${config.baseUrl}"`);
    }
    if (base.protocol !== "http:" && base.protocol !== "https:") {
      throw new TmfError(`baseUrl must be http or https, got "${base.protocol}"`);
    }
    this.#baseUrl = base.origin;
    this.#token = config.token;
    this.#timeoutMs = positive("timeoutMs", config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.#pageSize = positive("pageSize", config.pageSize ?? DEFAULT_PAGE_SIZE);
    this.#maxRequests = positive("maxRequests", config.maxRequests ?? DEFAULT_MAX_REQUESTS);
    this.#fetch = config.fetch ?? fetch;
  }

  /** Walks a collection page by page until the server says it is done. */
  async *list(path: string, signal?: AbortSignal): AsyncGenerator<TmfPage> {
    let offset = 0;
    for (let request = 1;; request++) {
      if (request > this.#maxRequests) {
        throw new TmfError(
          `request limit of ${this.#maxRequests} reached on ${path} at offset ${offset}; ` +
            `raise maxRequests or pageSize if the collection is really that large`,
        );
      }
      const url = `${this.#baseUrl}${path}?offset=${offset}&limit=${this.#pageSize}`;
      const { items, total } = await this.#get(url, signal);
      if (items.length > 0) yield { url, items };

      offset += items.length;
      const done = items.length === 0 ||
        (total !== undefined ? offset >= total : items.length < this.#pageSize);
      if (done) return;
    }
  }

  async #get(
    url: string,
    caller?: AbortSignal,
  ): Promise<{ items: unknown[]; total: number | undefined }> {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.#token !== undefined) headers.Authorization = `Bearer ${this.#token}`;

    let response: Response;
    try {
      response = await this.#fetch(url, { method: "GET", headers, signal });
    } catch (error) {
      if (caller?.aborted) throw new TmfError(`GET ${url} was cancelled`, { cause: error });
      if (timeout.aborted) {
        throw new TmfError(`GET ${url} timed out after ${this.#timeoutMs} ms`, { cause: error });
      }
      throw new TmfError(`GET ${url} failed: ${describe(error)}`, { cause: error });
    }

    if (!response.ok) {
      const detail = await errorDetail(response);
      throw new TmfError(`GET ${url} answered ${response.status}${detail}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new TmfError(`GET ${url} did not return valid JSON`, { cause: error });
    }
    if (!Array.isArray(body)) {
      throw new TmfError(`GET ${url} returned ${kind(body)}, expected a JSON array`);
    }

    const header = response.headers.get("X-Total-Count");
    let total: number | undefined;
    if (header !== null) {
      total = Number(header);
      if (!Number.isInteger(total) || total < 0) {
        throw new TmfError(`GET ${url} sent a malformed X-Total-Count: "${header}"`);
      }
    }
    return { items: body, total };
  }
}

function positive(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TmfError(`${name} must be a whole number >= 1, got ${value}`);
  }
  return value;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function kind(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}

/** The stub and most TMF servers answer errors as `{ error, status }` or `{ message }`. */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json() as Record<string, unknown>;
    const text = body.error ?? body.message ?? body.reason;
    return typeof text === "string" ? `: ${text}` : "";
  } catch {
    return "";
  }
}
