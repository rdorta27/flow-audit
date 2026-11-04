// SPDX-License-Identifier: MIT
/**
 * The edge between the data files and the engine (M4-06, D-14): `config.json` and
 * `catalog.json` use snake_case keys; the types inside the engine stay camelCase. These are the
 * only functions that translate between the two. Pure: no I/O.
 */

import type { Catalog, ImpactConfig, ParameterMeta, ParameterSource } from "./model.ts";

const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function mapKeys(value: unknown, rename: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => mapKeys(v, rename));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [rename(key), mapKeys(child, rename)]),
    );
  }
  return value;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const SOURCES: readonly string[] = ["client", "benchmark", "assumption", "example"];

/**
 * A rate or threshold is a number, or an object with `base` (or `value`) and optionally `low`,
 * `high`, `source`, `owner`, `date` (M5-07). Returns the base number and what else it says.
 */
function parameter(key: string, raw: unknown): { base: number; meta?: ParameterMeta } {
  if (typeof raw === "number" && Number.isFinite(raw)) return { base: raw };
  if (!isObj(raw)) throw new Error(`${key} must be a number or an object with a base value`);
  const base = raw.base ?? raw.value;
  const num = (name: string, v: unknown): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`${key}.${name} must be a number`);
    }
    return v;
  };
  const b = num("base", base);
  const meta: ParameterMeta = {};
  if (raw.low !== undefined) meta.low = num("low", raw.low);
  if (raw.high !== undefined) meta.high = num("high", raw.high);
  if ((meta.low ?? b) > b || (meta.high ?? b) < b) {
    throw new Error(`${key} must satisfy low <= base <= high`);
  }
  if (raw.source !== undefined) {
    if (typeof raw.source !== "string" || !SOURCES.includes(raw.source)) {
      throw new Error(`${key}.source must be one of ${SOURCES.join(", ")}`);
    }
    meta.source = raw.source as ParameterSource;
  }
  for (const f of ["owner", "date"] as const) {
    if (raw[f] === undefined) continue;
    if (typeof raw[f] !== "string") throw new Error(`${key}.${f} must be a string`);
    meta[f] = raw[f] as string;
  }
  return { base: b, meta };
}

/** Parsed `config.json` (snake_case) to the engine's `ImpactConfig`. Throws when it is not one. */
export function configFromFile(raw: unknown): ImpactConfig {
  if (!isObj(raw)) throw new Error("the config is not an object");
  if (!isObj(raw.rates) || !isObj(raw.thresholds)) {
    throw new Error("missing rates or thresholds");
  }
  const parameters: Record<string, ParameterMeta> = {};
  const flat = (group: "rates" | "thresholds") =>
    Object.fromEntries(
      Object.entries(raw[group] as Record<string, unknown>).map(([k, v]) => {
        const p = parameter(`${group}.${k}`, v);
        if (p.meta && Object.keys(p.meta).length > 0) parameters[`${group}.${k}`] = p.meta;
        return [k, p.base];
      }),
    );
  const config = mapKeys(
    { ...raw, rates: flat("rates"), thresholds: flat("thresholds") },
    toCamel,
  ) as ImpactConfig;
  if (Object.keys(parameters).length > 0) config.parameters = parameters;
  return config;
}

/** The engine's config as the snake_case object that `config.json` and `findings.json` carry. */
export function configToFile(config: ImpactConfig): Record<string, unknown> {
  const { parameters, ...rest } = config;
  const file = mapKeys(rest, toSnake) as Record<string, Record<string, unknown>>;
  for (const [key, meta] of Object.entries(parameters ?? {})) {
    const [group, name] = key.split(".");
    const base = file[group]?.[name];
    if (base === undefined) continue;
    // Keys in the order a person reads them: low, base, high, then who said so.
    file[group][name] = {
      ...(meta.low !== undefined ? { low: meta.low } : {}),
      base,
      ...(meta.high !== undefined ? { high: meta.high } : {}),
      ...(meta.source !== undefined ? { source: meta.source } : {}),
      ...(meta.owner !== undefined ? { owner: meta.owner } : {}),
      ...(meta.date !== undefined ? { date: meta.date } : {}),
    };
  }
  return file;
}

/** Parsed `catalog.json` (snake_case) to the engine's `Catalog`. Throws when it is not one. */
export function catalogFromFile(raw: unknown): Catalog {
  if (!isObj(raw) || !Array.isArray(raw.offers) || !Array.isArray(raw.specs)) {
    throw new Error("the catalog needs offers and specs");
  }
  return mapKeys(raw, toCamel) as Catalog;
}

/** The engine's catalog as the snake_case object that `catalog.json` carries. */
export function catalogToFile(catalog: Catalog): Record<string, unknown> {
  return mapKeys(catalog, toSnake) as Record<string, unknown>;
}
