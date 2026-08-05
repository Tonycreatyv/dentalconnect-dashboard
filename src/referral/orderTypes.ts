export type ReferralOrderSourceChannel =
  | "web"
  | "whatsapp"
  | "voice"
  | "qr"
  | "admin";
export type ReferralOrderRouteSource = "demo" | "google_routes" | "manual";
export type ReferralOrderCoverageStatus =
  | "available"
  | "manual_review"
  | "unavailable";
export type ReferralOrderStatus =
  | "submitted"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

/** UUID values are opaque database identifiers, never basket keys. */
export type ReferralUuid = string & { readonly __referralUuid: unique symbol };

/**
 * Untrusted request contract. Prices, fee bands, totals, and display snapshots
 * are intentionally absent and must be resolved by the backend.
 */
export type CreateReferralOrderInput = {
  idempotencyKey: string;
  campaignCode?: string | null;
  sourceChannel: ReferralOrderSourceChannel;
  partnerLocationId: ReferralUuid;
  basketOfferId: ReferralUuid;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryState: string;
  deliveryPostalCode: string;
  deliveryCountryCode: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  deliveryDistanceMiles?: number | null;
  deliveryDurationMinutes?: number | null;
  routeSource: ReferralOrderRouteSource;
  customerNotes?: string | null;
  consentTransactional: boolean;
  consentMarketing: boolean;
  consentVersion?: string | null;
};

export type ReferralOrderSummary = {
  id: ReferralUuid;
  orderCode: string;
  status: ReferralOrderStatus;
  partnerName: string;
  partnerLocationName: string;
  basketName: string;
  basketPriceCents: number;
  deliveryFeeCents: number;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  coverageStatus: ReferralOrderCoverageStatus;
  deliveryAddress: string;
  submittedAt: string | null;
  createdAt: string;
};

export type CreateReferralOrderResult = {
  ok: true;
  order: ReferralOrderSummary;
  idempotentReplay: boolean;
};

export type CreateReferralOrderErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CONSENT"
  | "INVALID_PARTNER_LOCATION"
  | "INVALID_BASKET_OFFER"
  | "DELIVERY_UNAVAILABLE"
  | "MINIMUM_ORDER_NOT_MET"
  | "IDEMPOTENCY_CONFLICT"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

export type CreateReferralOrderError = {
  ok: false;
  error: { code: CreateReferralOrderErrorCode; message: string };
};
