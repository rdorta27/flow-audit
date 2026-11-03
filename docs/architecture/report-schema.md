# Report schema: `findings/1`

Status: defined in M4-01. The in-memory form is `AuditReport` (`src/domain/model.ts`,
re-exported by `src/ports/report_renderer.ts`); `runAudit` returns it. `deno task audit --out <dir>` writes it
as `findings.json` (M4-02) next to `report.html` (M4-03). The report, the site and any future client read this one
contract. Every number in it carries its formula and the inputs it came from.

## Conventions

- **Keys in the file are snake_case** (D-12). The engine keeps camelCase objects and
  `toFileShape` (`src/domain/report_json.ts`) maps them. The doc names fields in the file form.
- `config` is printed as `config.json` has it (snake_case, D-14), so `cost.inputs[].key` such
  as `rates.cleanup_minutes` points into it; `data_files.ts` translates at the edge. The keys of
  `overlap.by_order` are order ids and stay as they are.
- `cost.currency` is `USD` today. Times are ISO 8601 UTC. Shares are fractions (0.004 = 0.4%).
- A field that a later card fills is present from day one, with `null`, `[]` or `{}`, so no
  reader breaks when it starts to carry data. The table below says which.
- `validateReport` (`src/domain/report_validator.ts`, no dependencies) checks a parsed file
  against this document and returns every problem found.

## Top-level blocks

| Key | What it holds |
|---|---|
| `schema_version` | `"findings/1"`. |
| `engine_version` | Version of the engine that produced the file. |
| `run` | `id`, `generated_at` (from the injected clock), `inputs_hash`, `config_hash`, `rules_hash` (SHA-256; the run `id` is the first 16 hex characters of the hash of the three). Same inputs, config and rules give the same hashes; changing one byte of an input changes `inputs_hash`. |
| `sources[]` | One per reader: `system`, `name`, `kind` (`tmf-api` or `file`), `endpoint` (URL or path), `simulated`, `evidence_kind` (`snapshot` or `history`), `records`, `rows_read`, `rows_discarded`, `sha256` (of the records as read, not of when they were read). Catalog counts and the rules versions per source come with later cards. |
| `labels` | `synthetic_data`, `simulated_integration`, `estimated_impact`: booleans the report must print. |
| `config` | The `ImpactConfig` used, as read. |
| `correlation` | `links` (counts by kind and confidence, zeros included), `unresolved` (records not placed under exactly one order), `unmapped` (records whose state was not recognised; always 0 until M2-05). Counts by pair of systems are the `links` kinds. |
| `systems[]` | One per `CAT`, `OMS`, `BPM`, `PROV`: `name`, `role`, `position` (1-based in the flow), `read`, `source_kind` (null if not read), `records`, `coverage` (share of orders with a record from that system, null when not read), `cannot_observe[]`, `findings[]` (rule ids whose evidence touches it). |
| `findings[]` | See below. |
| `overlap` | `by_order`: order id to the rule ids that charge it, only for orders charged by two or more rules (`{}` when none). `pairs[]`: `rules` (two ids) and `orders` (how many orders they share). |
| `totals` | `gross`: `hours` and `amount` summed over findings with `in_total` true. `net`: the same with each order counted once, at its largest charge (`rules.md`, "Overlap"); equals `gross` when nothing overlaps. |
| `journeys[]` | Orders the report draws (at most 3): `order_ref`, `segments[]`, `segments_unavailable` (why there are no segments; a snapshot has no history), `findings[]`, `correlation`, and `story[]`: the order step by step (`at`, `system`, `what` (one plain sentence), `record` (`id` and `endpoint`, or `null`), `finding` (the rule id that starts at this step, or `null`), `observed`, `reason` (why a step is not observed)). A step the source cannot show stays in the list with `observed` false. |

## Findings

