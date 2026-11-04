# Rule catalogue

Status: R01 to R05 are implemented (`src/domain/rules/r01.ts` to `r05.ts`) and registered in `src/domain/rules/index.ts`. Severity is shared (`src/domain/rules/severity.ts`). A rule reads the correlated orders, the config and, when it needs them, a `RuleContext` (the whole correlation and the catalog). R04 is the first rule (milestone Demo 1) and its
Demo 1 specification is written below. The rules below are the five
findings the demo reports. Each one must be defensible: a signal, the
evidence that proves it and a formula that turns it into hours.

## Rule contract

```ts
type Rule = {
  id: string;                 // R01
  title: string;
  severity: Severity;
  appliesTo: "order" | "service_order" | "catalog" | "process";
  detect(journey, catalog, config): Evidence[];
  impact(evidence, config): Impact;
};
```

A rule may not:

- fire without selecting evidence that a human can open;
- invent a rate: every number comes from `ImpactConfig` or from the data;
- depend on wall-clock time or on any file outside the dataset.

## Severity

| Level | When |
|---|---|
| `critical` | affects more than 10% of orders, or more than 200 h/month |
| `high` | affects more than 2% of orders, or more than 50 h/month |
| `medium` | everything else that still has a cost |

Severity is derived from impact, not declared by hand.

## R01 — Provisioning fallout without retry

**Rule version.** `R01@1`.

**Signal.** An activation attempt ends `failed` and no later attempt exists for the same
**product order item** within `thresholds.retry_window_hours` (default 24), while the service
order is not `CANCELLED`. The key is the item, not the service order: R04's retry is a new
service order over the same item, so it is still a retry and the 20 duplicated orders are not
counted twice. The window is inclusive: a retry exactly 24 h later is a retry; 24 h and one
second later is fallout. Only activations are read (an attempt with another `operation` is
ignored).

**Evidence.** The failed attempt (id, error code, error class), the next attempt if one
exists, the gap in days and the confidence of the link that placed the attempt under its order.

**Impact.**

```
hours = affected × (manual_minutes + wait_days × daily_followup_minutes) / 60
```

`affected` is orders (an order with two unretried failures counts once, at its first).
`wait_days` is measured per order, from the failure to the next attempt on the item; with no
next attempt, to the latest moment the data shows (never the wall clock). The cost has two terms:
manual handling and daily follow-up. On the demo: 400 orders (8% of 5,000), the next attempt
comes 60 h (2.5 days) later, so 400 × (5 + 2.5 × 15) / 60 = **283.3 h**. The 20 R04 orders are
in R01 as well; the overlap rule (below) counts each once in the net total.

**Error classes (M3-09).** `rules.r01` in `config.json` holds:

| Key | Meaning |
|---|---|
| `error_classes` | List of `{code, class}`; `class` is `transient`, `permanent`, `maintenance` or `unknown`. A code not listed is `unknown`. |
| `maintenance_windows` | List of `{from, to}` (ISO 8601 UTC, ends included). A failure that starts inside one is `maintenance`, unless its code is `permanent`. |
| `old_pending_hours` | A `pending` attempt older than this (measured to the end of the data) is reported as "old pending", not as a failure. Default 72. |

R01 leaves out `permanent` and `maintenance` failures and reports them in the finding's
`breakdown` (`excluded_permanent`, `excluded_maintenance`). Also counted there: `unknown_code`
(fallout orders whose code is not in the map, counted as fallout), `uncertain_timeout` (an
attempt whose outcome is `timeout` is uncertain, not failed), `old_pending`, `resolved_by_callback`
(a failed attempt whose callback closed it as succeeded), `inferred_links` (evidence placed
by an inferred link) and `unlinked_failed_attempts` / `ambiguous_failed_attempts` (failed
attempts that cannot be placed under one order, for example a reused terminal serial: not
counted, listed in `unmeasured`). A failed attempt whose start time cannot be read is refused
with a reason in `unmeasured`, never guessed. The demo's `HUB_TIMEOUT` is `transient`; its 41
permanent failures are left out. If every failure is left out there is no finding (the rule
returns nothing).

