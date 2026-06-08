import { assert, assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  checkSlotAvailability,
  getAvailableSlotsForDay,
  suggestNextAvailableSlots,
} from "../domain/availabilityCore.ts";

type MockArgs = {
  orgSettings?: unknown[];
  organizationSettings?: unknown;
  providers?: unknown[];
  barberServices?: unknown[];
  barbers?: unknown[];
  barberHours?: unknown[];
  businessHours?: unknown[];
  clinicHours?: unknown[];
  appointments?: unknown[];
  bookingHolds?: unknown[];
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
        gt(key: string, value: unknown) {
          filters[`gt_${key}`] = value;
          return chain;
        },
        limit() {
          if (table === "org_settings") return Promise.resolve({ data: args.orgSettings ?? [{ timezone: "America/Tegucigalpa" }], error: null });
          if (table === "barber_services") {
            return Promise.resolve({
              data: args.barberServices ?? [{ id: "svc-default", name: "Corte clásico", duration_min: 30, is_active: true }],
              error: null,
            });
          }
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
          if (table === "booking_holds") {
            const data = (args.bookingHolds ?? []) as any[];
            const now = String(filters.gt_expires_at ?? "");
            const filtered = data.filter((row) => {
              if (filters.organization_id && String(row.organization_id ?? "") !== String(filters.organization_id)) return false;
              if (filters.status && String(row.status ?? "") !== String(filters.status)) return false;
              if (now && String(row.expires_at ?? "") <= now) return false;
              return true;
            });
            return Promise.resolve({ data: filtered, error: null });
          }
          if (table === "providers") {
            return Promise.resolve({ data: args.providers ?? [], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          if (table === "organization_settings") {
            const data = args.organizationSettings ?? null;
            return Promise.resolve({ data, error: null });
          }
          return Promise.resolve({ data: null, error: null });
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

Deno.test("availability core: dental past date returns no slots", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        services: [
          { id: "limpieza", name: "Limpieza dental", duration_min: 30 },
        ],
        providers: [{ id: "doctor-1", name: "Equipo DICAN", active: true }],
        hours: {
          monday: { closed: false, open: "09:00", close: "17:00" },
          tuesday: { closed: false, open: "09:00", close: "17:00" },
          wednesday: { closed: false, open: "09:00", close: "17:00" },
          thursday: { closed: false, open: "09:00", close: "17:00" },
          friday: { closed: false, open: "09:00", close: "17:00" },
        },
      },
    }),
    organization_id: "clinic-demo",
    business_type: "dental",
    service_name: "Limpieza dental",
    provider_preference: "any",
    date: "2000-06-05",
    timezone: "America/Tegucigalpa",
    max_options: 5,
  });

  assertEquals(slots.length, 0);
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

Deno.test("availability core: active booking hold blocks slot", async () => {
  const res = await checkSlotAvailability({
    supabase: makeSupabase({
      businessHours: [{ day_of_week: "wed", open_time: "09:00", close_time: "17:00", is_closed: false }],
      bookingHolds: [{
        id: "hold-1",
        organization_id: "barber-demo",
        provider_id: "barber-1",
        provider_name: "Carlos",
        starts_at: "2099-01-07T10:00:00-06:00",
        ends_at: "2099-01-07T10:30:00-06:00",
        status: "held",
        expires_at: "2099-01-01T00:00:00Z",
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

Deno.test("availability core: expired booking hold does not block slot", async () => {
  const res = await checkSlotAvailability({
    supabase: makeSupabase({
      businessHours: [{ day_of_week: "wed", open_time: "09:00", close_time: "17:00", is_closed: false }],
      bookingHolds: [{
        id: "hold-expired",
        organization_id: "barber-demo",
        provider_id: "barber-1",
        provider_name: "Carlos",
        starts_at: "2099-01-07T10:00:00-06:00",
        ends_at: "2099-01-07T10:30:00-06:00",
        status: "held",
        expires_at: "2000-01-01T00:00:00Z",
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
  assertEquals(res.available, true);
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
  assert(slots.every((s) => Boolean(s.provider_id) && Boolean(s.provider_name)));
  assert(slots.every((s) => Boolean(s.starts_at) && Boolean(s.service_key) && Boolean(s.service_name)));
});

Deno.test("availability core slot contract: never returns slot without provider/service contract", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      businessHours: [{ day_of_week: "mon", open_time: "09:00", close_time: "11:00", is_closed: false }],
      barbers: [{ id: "barber-1", name: "Alex", is_active: true }],
      barberServices: [{ id: "svc-cut", name: "Corte clásico", duration_min: 30, is_active: true }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  assert(slots.length > 0);
  for (const slot of slots) {
    assertEquals(Boolean(slot.provider_id), true);
    assertEquals(Boolean(slot.provider_name), true);
    assertEquals(Boolean(slot.starts_at), true);
    assertEquals(Boolean(slot.service_key), true);
    assertEquals(Boolean(slot.service_name), true);
  }
});

Deno.test("availability core: any provider assignment prefers fewer appointments that day", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      businessHours: [{ day_of_week: "wed", open_time: "09:00", close_time: "12:00", is_closed: false }],
      barbers: [
        { id: "barber-1", name: "Carlos", is_active: true },
        { id: "barber-2", name: "Luis", is_active: true },
      ],
      appointments: [
        { appointment_date: "2099-01-07", appointment_time: "09:00", duration_min: 30, provider_id: "barber-1", status: "confirmed" },
        { appointment_date: "2099-01-07", appointment_time: "10:00", duration_min: 30, provider_id: "barber-1", status: "confirmed" },
      ],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-01-07",
    timezone: "America/Tegucigalpa",
    max_options: 1,
  });
  assert(slots.length > 0);
  assertEquals(slots[0]?.provider_id, "barber-2");
  assertEquals(slots[0]?.provider_name, "Luis");
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

Deno.test("availability core: today respects min_notice_min and slot_interval_min for barbershop", async () => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        booking_rules: { min_notice_min: 90, slot_interval_min: 30 },
      },
      businessHours: [{ day_of_week: "mon", open_time: "08:00", close_time: "22:00", is_closed: false }],
      barbers: [{ id: "barber-1", name: "Alex", is_active: true }],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: today,
    timezone,
    max_options: 3,
  });
  if (slots.length === 0) return;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const minAllowed = Math.ceil((nowMin + 90) / 30) * 30;
  const first = slots[0];
  const hh = Number(String(first.time).slice(0, 2));
  const mm = Number(String(first.time).slice(3, 5));
  const firstMin = hh * 60 + mm;
  assert(firstMin >= minAllowed);
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
  const uniqueTimes = new Set(slots.map((s) => s.time));
  assertEquals(uniqueTimes.size, slots.length);
  assertEquals(slots[0]?.time, "09:00");
});

Deno.test("availability core: barbershop defaults to 30-minute slot increments", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      barbers: [{ id: "barber-1", name: "Carlos", is_active: true }],
      barberHours: [{ barber_id: "barber-1", day_of_week: 2, start_time: "09:00", end_time: "11:00", is_active: true }],
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
  assert(slots.length >= 3);
  assertEquals(slots[0]?.time, "09:00");
  assertEquals(slots[1]?.time, "09:30");
  assertEquals(slots[2]?.time, "10:00");
});

Deno.test("availability core guard A: no providers => no slots offered", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-1", name: "Corte clásico", duration_min: 30 }],
        providers: [],
        hours: { mon: { closed: false, open: "08:00", close: "17:00" } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
  });
  assertEquals(slots.length, 0);
});

Deno.test("availability core guard B: all days closed => no slots offered", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-1", name: "Corte clásico", duration_min: 30 }],
        providers: [{ id: "prov-1", name: "Carlos" }],
        hours: { mon: { closed: true }, tue: { closed: true }, wed: { closed: true } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
  });
  assertEquals(slots.length, 0);
});

Deno.test("availability core guard C: no services => no booking availability", async () => {
  const res = await checkSlotAvailability({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [],
        providers: [{ id: "prov-1", name: "Carlos" }],
        hours: { mon: { closed: false, open: "08:00", close: "17:00" } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    specific_time: "10:00",
    timezone: "America/Tegucigalpa",
  });
  assertEquals(res.available, false);
});

Deno.test("availability core guard D: valid settings => availability works", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-1", name: "Corte clásico", duration_min: 30 }],
        providers: [{ id: "prov-1", name: "Carlos" }],
        hours: { mon: { closed: false, open: "08:00", close: "17:00" } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  assert(slots.length > 0);
});

Deno.test("availability core guard E: follow-up date suggestion still respects no providers/no hours", async () => {
  const nextSlots = await suggestNextAvailableSlots({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-1", name: "Corte clásico", duration_min: 30 }],
        providers: [],
        hours: { mon: { closed: true }, tue: { closed: true }, wed: { closed: true } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date_from: "2099-05-18",
    date_to: "2099-05-21",
    timezone: "America/Tegucigalpa",
    max_options: 5,
  });
  assertEquals(nextSlots.length, 0);
});

Deno.test("availability core: service alias 'Corte clásico' normalizes to corte and includes providers with matching services", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-corte", name: "Corte clásico", duration_min: 30 }],
        providers: [
          { id: "bryan", name: "Bryan", active: true, services: ["corte", "corte+barba"] },
          { id: "alex", name: "Alex", active: true, services: ["corte", "cejas"] },
        ],
        hours: { mon: { closed: false, open: "08:00", close: "17:00" } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
    max_options: 5,
  });
  assert(slots.length > 0);
  const providerIds = new Set(slots.map((s) => s.provider_id));
  assert(providerIds.has("bryan"));
  assert(providerIds.has("alex"));
});

Deno.test("availability core: empty provider services means all services", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-corte", name: "Corte clásico", duration_min: 30 }],
        providers: [
          { id: "carlos", name: "Carlos", active: true, services: [] },
        ],
        hours: { mon: { closed: false, open: "08:00", close: "17:00" } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  assert(slots.length > 0);
  assert(slots.every((s) => s.provider_id === "carlos"));
});

Deno.test("availability core: closed provider schedule day is excluded", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-corte", name: "Corte clásico", duration_min: 30 }],
        providers: [
          { id: "bryan", name: "Bryan", active: true, services: ["corte"], schedule: { mon: { open: "08:00", close: "17:00", closed: true } } },
          { id: "alex", name: "Alex", active: true, services: ["corte"], schedule: { mon: { open: "08:00", close: "17:00", closed: false } } },
        ],
        hours: { mon: { closed: false, open: "08:00", close: "17:00" } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
    max_options: 5,
  });
  assert(slots.length > 0);
  assert(slots.every((s) => s.provider_id !== "bryan"));
  assert(slots.some((s) => s.provider_id === "alex"));
});

Deno.test("availability core: provider partial schedule inherits organization hours for undefined day", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-corte", name: "Corte clásico", duration_min: 30 }],
        providers: [
          {
            id: "bryan",
            name: "Bryan",
            active: true,
            services: ["corte"],
            schedule: {
              tue: { closed: false, open: "10:00", close: "17:00" },
            },
          },
        ],
        hours: {
          mon: { closed: false, open: "08:00", close: "17:00" },
          tue: { closed: false, open: "08:00", close: "17:00" },
        },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  assert(slots.length > 0);
  assert(slots.every((s) => s.provider_id === "bryan"));
});

Deno.test("availability core: public providers table is preferred over organization_settings providers", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      providers: [
        { id: "public-alex", name: "Alex", active: true, role: "doctor", services: ["corte"], schedule: { mon: { closed: false, open: "09:00", close: "17:00" } } },
      ],
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-corte", name: "Corte clásico", duration_min: 30 }],
        providers: [
          { id: "json-bryan", name: "Bryan", active: true, services: ["corte"], schedule: { mon: { closed: false, open: "09:00", close: "17:00" } } },
        ],
        hours: { mon: { closed: false, open: "09:00", close: "17:00" } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  assert(slots.length > 0);
  assert(slots.every((slot) => slot.provider_id === "public-alex"));
});

Deno.test("availability core: provider services compatibility maps corte_barba to corte+barba", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "corte_barba", key: "corte_barba", name: "Corte y barba", duration_min: 80 }],
        providers: [
          { id: "edgar", name: "Edgar", active: true, services: ["corte+barba"] },
          { id: "alex", name: "Alex", active: true, services: ["limpieza"] },
        ],
        hours: { mon: { closed: false, open: "09:00", close: "18:00" } },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_id: "corte_barba",
    service_name: "Corte y barba",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
    max_options: 5,
  });
  assert(slots.length > 0);
  assert(slots.every((slot) => slot.provider_id === "edgar"));
});