| Key | Meaning |
|---|---|
| `id`, `rule_version` | The rule (`R04`) and its version (`R04@2`). |
| `title`, `plain_summary` | The name, and one sentence a non-specialist understands. |
| `where` | The system or seam where it happens, for example `OMS` or `OMS→PROV`. |
| `severity` | `critical`, `high` or `medium`, derived from impact (`rules.md`). |
| `status` | `detected`; `not_detected` (the rule ran and found nothing); `insufficient_evidence` (the source cannot show what the rule needs, for example snapshots for timing rules); `not_evaluable` (a system the rule needs is absent or covers too little). Today `runAudit` lists only `detected` findings; the other three states arrive with the rules that need them. |
| `affected_orders`, `share_of_orders` | Count and fraction of orders. |
| `evidence_level` | `strong`, `weak` or `history` (see the rule). |
| `evidence[]`, `evidence_total` | A sample of **at most 20 orders** (`EVIDENCE_SAMPLE_MAX`), each with `order_ref`, `event_ids`, `records[]` (`system`, `external_id`, `endpoint`) and an optional `note`; `evidence_total` is how many orders the rule found. |
| `confidence` | `level` (`confirmed` when every link the evidence rests on is explicit, else `possible`) and `inferred_link_share`. |
| `breakdown` | Optional, rule-specific counts. R04: `groups`, `extra_service_orders`, `retry_new_order`, `parallel_duplicate`, `needs_review`, `reached_activation`, `activation_attempts`. |
| `in_total` | Whether the finding counts in `totals`. R05 is `false` (D-11). |
| `cost` | See below. |
| `recommendation` | What to do about it. |

## Cost

| Key | Meaning |
|---|---|
| `currency` | `USD`. |
| `kind` | `recurring` (R01, R02, R05), `one_off` (R04 clean-up) or `accumulated_to_period_end` (R03). The report never mixes kinds in one "per month" column. |
| `period_days`, `normalisation` | Days the amount covers and how it became "per month"; `null` when it did not need to (a one-off). |
| `hours_month`, `amount_month` | The hours and the amount. For a `one_off` they are the amount of the audited period, not a monthly rate. **`amount_month` is the sum of `terms[].amount`; revenue at risk never enters it.** |
| `formula` | The text of the formula in `rules.md`. Required. |
| `inputs[]` | `key` (a dotted key of `config.json`, such as `rates.cleanup_minutes`), `value` (must equal the config), and `source`, `owner`, `date` (null until M5-07 provides them). |
| `terms[]` | `name`, `amount`, `basis`, `observed` (the count the term multiplies, when measured) and `input_keys` (keys in `inputs`). `basis` is `measured` (counted in the evidence), `rate_assumption` (an amount from `config.json`) or `not_observed`. A rate times a measured count is `rate_assumption`; `observed` says the count was measured. |
| `unmeasured[]` | `term` and `reason` for a term the source cannot show; it is not in `terms` and not in the amount. |
| `revenue_at_risk` | `amount`, `basis` (`arpu_assumption` or `null`) and `label` ("not lost revenue"). Never added to the amount. |

R04 has two terms: clean-up (`rates.cleanup_minutes`, `loaded_hour_usd`) and duplicate
activations (`rates.duplicateActivationCostUsd`). When the source has no activation records
the second term moves to `unmeasured` and the amount is the clean-up alone.

## Numbers

The file is written with two-space indent, a final newline and keys in the order of the model.
Hours (`hours`, `hours_month`) are rounded to one decimal and money (`amount`, `amount_month`)
to two, in `src/adapters/report/json_renderer.ts` and nowhere else; `config` is never rounded.
`run.id` and `run.generated_at` are the only fields that differ between two runs on the same
input.

## Not in `findings/1` yet

Ranges (a later card), redaction of identifiers (a
later card), catalog counts, `rules_versions` per source.
Their keys either exist with an empty value, as listed above, or are added with a version
bump of the schema.

## Example

The R04 finding of the demo, as `deno task audit` produces it over the stub (20 of 5,000
orders, 30 h, USD 1,350 + USD 240 = USD 1,590). The evidence sample is shortened to two of
its twenty orders and `journeys` to one, to keep the page readable; the validator accepts any
sample up to twenty. A test validates this exact block.

