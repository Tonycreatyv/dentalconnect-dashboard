import { assertEquals } from "https://deno.land/std@0.223.0/testing/asserts.ts";
import { executeToolAction } from "../domain/actionExecutor.ts";
import { createBookingHold } from "../domain/bookingHolds.ts";

type QueryResult = { error: any; data: any };

function makeResult(data: any): QueryResult {
  return { error: null, data };
}

function createBookSupabaseFixture(opts: {
  futureAppointments?: Array<Record<string, unknown>>;
  overlapAppointments?: Array<Record<string, unknown>>;
  barbers?: Array<Record<string, unknown>>;
  bookingHolds?: Array<Record<string, unknown>>;
  insertError?: Record<string, unknown>;
}) {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const followups: Array<Record<string, unknown>> = [];
  const appointmentEvents: Array<Record<string, unknown>> = [];
  const futureAppointments = opts.futureAppointments ?? [];
  const overlapAppointments = opts.overlapAppointments ?? [];
  const barbers = opts.barbers ?? [];
  const bookingHolds = opts.bookingHolds ?? [];
  const holdUpdates: Array<Record<string, unknown>> = [];
  const queries: Array<{
    table: string;
    filters: Array<{ op: string; key: string; value: unknown }>;
  }> = [];
  const canonicalProviders = barbers.length > 0
    ? barbers.map((b: any) => ({
      id: String(b.id),
      name: String(b.name),
      active: true,
    }))
    : [
      { id: "barber-1", name: "Carlos", active: true },
      { id: "barber-2", name: "Luis", active: true },
    ];

  const queryState = {
    table: "",
    filters: [] as Array<{ op: string; key: string; value: unknown }>,
    order: [] as Array<{ key: string; ascending: boolean }>,
    limit: 0,
  };

  function matchesFilters(row: Record<string, unknown>) {
    return queryState.filters.every((filter) => {
      const actual = row[filter.key];
      if (filter.op === "eq") {
        return String(actual ?? "") === String(filter.value ?? "");
      }
      if (filter.op === "in") {
        return Array.isArray(filter.value) &&
          (filter.value as unknown[]).map(String).includes(
            String(actual ?? ""),
          );
      }
      if (filter.op === "gte") {
        return String(actual ?? "") >= String(filter.value ?? "");
      }
      if (filter.op === "lte") {
        return String(actual ?? "") <= String(filter.value ?? "");
      }
      if (filter.op === "gt") {
        return String(actual ?? "") > String(filter.value ?? "");
      }
      if (filter.op === "lt") {
        return String(actual ?? "") < String(filter.value ?? "");
      }
      if (filter.op === "neq") {
        return String(actual ?? "") !== String(filter.value ?? "");
      }
      if (filter.op === "like") {
        const expected = String(filter.value ?? "").replace(/%/g, "");
        return String(actual ?? "").includes(expected);
      }
      return true;
    });
  }

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
      lte(key: string, value: unknown) {
        queryState.filters.push({ op: "lte", key, value });
        return chain;
      },
      lt(key: string, value: unknown) {
        queryState.filters.push({ op: "lt", key, value });
        return chain;
      },
      gt(key: string, value: unknown) {
        queryState.filters.push({ op: "gt", key, value });
        return chain;
      },
      neq(key: string, value: unknown) {
        queryState.filters.push({ op: "neq", key, value });
        return chain;
      },
      like(key: string, value: unknown) {
        queryState.filters.push({ op: "like", key, value });
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
        if (table === "organization_settings") {
          return makeResult({
            services: [
              { name: "Corte clásico", price: 150, duration_min: 30 },
            ],
            providers: canonicalProviders,
            hours: {
              monday: { closed: false, open: "08:00", close: "17:00" },
              tuesday: { closed: false, open: "08:00", close: "17:00" },
              wednesday: { closed: false, open: "08:00", close: "17:00" },
              thursday: { closed: false, open: "08:00", close: "17:00" },
              friday: { closed: false, open: "08:00", close: "17:00" },
              saturday: { closed: false, open: "09:00", close: "17:00" },
              sunday: { closed: true, open: "09:00", close: "17:00" },
            },
          });
        }
        if (table === "org_settings") {
          return makeResult({
            timezone: "America/Tegucigalpa",
            same_day_booking_cutoff: "15:00",
            buffer_min: 10,
          });
        }
        if (table === "appointments") {
          const found = futureAppointments.find((appointment) =>
            matchesFilters(appointment)
          );
          return makeResult(found ?? null);
        }
        if (table === "booking_holds") {
          const found = bookingHolds.find((hold) => matchesFilters(hold));
          return makeResult(found ?? null);
        }
        if (table === "leads") {
          return makeResult({
            channel: "whatsapp",
            channel_user_id: "50499900000",
            full_name: "Carlos Test",
          });
        }
        if (table === "barbers") {
          const wantedId = String(
            queryState.filters.find((f) => f.op === "eq" && f.key === "id")
              ?.value ?? "",
          );
          if (!wantedId) return makeResult(null);
          const found = barbers.find((b: any) =>
            String((b as any).id ?? "") === wantedId
          );
          if (!found) return makeResult(null);
          return makeResult({ ...found, is_active: true });
        }
        if (table === "clinics") return makeResult({ id: "clinic-1" });
        if (table === "clinic_settings") {
          return makeResult({
            hours: {
              monday: { closed: false, open: "08:00", close: "17:00" },
              tuesday: { closed: false, open: "08:00", close: "17:00" },
              wednesday: { closed: false, open: "08:00", close: "17:00" },
              thursday: { closed: false, open: "08:00", close: "17:00" },
              friday: { closed: false, open: "08:00", close: "17:00" },
              saturday: { closed: false, open: "09:00", close: "17:00" },
              sunday: { closed: true, open: "09:00", close: "17:00" },
            },
          });
        }
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
        queries.push({
          table,
          filters: queryState.filters.map((filter) => ({ ...filter })),
        });
        if (table === "appointments") {
          const hasFutureLookup = queryState.filters.some((f) =>
            f.op === "gte" && f.key === "appointment_date"
          );
          const hasOverlapLookup = queryState.filters.some((f) =>
            f.op === "lt" && f.key === "starts_at"
          );
          if (hasFutureLookup) return makeResult(futureAppointments);
          if (hasOverlapLookup) {
            return makeResult(
              overlapAppointments.filter((appointment) =>
                matchesFilters(appointment)
              ),
            );
          }
          return makeResult([]);
        }
        if (table === "booking_holds") {
          return makeResult(
            bookingHolds.filter((hold) => matchesFilters(hold)),
          );
        }
        if (table === "providers") return makeResult([]);
        if (table === "organization_settings") {
          return makeResult([
            {
              services: [{
                name: "Corte clásico",
                price: 150,
                duration_min: 30,
              }],
              providers: canonicalProviders,
              hours: {
                monday: { closed: false, open: "08:00", close: "17:00" },
                tuesday: { closed: false, open: "08:00", close: "17:00" },
                wednesday: { closed: false, open: "08:00", close: "17:00" },
                thursday: { closed: false, open: "08:00", close: "17:00" },
                friday: { closed: false, open: "08:00", close: "17:00" },
                saturday: { closed: false, open: "09:00", close: "17:00" },
                sunday: { closed: true, open: "09:00", close: "17:00" },
              },
            },
          ]);
        }
        if (table === "barbers") return makeResult(barbers);
        if (table === "information_schema.columns") {
          const tableName = String(
            queryState.filters.find((f) =>
              f.op === "eq" && f.key === "table_name"
            )?.value ?? "",
          );
          if (tableName === "followup_outbox") {
            return makeResult([
              "organization_id",
              "lead_id",
              "channel",
              "channel_user_id",
              "policy",
              "reason",
              "step",
              "max_steps",
              "scheduled_for",
              "due_at",
              "status",
              "attempts",
              "attempt_count",
              "provider",
              "provider_payload",
              "payload",
              "message_text",
              "updated_at",
            ].map((column_name) => ({ column_name })));
          }
          return makeResult([]);
        }
        if (table === "followup_outbox") {
          return makeResult(followups.filter((row) => matchesFilters(row)));
        }
        if (table === "clinics") return makeResult([{ id: "clinic-1" }]);
        if (table === "clinic_settings") {
          return makeResult([
            {
              hours: {
                monday: { closed: false, open: "08:00", close: "17:00" },
                tuesday: { closed: false, open: "08:00", close: "17:00" },
                wednesday: { closed: false, open: "08:00", close: "17:00" },
                thursday: { closed: false, open: "08:00", close: "17:00" },
                friday: { closed: false, open: "08:00", close: "17:00" },
                saturday: { closed: false, open: "09:00", close: "17:00" },
                sunday: { closed: true, open: "09:00", close: "17:00" },
              },
            },
          ]);
        }
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
      if (table === "booking_holds") {
        return {
          ...buildQuery(table),
          insert(payload: Record<string, unknown>) {
            bookingHolds.push(payload);
            return {
              select() {
                return {
                  single: async () => makeResult(payload),
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            queryState.table = table;
            queryState.filters = [];
            holdUpdates.push(payload);
            const chain: any = {
              eq(key: string, value: unknown) {
                queryState.filters.push({ op: "eq", key, value });
                return chain;
              },
              lte(key: string, value: unknown) {
                queryState.filters.push({ op: "lte", key, value });
                return chain;
              },
              then(resolve: (value: QueryResult) => unknown) {
                for (const hold of bookingHolds) {
                  if (matchesFilters(hold)) Object.assign(hold, payload);
                }
                return Promise.resolve(makeResult([])).then(resolve as any);
              },
            };
            return chain;
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
                  single: async () =>
                    opts.insertError
                      ? { error: opts.insertError, data: null }
                      : makeResult({ ...payload, id: "appt-new" }),
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
                      single: async () =>
                        makeResult({ ...payload, id: "appt-existing" }),
                      maybeSingle: async () =>
                        makeResult({ ...payload, id: "appt-existing" }),
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "appointment_events") {
        return {
          ...buildQuery(table),
          upsert(payload: Record<string, unknown>) {
            const key =
              `${payload.organization_id}|${payload.appointment_id}|${payload.event_type}`;
            if (
              !appointmentEvents.some((event) =>
                `${event.organization_id}|${event.appointment_id}|${event.event_type}` ===
                  key
              )
            ) {
              appointmentEvents.push(payload);
            }
            return Promise.resolve(makeResult(payload));
          },
          insert(payload: Record<string, unknown>) {
            appointmentEvents.push(payload);
            return Promise.resolve(makeResult(payload));
          },
        };
      }
      if (table === "followup_outbox") {
        return {
          ...buildQuery(table),
          upsert(payload: Record<string, unknown>) {
            const key =
              `${payload.organization_id}|${payload.lead_id}|${payload.reason}|${payload.step}`;
            if (
              !followups.some((row) =>
                `${row.organization_id}|${row.lead_id}|${row.reason}|${row.step}` ===
                  key
              )
            ) {
              followups.push(payload);
            }
            return {
              select() {
                return {
                  maybeSingle: async () =>
                    makeResult({ id: "followup-1", ...payload }),
                };
              },
            };
          },
          insert(payload: Record<string, unknown>) {
            followups.push(payload);
            return {
              select() {
                return {
                  maybeSingle: async () =>
                    makeResult({ id: "followup-1", ...payload }),
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(_key: string, _value: unknown) {
                return this;
              },
              like(_key: string, _value: unknown) {
                return this;
              },
              in(_key: string, _value: unknown[]) {
                followups.forEach((row) => Object.assign(row, payload));
                return Promise.resolve(makeResult([]));
              },
            };
          },
        };
      }
      return buildQuery(table);
    },
  };

  return {
    supabase,
    inserted,
    updated,
    events,
    bookingHolds,
    holdUpdates,
    followups,
    appointmentEvents,
    queries,
  };
}

Deno.test("cancel_appointment barbershop cancels active appointment with customer-facing copy", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [
      {
        id: "appt-cancel",
        organization_id: "barber-demo",
        lead_id: "lead-1",
        reason: "Corte clásico",
        title: "Cita: Corte clásico",
        appointment_date: "2099-05-23",
        appointment_time: "14:00",
        starts_at: "2099-05-23T14:00:00-06:00",
        status: "confirmed",
      },
    ],
  });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "cancel_appointment",
      payload: {
        appointment_id: "appt-cancel",
        business_type: "barbershop",
      },
    },
  });

  assertEquals(fixture.updated.length, 1);
  assertEquals(fixture.updated[0].status, "cancelled");
  assertEquals(
    result.replyOverride,
    "✅ Tu cita fue cancelada.\n\nSi querés, puedo ayudarte a buscar otro horario.",
  );
  assertEquals((result.statePatch as any)?.pending_cancel, null);
  assertEquals((result.statePatch as any)?.pending_cancel_appointment, null);
});

