// SPDX-License-Identifier: MIT
import type { SystemId } from "../domain/model.ts";

/**
 * Where a record came from, kept so every finding can point at its proof (M1-02).
 * The source system is `RawRecord.system`; this holds the rest.
 */
export interface Provenance {
  /** The record's own id in the source system, for example `ORD-1005`. */
  externalId: string;
  /** What was read: the collection URL for an API, the file path for an export. */
  endpoint: string;
  /** When it was read, ISO 8601 UTC. Observation time, not the time the event happened. */
  retrievedAt: string;
  /** True when the source labels itself simulated (the TMF stub does). */
  simulated: boolean;
}

/** A row as it came from an export, before normalization. */
export interface RawRecord {
  system: SystemId;
  /** File or stream the row came from, used in validation errors. */
  source: string;
  /** 1-based line, used in validation errors. */
  line: number;
  value: Readonly<Record<string, unknown>>;
  provenance: Provenance;
}

/**
 * One export per system. Adapters implement this in milestone M1; nothing in
 * the domain knows whether the rows come from a file, a stream or a test double.
 */
export interface EvidenceSource {
  readonly name: string;
  read(): AsyncIterable<RawRecord>;
}
