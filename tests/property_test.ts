// SPDX-License-Identifier: MIT
/**
 * Properties (M6-02): what must not change the findings. The order of the rows, a file cut in
 * two and read as two, and an export loaded twice all give the findings of the original. Also
 * the one performance figure `docs/requirements/mvp.md` states.
 */

import { type AuditSources, runAudit } from "../src/app/run_audit.ts";
import { renderHtml } from "../src/adapters/report/html_renderer.ts";
import { renderFindingsJson } from "../src/adapters/report/json_renderer.ts";
import { createFileSources } from "../src/adapters/ingest/file_sources.ts";
import { parseMapping } from "../src/adapters/ingest/mapping.ts";
import { configFromFile } from "../src/domain/data_files.ts";
import { mulberry32 } from "../src/dataset/prng.ts";
import type { EvidenceSource } from "../src/ports/evidence_source.ts";
import { assert, assertEquals } from "./assert.ts";
import { auditCopy, DEMO, digest, FILES, join, split, VALIDATION } from "./validation_support.ts";

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const reorder = (seed: number, header: boolean) => (text: string) => {
  const { head, rows } = split(text, header);
  return join(head, shuffled(rows, seed));
};

const small = digest(await auditCopy(VALIDATION));

Deno.test("row order does not change the findings (hand-written set, 12 shuffles)", async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const result = await auditCopy(VALIDATION, {
      "oms_orders.csv": reorder(seed, true),
      "provisioning.jsonl": reorder(seed + 100, false),
      "bpm_history.jsonl": reorder(seed + 200, false),
    });
    assertEquals(digest(result), small, `seed ${seed}`);
  }
});

Deno.test("row order does not change the findings (5,000-order demo)", async () => {
  const base = digest(await auditCopy(DEMO));
  const result = await auditCopy(DEMO, {
    "oms_orders.csv": reorder(7, true),
    "provisioning.jsonl": reorder(8, false),
    "bpm_history.jsonl": reorder(9, false),
  });
  assertEquals(digest(result), base);
});

Deno.test("an export loaded twice gives the same findings and a warning", async () => {
  const twice = (header: boolean) => (text: string) => {
    const { head, rows } = split(text, header);
    return join(head, [...rows, ...rows]);
  };
  const result = await auditCopy(VALIDATION, {
    "oms_orders.csv": twice(true),
    "provisioning.jsonl": twice(false),
    "bpm_history.jsonl": twice(false),
  });
  assertEquals(digest(result), small);
  assertEquals(
    result.quality?.warnings.filter((w) => w.includes("identical to the first")).length,
    3,
  );
});

/** Two sources read one after the other, as if one export had been cut in two. */
function concat(a: EvidenceSource, b: EvidenceSource): EvidenceSource {
  return {
    name: a.name,
    async *read() {
      yield* a.read();
      yield* b.read();
    },
  };
}

async function write(dir: string, name: string, text: string) {
  await Deno.writeTextFile(`${dir}/${name}`, text);
}

Deno.test("a file cut in two and read as two gives the findings of the whole", async () => {
  const [first, second] = [await Deno.makeTempDir(), await Deno.makeTempDir()];
  try {
    const cut = (rows: string[], sameKey?: (a: string, b: string) => boolean) => {
      let at = Math.floor(rows.length / 2);
      // Orders are read from several rows: cut where the order changes, not inside one.
      while (sameKey && at < rows.length && sameKey(rows[at - 1], rows[at])) at++;
      return [rows.slice(0, at), rows.slice(at)];
    };
    const oms = split(await Deno.readTextFile(`${VALIDATION}oms_orders.csv`), true);
    const orderOf = (row: string) => row.split(",")[0];
    const [o1, o2] = cut(oms.rows, (a, b) => orderOf(a) === orderOf(b));
    await write(first, "oms_orders.csv", join(oms.head, o1));
    await write(second, "oms_orders.csv", join(oms.head, o2));
    for (const name of ["provisioning.jsonl", "bpm_history.jsonl"]) {
      const [r1, r2] = cut(split(await Deno.readTextFile(`${VALIDATION}${name}`)).rows);
      await write(first, name, join([], r1));
      await write(second, name, join([], r2));
    }
    const mapping = parseMapping(
      await Deno.readTextFile(`${VALIDATION}mapping.json`),
      "mapping.json",
    );
    const options = (dir: string) => ({ dir, now: () => "2026-09-30T00:00:00.000Z" });
    const a = createFileSources(mapping, options(first));
    const b = createFileSources(mapping, options(second));
    const sources: AuditSources = {
      ...a,
      productOrders: concat(a.productOrders, b.productOrders),
      serviceOrders: concat(a.serviceOrders, b.serviceOrders),
      activations: concat(a.activations, b.activations),
      processes: concat(a.processes!, b.processes!),
      workOrders: undefined,
      readerFacts: undefined,
    };
    const config = configFromFile(
      JSON.parse(await Deno.readTextFile(`${VALIDATION}config.json`)),
    );
    const result = await runAudit({}, {
      clock: { nowIso: () => "2026-09-01T00:00:00Z" },
      sources,
      config,
      gate: {},
    });
    assertEquals(digest(result), small);
  } finally {
    await Deno.remove(first, { recursive: true });
    await Deno.remove(second, { recursive: true });
  }
});

Deno.test("5,000 orders are read, correlated, judged and reported in under 10 s", async () => {
  // docs/requirements/mvp.md, Performance. The whole pipeline, both report files included.
  const dir = await Deno.makeTempDir();
  try {
    for (const name of FILES) await Deno.copyFile(`${DEMO}${name}`, `${dir}/${name}`);
    const mapping = parseMapping(await Deno.readTextFile(`${DEMO}mapping.json`), "mapping.json");
    const config = configFromFile(JSON.parse(await Deno.readTextFile(`${DEMO}config.json`)));
    const started = performance.now();
    const sources = createFileSources(mapping, { dir, now: () => "2026-09-30T00:00:00.000Z" });
    const result = await runAudit({}, {
      clock: { nowIso: () => "2026-09-01T00:00:00Z" },
      sources,
      config,
      gate: {},
    });
    const html = renderHtml(result.report);
    const json = renderFindingsJson(result.report);
    const seconds = (performance.now() - started) / 1000;
    console.log(`  5,000 orders, files to report.html and findings.json: ${seconds.toFixed(2)} s`);
    assertEquals(result.correlation.orders.length, 5000);
    assert(html.length > 0 && json.length > 0);
    assert(seconds < 10, `${seconds.toFixed(2)} s, the requirement is under 10 s`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