Deno.test("reschedule_appointment barbershop updates active appointment with barber copy", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [
      {
        id: "appt-reschedule",
        organization_id: "barber-demo",
        lead_id: "lead-1",
        reason: "Corte clásico",
        title: "Cita: Corte clásico",
        appointment_date: "2099-05-23",
        appointment_time: "14:00",
        starts_at: "2099-05-23T14:00:00-06:00",
        ends_at: "2099-05-23T14:30:00-06:00",
        duration_min: 30,
        status: "confirmed",
      },
    ],
    overlapAppointments: [],
  });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "reschedule_appointment",
      payload: {
        appointment_id: "appt-reschedule",
        appointment_date: "2099-05-24",
        appointment_time: "13:00",
        reason: "Corte clásico",
        duration_min: 30,
        business_type: "barbershop",
      },
    },
  });

  assertEquals(fixture.updated.length, 1);
  assertEquals(fixture.updated[0].appointment_date, "2099-05-24");
  assertEquals(fixture.updated[0].appointment_time, "13:00");
  assertEquals(
    String(result.replyOverride ?? "").includes("✅ Cita reagendada"),
    true,
  );
  assertEquals(
    String(result.replyOverride ?? "").includes("💈 Servicio: *Corte clásico*"),
    true,
  );
  assertEquals(
    String(result.replyOverride ?? "").includes("📅 Nueva fecha:"),
    true,
  );
  assertEquals(
    String(result.replyOverride ?? "").includes("⏰ Nueva hora:"),
    true,
  );
  assertEquals((result.statePatch as any)?.pending_reschedule, null);
});

