// SPDX-License-Identifier: MIT
/**
 * Confidential mode (M5-12). `--redact` replaces every id the input carries (orders, service
 * orders, work orders, processes, attempts, terminal serials) by a stable pseudonym:
 * `HMAC-SHA256(secret, id)`, shortened, with a prefix that says what kind of id it was. The
 * same input and the same secret give the same pseudonyms; a new secret gives new ones. The
 * equivalence table (pseudonym, original) is written apart and is never part of a report.
 *
 * The replacement works on the final text of each output (findings.json, findings.csv,
 * report.html, quality.json), so no renderer needs to know about it. A token is replaced
 * only when it is a whole id, never when it is part of a longer word.
 */

export type IdKind = "order" | "serial" | "record";

export interface Pseudonym {
  pseudonym: string;
  original: string;
  kind: IdKind;
}

/** Keys whose string values are ids of the input, with the kind of id each one is. */
const ID_KEYS: Record<string, IdKind> = {
  orderRef: "order",
  order_ref: "order",
  replacesOrderRef: "order",
  supersededByOrderRef: "order",
  serial: "serial",
  terminalSerial: "serial",
  soRef: "record",
  woRef: "record",
  processId: "record",
  businessKey: "record",
  parentProcessId: "record",
  rootProcessId: "record",
  attemptId: "record",
  requestId: "record",
  productOrderItemRef: "record",
  itemRefs: "record",
  eventIds: "record",
  externalId: "record",
  taskId: "record",
};

/** Collects the ids found under the known id keys of any nested value; also order-keyed maps. */
export function collectIds(
  value: unknown,
  into: Map<string, IdKind> = new Map(),
  inheritedKind: IdKind | null = null,
  seen = new Set<unknown>(),
): Map<string, IdKind> {
  if (typeof value === "string") {
    if (inheritedKind && value !== "" && !into.has(value)) into.set(value, inheritedKind);
    return into;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return into;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, into, inheritedKind, seen);
    return into;
  }
  for (const [key, child] of Object.entries(value)) {
    const kind = ID_KEYS[key] ?? null;
    // `overlap.byOrder` is keyed by order id.
    if (key === "byOrder" && child && typeof child === "object") {
      for (const order of Object.keys(child)) if (!into.has(order)) into.set(order, "order");
    }
    collectIds(child, into, kind, seen);
  }
  return into;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const PREFIX: Record<IdKind, string> = { order: "ord", serial: "ser", record: "ref" };
const SIMPLE = /^[A-Za-z0-9_.:-]+$/;
const TOKEN = /[A-Za-z0-9_.:-]+/g;
const TRAILING = /[.:-]+$/;

export class Redactor {
  private constructor(readonly entries: readonly Pseudonym[]) {
    for (const e of entries) {
      if (SIMPLE.test(e.original)) this.simple.set(e.original, e.pseudonym);
      else this.odd.push(e);
    }
    this.odd.sort((a, b) => b.original.length - a.original.length);
  }
  private simple = new Map<string, string>();
  private odd: Pseudonym[] = [];

  /** Builds the pseudonyms for the ids; the secret must not be empty. */
  static async create(ids: ReadonlyMap<string, IdKind>, secret: string): Promise<Redactor> {
    if (secret === "") throw new Error("the redaction secret is empty");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const taken = new Set<string>();
    const out: Pseudonym[] = [];
    // Sorted, so a collision is resolved the same way on every run.
    for (const [original, kind] of [...ids].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const mac = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(original)),
      );
      let length = 10;
      let pseudonym = `${PREFIX[kind]}-${hex(mac).slice(0, length)}`;
      while (taken.has(pseudonym) && length < 64) {
        length += 2;
        pseudonym = `${PREFIX[kind]}-${hex(mac).slice(0, length)}`;
      }
      taken.add(pseudonym);
      out.push({ pseudonym, original, kind });
    }
    return new Redactor(out);
  }

  /** Replaces every whole id in the text. */
  text(input: string): string {
    let result = input.replace(TOKEN, (token) => {
      const direct = this.simple.get(token);
      if (direct) return direct;
      const trimmed = token.replace(TRAILING, "");
      if (trimmed !== token) {
        const hit = this.simple.get(trimmed);
        if (hit) return hit + token.slice(trimmed.length);
      }
      return token;
    });
    for (const e of this.odd) result = result.split(e.original).join(e.pseudonym);
    return result;
  }

  /** The equivalence table as CSV: keep it apart from the report. */
  tableCsv(): string {
    const q = (v: string) => /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
    return [
      "pseudonym,original,kind",
      ...this.entries.map((e) => [e.pseudonym, e.original, e.kind].map(q).join(",")),
    ].join("\n") + "\n";
  }
}

/** A fresh secret for a run that did not bring one: 32 random bytes. */
export function randomSecret(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Puts the banner "Confidential — <client>" with the date at the top of a finished HTML
 * report. It works on the text, so the renderer is untouched; the page's own styles do not
 * reach it, hence the inline style.
 */
export function addConfidentialBanner(html: string, client: string, date: string): string {
  const banner = `<div role="note" style="background:#7a1f1f;color:#fff;font:600 14px/1.4 ` +
    `system-ui,sans-serif;padding:8px 16px;text-align:center">Confidential — ` +
    `${escapeHtml(client)} · ${escapeHtml(date)}</div>`;
  const body = /<body[^>]*>/i.exec(html);
  if (!body) return banner + html;
  const at = body.index + body[0].length;
  return html.slice(0, at) + banner + html.slice(at);
}
