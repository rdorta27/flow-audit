# flow-audit

Audit workbench for BSS order flows. Reads evidence exported from the product catalog, order management, BPM and provisioning, reconstructs how every order travelled through them, detects where it broke, quantifies the impact, and produces a report that can be handed to a client.

It does not implement, configure or monitor those systems. It observes them.

> **Under construction — version 0.2.0, milestone Demo 1.** The engine reads orders and
> service orders from a simulated source, but detects nothing and produces no report yet:
> `deno task audit` exits with a clear message instead of pretending to audit.

## Where we are

The full picture, in Spanish and with every card's status, is in
[`../specs/estado.html`](../specs/estado.html) (open it in a browser). The short version:

| Today | What it is | See it |
|---|---|---|
| Synthetic data | 5,000 made-up orders of a fictional operator, with the defects planted on purpose | `data/demo/` |
| Simulated TMF server | Serves that data like a real system would, read-only | `deno task stub` |
| Readers and join | Fetch product orders (TMF622), service orders (TMF641) and activation attempts (TMF640), join them and print counts and how sure each join is | `deno task read` |

**Not yet:** no rule detects a problem, nothing computes a cost, no report comes out of the
engine. The 20 duplicated orders show up as a count, not as a finding.

**Where it goes:**

1. **Demo 1** — one real report: finding R04 (a retry creates a second service order),
   read from the simulated server, with its cost in USD and the formula.
2. **Client-ready** — read the files a real client exports and also detect R01, R02 and R05.

Done in Demo 1 so far: the three readers (milestone M1 is closed), provenance on every record,
the join of orders, service orders and activations with a confidence per link, the
classification of time as work, wait or gap (milestone M2 is closed) and the written spec of
R04. Next card: M3-02, implement R04. The plan is in
[`../specs/backlog.md`](../specs/backlog.md).

## Why

A telecom order crosses four systems owned by four teams. Nobody owns the whole path, so nobody can say with evidence where orders get stuck or what the manual work costs. Audits today are interviews and spreadsheets; this makes them reproducible, traceable and quantified.

## What it will do

```
evidence exports → ingest → reconstruct → detect → quantify → report.html
```

- **Ingest** one export per system into a canonical event stream.
- **Reconstruct** each order's journey, including the links the systems do not share.
- **Detect** five failure patterns with explicit rules, each tied to its evidence.
- **Quantify** hours and USD from visible, configurable rates.
- **Report** one self-contained HTML file with flow map, state machine, timeline and heat map.

## What runs today

Commands available in version 0.2.0:

- `deno task check` passes.
- `deno task test` passes 91 tests: dataset invariants, export stability, the hexagonal
  and license boundaries, the walking skeleton, the TMF stub and the readers.
- `deno task audit` exits with code 2: no evidence source exists yet.
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
| Demo 1 | One real report: R04 read from the TMF stub, with its cost in USD and formula | planned |
| Client-ready | Audit a client's file exports through `mapping.yml`; R01, R02, R04, R05 | planned |

## Versions

`core` sets the version numbers (semver). The sibling `site/` repository tags a release
only when it publishes that same `core` version, with the same number; site-only fixes
are not tagged. Both repositories start aligned at `0.1.0`.

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

The published report lives in the sibling `site/` repository, which today carries a
preview built on a mock, still marked under construction.

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