Deno.test("reschedule_appointment dental updates existing appointment without duplicate", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [
      {
        id: "appt-dental-reschedule",
        organization_id: "clinic-demo",
        lead_id: "lead-dental",
        reason: "Blanqueamiento dental",
        title: "Cita: Blanqueamiento dental",
        appointment_date: "2026-06-04",
        appointment_time: "09:00",
        starts_at: "2026-06-04T15:00:00.000Z",
        ends_at: "2026-06-04T16:00:00.000Z",
        duration_min: 60,
        status: "confirmed",
        provider_id: null,
        provider_name: "Equipo DICAN",
      },
    ],
    overlapAppointments: [],
  });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "clinic-demo",
    leadId: "lead-dental",
    action: {
      name: "reschedule_appointment",
      payload: {
        appointment_id: "appt-dental-reschedule",
        appointment_date: "2026-06-04",
        appointment_time: "10:00",
        starts_at: "2026-06-04T10:00:00",
        reason: "Blanqueamiento dental",
        duration_min: 60,
        provider_id: "doctor_demo",
        provider_name: "Doctor disponible",
        brand_name: "DICAN",
        business_type: "dental",
      },
    },
  });

  assertEquals(fixture.inserted.length, 0);
  assertEquals(fixture.updated.length, 1);
  assertEquals(fixture.updated[0].appointment_date, "2026-06-04");
  assertEquals(fixture.updated[0].appointment_time, "10:00");
  assertEquals(Object.hasOwn(fixture.updated[0], "provider_id"), false);
  assertEquals(fixture.updated[0].provider_name, "Equipo DICAN");
  assertEquals(
    String(result.replyOverride ?? "").includes("✅ Cita reagendada"),
    true,
  );
  assertEquals(
    String(result.replyOverride ?? "").includes(
      "Tu cita de *Blanqueamiento dental*",
    ),
    true,
  );
  assertEquals(
    String(result.replyOverride ?? "").includes(
      "quedó para *jueves, 4 de junio* a la *10:00 AM*",
    ),
    true,
  );
  assertEquals(
    String(result.replyOverride ?? "").includes("Te esperamos en *DICAN*."),
    true,
  );
});

Deno.test("cancel_appointment dental updates status without deleting appointment", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [
      {
        id: "appt-dental-cancel",
        organization_id: "clinic-demo",
        lead_id: "lead-dental",
        reason: "Extracción",
        title: "Cita: Extracción",
        appointment_date: "2026-06-04",
        appointment_time: "09:00",
        starts_at: "2026-06-04T15:00:00.000Z",
        status: "confirmed",
      },
    ],
  });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "clinic-demo",
    leadId: "lead-dental",
    action: {
      name: "cancel_appointment",
      payload: {
        appointment_id: "appt-dental-cancel",
        business_type: "dental",
      },
    },
  });

  assertEquals(fixture.inserted.length, 0);
  assertEquals(fixture.updated.length, 1);
  assertEquals(fixture.updated[0].status, "cancelled");
  assertEquals(
    String(result.replyOverride ?? "").includes("✅ Cita cancelada"),
    true,
  );
  assertEquals(String(result.replyOverride ?? "").includes("Extracción"), true);
});

Deno.test("book_appointment hard guard blocks exact duplicate", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [
      {
        id: "appt-dup",
        reason: "Corte clásico",
        title: "Cita: Corte clásico",
        appointment_date: targetDate,
        appointment_time: "10:00",
        starts_at: `${targetDate}T10:00:00-06:00`,
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
        appointment_date: targetDate,
        appointment_time: "10:00",
      },
    },
  });
  assertEquals(result.booking?.ok, false);
  assertEquals((result.booking as any)?.error, "duplicate_appointment_exact");
  assertEquals(fixture.inserted.length, 0);
});