Deno.test("availability core: provider cannot open day when org hours day is missing/closed", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-corte", name: "Corte clásico", duration_min: 30 }],
        providers: [
          {
            id: "alex",
            name: "Alex",
            active: true,
            services: ["corte"],
            schedule: {
              thu: { closed: false, open: "08:00", close: "17:00" },
            },
          },
        ],
        // Thursday intentionally undefined at org level
        hours: {
          mon: { closed: false, open: "08:00", close: "17:00" },
          tue: { closed: false, open: "08:00", close: "17:00" },
          wed: { closed: false, open: "08:00", close: "17:00" },
          fri: { closed: false, open: "08:00", close: "17:00" },
        },
      },
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-21",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  assertEquals(slots.length, 0);
});

Deno.test("availability core: provider conflict excludes only conflicted provider slot", async () => {
  const slots = await getAvailableSlotsForDay({
    supabase: makeSupabase({
      organizationSettings: {
        organization_id: "barber-demo",
        services: [{ id: "svc-corte", name: "Corte clásico", duration_min: 30 }],
        providers: [
          { id: "bryan", name: "Bryan", active: true, services: ["corte"] },
          { id: "alex", name: "Alex", active: true, services: ["corte"] },
        ],
        hours: { mon: { closed: false, open: "08:00", close: "17:00" } },
      },
      appointments: [
        { appointment_date: "2099-05-18", appointment_time: "09:00", duration_min: 30, provider_id: "bryan", status: "confirmed" },
      ],
    }),
    organization_id: "barber-demo",
    business_type: "barbershop",
    service_name: "Corte clásico",
    provider_preference: "any",
    date: "2099-05-18",
    timezone: "America/Tegucigalpa",
    max_options: 3,
  });
  const nine = slots.find((s) => s.time === "09:00");
  assert(nine != null);
  assertEquals(nine?.provider_id, "alex");
});

