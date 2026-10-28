// SPDX-License-Identifier: MIT
/**
 * Hand-written TMF-shaped resource types for the stub (M0-11).
 *
 * Only the fields Flow Audit uses, in the standard TMF style (camelCase,
 * `id`, `href`, `@type`). No schema text is copied from TM Forum or from any
 * integration candidate: writing our own types avoids the licensing question
 * recorded in M0-11 and keeps the surface exactly as wide as the adapter
 * needs (M1-01).
 */

/** A TMF-style reference: identity and address, no payload. */
export interface TmfRef {
  id: string;
  href: string;
}

/** `productOrderItem.productOffering` — the sold offer line. */
export interface TmfProductOfferingRef extends TmfRef {
  name: string;
}

export interface TmfProductOrderItem {
  id: string;
  action: "add";
  state: string;
  /** The offer this line sells; the catalog supplies id, href and name. */
  productOffering: TmfProductOfferingRef;
}

export interface TmfProductOrder {
  "@type": "ProductOrder";
  id: string;
  href: string;
  state: string;
  /** ISO 8601, UTC. */
  orderDate: string;
  productOrderItem: TmfProductOrderItem[];
}

/**
 * The explicit item-to-item link: which product order item a service order
 * item decomposes. TMF641 v4 defines no item-level product-order reference;
 * the stub adds this one (TMF-style `{id, href}`) because M0-04 showed the
 * chain dies without it — it is the field the M1 adapter maps with
 * correlation confidence `explicit`. `href` points at the parent order; the
 * item is addressed by its `id` inside it.
 */
export interface TmfProductOrderItemRef {
  id: string;
  href: string;
  productOrderId: string;
}

export interface TmfServiceOrderItem {
  id: string;
  action: "add";
  state: string;
  productOrderItem: TmfProductOrderItemRef;
}

export interface TmfServiceOrder {
  "@type": "ServiceOrder";
  id: string;
  href: string;
  state: string;
  /** ISO 8601, UTC. */
  orderDate: string;
  /** Declared for shape parity with TMF641; the synthetic dataset has no external ids. */
  externalId?: string;
  serviceOrderItem: TmfServiceOrderItem[];
}

export interface TmfServiceActivation {
  "@type": "ServiceActivation";
  id: string;
  href: string;
  state: string;
  /** ISO 8601, UTC. */
  activationDate: string;
  /** Absent while the attempt has not ended (pending). */
  completionDate?: string;
  /** Explicit link back to the service order — and item — it activates. */
  serviceOrder?: TmfRef;
  serviceOrderItem?: TmfRef;
}

/** Consistent JSON error body for every non-2xx the stub answers. */
export interface StubError {
  error: string;
  status: number;
}
