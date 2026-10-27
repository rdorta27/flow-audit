import type { SystemId } from "../domain/model.ts";

/** A row as it came from an export, before normalization. */
export interface RawRecord {
  system: SystemId;
  /** File or stream the row came from, used in validation errors. */
  source: string;
  /** 1-based line, used in validation errors. */
  line: number;
  value: Readonly<Record<string, unknown>>;
}

/**
 * One export per system. Adapters implement this in phase 4; nothing in the
 * domain knows whether the rows come from a file, a stream or a test double.
 */
export interface EvidenceSource {
  readonly name: string;
  read(): AsyncIterable<RawRecord>;
}
