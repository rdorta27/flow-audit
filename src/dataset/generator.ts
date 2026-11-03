// SPDX-License-Identifier: MIT
import type {
  Activity,
  Catalog,
  ImpactConfig,
  Order,
  ProcessInstance,
  ProvisioningAttempt,
  ServiceOrder,
  Spec,
  SystemId,
  WorkOrder,
} from "../domain/model.ts";
import { between, mulberry32 } from "./prng.ts";

export const SEED = 20260901;
export const ORDERS = 5000;
export const FALLOUT_ORDERS = 400;
export const TIMER_ORDERS = 150;
export const STUCK_ORDERS = 50;
export const DUPLICATE_ORDERS = 20;
export const WEAK_LINK_ORDERS = 300;

// Legitimate cases (M6-01). None of them is a defect: a rule that flags one is wrong.
export const NORMAL_TIMER_ORDERS = 200;
export const LONG_RUNNING_ORDERS = 30;
export const SUSPENDED_ORDERS = 1;
export const FALLOUT_QUEUE_ORDERS = 1;
export const PERMANENT_ERROR_ORDERS = 40;
export const MAINTENANCE_FAILURE_ORDERS = 30;
export const REPLACED_ORDERS = 10;
export const THREE_SO_DUPLICATES = 1;
export const REUSED_SERIAL_ORDERS = 5;
/** Plan 200 orders from this index on are sold under offer version v2. */
const V2_FIRST_INDEX = 2500;
export const OFFER_V2_ORDERS =
  Array.from({ length: ORDERS }, (_, i) => i).filter((i) => i >= V2_FIRST_INDEX && i % 3 === 2)
    .length;
/** Failures here are expected: the hub is down for maintenance. */
export const MAINTENANCE_WINDOW = {
  from: "2026-09-14T02:00:00.000Z",
  to: "2026-09-14T06:00:00.000Z",
};
/** A retry cannot fix these: the failure is about the customer or the terminal. */
export const PERMANENT_ERROR_CODES = [
  "TERMINAL_NOT_REGISTERED",
  "ACCOUNT_BLOCKED",
  "ADDRESS_NOT_SERVICEABLE",
];

export const WINDOW_START = Date.UTC(2026, 8, 1, 0, 0, 0);
export const WINDOW_END = Date.UTC(2026, 9, 1, 0, 0, 0);

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Cohorts are contiguous ranges so the golden numbers are exact and auditable. */
const FALLOUT = { from: 0, to: FALLOUT_ORDERS };
const TIMER = { from: FALLOUT_ORDERS, to: FALLOUT_ORDERS + TIMER_ORDERS };
const STUCK = { from: TIMER.from, to: TIMER.from + STUCK_ORDERS };
const WEAK_LINK = { from: TIMER.to, to: TIMER.to + WEAK_LINK_ORDERS };
const DUPLICATE = { from: 0, to: DUPLICATE_ORDERS };

const NORMAL_TIMER = { from: 1000, to: 1000 + NORMAL_TIMER_ORDERS };
const SUSPENDED = { from: 1200, to: 1200 + SUSPENDED_ORDERS };
const FALLOUT_QUEUE = { from: 1201, to: 1201 + FALLOUT_QUEUE_ORDERS };
const PERMANENT = { from: 1300, to: 1300 + PERMANENT_ERROR_ORDERS };
/** Orders that are cancelled because the next `REPLACED_ORDERS` orders replace them. */
const REPLACED = { from: 1400, to: 1400 + REPLACED_ORDERS };
const REPLACING = { from: REPLACED.to, to: REPLACED.to + REPLACED_ORDERS };
/** Serials of orders 1500+ are handed to orders 3000+ (a returned terminal, installed again). */
const REUSED_FROM = 1500;
const REUSED_SERIAL = { from: 3000, to: 3000 + REUSED_SERIAL_ORDERS };
const MAINTENANCE = { from: 2000, to: 2000 + MAINTENANCE_FAILURE_ORDERS };
const LONG_RUNNING = { from: 4700, to: 4700 + LONG_RUNNING_ORDERS };
/** One of the planted duplicates gets a third service order. */
const THREE_SO_INDEX = 5;
const STEP_MS = Math.floor((WINDOW_END - WINDOW_START) / ORDERS);
const OFFER_V2_FROM = new Date(WINDOW_START + V2_FIRST_INDEX * STEP_MS - 2 * MINUTE)
  .toISOString();

