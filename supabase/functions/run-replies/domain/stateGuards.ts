import type { PendingAction } from "./coreConversationContract.ts";

export function canExecuteBookingConfirmation(args: {
  pendingAction: PendingAction;
  lastBotStep: string;
  hasPendingBooking: boolean;
  pendingBookingStale: boolean;
}): boolean {
  return args.pendingAction.type === "confirm_booking" &&
    args.pendingAction.status === "active" &&
    args.pendingAction.createdFromLastBotPreconfirm &&
    args.lastBotStep === "barbershop_preconfirm" &&
    args.hasPendingBooking &&
    !args.pendingBookingStale;
}

