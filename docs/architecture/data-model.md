# Data model

Status: proposed, phase 0. Complements [architecture](overview.md).

Three models, deliberately separate: **catalog** (what can be sold), **orders** (what was sold) and **events** (what happened).

## Catalog

```
Offer ──1:n── OfferVersion ──1:1── Spec ──1:n── Attribute
```

| Entity | Key | Fields |
|---|---|---|
| `Offer` | `offer_id` | name, family, status, versions |
| `OfferVersion` | `offer_id` + `version` | valid_from, valid_to, price, spec_ref |
| `Spec` | `spec_id` | name, service_type, attributes |
| `Attribute` | `name` | type, required, value_space, used_by (OMS/BPM/PROV) |

The audit cares about one thing here: whether every attribute provisioning needs exists in the spec that the offer version points to. Missing attributes are what push work back to humans.

Demo offers: `SkyHome 50`, `SkyHome 100`, `SkyHome 200`, each with `kit` and `installation`. Required-by-provisioning attributes include `terminal_model`, `beam_id`, `capacity_profile` and `qos_profile`.

## Orders

```
Order ──1:n── ServiceOrder ──1:n── WorkOrder
                  └──1:1── ProcessInstance ──1:n── Activity
                  └──1:n── ProvisioningAttempt
```

| Entity | Key | Notes |
|---|---|---|
| `Order` | `ORD-…` | Commercial order. Owned by the sales/CRM side, which is **out of scope** and enters only as the root id. |
| `ServiceOrder` | `SO-…` | Decomposition of the order. One per service. Carries `order_ref`. |
| `WorkOrder` | `WO-…` | Field or back-office task: installation, activation, recovery. Carries `so_ref`. |
| `ProcessInstance` | `BPM-…` | Orchestration of a service order. Carries `so_ref`, or worse, only a business key. |
| `Activity` | `BPM-…` + sequence | Task, timer, gateway, compensation. |
| `ProvisioningAttempt` | `ACT-…` | One attempt to activate the terminal. Carries `sn` (terminal serial) and `so_ref`. |

### Lifecycle

```
DRAFT → SUBMITTED → VALIDATED → DECOMPOSED → SCHEDULED → INSTALLED → PROVISIONING → ACTIVE
             └──────────────┴──────────────┴────────────┴────────────┴──▶ FAILED / CANCELLED
```

Terminal states: `ACTIVE`, `CANCELLED`, `FAILED`. Everything else with no event for longer than `stuck_after` is **stuck** and counted by R03.

## Events

The only ingestible unit. Append-only, immutable, system-agnostic.

```ts
type Event = {
  event_id: string;
  at: string;              // ISO 8601, UTC
  system: "CAT" | "OMS" | "BPM" | "PROV";
  entity: "order" | "service_order" | "work_order" | "process" | "activity" | "attempt";
  entity_id: string;
  state: string;           // system-specific, normalized to the lifecycle above where possible
  actor: "system" | "human" | "partner";
  order_ref?: string;      // correlation, when the system knows it
  so_ref?: string;
  attrs?: Record<string, unknown>;  // error codes, beam, terminal, queue
};
```

**Rule:** an event without `order_ref` is still kept, and its missing link is itself evidence (R05).

## Correlation

Four identifiers, none shared by all four systems:

| System | Own id | Knows |
|---|---|---|
| OMS | `SO-` | `order_ref` |
| BPM | `BPM-` | sometimes only a business key (`order_ref`) |
| PROV | `ACT-` + `sn` | `so_ref` when well integrated, otherwise only `sn` |

Resolution order for each event: declared key → parent entity key → terminal serial → timestamp window (never silent: a time-based match is recorded as *weak* and counted as a correlation gap).

`OrderJourney` is the reconstruction result:

```ts
type OrderJourney = {
  order_ref: string;
  segments: Segment[];      // system, from, to, duration, kind: work | wait | gap
  findings: string[];       // rule ids that fired
  correlation: { strong: boolean; gaps: string[] };
};
```

Segments are what the timeline visual draws: the report shows time spent **waiting**, not time spent working.

## Impact

Impact is never stored in the data; it is computed at audit time from config:

```ts
type ImpactConfig = {
  orders_per_month: number;
  loaded_hour_usd: number;
  currency: "USD";
  rates: Record<string, number>;  // minutes per manual action, per finding
};
```

Example: R02 fires on 100% of 5,000 orders at 5 minutes each → 417 h/month → USD 18,750 at USD 45/h. The rate is visible in the report so the client can replace it with their own.

## Raw data

Exports are not versioned: `docs/data/raw/` is ignored. Only the synthetic demo dataset is committed, and it contains no real customer data.