Deno.test("availability core: exact-time alternatives are future and sorted near requested time", async () => {
  Deno.env.set("RUN_REPLIES_TEST_NOW", "2099-05-18T17:10:00Z"); // 11:10 AM America/Tegucigalpa
  try {
    const result = await checkSlotAvailability({
      supabase: makeSupabase({
        organizationSettings: {
          organization_id: "barber-demo",
          services: [{ id: "svc-corte", name: "Corte clásico", duration_min: 30 }],
          providers: [{ id: "alex", name: "Alex", active: true, services: ["corte"] }],
          hours: { mon: { closed: false, open: "09:00", close: "17:00" } },
          booking_rules: { slot_interval_min: 30, min_notice_min: 0 },
        },
        appointments: [
          { appointment_date: "2099-05-18", appointment_time: "14:00", starts_at: "2099-05-18T14:00:00-06:00", ends_at: "2099-05-18T14:30:00-06:00", duration_min: 30, provider_id: "alex", status: "confirmed" },
        ],
      }),
      organization_id: "barber-demo",
      business_type: "barbershop",
      service_name: "Corte clásico",
      provider_id: "alex",
      provider_preference: "specific",
      date: "2099-05-18",
      specific_time: "14:00",
      timezone: "America/Tegucigalpa",
      max_options: 3,
    });
    assertEquals(result.available, false);
    const times = (result.alternatives ?? []).map((slot) => slot.time);
    assert(!times.includes("09:00"));
    assert(!times.includes("09:30"));
    assert(!times.includes("10:00"));
    assertEquals(times[0], "13:30");
    assertEquals(times[1], "14:30");
  } finally {
    Deno.env.delete("RUN_REPLIES_TEST_NOW");
  }
});