**Known limits.** A planned maintenance window looks the same as a failure: it must be in the
config. The rule cannot tell a retry that was deliberately cancelled from one nobody made.
The error class is a declaration of the client, not something the engine learns.

## R02 — Missing catalog attribute forces a manual check

**Rule version.** `R02@1`. Needs the catalog (CAT) and the process tasks (BPM): both come from
the file exports; the TMF stub serves neither, so over `--source stub` the rule does not run.

**Signal.** The contract is a declared list, `rules.r02.activation_requirements` in
`config.json`: `[{attribute, required_by, via_task}]`, meaning "`required_by` needs this
attribute in the spec, and `via_task` is the manual task a person does when it is missing".
That tie is declared, never inferred. An order counts when the spec of its offer version lacks
the attribute and one of its processes ran a **human** task named `via_task`. (`used_by` in
the catalog stays informational: an absent attribute has no `used_by`.)

Which spec applies: the offer version on the order when the catalog has it (`explicit`); else
the version valid when the order was submitted (`inferred`, the finding is then `possible`);
else unknown: listed in `unmeasured` and not counted.

**Evidence.** Order, offer version, spec, the missing attribute and the process that ran the
manual task.

**Impact.**

```
hours = affected × manual_minutes / 60
```

**Demo.** `capacity_profile` missing on the first offer version; 4,167 of 5,000 orders (83%), 5 minutes each = **347.3 h**. Orders on the second version (833) get an automatic check. `evidence_total` is 4,167; the sample is capped. The hours are freeable capacity, not savings.

**Known limits.** A manual task can be deliberate (engineering approval). Only the task named
in the declared tie counts; a missing attribute with no such task is counted apart
(`missing_without_task`) and not priced. No `to_validate` status yet (M5-07).

## R03 — BPM timer expires without compensation

**Rule version.** `R03@1`.

**Signal.** A timer activity (`timerExpired`; `rules.r03.timer_activities` narrows which ones, empty
means any) expires in the activation subprocess, **no activity follows it**, the process is still
open (not ended, not suspended) and more than `thresholds.stuck_after_hours` (default 72) have
passed between the expiry and the end of the audited period. The end of the period is the newest
order intake, the same window the quality gate uses; no wall clock.

What happens after the expiry decides the bucket, in this order:

| Bucket | When | Counted as stuck |
|---|---|---|
| recovered | a later activity is named in `rules.r03.compensation_activities`, or a child process whose definition key is in `compensation_processes` | no |
| in human management | the process is open and waits on an open human task (any open task with a human actor, or one named in `human_management_tasks`) | no |
| continued | some other activity followed, or the process ended on its own | no |
| suspended | `suspended` is true or the state is `SUSPENDED` | no |
| within threshold | stuck for less than `stuck_after_hours` | no, not yet |
| **stuck** | none of the above | yes |

What counts as a compensation (a task, a child process, a manual step) is **declared in the config
(`rules.r03`)**, never hard-coded in the rule. An open incident on a stuck process is noted in its
evidence.

**Evidence.** Process id, the timer activity, expiry time, "nothing followed", days without
service, open incidents, and the order's record.

**Impact.**

```
hours = stuck × (manual_minutes + days_stuck × daily_followup_minutes) / 60
                                   // days_stuck: from the timer expiry to the end of the audited period
```

The cost kind is `accumulated_to_period_end`. Days are fractional (expiry to period end in
exact milliseconds), and **the figure is rounded only for display, to one decimal**. On the demo
the exact value is 316.97 h, which the report shows as 317.0 h; the engine never rounds inside
the formula. The orders recovered by a person are not charged: R03 counts only the stuck ones.

**Demo.** 150 processes have an expired `activation_timer`; 100 are recovered by the human task
`activation_recovery`; 50 are still `RUNNING` at the end of the period, about 25 days without
service: 50 × (5 + 25 × 15) min = 317.0 h. Net of the orders R02 also charges (the 50 stuck
orders are on the first offer version), the net total is lower than the gross 977.6 h; that is
the overlap rule below.

