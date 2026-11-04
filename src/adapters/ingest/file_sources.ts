// SPDX-License-Identifier: MIT
import type { FileSourceOptions } from "./file_common.ts";
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

/** The sources and mappers for the four exports in one directory. */
export function createFileSources(options: FileSourceOptions) {
  const oms = new OmsFile(options);
  const catalog = new FileCatalogSource(options);
  return {
    productOrders: oms.source("order"),
    serviceOrders: oms.source("service_order"),
    workOrders: oms.source("work_order"),
    processes: new FileBpmSource(options),
    activations: new FileProvisioningSource(options),
    catalog,
    catalogSource: catalog.asCatalogSource(),
    mappers: {
      order: mapFileOrder,
      serviceOrder: mapFileServiceOrder,
      workOrder: mapFileWorkOrder,
      process: mapFileProcess,
      attempt: mapFileAttempt,
    },
  };
}
