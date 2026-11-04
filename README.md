# flow-audit

Audit workbench for BSS order flows. Reads evidence exported from the product catalog, order management, BPM and provisioning, reconstructs how every order travelled through them, detects where it broke, quantifies the impact, and produces a report that can be handed to a client.

It does not implement, configure or monitor those systems. It observes them.

> **Under construction — 0.4.5 is the Client-ready candidate, pending review.** Demo 1 (0.4.0) is done.
> `deno task audit --dataset data/demo --out out` reads the four file exports, joins them, runs the quality
> gate and rules R01 to R05, and writes `out/findings.json` (`findings/2`) and a self-contained `out/report.html`.
> `deno task audit --source stub` reads the simulated server; R02 and R03 are not evaluated there, because it
> serves no catalog or process tasks. `deno task explain` follows one duplicated order.

## Where we are

The full picture, in Spanish and with every card's status, is in
[`../specs/estado.html`](../specs/estado.html) (open it in a browser). Flow Audit is an
open-source (MIT) technical demo under construction; there is no commercial offer.

### Real, simulated, missing

| Part | Status | What that means |
|---|---|---|
| Engine: read, join, R01 to R05, quality gate, assumptions table, diff, CSV, story, net total, `findings.json`, `report.html` | **Real** | Runs today: `deno task audit --dataset data/demo --out out` |
| Evidence source | **Simulated** | A TMF-shaped server over synthetic data (`deno task stub`); every response is marked simulated |
| Data | **Simulated** | 5,000 made-up orders of a fictional operator, defects planted on purpose (`data/demo/`) |
| Rates (minutes per action) | **Example** | From `data/demo/config.json`, not measured at any operator |
| Reading an operator's export files (CSV, JSON, JSONL) through a mapping | **Real** | `deno task audit --dataset data/demo`; the demo files are our own design (D-03), not yet a real operator's |
| Catalog and process steps of the story | **Real on files, missing on the stub** | The file audit reads the catalog and the process history. The simulated server does not, so those steps are "not observed" on `--source stub` |

What the engine finds today, from the demo files (hours a month): R01 283.3 h (400 orders),
R02 347.3 h (4,167 orders), R03 317 h (50 stuck orders), R04 30 h (20 orders), and R05 225 h (300 weak links) shown apart
(D-11). One order can carry several findings, so the net total counts each order once
(`totals.ts`): R01 to R04 add up to 977.6 h gross and 925.9 h net. On the
simulated server R02 does not run, because it serves no catalog or process tasks. Before any
rule, a quality gate checks each file (`docs/architecture/quality.md`).

**Where it goes:** **Demo 1** (0.4.0) is done. **Client-ready** (0.5.0) is in progress:
`0.4.5` is the candidate, pending review. The plan is in
[`../specs/backlog.md`](../specs/backlog.md); finished cards are in
[`../specs/done/`](../specs/done/README.md).

## Why

A telecom order crosses four systems owned by four teams. Nobody owns the whole path, so nobody can say with evidence where orders get stuck or what the manual work costs. Audits today are interviews and spreadsheets; this makes them reproducible, traceable and quantified.

## What it will do

```
evidence exports → ingest → reconstruct → detect → quantify → report.html
```

- **Ingest** one export per system into a canonical event stream.
- **Reconstruct** each order's journey, including the links the systems do not share.
- **Detect** five failure patterns with explicit rules, each tied to its evidence.
- **Quantify** hours from visible, configurable rates.
- **Report** one self-contained HTML file with flow map, state machine, timeline and heat map.

## What runs today

Commands available today:

- `deno task check` passes.
- `deno task test` passes: dataset invariants, export stability, the hexagonal and license
  boundaries, the TMF stub, the readers, the join, R01 to R05, the quality gate, assumptions
  and the findings schema and its validator.
- `deno task audit --source stub` (start `deno task stub` first) prints counts, links and
  `R04@2 · 20 orders · 30 h`. R02 and R03 are not evaluated on the stub. With `--out out` it
  writes the two report files; without a source it exits with code 2.
- `deno task audit --dataset data/demo --out out` reads the four exports through
  `data/demo/mapping.json` (`--mapping <path>` for another), runs the quality gate and R01 to
  R05 (400, 4,167, 50 stuck, 20 and 300), and writes the report. It prints one coverage line
  per file. See `docs/architecture/mapping.md`. This is the client-ready check:
  `tests/client_ready_test.ts` runs it and compares the findings with `data/demo/expected.json`
  and the hour estimate in `docs/product.md`. `--check` reads and gates, and does not run
  the rules. `deno task diff a/findings.json b/findings.json` compares two audits. `--redact`
  pseudonymises ids in the report files.