**Snapshot evidence.** A snapshot has no record of when each step ran. When the process evidence
is a snapshot the finding is `suspected` (not `detected`), with `confidence.level` `possible`,
`evidence_level` `weak` and an `unmeasured` note saying that days and hours are suspected, not
certain. A stuck order whose expiry time cannot be read is still counted, but its days are not
(only the manual minutes are).

**Needs.** OMS and BPM (`RULE_SYSTEMS`). When BPM was not read (the TMF stub serves no BPM) the
rule is `not_evaluable` in the quality report, never "0 findings".

**Known limits.** A long-running but healthy process must not be flagged: it needs an expired
timer and no later event. Multi-instance and event-subprocess logic are stored by the model
(`loopIndex`, `parentProcessId`) but not interpreted yet (0.6.0).

## R04 — Duplicate service order

**Rule version.** `R04@1` — the Demo 1 specification (M3-01). It reads snapshots, so it
needs no event history.

**Signal.** Two or more service orders decompose the **same product order item**: their
`serviceOrderItem.productOrderItem` links carry the same `productOrderId` and item `id`.
A product order line should produce one service order; a second one is a retry that
created a new order instead of retrying the existing one.

The key is the **item**, not the order. A multi-line product order legitimately creates
one service order per line, and each line has its own item id, so it does not fire.

**Evidence levels.** Every finding records which one it used.

| Level | Signal | Source |
|---|---|---|
| `strong` | two service order items reference the same product order item | the TMF stub, and any server that sends the item link |
| `weak` | two service orders share the same free-text `external_id` | a server that sends no item link, such as bss-oss-rust (a dialect reader, M1-04, was discarded); a convention, not a contract |
| `history` | a second service order is created within `duplicate_window_minutes` of a retry attempt on the first | event exports (M5-02); the richer variant, with the retry marker and the attempts |

Demo 1 implements `strong` only.

**Evidence.** The product order, every service order that points at its item (ids, states,
order dates) and the provenance of each record (system, endpoint, read time). With
activations (M1-05b) it adds the attempts, so the report can say whether the duplicate
reached activation.

**Impact.**

```
hours = duplicates × cleanup_minutes / 60
```

`duplicates` is the number of **groups**: product order items with more than one live
service order, once each, however many extra orders they have. Cost stays per group (one
clean-up per item), so it is unchanged from `R04@1`. The finding also reports, in
`breakdown`: `extra_service_orders` (the extras, so three service orders over one item are 2),
`retry_new_order` / `parallel_duplicate` / `needs_review` (groups by cause), and
`activation_attempts` (attempts that ran on an extra service order) next to
`reached_activation` (groups with at least one such attempt). On the synthetic dataset that is
20 groups (plus 1 amendment group, ORD-4500: an `add`, a `modify` and a second `add` over one
item, not counted), 21 extras (ORD-1017 has three service orders), all `retry_new_order`, 30 h and
**30 h** (20 × 90 min of clean-up). The duplicate activations are counts in `breakdown`, not a
cost term: they had only a money value, and the engine reports hours (D-21). A low/base/high range arrives with
M5-07; until then the cost is one value, every term `basis: rate_assumption`.

**R04@2 classification.** Service orders over one item are ordered by creation time; the first
is the original.

| Group | Meaning |
|---|---|
| `retry_new_order` | the original ended `FAILED` and a new service order was created: the demo's 20, what the rule exists to catch |
| `parallel_duplicate` | the original is still live |
| `amendment` | a later service order over the item has `action` `modify` or `delete` (M2-08), for example a plan change plus an added component: not counted, not priced, reported in `breakdown.amendments` |
| `needs_review` | the service orders have different known specs (for example an amendment): not counted, not priced; if no group is a duplicate there is no finding |

A spec of `unknown` (a source that sends none) cannot show a difference. The `action` of a
service order is read (`add`, `modify`, `delete`, `noChange`); an absent or unreadable action is
unknown and never makes an amendment. Two `add` over one item stay a duplicate. Limit: one
`modify` in a group makes the whole group an amendment, so a real duplicate hidden in the same
group is not counted. The finding is titled
"Duplicate service order", not "duplicate activation": the activation is a separate question,
answered by `reached_activation`.

**Severity.** Derived from impact, as for every rule: on the demo, 0.4% of orders and
30 h/month, so `medium`.