Deno.test("book_appointment persists provider_id/provider_name from payload", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    barbers: [{ id: "barber-1", name: "Carlos" }],
  });
  await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        service: "Corte clásico",
        appointment_date: targetDate,
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
  const targetDate = "2099-05-12";
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
        appointment_date: targetDate,
        appointment_time: "10:00",
        provider_name: "Carlos",
      },
    },
  });
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.inserted[0].provider_name, "Carlos");
  assertEquals(fixture.inserted[0].provider_id, "barber-carlos");
});

Deno.test("book_appointment never persists placeholder provider 'Cualquier barbero'", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({ futureAppointments: [] });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "barbershop",
        service: "Corte clásico",
        appointment_date: targetDate,
        appointment_time: "10:00",
        selected_slot: {
          date: targetDate,
          time: "10:00",
          starts_at: `${targetDate}T10:00:00-06:00`,
          service_key: "corte_clasico",
          service_name: "Corte clásico",
          provider_name: "Cualquier barbero",
        },
        provider_name: "Cualquier barbero",
      },
    },
  });
  assertEquals(result.booking?.ok, false);
  assertEquals((result.booking as any)?.error, "provider_assignment_required");
  assertEquals(fixture.inserted.length, 0);
});

Deno.test("book_appointment uses selected_slot as primary source on confirm", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({ futureAppointments: [] });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        selected_slot: {
          service_key: "corte_clasico",
          service_name: "Corte clásico",
          date: targetDate,
          time: "09:30",
          starts_at: `${targetDate}T09:30:00-06:00`,
          provider_id: "barber-1",
          provider_name: "Carlos",
        },
        service: "Barba",
        appointment_date: "2099-05-13",
        appointment_time: "11:00",
        provider_id: "barber-2",
        provider_name: "Luis",
      },
    },
  });
  assertEquals(result.booking?.ok, true);
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.inserted[0].appointment_date, targetDate);
  assertEquals(fixture.inserted[0].appointment_time, "09:30");
  assertEquals(fixture.inserted[0].provider_id, "barber-1");
  assertEquals(fixture.inserted[0].provider_name, "Carlos");
  assertEquals(fixture.inserted[0].reason, "Corte clásico");
});

Deno.test("book_appointment dental pending confirmation inserts offered slot without recomputed provider validation", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [],
    barbers: [],
  });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "clinic-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "dental",
        service: "Blanqueamiento dental",
        appointment_date: targetDate,
        date_year_explicit: true,
        appointment_time: "11:15",
        starts_at: `${targetDate}T11:15:00-06:00`,
        provider_id: "doctor_demo",
        provider_name: "Doctor disponible",
        duration_min: 60,
        buffer_after_min: 10,
        effective_duration_min: 70,
        selected_slot: {
          source: "dental_guided_pending_confirmation",
          service_key: "blanqueamiento_dental",
          service_name: "Blanqueamiento dental",
          date: targetDate,
          date_year_explicit: true,
          time: "11:15",
          starts_at: `${targetDate}T11:15:00-06:00`,
          provider_id: "doctor_demo",
          provider_name: "Doctor disponible",
          duration_min: 60,
          buffer_after_min: 10,
          effective_duration_min: 70,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, true);
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.inserted[0].appointment_date, targetDate);
  assertEquals(fixture.inserted[0].appointment_time, "11:15");
  assertEquals(fixture.inserted[0].provider_id, null);
  assertEquals(fixture.inserted[0].provider_name, "Equipo DICAN");
  assertEquals(fixture.inserted[0].reason, "Blanqueamiento dental");
  assertEquals(fixture.inserted[0].duration_min, 60);
  assertEquals((fixture.inserted[0].metadata as any)?.buffer_after_min, 10);
  assertEquals(
    (fixture.inserted[0].metadata as any)?.effective_duration_min,
    70,
  );
});

Deno.test("book_appointment dental rejects past pending confirmation before insert", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [],
    barbers: [],
  });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "clinic-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "dental",
        service: "Ortodoncia / brackets",
        appointment_date: "2000-06-05",
        appointment_time: "09:00",
        starts_at: "2000-06-05T09:00:00-06:00",
        provider_id: "doctor_demo",
        provider_name: "Doctor disponible",
        duration_min: 60,
        selected_slot: {
          source: "dental_guided_pending_confirmation",
          service_key: "ortodoncia",
          service_name: "Ortodoncia / brackets",
          date: "2000-06-05",
          time: "09:00",
          starts_at: "2000-06-05T09:00:00-06:00",
          provider_id: "doctor_demo",
          provider_name: "Doctor disponible",
          duration_min: 60,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, false);
  assertEquals((result.booking as any)?.error, "requested_date_in_past");
  assertEquals(
    result.replyOverride,
    "Tuve un problema guardando la cita. Te paso con recepción para confirmarla manualmente.",
  );
  assertEquals(fixture.inserted.length, 0);
});

Deno.test("book_appointment dental rejects ambiguous rollover future date before insert", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [],
    barbers: [],
  });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "clinic-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "dental",
        service: "Ortodoncia / brackets",
        appointment_date: "2027-06-05",
        appointment_time: "09:00",
        starts_at: "2027-06-05T09:00:00-06:00",
        provider_id: "doctor_demo",
        provider_name: "Doctor disponible",
        duration_min: 60,
        selected_slot: {
          source: "dental_guided_pending_confirmation",
          service_key: "ortodoncia",
          service_name: "Ortodoncia / brackets",
          date: "2027-06-05",
          time: "09:00",
          starts_at: "2027-06-05T09:00:00-06:00",
          provider_id: "doctor_demo",
          provider_name: "Doctor disponible",
          duration_min: 60,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, false);
  assertEquals(
    (result.booking as any)?.error,
    "requested_date_suspicious_rollover",
  );
  assertEquals(
    result.replyOverride,
    "Tuve un problema guardando la cita. Te paso con recepción para confirmarla manualmente.",
  );
  assertEquals(fixture.inserted.length, 0);
});

