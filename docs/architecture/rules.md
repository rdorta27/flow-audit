# Rule catalogue

Status: designed, not implemented (phase 5). The rules below are the five
findings the demo reports. Each one must be defensible: a signal, the
evidence that proves it and a formula that turns it into hours and USD.

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
usd   = hours × loaded_hour_usd
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
usd   = hours × loaded_hour_usd
```

**Demo.** `capacity_profile` missing; 100% of 5,000 orders, 5 minutes each = 417 h.

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
hours = stuck × (followup_minutes + days_stuck × daily_followup_minutes) / 60
usd   = hours × loaded_hour_usd
revenue_at_risk = stuck × arpu_usd      // reported separately, never added to cost
```

**Demo.** 3% (150 orders) hit the timer; one third (50) never close on their own.

**Known limits.** A long-running but healthy process must not be flagged. Require both
the expired timer and the absence of any subsequent event.

## R04 — OMS retry duplicates service orders

**Signal.** Two service orders share the same parent order and the same spec, and the
second one is created within `duplicate_window_minutes` (default 10) of a retry attempt
on the first. It comes from a replay, not from a second line item.

**Evidence.** Both service orders, the retry marker on the OMS call, and the duplicated
provisioning attempts.

**Impact.**

```
hours = duplicates × cleanup_minutes / 60
usd   = hours × loaded_hour_usd + duplicates × duplicate_activation_cost_usd
```

**Demo.** 5% of retries, about 20 orders/month, 90 minutes of cleanup each.

**Known limits.** Multi-line orders legitimately create several service orders. Compare
line-item count against service-order count before firing.

## R05 — No end-to-end correlation id

**Signal.** An order's records cannot be linked by a declared key and are resolved by a
time window, or an entity has no shared key with its parent (for example, a provisioning
attempt that only carries a terminal serial).

**Evidence.** Each weak link, the two records involved and the matching rule that was
needed to join them.

**Impact.**

```
hours = incidents_per_month × investigation_minutes / 60
usd   = hours × loaded_hour_usd
```

**Demo.** 300 incidents/month at 45 minutes = 225 h/month.

**Known limits.** Time windows are a fallback, not proof. A weak link is reported as a
correlation gap even when the match happens to be correct.

## Output

Every rule writes to `findings.json` with the same shape, so the report and the
heat map do not depend on which rule fired:

```json
{
  "id": "R01",
  "severity": "critical",
  "affected_orders": 400,
  "share_of_orders": 0.08,
  "evidence": [{ "order_ref": "ORD-1042", "event_ids": ["...", "..."] }],
  "impact": { "hours_month": 167, "usd_month": 7515, "revenue_at_risk": 0 },
  "recommendation": "Add an automatic retry with backoff before the order falls out to the manual queue."
}
```
