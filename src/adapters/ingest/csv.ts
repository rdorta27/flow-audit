// SPDX-License-Identifier: MIT
/**
 * A small CSV reader of our own (RFC 4180), so the engine keeps zero runtime dependencies.
 *
 * Fields may be quoted; inside quotes a delimiter, a line break or a doubled quote (`""`) is
 * data. Blank lines are skipped. A quote in the middle of an unquoted field, text after a
 * closing quote and a quote that never closes are errors, never guessed. Each row carries the
 * 1-based line where it starts, so a bad value can be traced to its place in the file.
 */

export interface CsvRow {
  /** 1-based line of the row's first character in the file. */
  line: number;
  cells: string[];
}

/** A malformed CSV; `line` is where the problem starts. */
export class CsvError extends Error {
  constructor(readonly line: number, why: string) {
    super(`line ${line}: ${why}`);
    this.name = "CsvError";
  }
}

export function parseCsv(input: string, delimiter = ","): CsvRow[] {
  if (delimiter.length !== 1) throw new CsvError(1, "the delimiter must be one character");
  const text = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;

  const endField = () => {
    cells.push(field);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (cells.length > 1 || cells[0] !== "") rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          const next = text[i + 1];
          if (next !== undefined && next !== delimiter && next !== "\n" && next !== "\r") {
            throw new CsvError(line, "text after the closing quote of a field");
          }
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"') {
      if (field !== "" || wasQuoted) throw new CsvError(line, "a quote inside an unquoted field");
      quoted = true;
      wasQuoted = true;
      quoteLine = line;
    } else if (c === delimiter) {
      endField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else field += c;
  }
  if (quoted) throw new CsvError(quoteLine, "a quoted field never closes");
  if (field !== "" || cells.length > 0 || wasQuoted) endRow();
  return rows;
}
