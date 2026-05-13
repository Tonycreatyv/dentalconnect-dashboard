import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { checkExactSlotAvailability, getAvailableSlots } from "../domain/availability.ts";

function makeSupabase(args: {
  overlapCount?: number;
  businessHoursRows?: unknown[];
  clinicHoursRows?: unknown[];
  appointmentsRows?: unknown[];
}) {
  return {
    from(table: string) {
      let sawDateWindowFilters = false;
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        neq() {
          if (table === "appointments" && sawDateWindowFilters) {
            return Promise.resolve({
              data: args.appointmentsRows ?? [],
              error: null,
            });
          }
          return chain;
        },
        gte() {
          sawDateWindowFilters = true;
          return chain;
        },
        lte() {
          sawDateWindowFilters = true;
          return chain;
        },
        lt() {
          return chain;
        },
        gt() {
          return chain;
        },
        limit() {
          if (table === "appointments") {
            return Promise.resolve({
              data: new Array(args.overlapCount ?? 0).fill({ id: "x" }),
              error: null,
            });
          }
          if (table === "business_hours") {
            return Promise.resolve({ data: args.businessHoursRows ?? [], error: null });
          }
          if (table === "clinic_hours") {
            return Promise.resolve({ data: args.clinicHoursRows ?? [], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
}

Deno.test("exact slot availability: available when no overlap", async () => {
  const res = await checkExactSlotAvailability({
    supabase: makeSupabase({ overlapCount: 0 }),
    organizationId: "clinic-demo",
    hours: {
      tue: { closed: false, open: "08:00", close: "17:00" },
    },
    requestedDate: "2099-01-06",
    requestedTime: "10:00",
    durationMin: 45,
    timezone: "America/Tegucigalpa",
    sameDayBookingCutoff: "15:00",
    bufferMin: 10,
  });
  assertEquals(res.available, true);
});

Deno.test("exact slot availability: conflict when overlap exists", async () => {
  const res = await checkExactSlotAvailability({
    supabase: makeSupabase({ overlapCount: 1 }),
    organizationId: "clinic-demo",
    hours: {
      tue: { closed: false, open: "08:00", close: "17:00" },
    },
    requestedDate: "2099-01-06",
    requestedTime: "10:00",
    durationMin: 45,
    timezone: "America/Tegucigalpa",
    sameDayBookingCutoff: "15:00",
    bufferMin: 10,
  });
  assertEquals(res.available, false);
  assertEquals(res.reason, "conflict");
});

Deno.test("exact slot availability: DB business_hours rejects before opening", async () => {
  const res = await checkExactSlotAvailability({
    supabase: makeSupabase({
      businessHoursRows: [{ day_of_week: "tue", open_time: "09:00", close_time: "18:00", is_closed: false }],
      overlapCount: 0,
    }),
    organizationId: "clinic-demo",
    requestedDate: "2099-01-06",
    requestedTime: "08:00",
    durationMin: 60,
    timezone: "America/Tegucigalpa",
    sameDayBookingCutoff: "15:00",
    bufferMin: 0,
  });
  assertEquals(res.available, false);
  assertEquals(res.reason, "outside_hours");
});

Deno.test("exact slot availability: DB business_hours rejects after cutoff by duration", async () => {
  const res = await checkExactSlotAvailability({
    supabase: makeSupabase({
      businessHoursRows: [{ day_of_week: "tue", open_time: "09:00", close_time: "18:00", is_closed: false }],
      overlapCount: 0,
    }),
    organizationId: "clinic-demo",
    requestedDate: "2099-01-06",
    requestedTime: "17:30",
    durationMin: 60,
    timezone: "America/Tegucigalpa",
    sameDayBookingCutoff: "15:00",
    bufferMin: 0,
  });
  assertEquals(res.available, false);
  assertEquals(res.reason, "outside_hours");
});

Deno.test("exact slot availability: DB business_hours allows 17:00 when duration fits", async () => {
  const res = await checkExactSlotAvailability({
    supabase: makeSupabase({
      businessHoursRows: [{ day_of_week: "tue", open_time: "09:00", close_time: "18:00", is_closed: false }],
      overlapCount: 0,
    }),
    organizationId: "clinic-demo",
    requestedDate: "2099-01-06",
    requestedTime: "17:00",
    durationMin: 60,
    timezone: "America/Tegucigalpa",
    sameDayBookingCutoff: "15:00",
    bufferMin: 0,
  });
  assertEquals(res.available, true);
});

Deno.test("getAvailableSlots: existing appointments block slots", async () => {
  const slots = await getAvailableSlots({
    supabase: makeSupabase({
      businessHoursRows: [{ day_of_week: "tue", open_time: "09:00", close_time: "11:00", is_closed: false }],
      appointmentsRows: [
        {
          start_at: "2099-01-06T09:00:00",
          ends_at: "2099-01-06T09:30:00",
          duration_min: 30,
          status: "confirmed",
        },
      ],
    }),
    organizationId: "clinic-demo",
    daysAhead: 1,
    slotDurationMin: 30,
    timezone: "America/Tegucigalpa",
    sameDayBookingCutoff: "23:59",
    bufferMin: 0,
  });
  assert(!slots.some((s) => s.time === "09:00"));
});

Deno.test("exact slot availability: falls back to default hours and logs marker when DB has no hours", async () => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map((x) => String(x)).join(" "));
  };
  try {
    const res = await checkExactSlotAvailability({
      supabase: makeSupabase({ overlapCount: 0, businessHoursRows: [], clinicHoursRows: [] }),
      organizationId: "clinic-demo",
      requestedDate: "2099-01-06",
      requestedTime: "08:00",
      durationMin: 30,
      timezone: "America/Tegucigalpa",
      sameDayBookingCutoff: "15:00",
      bufferMin: 0,
    });
    assertEquals(res.available, true);
    assert(logs.some((line) => line.includes("availability:using_default_hours")));
  } finally {
    console.log = originalLog;
  }
});