```json
{
  "schema_version": "findings/1",
  "engine_version": "0.3.5",
  "run": {
    "id": "b11b48203b389607",
    "generated_at": "2026-09-01T00:00:00Z",
    "inputs_hash": "16e384b8b09a420ed80986b345eb99c5d7cb2280c37358f3c34a3a4ffd4acac9",
    "config_hash": "d3cdb513cc14f476244c57b733437bda558df9629118e9c5ee5e795d12c46001",
    "rules_hash": "47aac6ef77567d17c45407f2e9bb024bab8902bd3949a9892ab0694262d1449f"
  },
  "sources": [
    {
      "system": "OMS",
      "name": "TMF622 productOrder",
      "kind": "tmf-api",
      "endpoint": "http://127.0.0.1:8081/tmf-api/productOrdering/v4/productOrder",
      "simulated": true,
      "evidence_kind": "snapshot",
      "records": 5000,
      "rows_read": 5000,
      "rows_discarded": 0,
      "sha256": "cbac3f6f9a14d3eaf24f9a790e5b441aae3ac27ce3b0d60fb8c2fc4d02401bff"
    },
    {
      "system": "OMS",
      "name": "TMF641 serviceOrder",
      "kind": "tmf-api",
      "endpoint": "http://127.0.0.1:8081/tmf-api/serviceOrdering/v4/serviceOrder",
      "simulated": true,
      "evidence_kind": "snapshot",
      "records": 5020,
      "rows_read": 5020,
      "rows_discarded": 0,
      "sha256": "6caca13466bbaea8bcf75a4c1fdc655072661c56bfc13f832ad69155012e4dd4"
    },
    {
      "system": "PROV",
      "name": "TMF640 serviceActivation",
      "kind": "tmf-api",
      "endpoint": "http://127.0.0.1:8081/tmf-api/serviceActivationAndConfiguration/v4/serviceActivation",
      "simulated": true,
      "evidence_kind": "snapshot",
      "records": 5400,
      "rows_read": 5400,
      "rows_discarded": 0,
      "sha256": "3d9ea88e01d2c0b338a6784540d5c953b44ee9c1deaf317992c28263a85a854a"
    }
  ],
  "labels": {
    "synthetic_data": true,
    "simulated_integration": true,
    "estimated_impact": true
  },
  "config": {
    "currency": "USD",
    "orders_per_month": 5000,
    "loaded_hour_usd": 45,
    "rates": {
      "manual_minutes": 5,
      "daily_followup_minutes": 15,
      "cleanup_minutes": 90,
      "investigation_minutes": 45,
      "duplicate_activation_cost_usd": 12,
      "arpu_usd": 65
    },
    "thresholds": {
      "retry_window_hours": 24,
      "stuck_after_hours": 72,
      "duplicate_window_minutes": 10
    }
  },
  "correlation": {
    "links": {
      "service_order->order": {
        "explicit": 5020,
        "inferred": 0,
        "ambiguous": 0,
        "missing": 0,
        "conflicting": 0
      },
      "process->service_order": {
        "explicit": 0,
        "inferred": 0,
        "ambiguous": 0,
        "missing": 0,
        "conflicting": 0
      },
      "process->order": {
        "explicit": 0,
        "inferred": 0,
        "ambiguous": 0,
        "missing": 0,
        "conflicting": 0
      },
      "attempt->service_order": {
        "explicit": 5100,
        "inferred": 0,
        "ambiguous": 0,
        "missing": 300,
        "conflicting": 0
      }
    },
    "unresolved": 300,
    "unmapped": 0
  },
  "systems": [
    {
      "system": "CAT",
      "name": "Product catalog",
      "role": "lists what is sold and the technical data needed to switch it on",
      "position": 1,
      "read": false,
      "source_kind": null,
      "records": 0,
      "coverage": null,
      "cannot_observe": [
        "not read in this run: no catalog source is wired yet"
      ],
      "findings": []
    },
    {
      "system": "OMS",
      "name": "Order manager",
      "role": "receives the order and splits it into service orders",
      "position": 2,
      "read": true,
      "source_kind": "tmf-api",
      "records": 10020,
      "coverage": 1,
      "cannot_observe": [
        "when each state change happened: the source is a snapshot, not a history"
      ],
      "findings": [
        "R04"
      ]
    },
    {
      "system": "BPM",
      "name": "Process orchestrator",
      "role": "runs the tasks in order and hands some to people",
      "position": 3,
      "read": false,
      "source_kind": null,
      "records": 0,
      "coverage": null,
      "cannot_observe": [
        "not read in this run: no process source is wired yet"
      ],
      "findings": []
    },
    {
      "system": "PROV",
      "name": "Activation system",
      "role": "switches the service on in the network; can fail and retry",
      "position": 4,
      "read": true,
      "source_kind": "tmf-api",
      "records": 5400,
      "coverage": 0.94,
      "cannot_observe": [
        "when each attempt changed state: the source is a snapshot, not a history"
      ],
      "findings": [
        "R04"
      ]
    }
  ],
  "findings": [
    {
      "id": "R04",
      "rule_version": "R04@2",
      "title": "Duplicate service order",
      "plain_summary": "When activation failed, someone retried by hand and the order manager created a second service order for the same line.",
      "where": "OMS",
      "severity": "medium",
      "status": "detected",
      "affected_orders": 20,
      "share_of_orders": 0.004,
      "evidence_level": "strong",
      "evidence": [
        {
          "order_ref": "ORD-1000",
          "event_ids": [
            "SO-20000",
            "SO-30000",
            "ACT-80000"
          ],
          "records": [
            {
              "system": "OMS",
              "external_id": "ORD-1000",
              "endpoint": "http://127.0.0.1:8081/tmf-api/productOrdering/v4/productOrder"
            },
            {
              "system": "OMS",
              "external_id": "SO-20000",
              "endpoint": "http://127.0.0.1:8081/tmf-api/serviceOrdering/v4/serviceOrder"
            },
            {
              "system": "OMS",
              "external_id": "SO-30000",
              "endpoint": "http://127.0.0.1:8081/tmf-api/serviceOrdering/v4/serviceOrder"
            },
            {
              "system": "PROV",
              "external_id": "ACT-80000",
              "endpoint": "http://127.0.0.1:8081/tmf-api/serviceActivationAndConfiguration/v4/serviceActivation"
            }
          ],
          "note": "2 service orders over item ORD-1000-1 (1 extra, retry_new_order); a duplicate reached activation"
        },
        {
          "order_ref": "ORD-1001",
          "event_ids": [
            "SO-20001",
            "SO-30001",
            "ACT-80001"
          ],
          "records": [
            {
              "system": "OMS",
              "external_id": "ORD-1001",
              "endpoint": "http://127.0.0.1:8081/tmf-api/productOrdering/v4/productOrder"
            },
            {
              "system": "OMS",
              "external_id": "SO-20001",
              "endpoint": "http://127.0.0.1:8081/tmf-api/serviceOrdering/v4/serviceOrder"
            },
            {
              "system": "OMS",
              "external_id": "SO-30001",
              "endpoint": "http://127.0.0.1:8081/tmf-api/serviceOrdering/v4/serviceOrder"
            },
            {
              "system": "PROV",
              "external_id": "ACT-80001",
              "endpoint": "http://127.0.0.1:8081/tmf-api/serviceActivationAndConfiguration/v4/serviceActivation"
            }
          ],
          "note": "2 service orders over item ORD-1001-1 (1 extra, retry_new_order); a duplicate reached activation"
        }
      ],
      "evidence_total": 20,
      "confidence": {
        "level": "confirmed",
        "inferred_link_share": 0
      },
      "in_total": true,
      "cost": {
        "currency": "USD",
        "kind": "one_off",
        "period_days": null,
        "normalisation": null,
        "hours_month": 30,
        "amount_month": 1590,
        "formula": "hours = duplicates × cleanup_minutes / 60; amount = hours × loaded_hour_usd + duplicates_that_reached_activation × duplicate_activation_cost_usd",
        "inputs": [
          {
            "key": "rates.cleanup_minutes",
            "value": 90,
            "source": null,
            "owner": null,
            "date": null
          },
          {
            "key": "loaded_hour_usd",
            "value": 45,
            "source": null,
            "owner": null,
            "date": null
          },
          {
            "key": "rates.duplicate_activation_cost_usd",
            "value": 12,
            "source": null,
            "owner": null,
            "date": null
          }
        ],
        "terms": [
          {
            "name": "Clean-up of duplicate service orders",
            "amount": 1350,
            "basis": "rate_assumption",
            "observed": 20,
            "input_keys": [
              "rates.cleanup_minutes",
              "loaded_hour_usd"
            ]
          },
          {
            "name": "Duplicate activations",
            "amount": 240,
            "basis": "rate_assumption",
            "observed": 20,
            "input_keys": [
              "rates.duplicate_activation_cost_usd"
            ]
          }
        ],
        "unmeasured": [],
        "revenue_at_risk": {
          "amount": 0,
          "basis": null,
          "label": "not lost revenue"
        }
      },
      "recommendation": "Make the retry reuse the existing service order, and confirm in billing the orders whose duplicate reached activation."
    }
  ],
  "overlap": {
    "by_order": {},
    "pairs": []
  },
  "totals": {
    "gross": {
      "hours": 30,
      "amount": 1590
    },
    "net": {
      "hours": 30,
      "amount": 1590
    }
  },
  "journeys": [
    {
      "order_ref": "ORD-1000",
      "segments": [],
      "findings": [
        "R04"
      ],
      "correlation": {
        "strong": true,
        "gaps": []
      },
      "segments_unavailable": "ORD-1000: the evidence is a snapshot read from http://127.0.0.1:8081/tmf-api/productOrdering/v4/productOrder; a snapshot has no record of when each step ran, so no segments can be built",
      "story": [
      {
            "at": "2026-09-01T00:00:27.000Z",
            "system": "OMS",
            "what": "The order manager received the order.",
            "record": {
                  "id": "ORD-1000",
                  "endpoint": "http://127.0.0.1:8081/tmf-api/productOrdering/v4/productOrder"
            },
            "finding": null,
            "observed": true,
            "reason": null
      },
      {
            "at": null,
            "system": "CAT",
            "what": "The product catalog was checked that the offer can be sold and activated.",
            "record": null,
            "finding": null,
            "observed": false,
            "reason": "not visible in this source"
      },
      {
            "at": "2026-09-01T02:32:27.000Z",
            "system": "OMS",
            "what": "A service order (SO-20000) was created for line 1.",
            "record": {
                  "id": "SO-20000",
                  "endpoint": "http://127.0.0.1:8081/tmf-api/serviceOrdering/v4/serviceOrder"
            },
            "finding": null,
            "observed": true,
            "reason": null
      },
      {
            "at": null,
            "system": "BPM",
            "what": "The process orchestrator ran its tasks for the order.",
            "record": null,
            "finding": null,
            "observed": false,
            "reason": "not visible in this source"
      },
      {
            "at": "2026-09-01T07:07:57.000Z",
            "system": "PROV",
            "what": "An activation attempt on SO-20000 failed.",
            "record": {
                  "id": "ACT-70000",
                  "endpoint": "http://127.0.0.1:8081/tmf-api/serviceActivationAndConfiguration/v4/serviceActivation"
            },
            "finding": null,
            "observed": true,
            "reason": null
      },
      {
            "at": "2026-09-03T19:07:27.000Z",
            "system": "OMS",
            "what": "A second service order (SO-30000) was created for line 1, which already had one.",
            "record": {
                  "id": "SO-30000",
                  "endpoint": "http://127.0.0.1:8081/tmf-api/serviceOrdering/v4/serviceOrder"
            },
            "finding": "R04",
            "observed": true,
            "reason": null
      },
      {
            "at": "2026-09-03T19:08:07.000Z",
            "system": "PROV",
            "what": "An activation attempt on SO-30000 succeeded.",
            "record": {
                  "id": "ACT-80000",
                  "endpoint": "http://127.0.0.1:8081/tmf-api/serviceActivationAndConfiguration/v4/serviceActivation"
            },
            "finding": null,
            "observed": true,
            "reason": null
      }
]
    }
  ]
}
```
