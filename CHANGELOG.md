# Changelog

No releases yet. The project is under construction: phases 0 and 1 are
done, the rest is still to be built.

## Unreleased

### Added

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
- Renumbered the roadmap: architecture and model (1), dataset (2), site (3), ingest (4),
  rules (5), report and publish (6).
