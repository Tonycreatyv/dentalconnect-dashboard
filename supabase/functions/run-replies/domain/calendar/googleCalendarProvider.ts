import {
  CalendarProvider,
  CreateCalendarEventInput,
  CreateCalendarEventResult,
  UpdateCalendarEventInput,
  UpdateCalendarEventResult,
  CancelCalendarEventInput,
  CancelCalendarEventResult,
} from "./types.ts";

export class GoogleCalendarProvider implements CalendarProvider {
  async createEvent(input: CreateCalendarEventInput): Promise<CreateCalendarEventResult> {
    return {
      success: true,
      provider: "google",
      event_id: crypto.randomUUID(),
    };
  }

  async updateEvent(input: UpdateCalendarEventInput): Promise<UpdateCalendarEventResult> {
    return {
      success: true,
      provider: "google",
    };
  }

  async cancelEvent(input: CancelCalendarEventInput): Promise<CancelCalendarEventResult> {
    return {
      success: true,
      provider: "google",
    };
  }
}