Deno.test("book_appointment dental live pending booking inserts sanitized DICAN appointment", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [],
    barbers: [{
      id: "doctor_demo",
      name: "Equipo DICAN",
      organization_id: "clinic-demo",
      is_active: true,
    }],
  });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "clinic-demo",
    leadId: "e772629a-3557-4107-a2c8-68258d0ecf32",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "dental",
        brand_name: "DICAN",
        service: "Blanqueamiento dental",
        reason: "Blanqueamiento dental",
        appointment_date: targetDate,
        date_year_explicit: true,
        appointment_time: "15:30",
        scheduled_date: targetDate,
        scheduled_time: "15:30",
        starts_at: `${targetDate}T15:30:00`,
        provider_id: "doctor_demo",
        provider_name: "Doctor disponible",
        patient_name: "Paciente Demo",
        duration_min: 60,
        buffer_after_min: 10,
        effective_duration_min: 70,
        selected_slot: {
          source: "dental_guided_pending_confirmation",
          service_key: "blanqueamiento_dental",
          service_name: "Blanqueamiento dental",
          date: targetDate,
          date_year_explicit: true,
          time: "15:30",
          starts_at: `${targetDate}T15:30:00`,
          provider_id: "doctor_demo",
          provider_name: "Doctor disponible",
          duration_min: 60,
          buffer_after_min: 10,
          effective_duration_min: 70,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, true);
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.inserted[0].provider_id, null);
  assertEquals(fixture.inserted[0].provider_name, "Equipo DICAN");
  assertEquals(fixture.inserted[0].patient_name, "Paciente Demo");
  assertEquals(fixture.inserted[0].appointment_date, targetDate);
  assertEquals(fixture.inserted[0].appointment_time, "15:30");
  assertEquals(fixture.inserted[0].start_at, `${targetDate}T21:30:00.000Z`);
  assertEquals(fixture.inserted[0].starts_at, `${targetDate}T21:30:00.000Z`);
  assertEquals(typeof fixture.inserted[0].end_at, "string");
  assertEquals(typeof fixture.inserted[0].ends_at, "string");
  assertEquals(fixture.inserted[0].status, "confirmed");
  assertEquals(fixture.inserted[0].reason, "Blanqueamiento dental");
  assertEquals(fixture.inserted[0].title, "Cita: Blanqueamiento dental");
  assertEquals(fixture.inserted[0].duration_min, 60);
  const appointmentQueries = fixture.queries.filter((query) =>
    query.table === "appointments"
  );
  const invalidProviderFilters = appointmentQueries.flatMap((query) =>
    query.filters.filter((filter) =>
      filter.key === "provider_id" &&
      (filter.value === "doctor_demo" || filter.value === "")
    )
  );
  assertEquals(invalidProviderFilters.length, 0);
  const overlapQuery = appointmentQueries.find((query) =>
    query.filters.some((filter) =>
      filter.op === "lt" && filter.key === "starts_at"
    )
  );
  assertEquals(
    overlapQuery?.filters.some((filter) =>
      filter.key === "starts_at" &&
      filter.value === `${targetDate}T22:40:00.000Z`
    ),
    true,
  );
  assertEquals(
    overlapQuery?.filters.some((filter) =>
      filter.key === "ends_at" &&
      filter.value === `${targetDate}T21:30:00.000Z`
    ),
    true,
  );
});

Deno.test("book_appointment dental live pending booking does not confirm on insert failure", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [],
    insertError: {
      code: "23502",
      message: "null value in column start_at violates not-null constraint",
      details: "Failing row contains test payload",
      hint: "Check start_at",
    },
  });
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const result = await executeToolAction({
      supabase: fixture.supabase,
      organizationId: "clinic-demo",
      leadId: "e772629a-3557-4107-a2c8-68258d0ecf32",
      action: {
        name: "book_appointment",
        payload: {
          business_type: "dental",
          brand_name: "DICAN",
          service: "Blanqueamiento dental",
          appointment_date: targetDate,
          date_year_explicit: true,
          appointment_time: "15:30",
          starts_at: `${targetDate}T15:30:00`,
          provider_id: "doctor_demo",
          provider_name: "Doctor disponible",
          patient_name: "Paciente Demo",
          duration_min: 60,
          selected_slot: {
            source: "dental_guided_pending_confirmation",
            service_key: "blanqueamiento_dental",
            service_name: "Blanqueamiento dental",
            date: targetDate,
            date_year_explicit: true,
            time: "15:30",
            starts_at: `${targetDate}T15:30:00`,
            provider_id: "doctor_demo",
            provider_name: "Doctor disponible",
            duration_min: 60,
          },
        },
      },
    });

    assertEquals(result.booking?.ok, false);
    assertEquals(
      String((result.booking as any)?.error).startsWith("insert_failed:"),
      true,
    );
    assertEquals(String(result.replyOverride ?? "").includes("✅"), false);
    assertEquals(
      logs.join("\n").includes(
        "[actionExecutor] dental appointment write failed",
      ),
      true,
    );
    assertEquals(logs.join("\n").includes('"provider_id":null'), true);
    assertEquals(
      logs.join("\n").includes('"provider_name":"Equipo DICAN"'),
      true,
    );
    assertEquals(
      logs.join("\n").includes(`"start_at":"${targetDate}T21:30:00.000Z"`),
      true,
    );
  } finally {
    console.error = originalError;
  }
});

Deno.test("book_appointment dental fallback provider conflict stops before insert without generic save failure", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [{
      id: "dental-overlap",
      organization_id: "clinic-demo",
      starts_at: `${targetDate}T21:45:00.000Z`,
      ends_at: `${targetDate}T22:15:00.000Z`,
      status: "confirmed",
      provider_id: null,
    }],
  });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "clinic-demo",
    leadId: "e772629a-3557-4107-a2c8-68258d0ecf32",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "dental",
        brand_name: "DICAN",
        service: "Blanqueamiento dental",
        appointment_date: targetDate,
        date_year_explicit: true,
        appointment_time: "15:30",
        starts_at: `${targetDate}T15:30:00`,
        provider_id: "doctor_demo",
        provider_name: "Doctor disponible",
        patient_name: "Paciente Demo",
        duration_min: 60,
        buffer_after_min: 10,
        effective_duration_min: 70,
        selected_slot: {
          source: "dental_guided_pending_confirmation",
          service_key: "blanqueamiento_dental",
          service_name: "Blanqueamiento dental",
          date: targetDate,
          date_year_explicit: true,
          time: "15:30",
          starts_at: `${targetDate}T15:30:00`,
          provider_id: "doctor_demo",
          provider_name: "Doctor disponible",
          duration_min: 60,
          buffer_after_min: 10,
          effective_duration_min: 70,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, false);
  assertEquals((result.booking as any)?.error, "availability_conflict");
  assertEquals(fixture.inserted.length, 0);
  assertEquals(
    String(result.replyOverride ?? "").includes("No pude guardar"),
    false,
  );
  const invalidProviderFilters = fixture.queries
    .filter((query) => query.table === "appointments")
    .flatMap((query) =>
      query.filters.filter((filter) =>
        filter.key === "provider_id" &&
        (filter.value === "doctor_demo" || filter.value === "")
      )
    );
  assertEquals(invalidProviderFilters.length, 0);
});

