// SPDX-License-Identifier: MIT
/** The product catalog export (`catalog.json`): an evidence source and the catalog itself. */

import { catalogFromFile } from "../../domain/data_files.ts";
import type { Catalog } from "../../domain/model.ts";
import type { CatalogSource } from "../../ports/catalog_source.ts";
import type { EvidenceSource, RawRecord } from "../../ports/evidence_source.ts";
import {
  FileError,
  type FileSourceOptions,
  joinPath,
  provenance,
  readFileText,
} from "./file_common.ts";
import type { CatalogMapping } from "./mapping.ts";

export class FileCatalogSource implements EvidenceSource {
  readonly name = "CAT catalog (file)";
  readonly path: string;
  constructor(
    private readonly options: FileSourceOptions,
    private readonly mapping: CatalogMapping,
  ) {
    this.path = joinPath(options.dir, mapping.file);
  }

  /** The catalog for the audit. `line` of a record is its 1-based place among offers, then specs. */
  async catalog(): Promise<Catalog> {
    const text = await readFileText(this.path);
    try {
      return catalogFromFile(JSON.parse(text));
    } catch (error) {
      throw new FileError(this.path, null, null, `not a catalog: ${(error as Error).message}`);
    }
  }

  asCatalogSource(): CatalogSource {
    return { read: () => this.catalog() };
  }

  async *read(): AsyncIterable<RawRecord> {
    const catalog = await this.catalog();
    let line = 0;
    for (const offer of catalog.offers) {
      yield this.#record(++line, "offer", offer.offerId, offer);
    }
    for (const spec of catalog.specs) {
      yield this.#record(++line, "spec", spec.specId, spec);
    }
  }

  #record(line: number, kind: string, id: string, body: object): RawRecord {
    return {
      system: "CAT",
      source: this.path,
      line,
      value: { kind, id, ...body },
      provenance: provenance(this.options, this.path, id, this.mapping.evidenceKind),
    };
  }
}
