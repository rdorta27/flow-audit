// SPDX-License-Identifier: MIT
import type { FileCoverage } from "./file_common.ts";
import { FileCatalogSource } from "./file_catalog_source.ts";
import { FileBpmSource, FileProvisioningSource } from "./file_jsonl_sources.ts";
import { OmsFile } from "./file_oms_source.ts";
import {
  mapFileAttempt,
  mapFileOrder,
  mapFileProcess,
  mapFileServiceOrder,
  mapFileWorkOrder,
} from "./file_mapping.ts";
import type { Mapping } from "./mapping.ts";
import type { ReaderFacts } from "../../domain/quality.ts";

export interface FileSourcesOptions {
  /** The directory with the exports; the mapping names the files inside it. */
  dir: string;
  /** Observation time for provenance; injected so tests are deterministic. */
  now: () => string;
}

/** The sources and mappers for one client's exports, as the mapping describes them. */
export function createFileSources(mapping: Mapping, options: FileSourcesOptions) {
  const base = { ...options, simulated: mapping.simulated };
  const oms = new OmsFile(base, mapping.oms);
  const bpm = mapping.bpm ? new FileBpmSource(base, mapping.bpm) : undefined;
  const prov = new FileProvisioningSource(base, mapping.prov);
  const catalog = mapping.catalog ? new FileCatalogSource(base, mapping.catalog) : undefined;
  const repeats = (system: ReaderFacts["system"], c: FileCoverage): ReaderFacts => ({
    system,
    duplicateKeys: c.repeatedKeys,
    exactDuplicates: c.exactRepeats,
  });
  return {
    productOrders: oms.source("order"),
    serviceOrders: oms.source("service_order"),
    workOrders: mapping.oms.columns.wo_ref === null ? undefined : oms.source("work_order"),
    processes: bpm,
    activations: prov,
    catalog,
    period: mapping.period,
    quality: mapping.quality,
    mappers: {
      order: mapFileOrder,
      serviceOrder: mapFileServiceOrder,
      workOrder: mapFileWorkOrder,
      process: mapFileProcess,
      attempt: mapFileAttempt,
    },
    /** The repeats each file held; call it after the audit has read the files. */
    readerFacts: async (): Promise<ReaderFacts[]> => {
      const list = [repeats("OMS", await oms.finishCoverage())];
      if (bpm) list.push(repeats("BPM", bpm.coverage));
      list.push(repeats("PROV", prov.coverage));
      return list;
    },
    /** The coverage report; call it after the audit has read the files. */
    coverage: async (): Promise<FileCoverage[]> => {
      const list = [await oms.finishCoverage()];
      if (bpm) list.push(bpm.coverage);
      list.push(prov.coverage);
      return list;
    },
  };
}