Deno.test("book_appointment dental keeps real uuid provider id", async () => {
  const targetDate = "2099-05-12";
  const providerId = "123e4567-e89b-12d3-a456-426614174000";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [],
    barbers: [],
  });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "clinic-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "dental",
        service: "Limpieza dental",
        appointment_date: targetDate,
        date_year_explicit: true,
        appointment_time: "10:30",
        starts_at: `${targetDate}T10:30:00-06:00`,
        provider_id: providerId,
        provider_name: "Dra. López",
        duration_min: 45,
        selected_slot: {
          source: "dental_guided_pending_confirmation",
          service_key: "limpieza_dental",
          service_name: "Limpieza dental",
          date: targetDate,
          date_year_explicit: true,
          time: "10:30",
          starts_at: `${targetDate}T10:30:00-06:00`,
          provider_id: providerId,
          provider_name: "Dra. López",
          duration_min: 45,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, true);
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.inserted[0].provider_id, providerId);
  assertEquals(fixture.inserted[0].provider_name, "Dra. López");
});

Deno.test("book_appointment dental final insert sanitizes fallback provider id after lookup", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [],
    barbers: [{
      id: "doctor_demo",
      name: "Equipo DICAN",
      organization_id: "clinic-demo",
      is_active: true,
    }],
  });
  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "clinic-demo",
    leadId: "lead-1",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "dental",
        service: "Extracción",
        appointment_date: targetDate,
        date_year_explicit: true,
        appointment_time: "10:30",
        starts_at: `${targetDate}T10:30:00-06:00`,
        provider_id: "doctor_demo",
        provider_name: "Doctor disponible",
        duration_min: 45,
        selected_slot: {
          source: "dental_guided_pending_confirmation",
          service_key: "extraccion",
          service_name: "Extracción",
          date: targetDate,
          date_year_explicit: true,
          time: "10:30",
          starts_at: `${targetDate}T10:30:00-06:00`,
          provider_id: "doctor_demo",
          provider_name: "Doctor disponible",
          duration_min: 50,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, true);
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.inserted[0].provider_id, null);
  assertEquals(fixture.inserted[0].provider_name, "Equipo DICAN");
  assertEquals(fixture.inserted[0].start_at, `${targetDate}T10:30:00-06:00`);
  assertEquals(fixture.inserted[0].starts_at, `${targetDate}T10:30:00-06:00`);
  assertEquals(fixture.inserted[0].end_at != null, true);
  assertEquals(fixture.inserted[0].ends_at != null, true);
  assertEquals(fixture.inserted[0].status, "confirmed");
});

Deno.test("booking hold helper creates hold for selected slot", async () => {
  const fixture = createBookSupabaseFixture({ futureAppointments: [] });
  const result = await createBookingHold({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "00000000-0000-0000-0000-000000000001",
    providerId: "barber-1",
    providerName: "Carlos",
    serviceKey: "corte_clasico",
    serviceName: "Corte clásico",
    date: "2099-05-12",
    time: "10:00",
    startsAt: "2099-05-12T10:00:00-06:00",
    durationMin: 30,
    timezone: "America/Tegucigalpa",
    nowIso: "2099-05-12T15:00:00Z",
  });

  assertEquals(result.ok, true);
  assertEquals(fixture.bookingHolds.length, 1);
  assertEquals(fixture.bookingHolds[0].status, "held");
  assertEquals(fixture.bookingHolds[0].provider_id, "barber-1");
  assertEquals(fixture.bookingHolds[0].service_key, "corte_clasico");
});

Deno.test("booking hold helper blocks another lead for same provider and time", async () => {
  const fixture = createBookSupabaseFixture({
    bookingHolds: [{
      id: "hold-1",
      organization_id: "barber-demo",
      lead_id: "00000000-0000-0000-0000-000000000001",
      provider_id: "barber-1",
      provider_name: "Carlos",
      service_key: "corte_clasico",
      service_name: "Corte clásico",
      starts_at: "2099-05-12T10:00:00-06:00",
      ends_at: "2099-05-12T10:30:00-06:00",
      status: "held",
      expires_at: "2099-12-31T00:00:00Z",
    }],
  });

  const result = await createBookingHold({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "00000000-0000-0000-0000-000000000002",
    providerId: "barber-1",
    providerName: "Carlos",
    serviceKey: "corte_clasico",
    serviceName: "Corte clásico",
    date: "2099-05-12",
    time: "10:00",
    startsAt: "2099-05-12T10:00:00-06:00",
    durationMin: 30,
    timezone: "America/Tegucigalpa",
    nowIso: "2099-05-12T15:00:00Z",
  });

  assertEquals(result.ok, false);
  assertEquals((result as any).reason, "active_hold_conflict");
  assertEquals(fixture.bookingHolds.length, 1);
});

Deno.test("book_appointment consumes active booking hold", async () => {
  const targetDate = "2099-05-12";
  const holdId = "hold-active";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    bookingHolds: [{
      id: holdId,
      organization_id: "barber-demo",
      lead_id: "00000000-0000-0000-0000-000000000001",
      provider_id: "barber-1",
      provider_name: "Carlos",
      service_key: "corte_clasico",
      service_name: "Corte clásico",
      starts_at: `${targetDate}T09:30:00-06:00`,
      ends_at: `${targetDate}T10:00:00-06:00`,
      status: "held",
      expires_at: "2099-12-31T00:00:00Z",
    }],
  });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "00000000-0000-0000-0000-000000000001",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "barbershop",
        selected_slot: {
          hold_id: holdId,
          service_key: "corte_clasico",
          service_name: "Corte clásico",
          date: targetDate,
          time: "09:30",
          starts_at: `${targetDate}T09:30:00-06:00`,
          provider_id: "barber-1",
          provider_name: "Carlos",
          duration_min: 30,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, true);
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.bookingHolds[0].status, "consumed");
  assertEquals(
    (fixture.bookingHolds[0].metadata as any).appointment_id,
    "appt-new",
  );
});

