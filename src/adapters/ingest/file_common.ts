// SPDX-License-Identifier: MIT
/** What every file reader shares: the error that names file, line and field, and the options. */

import type { Provenance } from "../../domain/model.ts";

/** A bad export. The message names the file, the line and, when it is one, the field. */
export class FileError extends Error {
  constructor(file: string, line: number | null, field: string | null, why: string) {
    super(
      `${file}${line === null ? "" : `:${line}`}${
        field === null ? "" : ` field "${field}"`
      }: ${why}`,
    );
    this.name = "FileError";
  }
}

export interface FileSourceOptions {
  /** The directory with the exports. */
  dir: string;
  /** Observation time for provenance; injected so tests are deterministic. */
  now: () => string;
  /** True when the files hold invented data (the demo dataset). */
  simulated: boolean;
}

export function joinPath(dir: string, file: string): string {
  return dir.endsWith("/") ? `${dir}${file}` : `${dir}/${file}`;
}

export async function readFileText(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    throw new FileError(path, null, null, `cannot read the file: ${(error as Error).message}`);
  }
}

export function provenance(
  options: FileSourceOptions,
  path: string,
  externalId: string,
): Provenance {
  return {
    externalId,
    endpoint: path,
    retrievedAt: options.now(),
    simulated: options.simulated,
    kind: "history",
  };
}

type Cells = Readonly<Record<string, unknown>>;

/** A required text field of a record. */
export function requiredText(file: string, line: number, row: Cells, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new FileError(file, line, field, "is required and is empty or missing");
  }
  return value.trim();
}

/** An optional text field: absent, null or blank gives null. */
export function optionalText(file: string, line: number, row: Cells, field: string): string | null {
  const value = row[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new FileError(file, line, field, "must be text");
  return value.trim() === "" ? null : value.trim();
}

/** A timestamp the engine can read; the text is kept as the file wrote it. */
export function requiredDate(file: string, line: number, row: Cells, field: string): string {
  const value = requiredText(file, line, row, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new FileError(file, line, field, `"${value}" is not a date`);
  }
  return value;
}

export function optionalDate(file: string, line: number, row: Cells, field: string): string | null {
  const value = optionalText(file, line, row, field);
  if (value !== null && Number.isNaN(Date.parse(value))) {
    throw new FileError(file, line, field, `"${value}" is not a date`);
  }
  return value;
}
