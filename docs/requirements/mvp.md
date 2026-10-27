# MVP requirements

Status: phase 0. Derived from [product](../product.md). No OpenSpec in this repo: this is the source of truth until it changes.

## R1 — Ingest the four systems

The tool reads one export per system (`CAT`, `OMS`, `BPM`, `PROV`) in JSON, CSV or JSONL, validates it against the canonical envelope and reports parse errors with file and line. No export format is required beyond a documented mapping file per adapter.

**Accepted when:** the demo dataset ingests with zero unclassified errors, and a malformed row fails with a message that names the file, line and field.

## R2 — Reconstruct the journey

For every order, the tool builds a timeline of segments across the four systems, resolving links by declared key, parent key, serial or time window. Weak matches are flagged, never silent.

**Accepted when:** the demo shows one timeline per order with systems, states, actors and wait durations; orders whose correlation relies on a time window are marked weak.

## R3 — Detect the five findings

Rules `R01`–`R05` fire on the demo dataset with the documented rates (±1 percentage point) and each finding cites the evidence that triggered it.

**Accepted when:** `findings.json` contains the five findings with rule id, severity, affected orders, evidence selectors and impact, and a test asserts the rates.

## R4 — Quantify impact

Impact is computed from `orders_per_month`, `loaded_hour_usd` and per-action minutes, all visible in the report. Changing a rate changes the numbers without re-running ingest.

**Accepted when:** editing the config changes the reported hours and USD, and the report states the rates used.

## R5 — Render the report

One self-contained `report.html`, no external assets, with summary, flow swimlane, state machine, order timeline, findings heat map and per-finding detail.

**Accepted when:** the file opens offline, renders the four visuals and every finding links to its evidence.

## Out of scope for the MVP

Adapters for real system exports, streaming for large datasets, the `serve` UI, PDF export, rule authoring by non-developers, multi-client management.