Deno.test("book_appointment with own active hold ignores cancelled appointment at same start", async () => {
  const targetDate = "2099-05-12";
  const holdId = "hold-own-active";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [{
      id: "appt-cancelled",
      organization_id: "barber-demo",
      provider_id: "barber-2",
      provider_name: "Carlos",
      starts_at: `${targetDate}T09:30:00-06:00`,
      ends_at: `${targetDate}T10:00:00-06:00`,
      status: "cancelled",
    }],
    bookingHolds: [{
      id: holdId,
      organization_id: "barber-demo",
      lead_id: "00000000-0000-0000-0000-000000000001",
      provider_id: "barber-1",
      provider_name: "Alex",
      service_key: "corte_clasico",
      service_name: "Corte clásico",
      starts_at: `${targetDate}T09:30:00-06:00`,
      ends_at: `${targetDate}T10:00:00-06:00`,
      status: "held",
      expires_at: "2099-12-31T00:00:00Z",
    }],
  });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "00000000-0000-0000-0000-000000000001",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "barbershop",
        selected_slot: {
          hold_id: holdId,
          service_key: "Corte clásico",
          service_name: "Corte clásico",
          date: targetDate,
          time: "09:30",
          starts_at: `${targetDate}T09:30:00-06:00`,
          provider_id: "barber-1",
          provider_name: "Alex",
          duration_min: 30,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, true);
  assertEquals(fixture.inserted.length, 1);
  assertEquals(fixture.inserted[0].provider_id, "barber-1");
  assertEquals(fixture.inserted[0].provider_name, "Alex");
  assertEquals(fixture.bookingHolds[0].status, "consumed");
});

Deno.test("book_appointment blocks active hold owned by another lead", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    bookingHolds: [{
      id: "hold-other-lead",
      organization_id: "barber-demo",
      lead_id: "00000000-0000-0000-0000-000000000002",
      provider_id: "barber-1",
      provider_name: "Alex",
      service_key: "corte_clasico",
      service_name: "Corte clásico",
      starts_at: `${targetDate}T09:30:00-06:00`,
      ends_at: `${targetDate}T10:00:00-06:00`,
      status: "held",
      expires_at: "2099-12-31T00:00:00Z",
    }],
  });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "00000000-0000-0000-0000-000000000001",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "barbershop",
        selected_slot: {
          hold_id: "hold-other-lead",
          service_key: "corte_clasico",
          service_name: "Corte clásico",
          date: targetDate,
          time: "09:30",
          starts_at: `${targetDate}T09:30:00-06:00`,
          provider_id: "barber-1",
          provider_name: "Alex",
          duration_min: 30,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, false);
  assertEquals(
    String((result.booking as any)?.error).includes(
      "requested_datetime_invalid",
    ),
    true,
  );
  assertEquals(fixture.inserted.length, 0);
});

Deno.test("book_appointment revalidates expired hold and creates appointment when slot is still available", async () => {
  const targetDate = "2099-05-12";
  const holdId = "hold-expired";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    bookingHolds: [{
      id: holdId,
      organization_id: "barber-demo",
      lead_id: "00000000-0000-0000-0000-000000000001",
      provider_id: "barber-1",
      provider_name: "Carlos",
      service_key: "corte_clasico",
      service_name: "Corte clásico",
      starts_at: `${targetDate}T09:30:00-06:00`,
      ends_at: `${targetDate}T10:00:00-06:00`,
      status: "held",
      expires_at: "2020-01-01T00:00:00Z",
    }],
  });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "00000000-0000-0000-0000-000000000001",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "barbershop",
        selected_slot: {
          hold_id: holdId,
          service_key: "corte_clasico",
          service_name: "Corte clásico",
          date: targetDate,
          time: "09:30",
          starts_at: `${targetDate}T09:30:00-06:00`,
          provider_id: "barber-1",
          provider_name: "Carlos",
          duration_min: 30,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, true);
  assertEquals(fixture.inserted.length, 1);
});

Deno.test("book_appointment rejects provider/start overlap at action layer", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    overlapAppointments: [{
      id: "appt-block",
      organization_id: "barber-demo",
      provider_id: "barber-1",
      starts_at: `${targetDate}T09:30:00-06:00`,
      ends_at: `${targetDate}T10:00:00-06:00`,
      status: "confirmed",
    }],
  });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "00000000-0000-0000-0000-000000000001",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "barbershop",
        selected_slot: {
          service_key: "corte_clasico",
          service_name: "Corte clásico",
          date: targetDate,
          time: "09:30",
          starts_at: `${targetDate}T09:30:00-06:00`,
          provider_id: "barber-1",
          provider_name: "Carlos",
          duration_min: 30,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, false);
  assertEquals((result.booking as any)?.error, "availability_conflict");
  assertEquals(
    String(result.replyOverride ?? "").includes("Ese horario"),
    true,
  );
  assertEquals(fixture.inserted.length, 0);
});

Deno.test("book_appointment handles DB duplicate conflict with alternatives and safe logs", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({
    futureAppointments: [],
    insertError: {
      code: "23505",
      message:
        "duplicate key value violates unique constraint appointments_provider_start_active_idx",
    },
  });
  const logs: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const result = await executeToolAction({
      supabase: fixture.supabase,
      organizationId: "barber-demo",
      leadId: "00000000-0000-0000-0000-000000000001",
      action: {
        name: "book_appointment",
        payload: {
          business_type: "barbershop",
          selected_slot: {
            service_key: "corte_clasico",
            service_name: "Corte clásico",
            date: targetDate,
            time: "09:30",
            starts_at: `${targetDate}T09:30:00-06:00`,
            provider_id: "barber-1",
            provider_name: "Carlos",
            duration_min: 30,
          },
        },
      },
    });

    assertEquals(result.booking?.ok, false);
    assertEquals(
      String((result.booking as any)?.error).startsWith("slot_conflict:"),
      true,
    );
    assertEquals(
      String(result.replyOverride ?? "").includes(
        "Ese horario acaba de ocuparse",
      ),
      true,
    );
    assertEquals(
      String(result.replyOverride ?? "").includes("Estoy teniendo un problema"),
      false,
    );
    assertEquals(
      logs.join("\n").includes("confirm_booking_db_insert_failed"),
      true,
    );
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
});