- `deno task read` reads product orders (TMF622), service orders (TMF641) and activation attempts
  (TMF640) from the stub and prints counts. Start `deno task stub` first. It is a data check, not an audit.
- `deno task stub` serves `data/demo/` as read-only, standard-TMF-shaped APIs
  (TMF622/641/640) on `127.0.0.1:8081`. Every response carries
  `X-Flow-Audit-Source: simulated`. It is a test source for the first adapter (M1-01) — known
  defects, golden numbers, no real system behind it — not a product simulator; see
  [architecture](docs/architecture/overview.md#the-tmf-stub).

Milestone M0 is closed (ADR 0003). It tested a third-party TMF system,
bss-oss-rust, locally and outside both repositories: it runs, access works, and its
contracts are captured (M0-02, M0-03, M0-04, M0-09). Its contract is weak (no item links,
free-text references, no pagination, no history), so the primary source is a TMF
stub of our own in this repository, serving the synthetic dataset in the standard TMF
shape and labelled simulated (M0-11). bss-oss-rust stays an optional, local-only dialect
check. Its license stays unclear and the author is not contacted (D-02), so it is never
redistributed or used in the public demo, which runs on the stub.

The plan is in [`../specs/backlog.md`](../specs/backlog.md):

| Milestone | Goal | State |
|---|---|---|
| — | Definition, skeleton, synthetic dataset, report preview | **done** (0.1.0) |
| M0 | Sources validated: bss-oss-rust tested locally; the TMF stub serves the synthetic dataset | **done** (0.2.0) |
| Demo 1 | One real report: R04 read from the TMF stub, with its evidence and its hours | **done** (0.4.0) |
| Client-ready | Audit file exports through a mapping; R01–R05, a gate and a defensible report | **candidate 0.4.5**, pending review |
| Order-to-cash | Follow the order into billing | planned (0.6.0) |

## Versions

Version numbers mark progress towards a milestone; they are not semver. `0.4.0` is Demo 1,
`0.5.0` Client-ready and `0.6.0` Order-to-cash; a `0.3.x` release is a step towards `0.4.0`
and may carry features. `core` and the sibling `site/` repository share the number of each
release and are tagged together. The engine reads its version from `deno.json` through
`src/version.ts`.

## Repository

| Path | Contents |
|---|---|
| `deno.json`, `mise.toml` | Tasks (`check`, `test`, `audit`) and pinned Deno |
| `docs/product.md` | What the product is, for whom, what it does and does not do |
| `docs/architecture/overview.md` | Shape, pipeline, stack, limits |
| `docs/architecture/data-model.md` | Entities, events, correlation, invariants |
| `docs/architecture/rules.md` | The five findings: signal, evidence, impact formula |
| `docs/decisions/` | ADRs, one decision per file |
| `docs/requirements/` | [MVP requirements](docs/requirements/mvp.md) |
| `docs/glossary/` | [BSS order-flow terms](docs/glossary/bss.md) |
| `data/demo/` | Versioned synthetic evidence: four exports, config and expected numbers |
| `src/` | CLI, domain, ports, adapters, dataset generator |
| `tests/` | Dataset, serializers, the two boundaries and the walking skeleton |

The public site lives in the sibling `site/` repository. It explains the product and links
the engine's real report under `site/engine/`. The demo page is still a handmade preview
(backlog S-06).

## Language

This version is English only: code, documentation, CLI and the generated report. Spanish and Portuguese output come later. The site is already published in English, Spanish and Portuguese. Commercial and technical presentations are in Spanish.

## License

The engine is MIT: see [`LICENSE`](LICENSE). It has no runtime dependencies, and every
file under `src/` and `tests/` carries the SPDX identifier.

What it reads is not MIT and is not distributed here. The systems used to validate an
integration are read over HTTP and keep their own licenses:
[`THIRD-PARTY.md`](THIRD-PARTY.md) lists them and states the boundary, and
[`TRADEMARKS.md`](TRADEMARKS.md) covers the name and the TM Forum marks.

The generic engine is open. Client adapters, mappings, rules and datasets stay private per
engagement, which is the part a client pays for. `tests/license_boundary_test.ts` enforces
the boundary: no vendored code, no remote import, no third-party capture committed, and an
SPDX header on every source file.