Deno.test("availability core: exact-time alternatives move to next open day when no future slots today", async () => {
  Deno.env.set("RUN_REPLIES_TEST_NOW", "2099-05-18T22:40:00Z"); // 4:40 PM America/Tegucigalpa
  try {
    const result = await checkSlotAvailability({
      supabase: makeSupabase({
        organizationSettings: {
          organization_id: "barber-demo",
          services: [{ id: "svc-corte", name: "Corte clásico", duration_min: 30 }],
          providers: [{ id: "alex", name: "Alex", active: true, services: ["corte"] }],
          hours: {
            mon: { closed: false, open: "09:00", close: "17:00" },
            tue: { closed: false, open: "09:00", close: "17:00" },
          },
          booking_rules: { slot_interval_min: 30, min_notice_min: 0 },
        },
      }),
      organization_id: "barber-demo",
      business_type: "barbershop",
      service_name: "Corte clásico",
      provider_id: "alex",
      provider_preference: "specific",
      date: "2099-05-18",
      specific_time: "16:00",
      timezone: "America/Tegucigalpa",
      max_options: 3,
    });
    assertEquals(result.available, false);
    assert((result.alternatives ?? []).length > 0);
    assert((result.alternatives ?? []).every((slot) => slot.date > "2099-05-18"));
  } finally {
    Deno.env.delete("RUN_REPLIES_TEST_NOW");
  }
});
