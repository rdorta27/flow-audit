# Changelog

Versions follow semver. `core` sets the numbers; the `site` repository reuses the same
tag when it publishes that version.

## Unreleased

## 0.3.1 — 2026-11-03

A corrections release: nothing new in the engine, and the public texts now say what is true.

- Costs: one set of figures everywhere. R01 USD 12,750; R03 now has a cost (USD 14,267 plus
  USD 3,250 of revenue at risk, apart); total USD 57,482 a month. `docs/product.md` and
  `docs/architecture/rules.md` (R03's formula and `days_stuck`) agree with the site.
- CLI: `--lang` removed from `deno task audit`; the engine is English only (backlog L-01).
- Docs: the R04 figure (USD 1,590), `AGENTS.md` and the README describe what exists today;
  finished cards moved to `../specs/done/`.

- Docs: R04's Demo 1 cost is USD 1,590 (decision (b): duplicate activations counted from the
  correlated activations) in `docs/architecture/rules.md` and the backlog; USD 1,350 is only
  the figure for a source without activations. `AGENTS.md` and the README describe what
  exists today (three readers, correlation, R04).
- Planning: finished cards moved to `../specs/done/`, one file per milestone (`m0-log.md` is
  now `done/m0.md`; links in `THIRD-PARTY.md` and ADR 0003 updated); the backlog keeps only
  pending work, with full cards, a "Start here" section for newcomers and rules for working
  a card in parallel. R03 and BPM file ingest move to Client-ready (D-05).

## 0.3.0 — 2026-11-03

Milestones M1 (the readers) and M2 (join and time classification) are closed and the first rule runs: R04 finds the 20 duplicated orders and prices them at USD 1,590.

- M3-02: `src/domain/rules/r04.ts` detects service orders duplicated over one product order
  item (`R04@1`), skips cancelled ones, derives severity from impact and prices the cleanup
  and duplicate activations from `ImpactConfig`. `deno task explain` writes a self-contained
  page that follows one duplicated order through read, join, rule and cost.
- M2-02: `src/domain/correlation.ts` joins service orders, processes and activation attempts
  to their orders, with a confidence per link (`explicit`, `inferred`, `ambiguous`,
  `missing`, `conflicting`) and the unresolved records kept apart. `tmf_mapping.ts` maps TMF
  records to the canonical model and translates states. `deno task read` prints how sure each
  join is.
- M2-03: tests for orphans, conflicting references, duplicate ids, inference by terminal
  serial and input-order independence, on small cases and at full size.
- M2-04: `src/domain/segments.ts` classifies an order's time as work, wait or gap, and
  refuses snapshot evidence with a reason.

- M1-05b: `src/adapters/ingest/tmf640_source.ts` reads provisioning activation attempts. An
  attempt with no link to its service order is kept, not rejected: that gap is what R05
  reports. `deno task read` now also counts activations and the unlinked ones.

- M1-02: every record carries `provenance` (its id in the source, the endpoint read, when it
  was read and whether the source labels itself simulated), so a finding can point at its
  proof. Read time is the observation time, taken per page from an injectable clock.

- `deno task read`: reads product orders and service orders from a TMF source and prints
  counts, including how many product orders have more than one service order. A data check,
  not an audit.

- M1-01: `src/adapters/ingest/` reads TMF622 product orders over HTTP as an `EvidenceSource`:
  `GET` only, paginated, bearer token and limits from environment variables
  (`FLOW_AUDIT_TMF_*`), clear errors for HTTP failures, bad bodies, timeouts and
  cancellation. Tests run with no network and once against the stub.

## 0.2.0 — 2026-10-29

Closes milestone M0 ([ADR 0003](docs/decisions/0003-tmf-stub-as-primary-source-and-typescript-adapters.md)):
the sources are validated and the decision is recorded. The primary source for
development, tests and the public demo is the TMF stub in `src/stub/` over the synthetic
dataset, labelled simulated; bss-oss-rust stays an optional, local-only dialect check
(M1-04) and its unresolved license does not block the demo; Openslice moves to Later. No
ingest adapter, rule or generated report yet — that is M1 onward.

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
- ADR 0003: the TMF stub is the primary source; adapters in TypeScript.

### Changed

- The plan moves from six phases to milestones M0–M5 (`../specs/flow-audit_BACKLOG.md`):
  validate one integration candidate, one read-only adapter, correlation, one rule, one report.
- Status lines in README, AGENTS and docs now name the version and milestone.
- This version is declared English only; Spanish and Portuguese output are deferred.
- The README reports M0 progress: bss-oss-rust was tested locally (M0-02, M0-03, M0-04,
  M0-09) and its contract is too weak to be the primary source. The primary source is
  a TMF stub in this repository over the synthetic dataset, in the standard TMF shape
  and labelled simulated (M0-11); bss-oss-rust stays an optional local dialect check and
  Openslice moves to later. The engine itself is unchanged.
- Milestone M0 is closed; M1 starts: the first read-only adapter over the stub.

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