export const IMPACT_CONFIG: ImpactConfig = {
  currency: "USD",
  ordersPerMonth: ORDERS,
  loadedHourUsd: 45,
  rates: {
    manualMinutes: 5,
    dailyFollowupMinutes: 15,
    cleanupMinutes: 90,
    investigationMinutes: 45,
    duplicateActivationCostUsd: 12,
    arpuUsd: 65,
  },
  thresholds: {
    retryWindowHours: 24,
    stuckAfterHours: 72,
    duplicateWindowMinutes: 10,
  },
};

const FAILED_ATTEMPTS = FALLOUT_ORDERS + PERMANENT_ERROR_ORDERS + FALLOUT_QUEUE_ORDERS +
  MAINTENANCE_FAILURE_ORDERS;
const ALL_ATTEMPTS = ORDERS + FALLOUT_ORDERS - REPLACED_ORDERS - LONG_RUNNING_ORDERS -
  SUSPENDED_ORDERS + MAINTENANCE_FAILURE_ORDERS + THREE_SO_DUPLICATES;

export const EXPECTED = {
  orders: ORDERS,
  service_orders: ORDERS + DUPLICATE_ORDERS + THREE_SO_DUPLICATES,
  work_orders: ORDERS,
  processes: ORDERS + DUPLICATE_ORDERS + THREE_SO_DUPLICATES,
  attempts: ALL_ATTEMPTS,
  attempts_by_state: {
    failed: FAILED_ATTEMPTS,
    pending: STUCK_ORDERS,
    succeeded: ALL_ATTEMPTS - FAILED_ATTEMPTS - STUCK_ORDERS,
  },
  findings: {
    R01: { affected_orders: FALLOUT_ORDERS, share_of_orders: 0.08 },
    // Only orders on the first version still ask a person for the capacity check.
    R02: {
      affected_orders: ORDERS - OFFER_V2_ORDERS,
      share_of_orders: (ORDERS - OFFER_V2_ORDERS) / ORDERS,
    },
    R03: {
      affected_orders: TIMER_ORDERS,
      stuck_orders: STUCK_ORDERS,
      share_of_orders: 0.03,
    },
    R04: { affected_orders: DUPLICATE_ORDERS, share_of_orders: 0.004 },
    R05: { affected_orders: WEAK_LINK_ORDERS, share_of_orders: 0.06 },
  },
  /** Legitimate cases no rule may flag; each one is a count of orders. */
  cases: {
    normal_timer_orders: NORMAL_TIMER_ORDERS,
    long_running_orders: LONG_RUNNING_ORDERS,
    suspended_orders: SUSPENDED_ORDERS,
    fallout_queue_orders: FALLOUT_QUEUE_ORDERS,
    offer_v2_orders: OFFER_V2_ORDERS,
    permanent_error_orders: PERMANENT_ERROR_ORDERS,
    maintenance_failure_orders: MAINTENANCE_FAILURE_ORDERS,
    replaced_orders: REPLACED_ORDERS,
    three_service_order_duplicates: THREE_SO_DUPLICATES,
    reused_serial_orders: REUSED_SERIAL_ORDERS,
    offer_v2_valid_from: OFFER_V2_FROM,
    maintenance_window: MAINTENANCE_WINDOW,
    permanent_error_codes: PERMANENT_ERROR_CODES,
  },
};

