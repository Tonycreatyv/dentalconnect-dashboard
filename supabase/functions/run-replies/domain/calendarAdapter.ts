export type CalendarEventResult = { ok: boolean; eventId?: string; message?: string };

export interface CalendarAdapter {
  bookEvent(args: { appointmentId: string; startAt?: string; endAt?: string }): Promise<CalendarEventResult>;
  cancelEvent(args: { eventId: string }): Promise<CalendarEventResult>;
  rescheduleEvent(args: { eventId: string; startAt?: string; endAt?: string }): Promise<CalendarEventResult>;
}

export class StubCalendarAdapter implements CalendarAdapter {
  async bookEvent(args: { appointmentId: string; startAt?: string; endAt?: string }) {
    return { ok: true, eventId: `stub-${args.appointmentId}` };
  }

  async cancelEvent(args: { eventId: string }) {
    return { ok: true, eventId: args.eventId };
  }

  async rescheduleEvent(args: { eventId: string; startAt?: string; endAt?: string }) {
    return { ok: true, eventId: args.eventId };
  }
}
