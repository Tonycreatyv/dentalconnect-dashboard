export type CalendarProvider = "google";

export type CreateCalendarEventInput = {
  organization_id: string;
  calendar_id: string;
  title: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  patient_name?: string;
  patient_email?: string;
  patient_phone?: string;
  metadata?: Record<string, unknown>;
};

export type CreateCalendarEventResult = {
  success: boolean;
  event_id?: string;
  provider: CalendarProvider;
  error?: string;
};

export type UpdateCalendarEventInput = {
  calendar_id: string;
  event_id: string;
  starts_at?: string;
  ends_at?: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateCalendarEventResult = {
  success: boolean;
  provider: CalendarProvider;
  error?: string;
};

export type CancelCalendarEventInput = {
  calendar_id: string;
  event_id: string;
};

export type CancelCalendarEventResult = {
  success: boolean;
  provider: CalendarProvider;
  error?: string;
};