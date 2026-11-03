# Rule catalogue

Status: R04 is implemented (`src/domain/rules/r04.ts`, M3-02) and registered in `src/domain/rules/index.ts`; the others are designed. R04 is the first rule (milestone Demo 1) and its
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

**Signal.** A `ProvisioningAttempt` ends in `failed` and no later attempt exists for
the same `so_ref` within `retry_window_hours` (default 24), while the service order
is not `CANCELLED`.

**Evidence.** The failed attempt (error code, queue), the gap to the next event,
and the point where the order leaves the automated path.

**Impact.**

```
hours = affected × (manual_minutes + wait_days × daily_followup_minutes) / 60
```

**Demo.** 8% of 5,000 orders = 400 orders, 25 manual minutes and 2.5 days of wait.

**Known limits.** A planned maintenance window looks the same as a failure. Exclude
error codes listed in `expected_failures` and require the gap to cross a retry window.

## R02 — Missing catalog attribute forces a manual check

**Signal.** For an offer version sold during the period, its spec lacks an attribute
with `used_by = PROV` that the BPM activities reference, and the process contains a
manual task that fills the missing value (capacity check, beam assignment).

**Evidence.** Offer version → spec, the absent attribute, and the manual activity
instances with actor `human`.

**Impact.**

```
hours = affected × manual_minutes / 60
```

**Demo.** `capacity_profile` missing on the first offer version; 4,167 of 5,000 orders (83%), 5 minutes each = 347 h. Orders on the second version (833) get an automatic check.

**Known limits.** A manual task can be deliberate (engineering approval). Only count
it when it exists *because* an attribute is missing, not when it has another purpose.

## R03 — BPM timer expires without compensation

**Signal.** A timer boundary event expires in the activation subprocess, the next
activity is neither a compensation nor an error handler, and the process shows no
state change for longer than `stuck_after_hours` (default 72).

**Evidence.** Timer activity, expiry timestamp, absent compensation, last state change,
and the order's age.

**Impact.**

```
hours = stuck × (manual_minutes + days_stuck × daily_followup_minutes) / 60
                                   // days_stuck: from the timer expiry to the end of the audited period
```

**Demo.** 3% (150 orders) hit the timer; one third (50) never close on their own. They have been stuck about 25 days at the end of September: 50 × (5 + 25 × 15) min = 317 h.

**Known limits.** A long-running but healthy process must not be flagged. Require both
the expired timer and the absence of any subsequent event.

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
20 groups, 21 extras (ORD-1017 has three service orders), all `retry_new_order`, 30 h and
**30 h** (20 × 90 min of clean-up). The duplicate activations are counts in `breakdown`, not a
cost term: they had only a money value, and the engine reports hours (D-21). A low/base/high range arrives with
M5-07; until then the cost is one value, every term `basis: rate_assumption`.

**R04@2 classification.** Service orders over one item are ordered by creation time; the first
is the original.

| Group | Meaning |
|---|---|
| `retry_new_order` | the original ended `FAILED` and a new service order was created: the demo's 20, what the rule exists to catch |
| `parallel_duplicate` | the original is still live |
| `needs_review` | the service orders have different known specs (for example an amendment): not counted, not priced; if no group is a duplicate there is no finding |

A spec of `unknown` (a source that sends none) cannot show a difference. The action of a
service order is not modelled yet, so it is not compared (M2-08/M2-10). The finding is titled
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

**Signal.** An order's records cannot be linked by a declared key and are resolved by a
time window, or an entity has no shared key with its parent (for example, a provisioning
attempt that only carries a terminal serial).

**Evidence.** Each weak link, the two records involved and the matching rule that was
needed to join them.

**Impact.**

```
hours = incidents_per_month × investigation_minutes / 60
```

**Demo.** 300 incidents/month at 45 minutes = 225 h/month.

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
for all of them: the `findings/1` schema, documented with a complete R04 example in
[report-schema.md](report-schema.md). A finding carries its `cost` block: the formula
written in this catalogue, the `config.json` inputs it used, the terms that add up to the
hours (each with its `basis`) and what could not be measured. The old per-rule example is replaced by the schema.
