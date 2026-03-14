import {
  CreateCalendarEventInput,
  CreateCalendarEventResult,
  UpdateCalendarEventInput,
  UpdateCalendarEventResult,
  CancelCalendarEventInput,
  CancelCalendarEventResult,
} from "./types.ts";
import { GoogleCalendarProvider } from "./googleCalendarProvider.ts";

export interface CalendarProvider {
  createEvent(input: CreateCalendarEventInput): Promise<CreateCalendarEventResult>;
  updateEvent(input: UpdateCalendarEventInput): Promise<UpdateCalendarEventResult>;
  cancelEvent(input: CancelCalendarEventInput): Promise<CancelCalendarEventResult>;
}

export function getCalendarProvider(provider: string): CalendarProvider {
  switch (provider.toLowerCase()) {
    case "google":
      return new GoogleCalendarProvider();
    default:
      throw new Error(`Unsupported calendar provider: ${provider}`);
  }
}
