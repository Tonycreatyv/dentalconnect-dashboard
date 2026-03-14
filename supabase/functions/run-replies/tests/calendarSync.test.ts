import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.223.0/assert/mod.ts";
import { syncCalendarEvent, overrideCalendarProviderFactory, resetCalendarProviderFactory } from "../domain/calendar/calendarSync.ts";
import type { CalendarProvider } from "../domain/calendar/provider.ts";
import { executeToolAction } from "../domain/actionExecutor.ts";

class MockProvider implements CalendarProvider {
  constructor(private config: { success: boolean; eventId?: string; error?: string }) {}
  async createEvent() {
    if (!this.config.success) {
      return { success: false, provider: "google", error: this.config.error ?? "fail" };
    }
    return {
      success: true,
      provider: "google",
      event_id: this.config.eventId ?? "evt-1",
    };
  }
  async updateEvent(input: any) {
    return { success: true, provider: "google" };
  }
  async cancelEvent(input: any) {
    return { success: true, provider: "google" };
  }
}

const baseInput = {
  organization_id: "org",
  calendar_id: "cal-1",
  title: "Title",
  starts_at: "2026-03-11T10:00:00Z",
  ends_at: "2026-03-11T11:00:00Z",
  patient_name: "Paciente",
  patient_email: "p@example.com",
  patient_phone: "123",
  metadata: { test: true },
};

Deno.test("syncCalendarEvent success", async () => {
  overrideCalendarProviderFactory(() => new MockProvider({ success: true, eventId: "evt-123" }));
  const result = await syncCalendarEvent({ ...baseInput, provider: "google" });
  assertEquals(result.sync_status, "synced");
  assertEquals(result.success, true);
  assertEquals(result.event_id, "evt-123");
  resetCalendarProviderFactory();
});

Deno.test("syncCalendarEvent skipped without provider", async () => {
  const result = await syncCalendarEvent({ ...baseInput, provider: "", calendar_id: "" });
  assertEquals(result.sync_status, "skipped");
  assertEquals(result.provider, null);
  assertEquals(result.success, false);
});

Deno.test("syncCalendarEvent error when provider fails", async () => {
  overrideCalendarProviderFactory(() => new MockProvider({ success: false, error: "boom" }));
  const result = await syncCalendarEvent({ ...baseInput, provider: "google" });
  assertEquals(result.sync_status, "error");
  assertStringIncludes(result.error ?? "", "boom");
  resetCalendarProviderFactory();
});

function createMockSupabase() {
  const inserted: any[] = [];
  const updates: any[] = [];
  return {
    inserted,
    updates,
    from: (table: string) => {
      if (table === "appointments") {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                const data = { ...row, id: "appt-1" };
                inserted.push(data);
                return { error: null, data };
              },
            }),
          }),
          update: (row: any) => ({
            eq: (key: string, value: string) => {
              updates.push({ row, key, value });
              return Promise.resolve({ error: null, data: row });
            },
          }),
        };
      }
      return {
        insert: async () => ({ error: null, data: null }),
      };
    },
  } as const;
}

Deno.test("actionExecutor persists appointment even if calendar sync fails", async () => {
  const supabase = createMockSupabase();
  overrideCalendarProviderFactory(() => new MockProvider({ success: false, error: "boom" }));
  await executeToolAction({
    supabase: supabase as any,
    organizationId: "org",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        appointment_date: "2026-03-11",
        appointment_time: "10:00",
        starts_at: "2026-03-11T10:00:00Z",
        ends_at: "2026-03-11T11:00:00Z",
        calendar_provider: "google",
        calendar_id: "cal-1",
      },
    },
  });
  assertEquals(supabase.inserted.length, 1);
  assertEquals(supabase.updates[0].row.calendar_sync_status, "error");
  resetCalendarProviderFactory();
});

Deno.test("actionExecutor stores event id when sync succeeds", async () => {
  const supabase = createMockSupabase();
  overrideCalendarProviderFactory(() => new MockProvider({ success: true, eventId: "evt-999" }));
  await executeToolAction({
    supabase: supabase as any,
    organizationId: "org",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        appointment_date: "2026-03-11",
        appointment_time: "10:00",
        starts_at: "2026-03-11T10:00:00Z",
        ends_at: "2026-03-11T11:00:00Z",
        calendar_provider: "google",
        calendar_id: "cal-1",
      },
    },
  });
  assertEquals(supabase.updates[0].row.calendar_sync_status, "synced");
  assertEquals(supabase.updates[0].row.calendar_event_id, "evt-999");
  resetCalendarProviderFactory();
});
