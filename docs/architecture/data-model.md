# Data model

Status: types implemented and dataset v2 generated (version 0.3.5); correlation (M2) and rule R04 (M3-02) are
implemented; the cost report arrives in M4.

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

Demo offers: `SkyHome 50`, `SkyHome 100`, `SkyHome 200`. Every first version's spec defines `terminal_model` (PROV), `qos_profile` (PROV, OMS) and `installation_type` (BPM). `capacity_profile` is missing from all of them, so a person does the capacity check. `SkyHome 200` has a second version, `v2`, valid from 2026-09-15T23:58Z (mid-month), whose spec `SPEC-SKYHOME-200-V2` adds `capacity_profile`: orders on it have an automatic capacity check, so R02 is a subset of the orders, not all of them. The catalog has no `beam_id` and no `kit`.

## Orders

```
Order ──1:n── ServiceOrder ──1:n── WorkOrder
                  └──1:1── ProcessInstance ──1:n── Activity
                  └──1:n── ProvisioningAttempt
```

| Entity | Key | Notes |
|---|---|---|
| `Order` | `ORD-…` | Commercial order. Owned by the sales/CRM side, which is **out of scope** and enters only as the root id. `replaces_order_ref` names the order an amendment replaces; the replaced order ends `CANCELLED`. |
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

Terminal states: `ACTIVE`, `CANCELLED`, `FAILED`, `REJECTED` (refused by validation before decomposition; not the same as a failure downstream). Other states the sources can report are `HELD`, `PARTIAL`, `CANCELLING` and `UNMAPPED` (a state we could not read). Everything else with no event for longer than `stuck_after` is **stuck** and counted by R03, unless a person or the customer owns the wait (see Legitimate cases).

### Legitimate cases in the demo

The demo also holds cases that look odd and are healthy. A rule that flags one is wrong, and each has a count in `data/demo/expected.json` under `cases`:

| Case | Orders | What it looks like |
|---|---|---|
| Normal timer | 200 | a `scheduling_wait` timer that ends on its own (`timer_expired` false): not R03 |
| Long running | 30 | process `RUNNING` about 40 h, installer slot pending, under `stuck_after` |
| Suspended | 1 | process `SUSPENDED` on a customer hold |
| Fallout queue | 1 | failed attempt, human task `fallout_review` open: a person owns it |
| Offer v2 | 833 | `SkyHome 200` sold on `v2`: no human capacity check |
| Permanent error | 40 | attempt failed with `TERMINAL_NOT_REGISTERED`, `ACCOUNT_BLOCKED` or `ADDRESS_NOT_SERVICEABLE`; a retry cannot fix it; order `FAILED` |
| Maintenance failure | 30 | `HUB_TIMEOUT` inside 2026-09-14 02:00-06:00 UTC, retried within the hour |
| Replaced | 10 | an order `CANCELLED` and replaced by the next ten orders |
| Three-service-order duplicate | 1 | one of the 20 planted duplicates has a third service order; still one R04 order |
| Reused serial | 5 | a terminal serial held by two orders |

Not built yet: a change plus an add on one order item (needs an `action` on the service order and an R04 that reads it).

## BPM evidence contract

What the engine asks of a BPM export (M2-09). A real engine (Camunda 7, Flowable) keeps separate history tables; the model reads one record per process instance with a flat list of activities (`data/demo/bpm_history.jsonl`). `tests/bpm_contract_test.ts` checks the demo against the **required** column. Fields marked optional may be absent; a rule that needs one says so and reports "not observed" otherwise. New fields (user task assignee, incidents, variables) arrive with M2-10.

| Canonical term | Field | Required | A real export calls it (Camunda 7 / Flowable) |
|---|---|---|---|
| Process instance | `process_id` | yes | `ACT_HI_PROCINST.ID_` / `PROC_INST_ID_` |
| | `so_ref` | one of `so_ref`, `business_key` | a process variable, or `BUSINESS_KEY_` |
| | `business_key` | one of `so_ref`, `business_key` | `ACT_HI_PROCINST.BUSINESS_KEY_` |
| | `state` | yes | `STATE_` (`ACTIVE`, `COMPLETED`, `SUSPENDED`, `EXTERNALLY_TERMINATED`) |
| | `started_at` | yes | `START_TIME_` |
| | `ended_at` | yes, null while running | `END_TIME_` |
| Activity instance | `activities[].sequence` | yes | order by `START_TIME_` in `ACT_HI_ACTINST` |
| | `activities[].kind` | yes (`task`, `timer`, `gateway`) | `ACT_TYPE_` (`userTask`, `serviceTask`, `intermediateTimer`, `exclusiveGateway`, `boundaryTimer`) |
| | `activities[].name` | yes | `ACT_NAME_` / `ACT_ID_` |
| | `activities[].started_at`, `ended_at` | yes, `ended_at` null while open | `START_TIME_`, `END_TIME_` |
| User task | `activities[].actor` (`human`, `system`, `partner`) | yes | a row in `ACT_HI_TASKINST` means `human`; `ASSIGNEE_` names the person (not read) |
| Timer | `activities[].timer_expired` | optional | `ACT_HI_JOB_LOG` entry of type `timer`, `JOB_DEF_TYPE_`, with an execution (fired) versus a deleted job |
| Incident | not in the model yet | optional (M2-10) | `ACT_HI_INCIDENT` (`INCIDENT_TYPE_`, `CREATE_TIME_`, `END_TIME_`) |
| Variable | not in the model yet | optional (M2-10) | `ACT_HI_VARINST` (`NAME_`, `VAR_TYPE_`, `TEXT_`) |

