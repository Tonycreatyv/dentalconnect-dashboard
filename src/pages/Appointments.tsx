import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { getVerticalConfig } from "../config/verticalConfig";
import { AppointmentCard } from "../components/AppointmentCard";
import { Tabs } from "../components/ui/Tabs";
import { MobileAppointmentRow, MobileBottomSheet, MobileCard, MobileChip, MobileEmptyState, MobileHeader } from "../components/mobile/MobilePrimitives";
const FALLBACK_ORG_ID = "clinic-demo";

type AppointmentRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  patient_name: string | null;
  reason: string | null;
  title: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  starts_at: string | null;
  ends_at: string | null;
  provider_id: string | null;
  provider_name: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StatusFilter = "all" | "confirmed" | "pending" | "cancelled";

function asDate(a: AppointmentRow): Date | null {
  if (a.starts_at) {
    const d = new Date(a.starts_at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (a.appointment_date) {
    const combined = `${a.appointment_date}T${a.appointment_time ?? "00:00"}:00`;
    const d = new Date(combined);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function statusKey(status: string | null | undefined): "confirmed" | "pending" | "cancelled" {
  const s = String(status ?? "").toLowerCase();
  if (s === "confirmed" || s === "confirmada") return "confirmed";
  if (s === "cancelled" || s === "cancelada" || s === "canceled") return "cancelled";
  return "pending";
}

function statusLabel(status: string | null | undefined): string {
  const k = statusKey(status);
  if (k === "confirmed") return "Confirmada";
  if (k === "cancelled") return "Cancelada";
  return "Pendiente";
}

function statusChipClass(status: string | null | undefined): string {
  const k = statusKey(status);
  if (k === "confirmed") return "border-emerald-800/60 bg-emerald-950/40 text-emerald-200";
  if (k === "cancelled") return "border-rose-800/60 bg-rose-950/40 text-rose-200";
  return "border-amber-800/60 bg-amber-950/40 text-amber-200";
}

function dayKey(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function dateText(d: Date): string {
  return d.toLocaleDateString("es-HN", { weekday: "long", day: "numeric", month: "long" });
}

function timeText(d: Date): string {
  return d.toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit" });
}

function buildTimePreview(open: string, close: string): string[] {
  const [openHour = 8, openMin = 0] = open.split(":").map((part) => Number(part));
  const [closeHour = 18, closeMin = 0] = close.split(":").map((part) => Number(part));
  const start = new Date();
  start.setHours(openHour, openMin, 0, 0);
  const end = new Date();
  end.setHours(closeHour, closeMin, 0, 0);
  const slots: string[] = [];
  const cursor = new Date(start);
  while (cursor < end && slots.length < 6) {
    slots.push(cursor.toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit" }));
    cursor.setMinutes(cursor.getMinutes() + 60);
  }
  return slots;
}

function serviceText(a: AppointmentRow): string {
  return a.reason || a.title || "Servicio";
}

function clientText(a: AppointmentRow): string {
  return a.patient_name || "Cliente";
}

function barberText(a: AppointmentRow, providerLabel = "Barbero"): string {
  return a.provider_name || `Cualquier ${providerLabel.toLowerCase()}`;
}

export default function Appointments() {
  const { resolvedOrgId, resolvedBusinessType } = useActiveOrg();
  const vertical = getVerticalConfig(resolvedBusinessType);
  const isBarbershop = resolvedBusinessType === "barbershop";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AppointmentRow[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [barberFilter, setBarberFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [hoursSummary, setHoursSummary] = useState("Horario activo");
  const [mobileAvailableTimes, setMobileAvailableTimes] = useState<string[]>([]);
  const [newAppointmentOpen, setNewAppointmentOpen] = useState(false);
  const [blockTimeOpen, setBlockTimeOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [draftPatient, setDraftPatient] = useState("");
  const [draftService, setDraftService] = useState("");
  const [draftProvider, setDraftProvider] = useState("");
  const [draftDate, setDraftDate] = useState(dayKey(new Date()));
  const [draftTime, setDraftTime] = useState("09:00");
  const [blockProvider, setBlockProvider] = useState("");
  const [blockDate, setBlockDate] = useState(dayKey(new Date()));
  const [blockFrom, setBlockFrom] = useState("09:00");
  const [blockTo, setBlockTo] = useState("10:00");
  const [blockReason, setBlockReason] = useState("");

  const effectiveOrgId = useMemo(() => {
    return resolvedOrgId || FALLBACK_ORG_ID;
  }, [resolvedOrgId]);

  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      setError(null);
      const [{ data, error }, settingsRes] = await Promise.all([
      supabase
        .from("appointments")
        .select("id, organization_id, lead_id, patient_name, reason, title, appointment_date, appointment_time, starts_at, ends_at, provider_id, provider_name, status, created_at, updated_at")
        .eq("organization_id", effectiveOrgId)
        .order("starts_at", { ascending: true, nullsFirst: false })
        .order("appointment_date", { ascending: true, nullsFirst: false }),
      supabase
        .from("organization_settings")
        .select("hours")
        .eq("organization_id", effectiveOrgId)
        .maybeSingle(),
      ]);
      if (!mounted) return;
      if (error) {
        setRows([]);
        setError(error.message);
      } else {
        setRows((data as AppointmentRow[]) ?? []);
      }
      const hours = (settingsRes.data as any)?.hours;
      const todayDay = new Date().getDay();
      const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const todayHours = hours?.[keys[todayDay]];
      if (todayHours?.closed) {
        setHoursSummary("Hoy cerrado");
        setMobileAvailableTimes([]);
      } else if (todayHours?.open && todayHours?.close) {
        setHoursSummary(`Horario activo: ${todayHours.open}–${todayHours.close}`);
        setMobileAvailableTimes(buildTimePreview(todayHours.open, todayHours.close));
      } else {
        setHoursSummary(resolvedBusinessType === "barbershop" ? "Horario activo: 8:00 AM–6:00 PM" : "Horario activo");
        setMobileAvailableTimes(resolvedBusinessType === "barbershop" ? buildTimePreview("08:00", "18:00") : []);
      }
      setLoading(false);
    }
    run();
    return () => {
      mounted = false;
    };
  }, [effectiveOrgId, resolvedBusinessType]);

  const mapped = useMemo(() => {
    return rows
      .map((a) => ({ ...a, derivedDate: asDate(a) }))
      .filter((a) => a.derivedDate !== null) as Array<AppointmentRow & { derivedDate: Date }>;
  }, [rows]);

  const barbers = useMemo(() => {
    const set = new Set<string>();
    for (const a of mapped) set.add(barberText(a, vertical.providerLabel));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [mapped, vertical.providerLabel]);

  const services = useMemo(() => {
    const set = new Set<string>();
    for (const a of mapped) set.add(serviceText(a));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [mapped]);

  const filtered = useMemo(() => {
    return mapped.filter((a) => {
      if (statusFilter !== "all" && statusKey(a.status) !== statusFilter) return false;
      if (barberFilter !== "all" && barberText(a, vertical.providerLabel) !== barberFilter) return false;
      if (serviceFilter !== "all" && serviceText(a) !== serviceFilter) return false;
      const k = dayKey(a.derivedDate);
      if (dateFrom && k < dateFrom) return false;
      if (dateTo && k > dateTo) return false;
      return true;
    });
  }, [mapped, statusFilter, barberFilter, serviceFilter, dateFrom, dateTo]);

  const today = useMemo(() => startOfToday(), []);
  const todayKey = dayKey(today);
  const weekKeys = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => dayKey(addDays(today, i)));
  }, [today]);

  const todayAppointments = useMemo(() => filtered.filter((a) => dayKey(a.derivedDate) === todayKey), [filtered, todayKey]);
  const upcoming = useMemo(() => filtered.filter((a) => weekKeys.includes(dayKey(a.derivedDate))), [filtered, weekKeys]);

  const kpi = useMemo(() => {
    let confirmed = 0;
    let pending = 0;
    let cancelled = 0;
    for (const a of filtered) {
      const k = statusKey(a.status);
      if (k === "confirmed") confirmed += 1;
      if (k === "pending") pending += 1;
      if (k === "cancelled") cancelled += 1;
    }
    return {
      today: todayAppointments.length,
      confirmed,
      pending,
      cancelled,
    };
  }, [filtered, todayAppointments.length]);

  const weeklyByDay = useMemo(() => {
    const map = new Map<string, Array<AppointmentRow & { derivedDate: Date }>>();
    for (const k of weekKeys) map.set(k, []);
    for (const a of upcoming) {
      const k = dayKey(a.derivedDate);
      if (!map.has(k)) continue;
      map.get(k)!.push(a);
    }
    for (const [k, list] of map.entries()) {
      list.sort((a, b) => a.derivedDate.getTime() - b.derivedDate.getTime());
      map.set(k, list);
    }
    return map;
  }, [upcoming, weekKeys]);

  const empty = !loading && !error && filtered.length === 0;
  const isDental = resolvedBusinessType === "dental";
  const sheetServices = services.length ? services : [vertical.serviceLabel];
  const sheetProviders = barbers.length ? barbers : [vertical.providerLabel];

  function openNewAppointmentSheet(prefillTime?: string) {
    setDraftPatient("");
    setDraftService(sheetServices[0] ?? vertical.serviceLabel);
    setDraftProvider(sheetProviders[0] ?? vertical.providerLabel);
    setDraftDate(dayKey(new Date()));
    setDraftTime(prefillTime ?? "09:00");
    setActionNotice("");
    setNewAppointmentOpen(true);
  }

  function openBlockTimeSheet() {
    setBlockProvider(sheetProviders[0] ?? vertical.providerLabel);
    setBlockDate(dayKey(new Date()));
    setBlockFrom("09:00");
    setBlockTo("10:00");
    setBlockReason("");
    setActionNotice("");
    setBlockTimeOpen(true);
  }

  function submitNewAppointment() {
    setNewAppointmentOpen(false);
    setActionNotice("Crear cita listo para conectar");
    window.setTimeout(() => setActionNotice(""), 3000);
  }

  function submitBlockTime() {
    setBlockTimeOpen(false);
    setActionNotice("Bloqueo listo para conectar");
    window.setTimeout(() => setActionNotice(""), 3000);
  }

  return (
    <div className={`app-page ${isBarbershop ? "text-[#F0F4F8]" : ""}`}>
      <MobileCard elevated className="lg:hidden">
        <MobileHeader
          title={vertical.agendaTitle}
          subtitle={`${kpi.today} hoy · ${kpi.confirmed} confirmadas`}
          action={(
            <button onClick={() => setShowMobileFilters((v) => !v)} className="min-h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-bold text-white/70">
              Filtros
            </button>
          )}
        />
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          {[
            { value: "all", label: "Todas" },
            { value: "confirmed", label: "Confirmadas" },
            { value: "pending", label: "Pendientes" },
            { value: "cancelled", label: "Canceladas" },
          ].map((item) => (
            <MobileChip key={item.value} onClick={() => setStatusFilter(item.value as StatusFilter)} active={statusFilter === item.value} tone="accent">
              {item.label}
            </MobileChip>
          ))}
        </div>
      </MobileCard>

      <section className={`hidden lg:block relative overflow-hidden rounded-[1.35rem] border p-3 shadow-[0_18px_48px_rgba(0,0,0,0.28)] sm:rounded-[2rem] sm:p-6 ${isBarbershop ? "border-[#1E2228] bg-[#0E1014]" : "border-white/10 bg-[#17120F]"}`}>
        {!isBarbershop ? <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,rgba(201,119,56,0.2),transparent_34%),radial-gradient(circle_at_90%_20%,rgba(240,194,120,0.12),transparent_30%)]" /> : null}
        <div className="relative flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold sm:px-3 sm:text-xs ${isBarbershop ? "border-[#18C37E]/20 bg-[#18C37E]/10 text-[#18C37E]" : "border-[#C97738]/25 bg-[#C97738]/10 text-[#FFD7AE]"}`}>
              {resolvedBusinessType === "barbershop" ? "Agenda compartida BarberLine" : vertical.agendaTitle}
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:mt-4 sm:text-3xl">{vertical.agendaTitle}</h1>
            <p className="text-safe mt-1 text-xs text-white/55 sm:mt-2 sm:text-sm">
              {resolvedBusinessType === "barbershop"
                ? "Citas de WhatsApp, walk-ins y ocupación por barbero."
                : "Citas creadas automáticamente desde WhatsApp y Messenger."}
            </p>
          </div>
          <Tabs
            value={statusFilter}
            onChange={setStatusFilter}
            items={[
              { value: "all", label: "Todas" },
              { value: "confirmed", label: "Confirmadas" },
              { value: "pending", label: "Pendientes" },
              { value: "cancelled", label: "Canceladas" },
            ]}
          />
        </div>
      </section>

      <section className="hidden grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid">
        {[
          { label: "Citas hoy", value: kpi.today, tone: "text-white" },
          { label: "Confirmadas", value: kpi.confirmed, tone: "text-emerald-200" },
          { label: "Pendientes", value: kpi.pending, tone: "text-amber-200" },
          { label: "Canceladas", value: kpi.cancelled, tone: "text-rose-200" },
        ].map((item) => (
          <div key={item.label} className={`${isBarbershop ? "bl-card" : "ui-card"} p-3 sm:p-4`}>
            <div className="truncate text-xs text-white/45">{item.label}</div>
            <div className={`mt-1 text-2xl font-black sm:text-3xl ${item.tone}`}>{item.value}</div>
          </div>
        ))}
      </section>

      <section className={`${showMobileFilters ? "block" : "hidden lg:block"} ${isBarbershop ? "bl-card" : "ui-card ui-card-pad"}`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold text-white/55">
            {vertical.providerLabel}
            <select value={barberFilter} onChange={(e) => setBarberFilter(e.target.value)} className="dc-select mt-1">
              <option value="all">Todos</option>
              {barbers.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-white/55">
            {vertical.serviceLabel}
            <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className="dc-select mt-1">
              <option value="all">Todos</option>
              {services.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-white/55">
            Desde
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="dc-input mt-1" />
          </label>
          <label className="text-xs font-semibold text-white/55">
            Hasta
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="dc-input mt-1" />
          </label>
        </div>
      </section>

      {loading && (
        <section className={`${isBarbershop ? "bl-card" : "ui-card ui-card-pad"} text-sm text-white/60`}>
          Cargando citas...
        </section>
      )}

      {error && (
        <section className="rounded-3xl border border-rose-800/60 bg-rose-950/40 p-5 text-sm text-rose-200">
          Error cargando citas: {error}
        </section>
      )}

      {empty && (
        <section className="lg:hidden space-y-3">
          <MobileEmptyState
            title="No hay citas confirmadas para hoy."
            description={hoursSummary}
            action={(
              <div className="grid grid-cols-2 gap-2">
                <button onClick={isDental ? () => openNewAppointmentSheet() : undefined} className="min-h-10 rounded-2xl border border-[#25D366]/35 bg-[#25D366]/12 px-3 text-xs font-black text-[#BDF8D1]">{isDental ? "Nueva cita" : "Crear cita"}</button>
                <button onClick={isDental ? openBlockTimeSheet : undefined} className="min-h-10 rounded-2xl border border-[#25384A] bg-[#162838] px-3 text-xs font-bold text-[#9CAAB8]">Bloquear horario</button>
              </div>
            )}
          />
          <div className="space-y-2">
            {mobileAvailableTimes.map((time) => (
              <MobileAppointmentRow key={time} onClick={isDental ? () => openNewAppointmentSheet(time) : undefined}>
                <span className="w-16 shrink-0 text-sm font-black text-[#25D366]">{time}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-[#F8FAFC]">Disponible</span>
                  <span className="block truncate text-xs text-[#9CAAB8]">{isDental ? "Espacio libre para cita" : "Espacio libre para cita o walk-in"}</span>
                </span>
              </MobileAppointmentRow>
            ))}
          </div>
        </section>
      )}

      {empty && (
        <section className={`hidden text-sm text-white/60 lg:block ${isBarbershop ? "bl-card" : "ui-card ui-card-pad"}`}>
          Cuando WhatsApp confirme una cita, aparecerá aquí.
        </section>
      )}

      {!loading && !error && !empty && (
        <>
          <section className="space-y-3 lg:hidden">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
              {weekKeys.map((k) => {
                const date = new Date(`${k}T00:00:00`);
                const list = weeklyByDay.get(k) ?? [];
                const isToday = k === new Date().toISOString().slice(0, 10);
                return (
                  <button key={k} className={`min-w-[74px] rounded-2xl border px-3 py-2 text-left ${isToday ? "border-[#25D366]/40 bg-[#25D366]/12 text-[#BDF8D1]" : "border-[#25384A] bg-[#111F2B] text-[#9CAAB8]"}`}>
                    <div className="text-[11px] font-bold capitalize">{date.toLocaleDateString("es-HN", { weekday: "short" })}</div>
                    <div className="text-lg font-black text-[#F8FAFC]">{date.getDate()}</div>
                    <div className="text-[10px]">{list.length} citas</div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={isDental ? () => openNewAppointmentSheet() : undefined} className="min-h-11 rounded-2xl border border-[#25D366]/35 bg-[#25D366]/12 px-3 text-sm font-black text-[#BDF8D1]">{isDental ? "Nueva cita" : "Crear cita"}</button>
              <button onClick={() => setShowMobileFilters((v) => !v)} className="min-h-11 rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm font-bold text-[#9CAAB8]">Filtros</button>
            </div>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-[#F8FAFC]">Agenda de hoy</h2>
                <span className="text-xs text-[#9CAAB8]">{todayAppointments.length} citas</span>
              </div>
              {todayAppointments.length === 0 ? (
                <MobileEmptyState title="Sin citas para hoy" description="Las citas confirmadas aparecerán aquí." />
              ) : todayAppointments.map((a) => (
                <MobileAppointmentRow key={a.id}>
                  <span className="w-14 shrink-0 text-sm font-black text-[#25D366]">{a.appointment_time || timeText(a.derivedDate)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-[#F8FAFC]">{clientText(a)}</span>
                    <span className="block truncate text-xs text-[#9CAAB8]">{serviceText(a)} · {barberText(a, vertical.providerLabel)}</span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusChipClass(a.status)}`}>{statusLabel(a.status)}</span>
                </MobileAppointmentRow>
              ))}
            </section>
          </section>

          <section className={`hidden lg:block ${isBarbershop ? "bl-card" : "ui-card ui-card-pad"}`}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-black text-white">Citas de hoy</h2>
                <p className="text-sm text-white/45">Vista rápida para el equipo en mostrador.</p>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/55">{todayAppointments.length} total</span>
            </div>
            <div className="mt-4 grid gap-2 xl:grid-cols-2">
              {todayAppointments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">Sin citas para hoy.</div>
              ) : todayAppointments.map((a) => (
                <AppointmentCard
                  key={a.id}
                  time={a.appointment_time || timeText(a.derivedDate)}
                  client={clientText(a)}
                  service={serviceText(a)}
                  provider={barberText(a, vertical.providerLabel)}
                  status={a.status}
                  accentClass={isBarbershop ? "bg-[#18C37E]" : "bg-[#C97738]"}
                />
              ))}
            </div>
          </section>

          <section className={`hidden lg:block ${isBarbershop ? "bl-card" : "ui-card ui-card-pad"}`}>
            <h2 className="text-lg font-black text-white">Próximas citas (7 días)</h2>
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              {upcoming.length === 0 && <div className="text-sm text-white/45">No hay próximas citas.</div>}
              {upcoming.map((a) => (
                <AppointmentCard key={a.id} time={`${dateText(a.derivedDate)} · ${a.appointment_time || timeText(a.derivedDate)}`} client={clientText(a)} service={serviceText(a)} provider={barberText(a, vertical.providerLabel)} status={a.status} accentClass={isBarbershop ? "bg-[#18C37E]" : "bg-[#D89A5E]"} />
              ))}
            </div>
          </section>

          <section className={`hidden lg:block ${isBarbershop ? "bl-card" : "ui-card ui-card-pad"}`}>
            <h2 className="text-lg font-black text-white">Vista semanal</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
              {weekKeys.map((k) => {
                const date = new Date(`${k}T00:00:00`);
                const list = weeklyByDay.get(k) ?? [];
                return (
                  <div key={k} className={`min-w-0 rounded-2xl border p-3 ${isBarbershop ? "border-[#1E2228] bg-[#0B0D0F]" : "border-white/10 bg-white/[0.045]"}`}>
                    <div className="text-xs font-black uppercase tracking-wide text-white/70">
                      {date.toLocaleDateString("es-HN", { weekday: "short", day: "numeric", month: "short" })}
                    </div>
                    <div className="mt-2 space-y-2">
                      {list.length === 0 && <div className="text-xs text-white/35">Sin citas</div>}
                      {list.map((a) => (
                        <div key={a.id} className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-2 py-2">
                          <div className={`text-xs ${isBarbershop ? "text-[#18C37E]" : "text-[#F0C278]"}`}>{a.appointment_time || timeText(a.derivedDate)}</div>
                          <div className="truncate text-sm text-white">{clientText(a)}</div>
                          <div className="truncate text-xs text-white/45">{serviceText(a)}</div>
                          <div className="mt-1">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${statusChipClass(a.status)}`}>
                              {statusLabel(a.status)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
      {actionNotice ? (
        <div className="rounded-2xl border border-[#25D366]/35 bg-[#25D366]/12 px-3 py-2 text-xs font-bold text-[#BDF8D1] lg:hidden">
          {actionNotice}
        </div>
      ) : null}
      {isDental ? (
        <>
          <MobileBottomSheet open={newAppointmentOpen}>
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-black text-[#F8FAFC]">Nueva cita</h2>
                <p className="text-xs text-[#9CAAB8]">Formulario local, listo para conectar.</p>
              </div>
              <label className="block text-xs font-bold text-[#9CAAB8]">
                Paciente
                <input value={draftPatient} onChange={(e) => setDraftPatient(e.target.value)} placeholder="Nombre del paciente" className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none" />
              </label>
              <label className="block text-xs font-bold text-[#9CAAB8]">
                Servicio dental
                <select value={draftService} onChange={(e) => setDraftService(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none">
                  {sheetServices.map((service) => <option key={service} value={service}>{service}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold text-[#9CAAB8]">
                Doctor
                <select value={draftProvider} onChange={(e) => setDraftProvider(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none">
                  {sheetProviders.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-bold text-[#9CAAB8]">
                  Fecha
                  <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none" />
                </label>
                <label className="block text-xs font-bold text-[#9CAAB8]">
                  Hora
                  <input type="time" value={draftTime} onChange={(e) => setDraftTime(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => setNewAppointmentOpen(false)} className="min-h-11 rounded-2xl border border-[#25384A] bg-[#111F2B] text-sm font-bold text-[#9CAAB8]">Cancelar</button>
                <button onClick={submitNewAppointment} className="min-h-11 rounded-2xl border border-[#25D366]/35 bg-[#25D366]/12 text-sm font-black text-[#BDF8D1]">Crear cita</button>
              </div>
            </div>
          </MobileBottomSheet>
          <MobileBottomSheet open={blockTimeOpen}>
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-black text-[#F8FAFC]">Bloquear horario</h2>
                <p className="text-xs text-[#9CAAB8]">Formulario local, listo para conectar.</p>
              </div>
              <label className="block text-xs font-bold text-[#9CAAB8]">
                Doctor
                <select value={blockProvider} onChange={(e) => setBlockProvider(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none">
                  {sheetProviders.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold text-[#9CAAB8]">
                Fecha
                <input type="date" value={blockDate} onChange={(e) => setBlockDate(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-bold text-[#9CAAB8]">
                  Desde
                  <input type="time" value={blockFrom} onChange={(e) => setBlockFrom(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none" />
                </label>
                <label className="block text-xs font-bold text-[#9CAAB8]">
                  Hasta
                  <input type="time" value={blockTo} onChange={(e) => setBlockTo(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none" />
                </label>
              </div>
              <label className="block text-xs font-bold text-[#9CAAB8]">
                Motivo opcional
                <input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="Ej: reunión, emergencia, descanso" className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none" />
              </label>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => setBlockTimeOpen(false)} className="min-h-11 rounded-2xl border border-[#25384A] bg-[#111F2B] text-sm font-bold text-[#9CAAB8]">Cancelar</button>
                <button onClick={submitBlockTime} className="min-h-11 rounded-2xl border border-[#25D366]/35 bg-[#25D366]/12 text-sm font-black text-[#BDF8D1]">Bloquear</button>
              </div>
            </div>
          </MobileBottomSheet>
        </>
      ) : null}
    </div>
  );
}
