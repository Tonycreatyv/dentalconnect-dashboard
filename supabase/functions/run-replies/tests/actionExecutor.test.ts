import { assertEquals } from "https://deno.land/std@0.223.0/testing/asserts.ts";
import { executeToolAction } from "../domain/actionExecutor.ts";

type QueryResult = { error: any; data: any };

function makeResult(data: any): QueryResult {
  return { error: null, data };
}

function createBookSupabaseFixture(opts: {
  futureAppointments?: Array<Record<string, unknown>>;
  barbers?: Array<Record<string, unknown>>;
}) {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const futureAppointments = opts.futureAppointments ?? [];
  const barbers = opts.barbers ?? [];

  const queryState = {
    table: "",
    filters: [] as Array<{ op: string; key: string; value: unknown }>,
    order: [] as Array<{ key: string; ascending: boolean }>,
    limit: 0,
  };

  function buildQuery(table: string) {
    queryState.table = table;
    queryState.filters = [];
    queryState.order = [];
    queryState.limit = 0;
    const chain: any = {
      select(_fields: string) {
        return chain;
      },
      eq(key: string, value: unknown) {
        queryState.filters.push({ op: "eq", key, value });
        return chain;
      },
      in(key: string, value: unknown) {
        queryState.filters.push({ op: "in", key, value });
        return chain;
      },
      gte(key: string, value: unknown) {
        queryState.filters.push({ op: "gte", key, value });
        return chain;
      },
      lt(_key: string, _value: unknown) {
        return chain;
      },
      gt(_key: string, _value: unknown) {
        return chain;
      },
      neq(_key: string, _value: unknown) {
        return chain;
      },
      order(key: string, opts?: { ascending?: boolean }) {
        queryState.order.push({ key, ascending: opts?.ascending !== false });
        return chain;
      },
      limit(value: number) {
        queryState.limit = value;
        return chain;
      },
      maybeSingle: async () => {
        if (table === "org_settings") {
          return makeResult({
            timezone: "America/Tegucigalpa",
            same_day_booking_cutoff: "15:00",
            buffer_min: 10,
          });
        }
        if (table === "appointments") {
          const wantsIdOnly = queryState.filters.some((f) => f.op === "in" && f.key === "status");
          if (wantsIdOnly) return makeResult(null);
          return makeResult(null);
        }
        if (table === "leads") return makeResult({ channel_user_id: "50499900000" });
        return makeResult(null);
      },
      single: async () => {
        if (table === "org_settings") {
          return makeResult({
            timezone: "America/Tegucigalpa",
            same_day_booking_cutoff: "15:00",
            buffer_min: 10,
          });
        }
        return makeResult(null);
      },
      then(resolve: (value: QueryResult) => unknown) {
        return Promise.resolve(chain.exec()).then(resolve as any);
      },
      async exec(): Promise<QueryResult> {
        if (table === "appointments") {
          const hasFutureLookup = queryState.filters.some((f) => f.op === "gte" && f.key === "appointment_date");
          const hasOverlapLookup = queryState.filters.some((f) => f.op === "lt" && f.key === "starts_at");
          if (hasFutureLookup) return makeResult(futureAppointments);
          if (hasOverlapLookup) return makeResult([]);
          return makeResult([]);
        }
        if (table === "providers") return makeResult([]);
        if (table === "barbers") return makeResult(barbers);
        if (table === "information_schema.columns") return makeResult([]);
        if (table === "followup_outbox") return makeResult({ id: "followup-1" });
        if (table === "clinics") return makeResult(null);
        if (table === "clinic_settings") return makeResult(null);
        return makeResult([]);
      },
    };
    return chain;
  }

  const supabase: any = {
    from(table: string) {
      if (table === "events") {
        return {
          insert(payload: Record<string, unknown>) {
            events.push(payload);
            return Promise.resolve(makeResult([]));
          },
        };
      }
      if (table === "appointments") {
        return {
          ...buildQuery(table),
          insert(payload: Record<string, unknown>) {
            inserted.push(payload);
            return {
              select() {
                return {
                  single: async () => makeResult({ ...payload, id: "appt-new" }),
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            updated.push(payload);
            return {
              eq(_key: string, _value: string) {
                return {
                  select() {
                    return {
                      single: async () => makeResult({ ...payload, id: "appt-existing" }),
                    };
                  },
                };
              },
            };
          },
        };
      }
      return buildQuery(table);
    },
  };

  return { supabase, inserted, updated, events };
}

Deno.test("book_appointment hard guard blocks exact duplicate", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [
      {
        id: "appt-dup",
        reason: "Corte clásico",
        title: "Cita: Corte clásico",
        appointment_date: "2026-05-12",
        appointment_time: "10:00",
        starts_at: "2026-05-12T10:00:00-06:00",
        status: "confirmed",
      },
    ],
  });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        service: "Corte clásico",
        appointment_date: "2026-05-12",
        appointment_time: "10:00",
      },
    },
  });
  assertEquals(result.booking?.ok, false);
  assertEquals((result.booking as any)?.error, "duplicate_appointment_exact");
  assertEquals(fixture.inserted.length, 0);
});

Deno.test("book_appointment persists provider_id/provider_name from payload", async () => {
  const fixture = createBookSupabaseFixture({ futureAppointments: [] });
  await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        service: "Corte clásico",
        appointment_date: "2026-05-12",
        appointment_time: "10:00",
        provider_id: "barber-1",
        provider_name: "Carlos",
      },
    },
  });
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.inserted[0].provider_id, "barber-1");
  assertEquals(fixture.inserted[0].provider_name, "Carlos");
});

Deno.test("book_appointment resolves provider_id from barber name when missing", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    barbers: [{ id: "barber-carlos", name: "Carlos" }],
  });
  await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        service: "Corte clásico",
        appointment_date: "2026-05-12",
        appointment_time: "10:00",
        provider_name: "Carlos",
      },
    },
  });
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.inserted[0].provider_name, "Carlos");
  assertEquals(fixture.inserted[0].provider_id, "barber-carlos");
});