Camunda 8 exports (Zeebe/Operate) use the same ideas under other names: process instance, flow node instance, job, incident, variable.

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

### Two times, two kinds of evidence

`at` is when the thing **happened**. When it was **observed** is a separate fact, kept in
`provenance.retrieved_at` together with the source id, the endpoint and whether the source
is simulated. Never fill one from the other.

An API such as TMF returns a **snapshot**: the state of a resource when it was read, with no
record of how it got there. An event export is a **history**: transitions with their own
timestamps. `provenance.kind` says which, and a rule that needs durations or transitions
(R01, R03) must refuse `snapshot` evidence instead of guessing. R04 needs neither: two
service orders over one product order item (`product_order_item_ref`) is visible in a
snapshot.

## Correlation

Four identifiers, none shared by all four systems:

| System | Own id | Knows |
|---|---|---|
| OMS | `SO-` | `order_ref` |
| BPM | `BPM-` | sometimes only a business key (`order_ref`) |
| PROV | `ACT-` + `sn` | `so_ref` when well integrated, otherwise only `sn` |

Every join carries how sure it is, and anything short of `explicit` is counted as a
correlation gap (`src/domain/correlation.ts`):

| Confidence | Meaning | Example |
|---|---|---|
| `explicit` | The record names its parent and the parent exists | a service order whose item points at `ORD-1005-1` |
| `inferred` | No reference, but exactly one candidate fits | an attempt with only a terminal serial that matches one service order |
| `ambiguous` | Several candidates fit, or the id pointed at is not unique | a serial shared by two service orders; two orders with the same id |
| `missing` | No reference and no candidate, or the reference points at nothing | an activation with no service order; a service order naming an order that is not in the data |
| `conflicting` | Two references on one record disagree | `orderRef` says A but the order line belongs to B |

Resolution order: declared key → the order line a service order points at → terminal serial
(an empty serial is absent and never joins) → business key for a process. Matching by a time
window is **not implemented**: it would hide wrong joins, so it waits for a source that
needs it. Records that cannot be placed under exactly one order are kept in `unresolved`
with the link that says why; nothing is dropped. Duplicate ids are reported, and every
link that points at one is `ambiguous`. The result does not depend on input order.

### TMF states

Readers map TMF states to the canonical lifecycle in `tmf_mapping.ts`. The translation is
lossy (an API state stands for the later part of the lifecycle, so `IN_PROGRESS` is
`PROVISIONING` whether the order was installed or not) and the table is in that file. An
unknown state never fails the read: the record maps to `UNMAPPED` (`unmapped` for an attempt) and keeps the source text in `rawState`; correlation counts these by system and state, and no rule counts them as failed or active. TMF `rejected` stays `REJECTED`, apart from `failed`. Fields the API does not carry are marked, not
invented: `offerVersion` and `specId` are `"unknown"` and an attempt's `serial` is empty.

An attempt may also carry optional detail (M2-07), filled only when the source has it: `attemptNo`, `operation` (`activate`, `suspend`, `deactivate`, `modify`), `requestId`, `callbackAt` (TMF640 `callbackDate`) and `outcome` (`succeeded`, `failed`, `timeout`, `pending`; a `timeout` is an unknown outcome, a `failed` a known one). Nothing requires them and a value outside the lists is left out, not guessed. No rule uses them yet.

### Derived order state

`src/domain/order_state.ts` (M2-06) derives a state per product order item from its service orders (`active`, `partial`, `failed`, `in_progress`, `unknown`) and combines the items into one for the order. Active and failed service orders over one item give `partial`. `disagrees` is true when the order's own state (`ACTIVE`, `FAILED`, `PARTIAL`, or an in-flight state) contradicts the derived one; states that claim nothing comparable (`CANCELLED`, `HELD`, `UNMAPPED`...) never disagree. It is informational: `deno task read` prints the count, and no cost or finding comes from it.

`OrderJourney` is the reconstruction result:

```ts
type OrderJourney = {
  order_ref: string;
  segments: Segment[];      // system, from, to, duration, kind: work | wait | gap
  segments_unavailable?: string; // why segments is empty, for snapshot evidence
  findings: string[];       // rule ids that fired
  correlation: { strong: boolean; gaps: string[] };
};
```

Segments are what the timeline visual draws: the report shows time spent **waiting**, not time spent working.

