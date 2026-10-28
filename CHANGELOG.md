# Changelog

Versions follow semver. `core` sets the numbers; the `site` repository reuses the same
tag when it publishes that version.

## Unreleased

### Added

- `deno task stub` (M0-11): the synthetic dataset served as read-only, standard-TMF-shaped
  APIs — `productOrder`, `serviceOrder` and `serviceActivation` on loopback — with
  `offset`/`limit` pagination, `X-Total-Count`, a `?state` filter, JSON error bodies, 405
  on any non-GET method and an optional bearer check (`STUB_BEARER_TOKEN`); every response
  is marked `X-Flow-Audit-Source: simulated`. The stub lives in `src/stub/` (the domain
  imports nothing from it), reads `data/demo/` with domain types, and serves each
  resource's state at the end of the dataset window, derived from the exports; the event
  history stays in the file exports. The R04 duplicate cohort is visible as two service
  orders over one product order item, and the weak-link attempts (R05) as activations
  with no service order.

### Changed

- The plan moves from six phases to milestones M0–M5 (`../specs/flow-audit_BACKLOG.md`):
  validate one integration candidate, one read-only adapter, correlation, one rule, one report.
- Status lines in README, AGENTS and docs now name the version and milestone.
- This version is declared English only; Spanish and Portuguese output are deferred.
- The README reports M0 progress: bss-oss-rust was tested locally (M0-02, M0-03, M0-04,
  M0-09) and its contract is too weak to be the primary source. The primary source will
  be a TMF stub in this repository over the synthetic dataset, in the standard TMF shape
  and labelled simulated (M0-11); bss-oss-rust stays an optional local dialect check and
  Openslice moves to later. The engine itself is unchanged.

## 0.1.0 — 2026-10-28

Baseline before milestone M0. Old tags `0.1.0` and `0.2.0` were removed; this release
replaces them and is aligned with `site` 0.1.0.

### Added

- Deterministic Ortelis dataset: 5,000 orders in a fixed September 2026 window.
- Versioned exports in `data/demo/`: catalog, OMS, BPM, provisioning, config and expected numbers.
- `deno task dataset` regenerates the dataset from a fixed seed.
- Invariant suite covering the data-model rules and the five defect cohorts.
- Deno toolchain pinned in `mise.toml`, with `check`, `test` and `audit` tasks.
- Hexagonal skeleton: `domain`, `ports`, `adapters`, `app` and `cli`.
- Canonical model types: events, catalog, orders, journeys, impact and findings.
- Boundary test that keeps `domain/` free of I/O and the project free of runtime dependencies.
- Walking-skeleton CLI that exits with code 2 and a clear message when no evidence source exists.
- ADR 0002: hexagonal layout and the dependency rule.
- Product definition: problem, buyer, scope, demo, success criteria.
- Architecture overview: local-first CLI, pipeline, stack, limits.
- Data model: catalog, orders, events, correlation and impact.
- Rule catalogue R01–R05 with signal, evidence and impact formula.
- ADR 0001: local-first CLI with a static report.
- MVP requirements R1–R6 and non-functional requirements.
- BSS order-flow glossary.

### Changed

- README now states the phase and what runs today (nothing).
- Renamed the product to Flow Audit.
- Renumbered the roadmap: architecture and model (1), dataset (2), site (3), ingest (4),
  rules (5), report and publish (6).
- Aligned the demo order and the R04 signal with the generated dataset.
