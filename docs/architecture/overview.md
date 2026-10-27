# Architecture

> **Under construction — phase 3.** The skeleton, the dataset and the report preview
> exist; the analysis does not. Adapters and rules are still empty. Complements [product](../product.md).

## Shape

**Local-first CLI that produces a static report.** No server, no database, no accounts. Evidence goes in, a folder with the report comes out.

The shape follows the constraint, not the fashion: audit evidence is client-confidential and usually cannot leave a laptop, and the deliverable of an audit is a document, not a service. See [ADR 0001](../decisions/0001-local-first-cli-static-report.md).

```
data/demo/ortelis/            Flow Audit
  catalog.json                 ┌───────────────────────────────────────────┐
  oms_orders.csv          ────▶│ ingest → reconstruct → detect → quantify  │───▶ out/
  bpm_history.jsonl            │   │          │           │         │     │      report.html
  provisioning.jsonl           │   ▼          ▼           ▼         ▼     │      findings.json
                               │ events   timeline    findings   impact   │      dataset/
                               └───────────────────────────────────────────┘
```

## Pipeline

| Stage | Input | Output | Responsibility |
|---|---|---|---|
| **Ingest** | Raw exports | `Event[]` | Parse, validate, normalize. One adapter per system, one canonical envelope. |
| **Reconstruct** | `Event[]` | `OrderJourney[]` | Group by order, resolve correlation keys, order events, cut waits and detect gaps. |
| **Detect** | `OrderJourney[]` + catalog | `Finding[]` | Run rules. Each rule declares condition, evidence selector and impact formula. |
| **Quantify** | `Finding[]` + config | `Finding[]` with impact | Turn counts and durations into hours and USD with explicit, configurable rates. |
| **Render** | `Finding[]` + journeys + config | `report.html`, `findings.json` | Presentation only. No analysis in the renderer. |

Analysis and presentation are separated on purpose: the same findings must be renderable as HTML, as JSON, or as slides later without re-running the rules.

## Components

Hexagonal, with the domain at the center and no I/O inside it.

| Layer | Contents | Depends on |
|---|---|---|
| `domain/` | Canonical model, journey reconstruction, rule engine, impact math | nothing |
| `ports/` | `EvidenceSource`, `CatalogSource`, `ReportRenderer`, `Clock` | domain |
| `adapters/ingest/` | CSV, JSON, JSONL readers per system | ports |
| `adapters/report/` | HTML renderer, SVG diagrams, JSON writer | ports |
| `app/` | `runAudit(config)` use case, configuration | domain, ports |
| `cli/` | Argument parsing, exit codes, progress | app |

Rules are data plus a predicate in `domain/rules/`: they declare an id, a severity, the evidence they select and the impact formula. Adding a finding means adding a rule, not touching the pipeline.

## Stack

| Choice | Why |
|---|---|
| TypeScript on Deno | No build step for the CLI, standard test runner, single toolchain |
| No runtime dependencies | An audit tool must run on a locked-down laptop years from now |
| Plain template strings + inline SVG | The report is one file, portable, no CDN, no JS framework |
| `mise` for the toolchain | Same convention as the rest of the workspace |

Rejected for now: a browser-only app (can't handle large exports) and a hosted service (evidence cannot leave the client).

## Layout

```
core/
  docs/            product, architecture, data model, decisions, requirements, glossary
  src/
    domain/        model, rules, impact
    ports/
    adapters/      ingest/, report/
    app/
    cli/
  data/demo/       synthetic evidence for Ortelis Satellite
  tests/
site/              under construction, later the built demo report
```

## Scale

5,000 orders per month with ~8 events each fits comfortably in memory (tens of MB). Streaming is a later concern; the ingest port already accepts an iterator so the change stays local.

## Extension points

1. **New system** → new adapter under `adapters/ingest/` and, if it adds a new entity, a field in the canonical model.
2. **New finding** → new rule under `domain/rules/`, no pipeline change.
3. **New output** → new renderer under `adapters/report/` implementing the same port.
4. **New client** → new dataset under `data/`, same rules.

## One audit, step by step

| # | Step | Who | Output |
|---|---|---|---|
| 1 | Scope: period, product family, systems and owners | Consultant + client | `config.json` |
| 2 | Export one read-only file per system | Client | `raw/` |
| 3 | Map columns to the canonical envelope | Consultant | `mapping.yml` per system |
| 4 | Ingest and validate | Tool | normalized `dataset/` |
| 5 | Reconstruct journeys and list correlation gaps | Tool | `journeys.json` |
| 6 | Run rules and quantify with the client's rates | Tool | `findings.json` |
| 7 | Review each finding's evidence, accept or downgrade | Consultant | reviewed findings |
| 8 | Render and hand over | Tool | `report.html` |
| 9 | Archive dataset, rules and config for the next audit | Consultant | versioned folder |

No credentials are needed: the tool reads exports, it does not connect to systems.

## Testing strategy

| Level | What it proves |
|---|---|
| Unit | Each rule fires and stays quiet on a fixture pair (positive, negative) |
| Golden dataset | The Ortelis dataset produces the documented counts and shares |
| Property | No event is lost: every event lands in exactly one journey or in the orphan list |
| Snapshot | The same dataset, config and rules produce the same `findings.json` |
| Render | The report opens offline and every evidence link resolves |

No test touches the network.

## Privacy and security

- No network calls, no telemetry, no accounts, no update check.
- Evidence lives in memory; files are written only where the user asks.
- Real exports are redacted by adapter configuration before the normalized dataset is written.
- The report contains customer identifiers: it is marked confidential and loads no external asset.
- No secrets, tokens or client names in the repository or its history.

## Limits

- Four systems and one flow (order-to-activate); other flows need their own rules.
- Time-window correlation is a fallback: conclusions about traceability are conservative.
- Rules find patterns, not root causes; the recommendation stays with the consultant.
- Export formats must be documented; live connectors are not in the MVP.
- 5,000 orders per month fit in memory; streaming is deliberately postponed.

## Open questions

- Where do rules live: TypeScript predicates or declarative YAML? Start with TypeScript, revisit if a consultant needs to add rules without coding.
- Does the report need a language switch at render time, or two generated files? Start with a `--lang` flag, one file per language.