| Kind | What it is |
|---|---|
| `work` | A system is executing: a process task, or a provisioning attempt. A human task is `work` with `actor: human`; its queue time cannot be told apart from hands-on time |
| `wait` | A process timer is running |
| `gap` | No system has any record covering this time: nobody is known to be working |

A gap is the finding-worthy one, but not proof of a fault: the data cannot say what was
happening. Segments never overlap (when a task and an attempt start together the attempt is
kept, because its state is the outcome), start when the order is submitted and end at the
last record with an end time; records still running are returned as `open`. They need
event history: snapshot evidence is refused with a reason (`segments_unavailable`) instead
of guessed at.

## Invariants

The dataset must satisfy these, and `tests/dataset_test.ts` checks them:

1. Every `ServiceOrder` has exactly one parent `Order` reachable by `order_ref`.
2. Every `WorkOrder` has exactly one parent `ServiceOrder`.
3. Every `ProcessInstance` maps to one `ServiceOrder`, directly or through a business key.
4. Every `ProvisioningAttempt` carries a terminal serial; `so_ref` is optional, and its absence is itself a finding (R05).
5. Events of one entity are monotonic in `at`; equal timestamps are ordered by `event_id`.
6. A terminal state (`ACTIVE`, `CANCELLED`, `FAILED`) has no later state event, only corrections recorded as new events.
7. Every order ends in a terminal state or is deliberately stuck for the demo; there is no unexplained third case.
8. Offer versions of the same offer do not overlap in time.
9. No event is lost: ingested events = events in journeys + orphans.
10. No event carries a real customer's data.

## Worked example

`OrderJourney` for the demo order described in [product](../product.md):

```json
{
  "order_ref": "ORD-1042",
  "correlation": { "strong": false, "gaps": ["PROV ACT-5510 linked by serial SN-449120"] },
  "segments": [
    { "system": "CAT",  "from": "2026-09-02T09:14:00Z", "to": "2026-09-02T09:15:00Z", "kind": "work", "state": "VALIDATED" },
    { "system": "BPM",  "from": "2026-09-02T09:15:00Z", "to": "2026-09-02T11:40:00Z", "kind": "wait", "state": "MANUAL_CAPACITY_CHECK", "actor": "human" },
    { "system": "OMS",  "from": "2026-09-02T11:41:00Z", "to": "2026-09-02T13:02:00Z", "kind": "work", "state": "DECOMPOSED" },
    { "system": "PROV", "from": "2026-09-02T13:02:00Z", "to": "2026-09-04T18:20:00Z", "kind": "gap",  "state": "HUB_TIMEOUT" },
    { "system": "BPM",  "from": "2026-09-04T18:20:00Z", "to": "2026-09-05T09:14:00Z", "kind": "wait", "state": "TIMER_EXPIRED" },
    { "system": "PROV", "from": "2026-09-05T09:14:00Z", "to": "2026-09-05T09:31:00Z", "kind": "work", "state": "ACTIVE" }
  ],
  "findings": ["R01", "R02", "R03", "R04", "R05"]
}
```

The gap is the point: two and a half days where the order was not waiting for a person
and not being worked on by a system.

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

`config.json` and `catalog.json` use snake_case keys (`loaded_hour_usd`, `rates.cleanup_minutes`,
`spec_id`, `used_by`, `valid_from`, `price_usd`), like every data file the project defines (D-14).
The engine reads them through one translation at the edge (`src/domain/data_files.ts`); its
internal types stay camelCase. TMF payloads stay camelCase, as the standard has them.

Example: R02 fires on the 4,167 orders still on the first offer versions (83%) at 5 minutes each → 347 h/month → USD 15,625 at USD 45/h. The rate is visible in the report so the client can replace it with their own.

## Raw data

Exports are not versioned: `docs/data/raw/` is ignored. Only the synthetic demo dataset is committed, and it contains no real customer data.

## The bss-oss-rust dialect

The candidate evaluated in M0-04 speaks a weaker TMF than the stub serves. The adapter
maps this dialect; the stub does not imitate it. Observed at commit `c65aacd6` (full
contract and captures in `../../sandbox/bss-oss/setup/CONTRACTS.md`, outside the
repositories per ADR 0004):

| Standard shape (the stub serves this) | bss-oss-rust (observed) |
|---|---|
| camelCase (`orderDate`, `relatedParty`) | snake_case (`order_date`, `external_id`) |
| `productOrderItem` / `serviceOrderItem` always present | items accepted on create, never returned |
| `serviceOrderItem.productOrderItem`: explicit item link | free-text `external_id` on the service order, client-written |
| activation → service order explicit (`serviceOrder`) | link stored in the database, never returned |
| `offset`/`limit` + `X-Total-Count` | no pagination, no filters, unbounded lists |
| detail expands its items | detail ≡ list row |
| states progress (in the dataset) | no PATCH: state frozen at creation |
| 401 in JSON | 401 in plain text, the rest JSON |

Consequence for correlation: in the dialect, the product order → service order link is a
Flow Audit convention with confidence `inferred`, and activation links are `missing`;
against the stub the item-level link is `explicit`.
