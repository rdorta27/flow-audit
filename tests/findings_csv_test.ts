// SPDX-License-Identifier: MIT
/** Per-finding CSV (M5-09). */

import { main } from "../src/cli/main.ts";
import {
  CSV_COLUMNS,
  CSV_ORDER_LIMIT,
  renderFindingsCsv,
} from "../src/adapters/export/findings_csv.ts";
import { assert, assertEquals } from "./assert.ts";

/** A small RFC 4180 reader: enough to prove the file opens as a table. */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  return rows;
}

Deno.test("--out writes findings.csv: order rows add up to each finding's hours", async () => {
  const dir = await Deno.makeTempDir();
  const log = console.log;
  console.log = () => {};
  try {
    assertEquals(await main(["--dataset", "data/demo", "--out", dir, "--quiet"]), 0);
    const rows = parse(await Deno.readTextFile(`${dir}/findings.csv`));
    assertEquals(rows[0], [...CSV_COLUMNS]);
    assert(rows.every((r) => r.length === CSV_COLUMNS.length));
    const findings = JSON.parse(await Deno.readTextFile(`${dir}/findings.json`)).findings;
    const col = (n: string) => CSV_COLUMNS.indexOf(n as typeof CSV_COLUMNS[number]);
    for (const f of findings) {
      const mine = rows.filter((r) => r[col("rule")] === f.id);
      const head = mine.find((r) => r[col("row_type")] === "finding")!;
      const orders = mine.filter((r) => r[col("row_type")] === "order");
      assertEquals(Number(head[col("orders_total")]), f.affected_orders);
      assertEquals(Number(head[col("orders_listed")]), orders.length);
      const sum = orders.reduce((a, r) => a + Number(r[col("estimated_hours")]), 0);
      const whole = Number(head[col("orders_listed")]) === Number(head[col("orders_total")]);
      if (whole) {
        assert(Math.abs(sum - Number(head[col("estimated_hours")])) < 0.05, `${f.id}: ${sum}`);
      } else {
        assert(sum < Number(head[col("estimated_hours")]), `${f.id}: truncated`);
      }
      assert(head[col("rates")].includes("rates."), head[col("rates")]);
      assert(head[col("basis")] !== "");
    }
  } finally {
    console.log = log;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("past the limit the finding row states the total", () => {
  const finding = {
    id: "R9",
    cost: {
      hoursMonth: CSV_ORDER_LIMIT + 5,
      inputs: [{ key: "rates.cleanup_minutes", value: 60, source: null }],
      terms: [{ basis: "rate_assumption" }],
    },
  };
  const charges = Array.from({ length: CSV_ORDER_LIMIT + 5 }, (_, i) => ({
    ruleId: "R9",
    orderRef: `O-${i}`,
    hours: 1,
  }));
  // deno-lint-ignore no-explicit-any
  const rows = parse(renderFindingsCsv([finding as any], charges));
  assertEquals(rows.length, 1 + 1 + CSV_ORDER_LIMIT + 1 - 1);
  assertEquals(rows[1].slice(6), [String(CSV_ORDER_LIMIT), String(CSV_ORDER_LIMIT + 5)]);
  assertEquals(rows[1][4], "rates.cleanup_minutes=60 (assumed)");
});
