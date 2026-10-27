import type {
  Activity,
  Catalog,
  ImpactConfig,
  Order,
  ProcessInstance,
  ProvisioningAttempt,
  WorkOrder,
} from "../../domain/model.ts";
import type { DemoDataset } from "../../dataset/generator.ts";

export const OMS_COLUMNS = [
  "order_ref",
  "submitted_at",
  "order_state",
  "offer_id",
  "offer_version",
  "so_ref",
  "spec_id",
  "so_state",
  "so_created_at",
  "terminal_serial",
  "wo_ref",
  "wo_kind",
  "wo_state",
  "wo_created_at",
] as const;

function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeCatalog(catalog: Catalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export function serializeOms(dataset: DemoDataset): string {
  const ordersByRef = new Map<string, Order>(
    dataset.orders.map((order) => [order.orderRef, order]),
  );
  const workOrdersBySo = new Map<string, WorkOrder>(
    dataset.workOrders.map((workOrder) => [workOrder.soRef, workOrder]),
  );

  const rows: string[] = [OMS_COLUMNS.join(",")];

  for (const serviceOrder of dataset.serviceOrders) {
    const order = ordersByRef.get(serviceOrder.orderRef);
    if (!order) {
      throw new Error(`service order ${serviceOrder.soRef} has no order ${serviceOrder.orderRef}`);
    }
    const workOrder = workOrdersBySo.get(serviceOrder.soRef);

    rows.push(
      [
        order.orderRef,
        order.submittedAt,
        order.state,
        order.offerId,
        order.offerVersion,
        serviceOrder.soRef,
        serviceOrder.specId,
        serviceOrder.state,
        serviceOrder.createdAt,
        serviceOrder.terminalSerial,
        workOrder?.woRef,
        workOrder?.kind,
        workOrder?.state,
        workOrder?.createdAt,
      ].map(csvField).join(","),
    );
  }

  return `${rows.join("\n")}\n`;
}

export function serializeBpm(dataset: DemoDataset): string {
  const activitiesByProcess = new Map<string, Activity[]>();
  for (const activity of dataset.activities) {
    const list = activitiesByProcess.get(activity.processId) ?? [];
    list.push(activity);
    activitiesByProcess.set(activity.processId, list);
  }

  const lines = dataset.processes.map((process: ProcessInstance) => {
    const activities = (activitiesByProcess.get(process.processId) ?? []).map((activity) => ({
      sequence: activity.sequence,
      kind: activity.kind,
      name: activity.name,
      actor: activity.actor,
      started_at: activity.startedAt,
      ended_at: activity.endedAt,
      timer_expired: activity.timerExpired ?? false,
    }));

    return JSON.stringify({
      process_id: process.processId,
      so_ref: process.soRef,
      business_key: process.businessKey,
      state: process.state,
      started_at: process.startedAt,
      ended_at: process.endedAt,
      activities,
    });
  });

  return `${lines.join("\n")}\n`;
}

export function serializeProvisioning(dataset: DemoDataset): string {
  const lines = dataset.attempts.map((attempt: ProvisioningAttempt) =>
    JSON.stringify({
      attempt_id: attempt.attemptId,
      so_ref: attempt.soRef,
      serial: attempt.serial,
      state: attempt.state,
      error_code: attempt.errorCode,
      started_at: attempt.startedAt,
      ended_at: attempt.endedAt,
    })
  );

  return `${lines.join("\n")}\n`;
}

export function serializeDataset(dataset: DemoDataset): Record<string, string> {
  return {
    "catalog.json": serializeCatalog(dataset.catalog),
    "oms_orders.csv": serializeOms(dataset),
    "bpm_history.jsonl": serializeBpm(dataset),
    "provisioning.jsonl": serializeProvisioning(dataset),
  };
}

export function serializeJson(value: ImpactConfig | unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
