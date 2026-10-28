// SPDX-License-Identifier: MIT
/**
 * Maps the synthetic dataset onto standard-TMF-shaped resources (M0-11).
 *
 * The dataset is an event history; TMF resources are snapshots. Each resource
 * below is the state **at the end of the window** (September 2026): the
 * exports already record the state every entity was left in when the window
 * closed, so derivation is a projection into the TMF vocabulary:
 *
 * | dataset state            | TMF state     |
 * |--------------------------|---------------|
 * | order      ACTIVE        | COMPLETED     |
 * | order      PROVISIONING  | IN_PROGRESS   |
 * | service order ACTIVE     | COMPLETED     |
 * | service order FAILED     | FAILED        |
 * | service order PROVISIONING | IN_PROGRESS |
 * | attempt succeeded        | COMPLETED     |
 * | attempt failed           | FAILED        |
 * | attempt pending          | PENDING       |
 *
 * There is no `completionDate` for orders and service orders: the dataset
 * stores no order-closure timestamp, and inventing one would break the
 * provenance. Activation `completionDate` is the attempt's `ended_at` when it
 * has one (pending attempts have none). The event history itself stays in the
 * file exports (M5-02); the stub deliberately does not re-serve it.
 */

import type { Catalog, Order, ProvisioningAttempt, ServiceOrder } from "../domain/model.ts";
import type {
  TmfProductOrder,
  TmfProductOrderItem,
  TmfServiceActivation,
  TmfServiceOrder,
  TmfServiceOrderItem,
} from "./tmf.ts";

export const PRODUCT_ORDER_PATH = "/tmf-api/productOrdering/v4/productOrder";
export const SERVICE_ORDER_PATH = "/tmf-api/serviceOrdering/v4/serviceOrder";
export const SERVICE_ACTIVATION_PATH =
  "/tmf-api/serviceActivationAndConfiguration/v4/serviceActivation";

export interface StubState {
  productOrders: TmfProductOrder[];
  serviceOrders: TmfServiceOrder[];
  activations: TmfServiceActivation[];
}

const orderTmfState: Record<string, string> = {
  ACTIVE: "COMPLETED",
  PROVISIONING: "IN_PROGRESS",
};
const attemptTmfState: Record<ProvisioningAttempt["state"], string> = {
  pending: "PENDING",
  failed: "FAILED",
  succeeded: "COMPLETED",
};

/** Item id inside a product order: `<orderId>-1`; every order sells one line. */
export function productOrderItemId(orderId: string): string {
  return `${orderId}-1`;
}

/** Item id inside a service order: `<soId>-1`; every service order has one line. */
export function serviceOrderItemId(soId: string): string {
  return `${soId}-1`;
}

export function buildStubState(
  catalog: Catalog,
  orders: Order[],
  serviceOrders: ServiceOrder[],
  attempts: ProvisioningAttempt[],
): StubState {
  const offeringByName = new Map(
    catalog.offers.map((offer) => [offer.offerId, offer]),
  );

  const productOrders: TmfProductOrder[] = orders.map((order) => {
    const item: TmfProductOrderItem = {
      id: productOrderItemId(order.orderRef),
      action: "add",
      state: orderTmfState[order.state] ?? order.state,
      productOffering: {
        id: order.offerId,
        href: `/tmf-api/productCatalogManagement/v4/productOffering/${order.offerId}`,
        name: offeringByName.get(order.offerId)?.name ?? order.offerId,
      },
    };
    return {
      "@type": "ProductOrder",
      id: order.orderRef,
      href: `${PRODUCT_ORDER_PATH}/${order.orderRef}`,
      state: item.state,
      orderDate: order.submittedAt,
      productOrderItem: [item],
    };
  });

  const serviceOrdersTmf: TmfServiceOrder[] = serviceOrders.map((so) => {
    const state = orderTmfState[so.state] ?? so.state;
    const item: TmfServiceOrderItem = {
      id: serviceOrderItemId(so.soRef),
      action: "add",
      state,
      productOrderItem: {
        id: productOrderItemId(so.orderRef),
        href: `${PRODUCT_ORDER_PATH}/${so.orderRef}`,
        productOrderId: so.orderRef,
      },
    };
    return {
      "@type": "ServiceOrder",
      id: so.soRef,
      href: `${SERVICE_ORDER_PATH}/${so.soRef}`,
      state,
      orderDate: so.createdAt,
      serviceOrderItem: [item],
    };
  });

  const activations: TmfServiceActivation[] = attempts.map((attempt) => ({
    "@type": "ServiceActivation",
    id: attempt.attemptId,
    href: `${SERVICE_ACTIVATION_PATH}/${attempt.attemptId}`,
    state: attemptTmfState[attempt.state],
    activationDate: attempt.startedAt,
    ...(attempt.endedAt === null ? {} : { completionDate: attempt.endedAt }),
    // R05 leaves the weak-link attempts with no service-order link at all.
    ...(attempt.soRef === null ? {} : {
      serviceOrder: {
        id: attempt.soRef,
        href: `${SERVICE_ORDER_PATH}/${attempt.soRef}`,
      },
      serviceOrderItem: {
        id: serviceOrderItemId(attempt.soRef),
        href: `${SERVICE_ORDER_PATH}/${attempt.soRef}`,
      },
    }),
  }));

  return { productOrders, serviceOrders: serviceOrdersTmf, activations };
}
