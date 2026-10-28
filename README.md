# flow-audit

Audit workbench for BSS order flows. Reads evidence exported from the product catalog, order management, BPM and provisioning, reconstructs how every order travelled through them, detects where it broke, quantifies the impact, and produces a report that can be handed to a client.

It does not implement, configure or monitor those systems. It observes them.

> **Under construction — version 0.1.0, milestone M0.** The skeleton, the dataset and a preview of the report exist. There is no ingest adapter, no rule and no generated report yet: the command exits with a clear message instead of pretending to audit.

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

## Where we are

What runs today (version 0.1.0):

- `deno task check` passes.
- `deno task test` passes 34 tests: dataset invariants, export stability, the hexagonal
  and license boundaries and the walking skeleton.
- `deno task audit` exits with code 2: no evidence source exists yet.

Milestone M0 has produced no engine code yet. It tested a third-party TMF system,
bss-oss-rust, locally and outside both repositories: it runs, access works, and its
contracts are captured (M0-02, M0-03, M0-04, M0-09). Its contract is weak (no item links,
free-text references, no pagination, no history), so the primary source will be a TMF
stub of our own in this repository, serving the synthetic dataset in the standard TMF
shape and labelled simulated (M0-11). bss-oss-rust stays an optional, local-only dialect
check. Its license review waits for the author's answers (M0-05) and no longer blocks the
public demo.

The plan is in [`../specs/flow-audit_BACKLOG.md`](../specs/flow-audit_BACKLOG.md):

| Milestone | Goal | State |
|---|---|---|
| — | Definition, skeleton, synthetic dataset, report preview | **done** (0.1.0) |
| M0 | Validate the sources: bss-oss-rust tested locally; TMF stub over the synthetic dataset next | in progress |
| M1 | First read-only adapter (TMF622) | planned |
| M2 | Canonical model and correlation | planned |
| M3 | First deterministic rule (R04) | planned |
| M4 | Reproducible JSON report, then HTML | planned |
| M5 | Demonstration readiness | planned |

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