export interface DemoDefects {
  /** Order refs whose first provisioning attempt failed with no retry inside the window. */
  fallout: string[];
  /** Order refs that hit the activation timer. */
  timers: string[];
  /** Order refs still running when the window closed. */
  stuck: string[];
  /** Order refs that ended up with two service orders for the same spec. */
  duplicates: string[];
  /** Order refs whose provisioning attempts carry only a serial. */
  weakLinks: string[];
  /** Cases that look odd and are healthy (M6-01). */
  legit: Record<LegitCase, string[]>;
}

export type LegitCase =
  | "normalTimers"
  | "longRunning"
  | "suspended"
  | "falloutQueue"
  | "offerV2"
  | "permanentErrors"
  | "maintenanceFailures"
  | "replaced"
  | "replacing"
  | "threeServiceOrderDuplicates"
  | "reusedSerials";

export interface DemoDataset {
  catalog: Catalog;
  orders: Order[];
  serviceOrders: ServiceOrder[];
  workOrders: WorkOrder[];
  processes: ProcessInstance[];
  activities: Activity[];
  attempts: ProvisioningAttempt[];
  defects: DemoDefects;
  meta: {
    seed: number;
    windowStart: string;
    windowEnd: string;
    orders: number;
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function inRange(index: number, range: { from: number; to: number }): boolean {
  return index >= range.from && index < range.to;
}

function buildCatalog(): Catalog {
  const prov: SystemId[] = ["PROV"];
  const provAndOms: SystemId[] = ["PROV", "OMS"];
  const bpm: SystemId[] = ["BPM"];

  const specs: Spec[] = [50, 100, 200].map((plan) => ({
    specId: `SPEC-SKYHOME-${plan}`,
    name: `SkyHome ${plan} technical spec`,
    serviceType: "residential-satellite-internet",
    attributes: [
      { name: "terminal_model", type: "string", required: true, usedBy: prov },
      { name: "qos_profile", type: "string", required: true, usedBy: provAndOms },
      { name: "installation_type", type: "string", required: true, usedBy: bpm },
      // capacity_profile is deliberately absent: that gap is finding R02.
    ],
  }));

  // From mid-month the 200 plan is sold on a spec that defines capacity_profile.
  specs.push({
    specId: "SPEC-SKYHOME-200-V2",
    name: "SkyHome 200 technical spec (v2)",
    serviceType: "residential-satellite-internet",
    attributes: [
      ...specs[2].attributes,
      { name: "capacity_profile", type: "string", required: true, usedBy: prov },
    ],
  });

  return {
    specs,
    offers: [50, 100, 200].map((plan) => ({
      offerId: `OFFER-SKYHOME-${plan}`,
      name: `SkyHome ${plan}`,
      family: "SkyHome",
      status: "active" as const,
      versions: [
        {
          version: "v1",
          validFrom: "2026-01-01T00:00:00.000Z",
          validTo: plan === 200 ? OFFER_V2_FROM : null,
          priceUsd: plan + 29,
          specId: `SPEC-SKYHOME-${plan}`,
        },
        ...(plan === 200
          ? [{
            version: "v2",
            validFrom: OFFER_V2_FROM,
            validTo: null,
            priceUsd: plan + 29,
            specId: "SPEC-SKYHOME-200-V2",
          }]
          : []),
      ],
    })),
  };
}

export function generateDemoDataset(): DemoDataset {
  const rng = mulberry32(SEED);
  const catalog = buildCatalog();

  const orders: Order[] = [];
  const serviceOrders: ServiceOrder[] = [];
  const workOrders: WorkOrder[] = [];
  const processes: ProcessInstance[] = [];
  const activities: Activity[] = [];
  const attempts: ProvisioningAttempt[] = [];
  const defects: DemoDefects = {
    fallout: [],
    timers: [],
    stuck: [],
    duplicates: [],
    weakLinks: [],
    legit: {
      normalTimers: [],
      longRunning: [],
      suspended: [],
      falloutQueue: [],
      offerV2: [],
      permanentErrors: [],
      maintenanceFailures: [],
      replaced: [],
      replacing: [],
      threeServiceOrderDuplicates: [],
      reusedSerials: [],
    },
  };

  const stepMs = STEP_MS;
  const plans = [50, 100, 200];

  for (let index = 0; index < ORDERS; index++) {
    const plan = plans[index % plans.length];
    const orderRef = `ORD-${1000 + index}`;
    const soRef = `SO-${20000 + index}`;
    const woRef = `WO-${40000 + index}`;
    const processId = `BPM-${50000 + index}`;
    const attemptId = `ACT-${70000 + index}`;
    const isReusedSerial = inRange(index, REUSED_SERIAL);
    const serial = `SN-${
      900000 + (isReusedSerial ? REUSED_FROM + index - REUSED_SERIAL.from : index)
    }`;
    const isV2 = plan === 200 && index >= V2_FIRST_INDEX;
    const offerVersion = isV2 ? "v2" : "v1";
    const specId = isV2 ? "SPEC-SKYHOME-200-V2" : `SPEC-SKYHOME-${plan}`;

    const isFallout = inRange(index, FALLOUT);
    const isTimer = inRange(index, TIMER);
    const isStuck = inRange(index, STUCK);
    const isDuplicate = inRange(index, DUPLICATE);
    const isWeakLink = inRange(index, WEAK_LINK);
    const isNormalTimer = inRange(index, NORMAL_TIMER);
    const isSuspended = inRange(index, SUSPENDED);
    const isQueue = inRange(index, FALLOUT_QUEUE);
    const isPermanent = inRange(index, PERMANENT);
    const isReplaced = inRange(index, REPLACED);
    const isReplacing = inRange(index, REPLACING);
    const isMaintenance = inRange(index, MAINTENANCE);
    const isLongRunning = inRange(index, LONG_RUNNING);
    const isOpen = isStuck || isLongRunning || isSuspended || isQueue;

    const submitted = WINDOW_START + index * stepMs + between(rng, -60, 60) * 1000;
    const checkStart = submitted + 3 * MINUTE;
    const checkMinutes = between(rng, 90, 150);
    // From v2 the capacity profile is in the spec, so the check is automatic.
    const checkEnd = checkStart + (isV2 ? 1 : checkMinutes) * MINUTE;
    const decomposedAt = checkEnd + between(rng, 1, 3) * MINUTE;
    const installationStart = decomposedAt + between(rng, 30, 90) * MINUTE;
    const installationEnd = installationStart + between(rng, 4, 10) * HOUR;
    const naturalActivation = installationEnd + between(rng, 1, 5) * MINUTE;
    const mIndex = index - MAINTENANCE.from;
    // A maintenance order waits for the hub to come back: its first try lands in the window.
    const activationStart = isMaintenance
      ? Date.parse(MAINTENANCE_WINDOW.from) + mIndex * 7 * MINUTE
      : naturalActivation;
    if (isMaintenance && activationStart < naturalActivation) {
      throw new Error(`${orderRef} is not ready before the maintenance window`);
    }
    const retryStart = isMaintenance
      ? Date.parse(MAINTENANCE_WINDOW.to) + (mIndex + 1) * MINUTE
      : activationStart + 60 * HOUR;
    const retryEnd = retryStart + 40_000;
    const failedEnd = activationStart + 30_000;
    const timerEnd = installationEnd + 48 * HOUR;
    const recoveryStart = timerEnd + 1 * HOUR;
    const recoveryEnd = timerEnd + 2 * HOUR;

    orders.push({
      orderRef,
      submittedAt: iso(submitted),
      state: isOpen ? "PROVISIONING" : isPermanent ? "FAILED" : isReplaced ? "CANCELLED" : "ACTIVE",
      offerId: `OFFER-SKYHOME-${plan}`,
      offerVersion,
      ...(isReplacing
        ? { replacesOrderRef: `ORD-${1000 + index - REPLACING.from + REPLACED.from}` }
        : {}),
    });

    serviceOrders.push({
      soRef,
      orderRef,
      specId,
      state: isOpen
        ? "PROVISIONING"
        : isDuplicate || isPermanent
        ? "FAILED"
        : isReplaced
        ? "CANCELLED"
        : "ACTIVE",
      createdAt: iso(decomposedAt),
      terminalSerial: serial,
    });

    workOrders.push({
      woRef,
      soRef,
      kind: "installation",
      state: isReplaced ? "CANCELLED" : isLongRunning ? "OPEN" : "DONE",
      createdAt: iso(installationStart),
    });

    const baseActivities: Activity[] = [
      {
        processId,
        sequence: 1,
        kind: "task",
        name: "capacity_check",
        actor: isV2 ? "system" : "human",
        startedAt: iso(checkStart),
        endedAt: iso(checkEnd),
      },
      {
        processId,
        sequence: 2,
        kind: "task",
        name: "decompose",
        actor: "system",
        startedAt: iso(decomposedAt),
        endedAt: iso(decomposedAt + 30_000),
      },
      {
        processId,
        sequence: 3,
        kind: "task",
        name: "installation",
        actor: "partner",
        startedAt: iso(installationStart),
        endedAt: iso(installationEnd),
      },
    ];
    if (isNormalTimer) {
      // A scheduling wait that ends on its own, before the installer's slot: normal, not R03.
      baseActivities.splice(2, 0, {
        processId,
        sequence: 3,
        kind: "timer",
        name: "scheduling_wait",
        actor: "system",
        startedAt: iso(decomposedAt + 30_000),
        endedAt: iso(installationStart),
        timerExpired: false,
      });
      baseActivities[3].sequence = 4;
      defects.legit.normalTimers.push(orderRef);
    }
    if (isV2) defects.legit.offerV2.push(orderRef);
    if (isReusedSerial) defects.legit.reusedSerials.push(orderRef);
    if (isReplacing) defects.legit.replacing.push(orderRef);

    if (isTimer) {
      activities.push(...baseActivities, {
        processId,
        sequence: 4,
        kind: "timer",
        name: "activation_timer",
        actor: "system",
        startedAt: iso(installationEnd),
        endedAt: iso(timerEnd),
        timerExpired: true,
      });

      attempts.push({
        attemptId,
        soRef: isWeakLink ? null : soRef,
        serial,
        state: isStuck ? "pending" : "succeeded",
        errorCode: null,
        startedAt: iso(activationStart),
        endedAt: isStuck ? null : iso(recoveryEnd),
      });

      if (isStuck) {
        processes.push({
          processId,
          soRef,
          businessKey: orderRef,
          state: "RUNNING",
          startedAt: iso(decomposedAt),
          endedAt: null,
        });
        defects.timers.push(orderRef);
        defects.stuck.push(orderRef);
        continue;
      }

      activities.push({
        processId,
        sequence: 5,
        kind: "task",
        name: "activation_recovery",
        actor: "human",
        startedAt: iso(recoveryStart),
        endedAt: iso(recoveryEnd),
      });
      processes.push({
        processId,
        soRef,
        businessKey: orderRef,
        state: "COMPLETED",
        startedAt: iso(decomposedAt),
        endedAt: iso(recoveryEnd),
      });
      defects.timers.push(orderRef);
      continue;
    }

    if (isFallout) {
      activities.push(...baseActivities, {
        processId,
        sequence: 4,
        kind: "task",
        name: "activation",
        actor: "system",
        startedAt: iso(activationStart),
        endedAt: iso(isDuplicate ? failedEnd : retryEnd),
      });

      attempts.push({
        attemptId,
        soRef: isWeakLink ? null : soRef,
        serial,
        state: "failed",
        errorCode: "HUB_TIMEOUT",
        startedAt: iso(activationStart),
        endedAt: iso(failedEnd),
      });

      if (isDuplicate) {
        const duplicateSoRef = `SO-${30000 + index}`;
        const duplicateProcessId = `BPM-${60000 + index}`;
        const duplicateAttemptId = `ACT-${80000 + index}`;

        serviceOrders.push({
          soRef: duplicateSoRef,
          orderRef,
          specId,
          state: "ACTIVE",
          createdAt: iso(retryStart),
          terminalSerial: serial,
        });
        processes.push({
          processId: duplicateProcessId,
          soRef: duplicateSoRef,
          businessKey: orderRef,
          state: "COMPLETED",
          startedAt: iso(retryStart),
          endedAt: iso(retryEnd),
        });
        activities.push({
          processId: duplicateProcessId,
          sequence: 1,
          kind: "task",
          name: "activation_retry",
          actor: "system",
          startedAt: iso(retryStart),
          endedAt: iso(retryEnd),
        });
        attempts.push({
          attemptId: duplicateAttemptId,
          soRef: duplicateSoRef,
          serial,
          state: "succeeded",
          errorCode: null,
          startedAt: iso(retryStart),
          endedAt: iso(retryEnd),
        });
        processes.push({
          processId,
          soRef,
          businessKey: orderRef,
          state: "FAILED",
          startedAt: iso(decomposedAt),
          endedAt: iso(failedEnd),
        });
        if (index === THREE_SO_INDEX) {
          // The retry was retried: a third service order, activated again.
          const thirdSoRef = `SO-${35000 + index}`;
          const thirdProcessId = `BPM-${65000 + index}`;
          const thirdStart = retryStart + 2 * HOUR;
          serviceOrders.push({
            soRef: thirdSoRef,
            orderRef,
            specId,
            state: "ACTIVE",
            createdAt: iso(thirdStart),
            terminalSerial: serial,
          });
          processes.push({
            processId: thirdProcessId,
            soRef: thirdSoRef,
            businessKey: orderRef,
            state: "COMPLETED",
            startedAt: iso(thirdStart),
            endedAt: iso(thirdStart + 40_000),
          });
          activities.push({
            processId: thirdProcessId,
            sequence: 1,
            kind: "task",
            name: "activation_retry",
            actor: "system",
            startedAt: iso(thirdStart),
            endedAt: iso(thirdStart + 40_000),
          });
          attempts.push({
            attemptId: `ACT-${85000 + index}`,
            soRef: thirdSoRef,
            serial,
            state: "succeeded",
            errorCode: null,
            startedAt: iso(thirdStart),
            endedAt: iso(thirdStart + 40_000),
          });
          defects.legit.threeServiceOrderDuplicates.push(orderRef);
        }
        defects.fallout.push(orderRef);
        defects.duplicates.push(orderRef);
        continue;
      }

      attempts.push({
        attemptId: `ACT-${100000 + index}`,
        soRef: isWeakLink ? null : soRef,
        serial,
        state: "succeeded",
        errorCode: null,
        startedAt: iso(retryStart),
        endedAt: iso(retryEnd),
      });
      processes.push({
        processId,
        soRef,
        businessKey: orderRef,
        state: "COMPLETED",
        startedAt: iso(decomposedAt),
        endedAt: iso(retryEnd),
      });
      defects.fallout.push(orderRef);
      continue;
    }

    if (isReplaced) {
      // Cancelled before installation because the next order replaces it.
      activities.push(...baseActivities.slice(0, 2));
      processes.push({
        processId,
        soRef,
        businessKey: orderRef,
        state: "CANCELLED",
        startedAt: iso(decomposedAt),
        endedAt: iso(decomposedAt + 40 * MINUTE),
      });
      defects.legit.replaced.push(orderRef);
      continue;
    }

    if (isLongRunning || isSuspended || isQueue) {
      // Healthy open work: the partner's slot is days away, the customer paused, or a person
      // owns the failure in a fallout queue. None of them is stuck.
      const done = baseActivities.slice(0, isLongRunning ? 2 : 3);
      if (isLongRunning) {
        activities.push(...done, { ...baseActivities[2], endedAt: null });
        defects.legit.longRunning.push(orderRef);
      } else if (isSuspended) {
        activities.push(...done, {
          processId,
          sequence: 4,
          kind: "task",
          name: "customer_hold",
          actor: "human",
          startedAt: iso(activationStart),
          endedAt: null,
        });
        defects.legit.suspended.push(orderRef);
      } else {
        activities.push(...done, {
          processId,
          sequence: 4,
          kind: "task",
          name: "activation",
          actor: "system",
          startedAt: iso(activationStart),
          endedAt: iso(failedEnd),
        }, {
          processId,
          sequence: 5,
          kind: "task",
          name: "fallout_review",
          actor: "human",
          startedAt: iso(failedEnd + MINUTE),
          endedAt: null,
        });
        attempts.push({
          attemptId,
          soRef,
          serial,
          state: "failed",
          errorCode: PERMANENT_ERROR_CODES[2],
          startedAt: iso(activationStart),
          endedAt: iso(failedEnd),
        });
        defects.legit.falloutQueue.push(orderRef);
      }
      processes.push({
        processId,
        soRef,
        businessKey: orderRef,
        state: isSuspended ? "SUSPENDED" : "RUNNING",
        startedAt: iso(decomposedAt),
        endedAt: null,
      });
      continue;
    }

    if (isPermanent) {
      activities.push(...baseActivities, {
        processId,
        sequence: 4,
        kind: "task",
        name: "activation",
        actor: "system",
        startedAt: iso(activationStart),
        endedAt: iso(failedEnd),
      });
      attempts.push({
        attemptId,
        soRef,
        serial,
        state: "failed",
        errorCode: PERMANENT_ERROR_CODES[(index - PERMANENT.from) % PERMANENT_ERROR_CODES.length],
        startedAt: iso(activationStart),
        endedAt: iso(failedEnd),
      });
      processes.push({
        processId,
        soRef,
        businessKey: orderRef,
        state: "FAILED",
        startedAt: iso(decomposedAt),
        endedAt: iso(failedEnd),
      });
      defects.legit.permanentErrors.push(orderRef);
      continue;
    }

    if (isMaintenance) {
      // Failed while the hub was down, retried as soon as it was back: nothing to fix.
      const retryDone = retryStart + 40_000;
      activities.push(...baseActivities, {
        processId,
        sequence: 4,
        kind: "task",
        name: "activation",
        actor: "system",
        startedAt: iso(activationStart),
        endedAt: iso(retryDone),
      });
      attempts.push({
        attemptId,
        soRef,
        serial,
        state: "failed",
        errorCode: "HUB_TIMEOUT",
        startedAt: iso(activationStart),
        endedAt: iso(failedEnd),
      }, {
        attemptId: `ACT-${100000 + index}`,
        soRef,
        serial,
        state: "succeeded",
        errorCode: null,
        startedAt: iso(retryStart),
        endedAt: iso(retryDone),
      });
      processes.push({
        processId,
        soRef,
        businessKey: orderRef,
        state: "COMPLETED",
        startedAt: iso(decomposedAt),
        endedAt: iso(retryDone),
      });
      defects.legit.maintenanceFailures.push(orderRef);
      continue;
    }

    // Normal path: the first attempt succeeds.
    activities.push(...baseActivities, {
      processId,
      sequence: baseActivities.length + 1,
      kind: "task",
      name: "activation",
      actor: "system",
      startedAt: iso(activationStart),
      endedAt: iso(activationStart + 45_000),
    });
    attempts.push({
      attemptId,
      soRef: isWeakLink ? null : soRef,
      serial,
      state: "succeeded",
      errorCode: null,
      startedAt: iso(activationStart),
      endedAt: iso(activationStart + 45_000),
    });
    processes.push({
      processId,
      soRef,
      businessKey: orderRef,
      state: "COMPLETED",
      startedAt: iso(decomposedAt),
      endedAt: iso(activationStart + 60_000),
    });

    if (isWeakLink) defects.weakLinks.push(orderRef);
  }

  return {
    catalog,
    orders,
    serviceOrders,
    workOrders,
    processes,
    activities,
    attempts,
    defects,
    meta: {
      seed: SEED,
      windowStart: iso(WINDOW_START),
      windowEnd: iso(WINDOW_END),
      orders: ORDERS,
    },
  };
}