**Demo.** 20 orders out of 5,000 (`data/demo/expected.json`, `R04.affected_orders`), each
with two service orders over one product order item. The rule must find exactly those 20.

**Failure cases — when it must not fire, and what it cannot tell.**

| Case | Treatment |
|---|---|
| Multi-line product order, one service order per line | Does not fire: each line has its own item id |
| An earlier service order is `CANCELLED` and a new one replaces it | Does not fire: a cancellation followed by a new order is deliberate |
| Service order with no `productOrderItem` link | Cannot be evaluated; the reader already rejects it (M1-05a) rather than guessing |
| Two service orders created minutes apart by a legitimate split (for example a bundle) on the same item | Fires; cannot be told apart without the retry marker. The recommendation asks the client to confirm |
| Many service orders on one item | One group for cost; every extra is counted in `extra_service_orders` |
| Service orders on one item with different specs | `needs_review`, not counted |

**Known limits.** On snapshots the rule sees that a second order exists, not why it was
created. Treat each finding as a candidate that the evidence supports, not as proof of a
retry. A duplicated activation can become a duplicated charge; billing accuracy is out of
scope, so the finding flags the orders whose duplicate reached activation for the client
to check in billing.

## R05 — No end-to-end correlation id

**Rule version.** `R05@1`.

**Amendments (M2-08).** R05 reads the correlation and so consults amendments through it: a
service order whose order was replaced follows the replacement (an `explicit` link, not
`missing`), and an attempt whose terminal is shared by a cancelled replaced order and its
replacement is placed on the replacement (`inferred`, not `ambiguous`). It is still one weak link
when only the serial joins them.

**Signal.** Every link of the correlation report that is not `explicit` (`inferred`,
`ambiguous`, `conflicting` or `missing`) is one incident. The rule reads the correlation and
does no matching of its own.

**Incident per weak link, not per order.** An order with two weak links is two incidents,
because each one is a separate investigation (two records to join by hand). So
`affected_orders` of the finding counts incidents, and the share is incidents over orders.
An explicit link is never counted.

**Evidence.** Each weak link: the record, what it should have pointed at, its confidence and
the basis. When the record could not be placed under an order (missing or ambiguous), the
evidence entry is named by the record id.

**Impact.**

```
hours = incidents × investigation_minutes / 60
```

**Demo.** 300 weak links at 45 minutes = **225 h** (the 300 attempts that only carry a terminal
serial). The count is the same from both sources; the split by confidence is not: from files the
serial finds its service order (`inferred`), from the stub the serial is not served (`missing`).
R05 is `in_total` false: it is shown apart and is not in the net total (D-11), and it charges no
order.

**Known limits.** Time windows are a fallback, not proof. A weak link is reported as a
correlation gap even when the match happens to be correct.

## Overlap

Rules can charge the same order (R01 and R03 both bill manual minutes and waiting days on a
stuck order), so the sum of the findings (`totals.gross`) can count an order's hours more
than once. `totals.net` counts each order once:

1. For each order, a rule's charge is the sum of what that rule charges the order (one rule
   charging two items of the order is still one rule).
2. When two or more rules in the total charge the same order, only the **largest charge in
   hours** stays. On a tie the **lowest rule id** stays (R01 before R03), so the result never
   depends on the order the rules ran.
3. `net = gross - the charges removed`; with no overlap it equals `gross` exactly.
4. `overlap.by_order` lists the rules that charge each overlapped order and `overlap.pairs`
   counts the orders each pair shares. A finding with `in_total` false takes no part.

A rule supplies its per-order charges (`Rule.charges`) next to its finding; they add up to the
finding's cost. This only removes double counting; it does not say which rule is the root cause
(0.6.0). The report leads with per-rule figures and shows both totals with this explanation.

## Output

Every rule returns the same `Finding` (`src/domain/model.ts`) and the file keeps one shape
for all of them: the `findings/2` schema, documented with a complete R04 example in
[report-schema.md](report-schema.md). A finding carries its `cost` block: the formula
written in this catalogue, the `config.json` inputs it used, the terms that add up to the
hours (each with its `basis`) and what could not be measured. The old per-rule example is replaced by the schema.
