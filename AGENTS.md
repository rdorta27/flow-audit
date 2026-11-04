# AGENTS

- This repo is at **0.4.4, published**, on the way to **0.5.0, Client-ready** (versions mark
  milestones, not semver). It has the synthetic dataset, the simulated TMF stub, TMF readers
  and file readers (`src/adapters/ingest/`), correlation, segments, a quality gate
  (`src/domain/quality.ts`) and rules R01 to R05. `deno task audit --dataset data/demo --out out`
  runs R01 to R05 and writes `findings.json` (`findings/2`) and `report.html`, including the
  assumptions table, the story of one order and the net total. On the stub, R02 and R03 are not
  evaluated. Data files use snake_case keys (TS stays camelCase). What is left is
  `../specs/backlog.md` (M5-06, M4-10, M4-11, the site cards, and the known corrections). Closed
  cards are in `../specs/done/`; if they disagree with the backlog, `done/` wins.
- This version is English only: code, docs, CLI and report. Spanish and Portuguese output
  come later (backlog L-01).
- Read `README.md`, then `docs/product.md`, then `docs/architecture/`.
- `domain/` has no I/O: rules and reconstruction must be testable without files.
- A new finding is a new rule under `domain/rules/`; never hardcode it in the renderer.
- Every rule follows the contract in `docs/architecture/rules.md`: signal, evidence, formula.
- The report is one self-contained file: no CDN, no external fonts, no build step. It speaks
  to someone outside telecom and follows the approved design in `../specs/design/` (generic
  system names, one colour per system; backlog S-11).
- Only synthetic data is committed. Client evidence never enters the repo or its history.
- The engine is MIT. Never vendor, copy or import third-party code; the systems it reads
  are reached over HTTP only (`THIRD-PARTY.md`). The boundary is a test, not a promise.
- Impact rates are configuration, not constants: every number in the report must be replaceable.
- When you close a backlog card, move it with its Result to `../specs/done/<milestone>.md`
  and update the "Where we are" section of `README.md` and `../specs/estado.html` in the
  same change; `../specs/backlog.md` (what is left) and `../specs/done/` (what is built)
  win if they disagree.
- Tests: `deno test`. Run them before proposing a change.
- Commits: the `commit-msg` hook enforces the format (`<type>: <summary>`, why + `Changes:`).
- Do not push, tag or publish without explicit approval.

## Index

| Need | File |
|---|---|
| Product, scope, demo | `docs/product.md` |
| Architecture, stack, limits | `docs/architecture/overview.md` |
| Entities, events, invariants | `docs/architecture/data-model.md` |
| Findings, evidence, impact | `docs/architecture/rules.md` |
| Client directory, redaction | `docs/architecture/engagement.md` |
| Why local-first CLI | `docs/decisions/0001-local-first-cli-static-report.md` |
| Why the source is our TMF stub (simulated) | `docs/decisions/0003-tmf-stub-as-primary-source-and-typescript-adapters.md` |
| MVP requirements | `docs/requirements/mvp.md` |
| Vocabulary | `docs/glossary/bss.md` |
