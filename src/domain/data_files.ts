// SPDX-License-Identifier: MIT
/**
 * The edge between the data files and the engine (M4-06, D-14): `config.json` and
 * `catalog.json` use snake_case keys; the types inside the engine stay camelCase. These are the
 * only functions that translate between the two. Pure: no I/O.
 */

import type { Catalog, ImpactConfig } from "./model.ts";

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

/** Parsed `config.json` (snake_case) to the engine's `ImpactConfig`. Throws when it is not one. */
export function configFromFile(raw: unknown): ImpactConfig {
  if (!isObj(raw)) throw new Error("the config is not an object");
  if (!isObj(raw.rates) || !isObj(raw.thresholds)) {
    throw new Error("missing rates or thresholds");
  }
  return mapKeys(raw, toCamel) as ImpactConfig;
}

/** The engine's config as the snake_case object that `config.json` and `findings.json` carry. */
export function configToFile(config: ImpactConfig): Record<string, unknown> {
  return mapKeys(config, toSnake) as Record<string, unknown>;
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
