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

export const EXPECTED = {
  orders: ORDERS,
  service_orders: ORDERS + DUPLICATE_ORDERS,
  work_orders: ORDERS,
  processes: ORDERS + DUPLICATE_ORDERS,
  attempts: ORDERS + FALLOUT_ORDERS,
  attempts_by_state: {
    failed: FALLOUT_ORDERS,
    pending: STUCK_ORDERS,
    succeeded: ORDERS - STUCK_ORDERS,
  },
  findings: {
    R01: { affected_orders: FALLOUT_ORDERS, share_of_orders: 0.08 },
    R02: { affected_orders: ORDERS, share_of_orders: 1 },
    R03: {
      affected_orders: TIMER_ORDERS,
      stuck_orders: STUCK_ORDERS,
      share_of_orders: 0.03,
    },
    R04: { affected_orders: DUPLICATE_ORDERS, share_of_orders: 0.004 },
    R05: { affected_orders: WEAK_LINK_ORDERS, share_of_orders: 0.06 },
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
}

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
          validTo: null,
          priceUsd: plan + 29,
          specId: `SPEC-SKYHOME-${plan}`,
        },
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
  };

  const stepMs = Math.floor((WINDOW_END - WINDOW_START) / ORDERS);
  const plans = [50, 100, 200];

  for (let index = 0; index < ORDERS; index++) {
    const plan = plans[index % plans.length];
    const orderRef = `ORD-${1000 + index}`;
    const soRef = `SO-${20000 + index}`;
    const woRef = `WO-${40000 + index}`;
    const processId = `BPM-${50000 + index}`;
    const attemptId = `ACT-${70000 + index}`;
    const serial = `SN-${900000 + index}`;
    const specId = `SPEC-SKYHOME-${plan}`;

    const isFallout = inRange(index, FALLOUT);
    const isTimer = inRange(index, TIMER);
    const isStuck = inRange(index, STUCK);
    const isDuplicate = inRange(index, DUPLICATE);
    const isWeakLink = inRange(index, WEAK_LINK);

    const submitted = WINDOW_START + index * stepMs + between(rng, -60, 60) * 1000;
    const checkStart = submitted + 3 * MINUTE;
    const checkEnd = checkStart + between(rng, 90, 150) * MINUTE;
    const decomposedAt = checkEnd + between(rng, 1, 3) * MINUTE;
    const installationStart = decomposedAt + between(rng, 30, 90) * MINUTE;
    const installationEnd = installationStart + between(rng, 4, 10) * HOUR;
    const activationStart = installationEnd + between(rng, 1, 5) * MINUTE;
    const retryStart = activationStart + 60 * HOUR;
    const retryEnd = retryStart + 40_000;
    const failedEnd = activationStart + 30_000;
    const timerEnd = installationEnd + 48 * HOUR;
    const recoveryStart = timerEnd + 1 * HOUR;
    const recoveryEnd = timerEnd + 2 * HOUR;

    orders.push({
      orderRef,
      submittedAt: iso(submitted),
      state: isStuck ? "PROVISIONING" : "ACTIVE",
      offerId: `OFFER-SKYHOME-${plan}`,
      offerVersion: "v1",
    });

    serviceOrders.push({
      soRef,
      orderRef,
      specId,
      state: isStuck ? "PROVISIONING" : isDuplicate ? "FAILED" : "ACTIVE",
      createdAt: iso(decomposedAt),
      terminalSerial: serial,
    });

    workOrders.push({
      woRef,
      soRef,
      kind: "installation",
      state: "DONE",
      createdAt: iso(installationStart),
    });

    const baseActivities: Activity[] = [
      {
        processId,
        sequence: 1,
        kind: "task",
        name: "capacity_check",
        actor: "human",
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

    // Normal path: the first attempt succeeds.
    activities.push(...baseActivities, {
      processId,
      sequence: 4,
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
