import type {
  CalendarProvider,
  CreateCalendarEventInput,
  CreateCalendarEventResult,
  UpdateCalendarEventInput,
  UpdateCalendarEventResult,
  CancelCalendarEventInput,
  CancelCalendarEventResult,
} from "./types.ts";

export class GoogleCalendarProvider {
  async createEvent(_input: CreateCalendarEventInput): Promise<CreateCalendarEventResult> {
    return {
      success: true,
      provider: "google" satisfies CalendarProvider,
      event_id: crypto.randomUUID(),
    };
  }

  async updateEvent(_input: UpdateCalendarEventInput): Promise<UpdateCalendarEventResult> {
    return {
      success: true,
      provider: "google" satisfies CalendarProvider,
    };
  }

  async cancelEvent(_input: CancelCalendarEventInput): Promise<CancelCalendarEventResult> {
    return {
      success: true,
      provider: "google" satisfies CalendarProvider,
    };
  }
}