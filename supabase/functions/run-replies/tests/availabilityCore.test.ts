import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  checkSlotAvailability,
  getAvailableSlotsForDay,
  suggestNextAvailableSlots,
} from "../domain/availabilityCore.ts";

type MockArgs = {
  orgSettings?: unknown[];
  barberServices?: unknown[];
  barbers?: unknown[];
  barberHours?: unknown[];
  businessHours?: unknown[];
  clinicHours?: unknown[];
  appointments?: unknown[];
};

function makeSupabase(args: MockArgs) {
  return {
    from(table: string) {
      let filters: Record<string, unknown> = {};
      const chain = {
        select() {
          return chain;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return chain;
        },
        neq() {
          return chain;
        },
        gte(key: string, value: unknown) {
          filters[`gte_${key}`] = value;
          return chain;
        },
        lte(key: string, value: unknown) {
          filters[`lte_${key}`] = value;
          return chain;
        },
        limit() {
          if (table === "org_settings") return Promise.resolve({ data: args.orgSettings ?? [{ timezone: "America/Tegucigalpa" }], error: null });
          if (table === "barber_services") return Promise.resolve({ data: args.barberServices ?? [], error: null });
          if (table === "barbers") return Promise.resolve({ data: args.barbers ?? [], error: null });
          if (table === "barber_hours") return Promise.resolve({ data: args.barberHours ?? [], error: null });
          if (table === "business_hours") return Promise.resolve({ data: args.businessHours ?? [], error: null });
          if (table === "clinic_hours") return Promise.resolve({ data: args.clinicHours ?? [], error: null });
          if (table === "appointments") {
            const data = (args.appointments ?? []) as any[];
            const fromDate = String(filters.gte_appointment_date ?? "");
            const toDate = String(filters.lte_appointment_date ?? "");
            const filtered = data.filter((row) => {
              const d = String(row.appointment_date ?? "");
              if (!fromDate || !toDate) return true;
              return d >= fromDate && d <= toDate;
            });
            return Promise.resolve({ data: filtered, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        then(resolve: (value: unknown) => unknown) {
          return (chain.limit() as Promise<unknown>).then(resolve);
        },
      };
      return chain;
    },
  };
}

Deno.test("availability core: past time rejected", async () => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const pastHour = String(Math.max(0, now.getHours() - 1)).padStart(2, "0");
  const res = await checkSlotAvailability({
    supabase: makeSupabase({}),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: today,
    specific_time: `${pastHour}:00`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  assertEquals(res.available, false);
  assertEquals(res.reason, "past_time");
});

Deno.test("availability core: closed day rejected", async () => {
  const base = new Date("2099-01-01T12:00:00");
  while (base.getDay() !== 0) base.setDate(base.getDate() + 1); // Sunday
  const sunday = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
  const res = await checkSlotAvailability({
    supabase: makeSupabase({
      businessHours: [{ day_of_week: "sun", open_time: "09:00", close_time: "17:00", is_closed: true }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: sunday,
    specific_time: "10:00",
    timezone: "America/Tegucigalpa",
  });
  assertEquals(res.available, false);
  assertEquals(res.reason, "closed_day");
});

Deno.test("availability core: occupied slot rejected", async () => {
  const res = await checkSlotAvailability({
    supabase: makeSupabase({
      businessHours: [{ day_of_week: "wed", open_time: "09:00", close_time: "17:00", is_closed: false }],
      appointments: [{
        appointment_date: "2099-01-07",
        appointment_time: "10:00",
        duration_min: 30,
        provider_id: "barber-1",
        status: "confirmed",
      }],
      barbers: [{ id: "barber-1", name: "Carlos", is_active: true }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_id: "barber-1",
    provider_preference: "specific",
    date: "2099-01-07",
    specific_time: "10:00",
    timezone: "America/Tegucigalpa",
  });
  assertEquals(res.available, false);
  assertEquals(res.reason, "overlap");
});

Deno.test("availability core: service duration overlap rejected", async () => {
  const res = await checkSlotAvailability({
    supabase: makeSupabase({
      businessHours: [{ day_of_week: "wed", open_time: "09:00", close_time: "17:00", is_closed: false }],
      barberServices: [{ id: "svc1", name: "Corte + barba", duration_min: 45, is_active: true }],
      appointments: [{
        appointment_date: "2099-01-07",
        appointment_time: "10:30",
        duration_min: 30,
        provider_id: "barber-1",
        status: "confirmed",
      }],
      barbers: [{ id: "barber-1", name: "Carlos", is_active: true }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_id: "svc1",
    provider_id: "barber-1",
    provider_preference: "specific",
    date: "2099-01-07",
    specific_time: "10:00",
    timezone: "America/Tegucigalpa",
  });
  assertEquals(res.available, false);
  assertEquals(res.reason, "overlap");
});

Deno.test("availability core: any provider works", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      businessHours: [{ day_of_week: "wed", open_time: "09:00", close_time: "12:00", is_closed: false }],
      barbers: [
        { id: "barber-1", name: "Carlos", is_active: true },
        { id: "barber-2", name: "Luis", is_active: true },
      ],
      appointments: [{
        appointment_date: "2099-01-07",
        appointment_time: "09:00",
        duration_min: 30,
        provider_id: "barber-1",
        status: "confirmed",
      }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-01-07",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  assert(slots.length > 0);
});

Deno.test("availability core: specific barber works", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      businessHours: [{ day_of_week: "wed", open_time: "09:00", close_time: "12:00", is_closed: false }],
      barbers: [{ id: "barber-1", name: "Carlos", is_active: true }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_id: "barber-1",
    provider_preference: "specific",
    date: "2099-01-07",
    timezone: "America/Tegucigalpa",
    max_options: 2,
  });
  assert(slots.length > 0);
  assert(slots.every((s) => s.provider_id === "barber-1"));
});

Deno.test("availability core: returns slots for Wednesday", async () => {
  const slots = await suggestNextAvailableSlots({
    supabase: makeSupabase({
      businessHours: [
        { day_of_week: "wed", open_time: "09:00", close_time: "11:00", is_closed: false },
      ],
      barbers: [{ id: "barber-1", name: "Carlos", is_active: true }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date_from: "2099-01-07",
    date_to: "2099-01-07",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  assert(slots.length > 0);
  assert(slots.every((s) => s.date === "2099-01-07"));
});

Deno.test("availability core: provider hours prevent slots before 09:00 with multiple barbers", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      barbers: [
        { id: "barber-1", name: "Carlos", is_active: true },
        { id: "barber-2", name: "Luis", is_active: true },
        { id: "barber-3", name: "Ramon", is_active: true },
      ],
      barberHours: [
        { barber_id: "barber-1", day_of_week: 2, start_time: "09:00", end_time: "19:00", is_active: true },
        { barber_id: "barber-2", day_of_week: 2, start_time: "09:00", end_time: "19:00", is_active: true },
        { barber_id: "barber-3", day_of_week: 2, start_time: "09:00", end_time: "19:00", is_active: true },
      ],
      businessHours: [{ day_of_week: "tue", open_time: "08:00", close_time: "17:00", is_closed: false }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-01-06",
    timezone: "America/Tegucigalpa",
    max_options: 5,
  });
  assert(slots.length > 0);
  assert(slots.every((s) => s.time >= "09:00"));
  assertEquals(slots[0]?.time, "09:00");
});

Deno.test("availability core: integer day_of_week 2 maps to Tuesday", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      barbers: [{ id: "barber-1", name: "Carlos", is_active: true }],
      barberHours: [{ barber_id: "barber-1", day_of_week: 2, start_time: "09:00", end_time: "19:00", is_active: true }],
      businessHours: [{ day_of_week: "tue", open_time: "08:00", close_time: "17:00", is_closed: false }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-01-06",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  assert(slots.length > 0);
  assertEquals(slots[0]?.time, "09:00");
});

Deno.test("availability core: deduplicates same time across providers", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      barbers: [
        { id: "barber-1", name: "Carlos", is_active: true },
        { id: "barber-2", name: "Luis", is_active: true },
      ],
      barberHours: [
        { barber_id: "barber-1", day_of_week: 2, start_time: "09:00", end_time: "10:00", is_active: true },
        { barber_id: "barber-2", day_of_week: 2, start_time: "09:00", end_time: "10:00", is_active: true },
      ],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-01-06",
    timezone: "America/Tegucigalpa",
    max_options: 5,
  });
  assert(slots.length > 0);
  const uniqueTimes = new Set(slots.map((s) => s.time));
  assertEquals(uniqueTimes.size, slots.length);
  assertEquals(slots[0]?.time, "09:00");
});

Deno.test("availability core: barbershop defaults to 30-minute slot increments", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      barbers: [{ id: "barber-1", name: "Carlos", is_active: true }],
      barberHours: [{ barber_id: "barber-1", day_of_week: 2, start_time: "09:00", end_time: "11:00", is_active: true }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-01-06",
    timezone: "America/Tegucigalpa",
    max_options: 5,
  });
  assert(slots.length >= 3);
  assertEquals(slots[0]?.time, "09:00");
  assertEquals(slots[1]?.time, "09:30");
  assertEquals(slots[2]?.time, "10:00");
});