Deno.test("BarberLine confirmed appointment creates appointment event and reminder jobs", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({ futureAppointments: [] });

  const result = await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "00000000-0000-0000-0000-000000000001",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "barbershop",
        selected_slot: {
          service_key: "corte_clasico",
          service_name: "Corte clásico",
          date: targetDate,
          time: "09:30",
          starts_at: `${targetDate}T09:30:00-06:00`,
          provider_id: "barber-1",
          provider_name: "Carlos",
          duration_min: 30,
        },
      },
    },
  });

  assertEquals(result.booking?.ok, true);
  assertEquals(
    fixture.appointmentEvents.some((event) =>
      event.event_type === "appointment_confirmed"
    ),
    true,
  );
  assertEquals(fixture.followups.length, 2);
  assertEquals(
    fixture.followups.some((job) => String(job.reason).endsWith(":24h")),
    true,
  );
  assertEquals(
    fixture.followups.some((job) => String(job.reason).endsWith(":2h")),
    true,
  );
});

Deno.test("BarberLine reminder payload contains appointment details and WhatsApp template flag", async () => {
  const targetDate = "2099-05-12";
  const fixture = createBookSupabaseFixture({ futureAppointments: [] });

  await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "00000000-0000-0000-0000-000000000001",
    action: {
      name: "book_appointment",
      payload: {
        business_type: "barbershop",
        patient_name: "Carlos Test",
        selected_slot: {
          service_key: "corte_clasico",
          service_name: "Corte clásico",
          date: targetDate,
          time: "09:30",
          starts_at: `${targetDate}T09:30:00-06:00`,
          provider_id: "barber-1",
          provider_name: "Carlos",
          duration_min: 30,
        },
      },
    },
  });

  const payload = fixture.followups.find((job) =>
    String(job.reason).endsWith(":24h")
  )?.payload as Record<string, unknown>;
  assertEquals(payload.appointment_id, "appt-new");
  assertEquals(payload.service_name, "Corte clásico");
  assertEquals(payload.provider_name, "Carlos");
  assertEquals(payload.customer_name, "Carlos Test");
  assertEquals(payload.template_required, true);
  assertEquals(payload.template_name, "barber_appointment_reminder");
});

Deno.test("BarberLine cancel appointment cancels pending reminder jobs and records event", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [
      {
        id: "appt-cancel-reminders",
        organization_id: "barber-demo",
        lead_id: "lead-1",
        reason: "Corte clásico",
        title: "Cita: Corte clásico",
        appointment_date: "2099-05-23",
        appointment_time: "14:00",
        starts_at: "2099-05-23T14:00:00-06:00",
        status: "confirmed",
      },
    ],
  });
  fixture.followups.push({
    organization_id: "barber-demo",
    lead_id: "lead-1",
    reason: "appointment_reminder:appt-cancel-reminders:24h",
    step: 1,
    status: "queued",
  });

  await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "cancel_appointment",
      payload: {
        appointment_id: "appt-cancel-reminders",
        business_type: "barbershop",
      },
    },
  });

  assertEquals(fixture.followups[0].status, "cancelled");
  assertEquals(
    fixture.appointmentEvents.some((event) =>
      event.event_type === "appointment_cancelled"
    ),
    true,
  );
});

Deno.test("BarberLine reschedule replaces reminder jobs and records appointment_rescheduled", async () => {
  const fixture = createBookSupabaseFixture({
    futureAppointments: [
      {
        id: "appt-reschedule-reminders",
        organization_id: "barber-demo",
        lead_id: "lead-1",
        reason: "Corte clásico",
        title: "Cita: Corte clásico",
        appointment_date: "2099-05-23",
        appointment_time: "14:00",
        starts_at: "2099-05-23T14:00:00-06:00",
        status: "confirmed",
      },
    ],
  });
  fixture.followups.push({
    organization_id: "barber-demo",
    lead_id: "lead-1",
    reason: "appointment_reminder:appt-reschedule-reminders:24h",
    step: 1,
    status: "queued",
  });

  await executeToolAction({
    supabase: fixture.supabase,
    organizationId: "barber-demo",
    leadId: "lead-1",
    action: {
      name: "reschedule_appointment",
      payload: {
        appointment_id: "appt-reschedule-reminders",
        business_type: "barbershop",
        appointment_date: "2099-05-24",
        appointment_time: "09:00",
        starts_at: "2099-05-24T09:00:00-06:00",
        provider_id: "barber-1",
        provider_name: "Carlos",
        reason: "Corte clásico",
        duration_min: 30,
      },
    },
  });

  assertEquals(
    fixture.followups.some((job) => job.status === "cancelled"),
    true,
  );
  assertEquals(
    fixture.followups.some((job) => String(job.reason).endsWith(":2h")),
    true,
  );
  assertEquals(
    fixture.appointmentEvents.some((event) =>
      event.event_type === "appointment_rescheduled"
    ),
    true,
  );
});

Deno.test("BarberLine reminder source has duplicate, past-due, and template safeguards", async () => {
  const source = await Deno.readTextFile(
    new URL("../domain/actionExecutor.ts", import.meta.url),
  );
  const followupsSource = await Deno.readTextFile(
    new URL("../../run-followups/index.ts", import.meta.url),
  );
  assertEquals(
    source.includes('onConflict: "organization_id,lead_id,reason,step"'),
    true,
  );
  assertEquals(
    source.includes("appointment_reminder_not_scheduled_past_due"),
    true,
  );
  assertEquals(source.includes("template_required: templateRequired"), true);
  assertEquals(
    followupsSource.includes(
      "template_required:whatsapp_template_sender_not_connected",
    ),
    true,
  );
});
