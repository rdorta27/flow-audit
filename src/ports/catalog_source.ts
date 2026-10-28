// SPDX-License-Identifier: MIT
import type { Catalog } from "../domain/model.ts";

/** The catalog snapshot the audit runs against. */
export interface CatalogSource {
  read(): Promise<Catalog>;
}
