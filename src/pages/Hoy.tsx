import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, Calendar, MessageCircle, Clock3,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  SendHorizonal, CheckCircle2, XCircle, Scissors, UserPlus, Users, X,
  LogIn, RotateCcw, Zap, Wifi,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { getVerticalConfig } from "../config/verticalConfig";
import { BarberStatusCard, type BarberAppointment } from "../components/BarberStatusCard";
import { AppointmentCard as BusinessAppointmentCard } from "../components/AppointmentCard";
import {
  MobileActionButton,
  MobileCard,
  MobileEmptyState,
  MobileHeader,
  MobileListRow,
  MobileBottomSheet,
  MobileStatTile,
  MobileStatusPill,
} from "../components/mobile/MobilePrimitives";

const DEFAULT_ORG = "clinic-demo";

type AppointmentRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  patient_name: string | null;
  title: string | null;
  reason: string | null;
  status: string | null;
  start_at: string | null;
  starts_at: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  provider_name: string | null;
  channel?: string | null;
};

type WeekAppt = {
  id: string;
  start_at: string | null;
  starts_at: string | null;
  status: string | null;
  patient_name: string | null;
  provider_name: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
};

type AlertRow = {
  id: string;
  title: string;
  body: string | null;
  type: string | null;
  status: string | null;
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function apptISO(a: { start_at: string | null; starts_at: string | null; appointment_date?: string | null; appointment_time?: string | null }) {
  if (a.start_at) return a.start_at;
  if (a.starts_at) return a.starts_at;
  if (a.appointment_date) return `${a.appointment_date}T${a.appointment_time ?? "00:00"}:00`;
  return null;
}
function fmtTime(iso: string | null) {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}
function fmtWeekday(d: Date) {
  return d.toLocaleDateString("es", { weekday: "long" });
}
function getMondayOfWeek(d: Date) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0,0,0,0);
  return m;
}

function sameDayFromIso(iso: string | null, day: Date): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return startOfDay(date).getTime() === startOfDay(day).getTime();
}

function inRangeFromIso(iso: string | null, start: Date, end: Date): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return !Number.isNaN(time) && time >= start.getTime() && time <= end.getTime();
}

type StatusKey = "confirmed" | "pending" | "cancelled" | "completed";
const STATUS_STYLES: Record<StatusKey, { chip: string; label: string; dot: string; week: string }> = {
  confirmed: { chip: "bg-emerald-400/10 border-emerald-400/30 text-emerald-300", label: "Confirmada", dot: "bg-emerald-400", week: "text-emerald-300" },
  pending:   { chip: "bg-amber-400/10 border-amber-400/30 text-amber-300",       label: "Pendiente",  dot: "bg-amber-400",  week: "text-amber-300"   },
  cancelled: { chip: "bg-rose-400/10 border-rose-400/30 text-rose-300",         label: "Cancelada",  dot: "bg-rose-400",   week: "text-rose-300"    },
  completed: { chip: "bg-sky-400/10 border-sky-400/30 text-sky-300",            label: "Completada", dot: "bg-sky-400",    week: "text-sky-300"     },
};
function getStatus(raw: string | null): StatusKey {
  const s = (raw ?? "pending").toLowerCase();
  return s in STATUS_STYLES ? (s as StatusKey) : "pending";
}

const DOC_COLORS = [
  "bg-blue-500/20 text-blue-300 border-blue-400/30",
  "bg-purple-500/20 text-purple-300 border-purple-400/30",
  "bg-teal-500/20 text-teal-300 border-teal-400/30",
  "bg-pink-500/20 text-pink-300 border-pink-400/30",
];
const BARBER_ACCENTS = ["bg-[#25D366]", "bg-[#22C55E]", "bg-[#14B8A6]", "bg-[#84CC16]", "bg-[#38BDF8]"];
function docColor(name: string, doctors: string[]) {
  const idx = doctors.indexOf(name);
  return DOC_COLORS[idx % DOC_COLORS.length] ?? DOC_COLORS[0];
}
function barberAccent(name: string, index: number) {
  let hash = index;
  for (const ch of name.toLowerCase()) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return BARBER_ACCENTS[Math.abs(hash) % BARBER_ACCENTS.length];
}

function StatPill({ value, label, color, onClick }: {
  value: number; label: string; color: string; onClick?: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition hover:opacity-80 ${color}`}>
      <span className="text-lg font-bold">{value}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}

function ApptCard({ appt, doctors, onConfirm, onComplete, onCancel, onMessage, customerLabel, providerLabel, serviceLabel }: {
  appt: AppointmentRow;
  doctors: string[];
  onConfirm: (id: string) => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  onMessage: (leadId: string | null) => void;
  customerLabel: string;
  providerLabel: string;
  serviceLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const status = getStatus(appt.status);
  const st = STATUS_STYLES[status];
  const time = (appt as any).appointment_time || fmtTime(apptISO(appt));
  const docName = appt.provider_name || "Sin asignar";
  const channelLabel = String(appt.channel ?? "whatsapp").toLowerCase() === "whatsapp" ? "WhatsApp" : String(appt.channel ?? "Canal");
  const dc = appt.provider_name ? docColor(docName, doctors) : "bg-white/5 text-white/30 border-white/10";
  const serviceValue = appt.reason || appt.title || "Servicio";
  const customerValue = appt.patient_name || customerLabel;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0C111C] overflow-hidden">
      <button onClick={() => setOpen(p => !p)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition">
        <div className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
        <span className="text-sm font-bold text-white/60 w-16 shrink-0">{time}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{serviceValue}</div>
          <div className="text-xs text-white/70 truncate">{customerValue}</div>
          <div className="text-[11px] text-white/45 truncate">{docName} · {channelLabel}</div>
        </div>
        <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border hidden md:inline ${dc}`}>
          {docName}
        </span>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${st.chip}`}>
          {st.label}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-white/30 shrink-0" /> : <ChevronDown className="h-4 w-4 text-white/30 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/[0.06]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3 mb-4">
            {[
              { label: customerLabel, value: appt.patient_name || "—" },
              { label: serviceLabel, value: appt.reason || appt.title || "Consulta" },
              { label: "Hora",     value: time },
              { label: providerLabel, value: docName },
              { label: "Estado",   value: st.label },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-[10px] text-white/30 uppercase tracking-wide mb-0.5">{label}</div>
                <div className="text-sm text-white/85">{value}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {status === "pending" && (
              <button onClick={() => onConfirm(appt.id)}
                className="flex-1 min-w-[100px] h-9 rounded-xl bg-emerald-400/10 border border-emerald-400/30 text-xs font-medium text-emerald-300 hover:bg-emerald-400/20 flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar
              </button>
            )}
            {status === "confirmed" && (
              <button onClick={() => onComplete(appt.id)}
                className="flex-1 min-w-[100px] h-9 rounded-xl bg-sky-400/10 border border-sky-400/30 text-xs font-medium text-sky-300 hover:bg-sky-400/20 flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Completar
              </button>
            )}
            <button onClick={() => onMessage(appt.lead_id)}
              className="flex-1 min-w-[100px] h-9 rounded-xl bg-white/5 border border-white/15 text-xs font-medium text-white/70 hover:bg-white/10 flex items-center justify-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" /> Mensaje
            </button>
            {status !== "cancelled" && status !== "completed" && (
              <button onClick={() => onCancel(appt.id)}
                className="h-9 px-3 rounded-xl bg-rose-500/10 border border-rose-400/30 text-xs font-medium text-rose-300 hover:bg-rose-500/20 flex items-center justify-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WeekCalendar({ weekAppts, selectedDate, onDayClick, docFilter }: {
  weekAppts: WeekAppt[];
  selectedDate: Date;
  onDayClick: (d: Date) => void;
  docFilter: string;
}) {
  const monday = getMondayOfWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const today = startOfDay(new Date());
  const DAY_NAMES = ["Lu","Ma","Mi","Ju","Vi","Sá","Do"];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <span className="text-xs font-medium text-white/40 uppercase tracking-wide">Esta semana</span>
        <button onClick={() => onDayClick(new Date())} className="text-xs text-[#3CBDB9] hover:underline">
          Ir a hoy
        </button>
      </div>
      <div className="grid grid-cols-7 divide-x divide-white/[0.06]">
        {days.map((day, i) => {
          const isToday    = startOfDay(day).getTime() === today.getTime();
          const isSelected = startOfDay(day).getTime() === startOfDay(selectedDate).getTime();
          const dayStr     = startOfDay(day).toISOString().slice(0, 10);
          const dayAppts   = weekAppts.filter(a => {
            const iso = apptISO(a);
            if (!iso) return false;
            if (iso.slice(0, 10) !== dayStr) return false;
            if (docFilter !== "all" && docFilter !== "unassigned" && a.provider_name !== docFilter) return false;
            if (docFilter === "unassigned" && a.provider_name) return false;
            return true;
          });

          return (
            <button key={i} onClick={() => onDayClick(day)}
              className={`flex flex-col items-center py-2 px-0.5 min-h-[76px] transition hover:bg-white/[0.04] ${isSelected ? "bg-white/[0.06]" : ""}`}>
              <span className="text-[10px] text-white/30 mb-1">{DAY_NAMES[i]}</span>
              <span className={`text-sm font-medium mb-1.5 w-7 h-7 flex items-center justify-center rounded-full ${
                isToday    ? "bg-[#3CBDB9] text-[#0B1117]" :
                isSelected ? "border border-[#3CBDB9]/50 text-[#3CBDB9]" :
                             "text-white/70"
              }`}>
                {day.getDate()}
              </span>
              <div className="flex flex-col gap-0.5 w-full px-0.5">
                {dayAppts.slice(0, 2).map((a, ai) => {
                  const st = STATUS_STYLES[getStatus(a.status)];
                  return (
                    <div key={ai} className={`text-[9px] truncate px-1 py-0.5 rounded bg-white/5 ${st.week}`}>
                      {(a as any).appointment_time || fmtTime(apptISO(a))} {a.patient_name?.split(" ")[0] ?? "—"}
                    </div>
                  );
                })}
                {dayAppts.length > 2 && (
                  <div className="text-[9px] text-white/30 text-center">+{dayAppts.length - 2}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CommandHeroAction({ icon, label, tone, onClick }: {
  icon: React.ReactNode;
  label: string;
  tone: "sky" | "emerald" | "muted" | "whatsapp" | "done";
  onClick: () => void;
}) {
  const toneClass = {
    sky: "text-sky-400 hover:bg-sky-400/[0.08]",
    emerald: "text-[#18C37E] hover:bg-[#18C37E]/[0.08]",
    muted: "text-[#8A9299] hover:bg-white/[0.05] hover:text-[#F0F4F8]",
    whatsapp: "text-[#25D366] hover:bg-[#25D366]/[0.08]",
    done: "text-[#353D4A]",
  }[tone];
  return (
    <button type="button" onClick={onClick} className={`flex min-w-0 items-center justify-center gap-1 border-r border-[#18C37E]/[0.08] py-3 text-[11px] font-semibold transition last:border-r-0 ${toneClass}`}>
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function CommandMetric({ label, value, alert, highlight }: { label: string; value: string; alert?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1 rounded-xl border py-4 ${alert ? "border-amber-800/[0.18] bg-amber-950/[0.15]" : "border-[#1E2228] bg-[#0E1014]"}`}>
      <span className={`text-2xl font-extrabold leading-none ${alert ? "text-amber-400" : highlight ? "text-[#18C37E]" : "text-[#F0F4F8]"}`}>{value}</span>
      <span className="text-[10px] font-medium text-[#4A5260]">{label}</span>
    </div>
  );
}

function CommandQuickTile({ icon, label, badge, onClick }: { icon: React.ReactNode; label: string; badge?: number; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl border border-[#1E2228] bg-[#0E1014] py-3.5 transition hover:border-white/[0.10] hover:bg-[#131820] active:scale-[0.97]">
      <span className="text-[#5A6270]">{icon}</span>
      <span className="text-center text-[10px] font-semibold leading-tight text-[#4A5260]">{label}</span>
      {!!badge && badge > 0 ? (
        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#18C37E] text-[8px] font-bold leading-none text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function DrawerShell({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-sm">
      <button type="button" aria-label="Cerrar" onClick={onClose} className="absolute inset-0 cursor-default" />
      <aside className="relative z-10 flex h-full w-full max-w-[410px] flex-col overflow-y-auto border-l border-[#1E2227] bg-[#0B0D0F] shadow-2xl">
        {children}
      </aside>
    </div>
  );
}

function DrawerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#4A5260]">{label}</span>
      {children}
    </label>
  );
}

const drawerInputClass = "w-full rounded-lg border border-white/[0.08] bg-[#05060A] px-3 py-2.5 text-sm text-[#E8ECF2] outline-none transition placeholder:text-[#2A303A] focus:border-white/[0.16]";

function BarberWalkInDrawer({
  open,
  client,
  service,
  provider,
  services,
  providers,
  onClientChange,
  onServiceChange,
  onProviderChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  client: string;
  service: string;
  provider: string;
  services: string[];
  providers: string[];
  onClientChange: (value: string) => void;
  onServiceChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <DrawerShell open={open} onClose={onClose}>
      <div className="flex items-center gap-3 border-b border-[#1E2227] px-5 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#18C37E]/20 bg-[#18C37E]/[0.12]">
          <UserPlus className="h-4 w-4 text-[#18C37E]" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-[#F0F4F8]">Walk-in rápido</h2>
          <p className="mt-0.5 text-xs text-[#4A5260]">Visual-only por ahora, sin guardar en base de datos.</p>
        </div>
        <button type="button" onClick={onClose} className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] text-[#8A9299] hover:bg-white/[0.05]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-4 p-5">
        <DrawerField label="Nombre del cliente">
          <input value={client} onChange={(event) => onClientChange(event.target.value)} placeholder="Ej: Pedro López" className={drawerInputClass} />
        </DrawerField>
        <div className="grid grid-cols-2 gap-3">
          <DrawerField label="Servicio">
            <select value={service} onChange={(event) => onServiceChange(event.target.value)} className={drawerInputClass}>
              {services.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </DrawerField>
          <DrawerField label="Barbero">
            <select value={provider} onChange={(event) => onProviderChange(event.target.value)} className={drawerInputClass}>
              {providers.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </DrawerField>
        </div>
        <DrawerField label="Hora estimada">
          <input value={new Date().toLocaleTimeString("es-HN", { hour: "numeric", minute: "2-digit" })} readOnly className={drawerInputClass} />
        </DrawerField>
        <DrawerField label="Notas">
          <textarea rows={3} placeholder="Preferencias, observaciones..." className={`${drawerInputClass} resize-none`} />
        </DrawerField>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-white/[0.08] text-sm font-semibold text-[#8A9299] transition hover:bg-white/[0.05]">
            Cancelar
          </button>
          <button type="button" onClick={onSubmit} className="min-h-11 flex-[2] rounded-xl bg-[#18C37E] text-sm font-bold text-white transition hover:bg-[#15AE6F]">
            Crear walk-in
          </button>
        </div>
      </div>
    </DrawerShell>
  );
}

function BarberAppointmentPreviewDrawer({
  appointment,
  checkedIn,
  onClose,
  onCheckIn,
  onMessage,
}: {
  appointment: AppointmentRow | null;
  checkedIn: boolean;
  onClose: () => void;
  onCheckIn: () => void;
  onMessage: () => void;
}) {
  const open = Boolean(appointment);
  const time = appointment ? ((appointment as any).appointment_time || fmtTime(apptISO(appointment))) : "";
  const initials = String(appointment?.patient_name || "Cliente").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <DrawerShell open={open} onClose={onClose}>
      {appointment ? (
        <>
          <div className="flex items-center gap-4 border-b border-[#1E2227] px-5 py-5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#18C37E]/[0.12] bg-[#131A17]">
              <span className="text-lg font-bold text-[#8A9A94]">{initials}</span>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[17px] font-bold leading-tight text-[#F0F4F8]">{appointment.patient_name || "Cliente"}</h2>
              <p className="mt-0.5 font-mono text-xs text-[#5A6270]">{appointment.lead_id ? "Cliente por WhatsApp" : "Sin lead vinculado"}</p>
              <div className="mt-2">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[getStatus(appointment.status)].chip}`}>{checkedIn ? "En espera" : STATUS_STYLES[getStatus(appointment.status)].label}</span>
              </div>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] text-[#8A9299] hover:bg-white/[0.05]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-4 p-5">
            <div className="rounded-xl border border-[#1E2228] bg-[#0E1014] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#353D4A]">Cita</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <PreviewInfo icon={<Clock3 className="h-3.5 w-3.5" />} label="Hora" value={time} />
                <PreviewInfo icon={<Users className="h-3.5 w-3.5" />} label="Barbero" value={appointment.provider_name || "Barbero"} />
                <PreviewInfo icon={<Scissors className="h-3.5 w-3.5" />} label="Servicio" value={appointment.reason || appointment.title || "Cita"} />
                <PreviewInfo icon={<MessageCircle className="h-3.5 w-3.5" />} label="Canal" value={String(appointment.channel ?? "WhatsApp")} />
              </div>
            </div>
            <div className="rounded-xl border border-[#25D366]/[0.12] bg-[#25D366]/[0.03] p-4">
              <div className="mb-2 flex items-center gap-2">
                <MessageCircle className="h-3.5 w-3.5 text-[#25D366]" />
                <p className="text-[10px] font-bold uppercase tracking-[0.10em] text-[#25D366]">Último mensaje</p>
              </div>
              <p className="text-xs italic leading-relaxed text-[#7A8290]">"Listo, tu cita quedó confirmada para hoy a las {time}."</p>
            </div>
            <div className="space-y-2">
              <p className="pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#353D4A]">Acciones</p>
              <button type="button" onClick={onCheckIn} className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[#18C37E]/[0.22] bg-[#18C37E]/[0.12] py-3 text-sm font-bold text-[#18C37E] transition hover:bg-[#18C37E]/[0.20]">
                <LogIn className="h-4 w-4" />
                {checkedIn ? "En espera · Check-in realizado" : "Check-in · Llegó"}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] py-2.5 text-sm font-semibold text-[#8A9299] transition hover:bg-white/[0.07] hover:text-[#F0F4F8]">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reagendar
                </button>
                <button type="button" onClick={onMessage} className="flex items-center justify-center gap-2 rounded-xl border border-[#25D366]/[0.14] bg-[#25D366]/[0.07] py-2.5 text-sm font-semibold text-[#25D366] transition hover:bg-[#25D366]/[0.14]">
                  <MessageCircle className="h-3.5 w-3.5" />
                  Mensaje
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </DrawerShell>
  );
}

function PreviewInfo({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-[#4A5260]">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-[#353D4A]">{label}</p>
        <p className="mt-0.5 break-words text-xs font-semibold text-[#C8D0DC]">{value}</p>
      </div>
    </div>
  );
}

export default function Hoy() {
  const navigate = useNavigate();
  const { activeOrgId, activeBusinessType, activeOrgName } = useActiveOrg();
  const vertical = getVerticalConfig(activeBusinessType);
  const orgId = activeOrgId || DEFAULT_ORG;
  useEffect(() => {
    console.log("[hoy:active_org]", {
      activeOrgId,
      activeBusinessType,
      activeOrgName,
      resolvedOrgId: orgId,
    });
  }, [activeOrgId, activeBusinessType, activeOrgName, orgId]);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [weekAppts, setWeekAppts] = useState<WeekAppt[]>([]);
  const [leadChannelById, setLeadChannelById] = useState<Record<string, string>>({});
  const [newMessages, setNewMessages] = useState(0);
  const [pendingOutbox, setPendingOutbox] = useState(0);
  const [humanHandoffCount, setHumanHandoffCount] = useState(0);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [tomorrowCount, setTomorrowCount] = useState(0);
  const [weekCount, setWeekCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [docFilter, setDocFilter] = useState("all");
  const [barberStatusOverrides, setBarberStatusOverrides] = useState<Record<string, "Disponible" | "Ocupado">>({});
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInNotice, setWalkInNotice] = useState("");
  const [walkInClient, setWalkInClient] = useState("");
  const [walkInService, setWalkInService] = useState("");
  const [walkInProvider, setWalkInProvider] = useState("");
  const [previewAppointment, setPreviewAppointment] = useState<AppointmentRow | null>(null);
  const [checkedInIds, setCheckedInIds] = useState<Record<string, boolean>>({});

  const isToday = useMemo(
    () => startOfDay(selectedDate).getTime() === startOfDay(new Date()).getTime(),
    [selectedDate],
  );

  const doctors = useMemo(() => {
    const names = appointments.map(a => a.provider_name).filter((n): n is string => !!n);
    const unique = [...new Set(names)];
    if (unique.length > 0) return unique;
    if (orgId === "barber-demo-wimaeil") return ["William"];
    return [];
  }, [appointments, orgId]);

  const walkInServices = useMemo(() => {
    const names = appointments.map((a) => a.reason || a.title).filter((n): n is string => Boolean(n));
    const unique = [...new Set(names)];
    if (unique.length > 0) return unique;
    if (orgId === "barber-demo-wimaeil") return ["Corte general", "Corte + facial"];
    return ["Corte", "Barba"];
  }, [appointments, orgId]);

  const filteredAppts = useMemo(() => {
    if (docFilter === "all") return appointments;
    if (docFilter === "unassigned") return appointments.filter(a => !a.provider_name);
    return appointments.filter(a => a.provider_name === docFilter);
  }, [appointments, docFilter]);

  const pendingCount   = appointments.filter(a => getStatus(a.status) === "pending").length;
  const confirmedCount = appointments.filter(a => getStatus(a.status) === "confirmed").length;
  const nextAppointment = useMemo(() => {
    return appointments
      .filter((appt) => getStatus(appt.status) !== "cancelled")
      .map((appt) => ({ appt, iso: apptISO(appt) }))
      .filter((item): item is { appt: AppointmentRow; iso: string } => Boolean(item.iso))
      .filter((item) => new Date(item.iso).getTime() >= Date.now())
      .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())[0]?.appt ?? null;
  }, [appointments]);
  const visibleBusinessName =
    activeOrgName ||
    (orgId === "barber-demo-wimaeil"
      ? "Barbería WIMAEIL"
      : orgId === "barber-demo"
        ? "BarberLine"
        : activeBusinessType === "barbershop"
          ? "Barbería"
          : "DentalConnect");
  const now = new Date();

  const barberSections = useMemo(() => {
    const providerNames = doctors.length ? doctors : [activeBusinessType === "barbershop" ? "Barbero disponible" : vertical.providerLabel];
    return providerNames.map((name, index) => {
      const list = appointments
        .filter((appt) => (appt.provider_name || "Sin asignar") === name || (!appt.provider_name && name === "Barbero disponible"))
        .filter((appt) => getStatus(appt.status) !== "cancelled")
        .sort((a, b) => {
          const ai = apptISO(a);
          const bi = apptISO(b);
          return (ai ? new Date(ai).getTime() : 0) - (bi ? new Date(bi).getTime() : 0);
        });
      const mapped: BarberAppointment[] = list.map((appt) => ({
        id: appt.id,
        time: (appt as any).appointment_time || fmtTime(apptISO(appt)),
        client: appt.patient_name || vertical.customerLabel,
        service: appt.reason || appt.title || vertical.serviceLabel,
        provider: appt.provider_name || name,
        status: appt.status,
        leadId: appt.lead_id,
      }));
      const next = mapped.find((appt) => {
        const raw = list.find((item) => item.id === appt.id);
        const iso = raw ? apptISO(raw) : null;
        return iso ? new Date(iso).getTime() >= now.getTime() : true;
      }) ?? mapped[0] ?? null;
      const hasCurrentCut = list.some((appt) => {
        const iso = apptISO(appt);
        if (!iso) return false;
        const start = new Date(iso).getTime();
        const end = start + 45 * 60 * 1000;
        return start <= now.getTime() && end >= now.getTime() && getStatus(appt.status) === "confirmed";
      });
      const override = barberStatusOverrides[name];
      const status: "Disponible" | "Ocupado" | "En corte" = override === "Ocupado" ? "Ocupado" : hasCurrentCut ? "En corte" : "Disponible";
      return {
        name,
        status,
        nextAppointment: next,
        appointments: mapped,
        colorClass: barberAccent(name, index),
      };
    });
  }, [appointments, doctors, activeBusinessType, vertical, barberStatusOverrides]);

  async function load() {
    setLoading(true);
    const todayStartDate = startOfDay(selectedDate);
    const todayEndDate   = endOfDay(selectedDate);
    const todayStart = todayStartDate.toISOString();
    const todayEnd   = todayEndDate.toISOString();
    const selectedDateKey = todayStart.slice(0, 10);
    const tomorrow   = new Date(selectedDate.getTime() + 86_400_000);
    const monday     = getMondayOfWeek(selectedDate);
    const sunday     = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23,59,59,999);
    const weekStart = monday.toISOString();
    const weekEnd = sunday.toISOString();
    const weekStartKey = weekStart.slice(0, 10);
    const weekEndKey = weekEnd.slice(0, 10);
    const oneDayAgo  = new Date(Date.now() - 86_400_000).toISOString();
    const apptSelect = "id, organization_id, lead_id, patient_name, title, reason, status, start_at, starts_at, appointment_date, appointment_time, provider_name";

    const [
      todayStartAtRes,
      todayStartsAtRes,
      todayDateRes,
      weekStartAtRes,
      weekStartsAtRes,
      weekDateRes,
      msgsRes,
      outboxRes,
      alertsRes,
      handoffRes,
    ] = await Promise.all([
      supabase.from("appointments")
        .select(apptSelect)
        .eq("organization_id", orgId)
        .gte("start_at", todayStart).lte("start_at", todayEnd)
        .order("start_at", { ascending: true }),
      supabase.from("appointments")
        .select(apptSelect)
        .eq("organization_id", orgId)
        .gte("starts_at", todayStart).lte("starts_at", todayEnd)
        .order("starts_at", { ascending: true }),
      supabase.from("appointments")
        .select(apptSelect)
        .eq("organization_id", orgId)
        .eq("appointment_date", selectedDateKey)
        .order("appointment_time", { ascending: true }),
      supabase.from("appointments")
        .select(apptSelect)
        .eq("organization_id", orgId)
        .gte("start_at", weekStart).lte("start_at", weekEnd)
        .neq("status", "cancelled"),
      supabase.from("appointments")
        .select(apptSelect)
        .eq("organization_id", orgId)
        .gte("starts_at", weekStart).lte("starts_at", weekEnd)
        .neq("status", "cancelled"),
      supabase.from("appointments")
        .select(apptSelect)
        .eq("organization_id", orgId)
        .gte("appointment_date", weekStartKey).lte("appointment_date", weekEndKey)
        .neq("status", "cancelled"),
      supabase.from("messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId).eq("role", "user").eq("channel", "whatsapp").gte("created_at", todayStart),
      supabase.from("reply_outbox")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId).in("status", ["queued","pending","processing"])
        .gte("created_at", oneDayAgo),
      supabase.from("alerts")
        .select("id, title, body, type, status")
        .eq("organization_id", orgId).eq("status", "open").neq("type", "daily_digest")
        .order("created_at", { ascending: false }).limit(3),
      supabase.from("leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("handoff_to_human", true),
    ]);
    const todayRows = [
      ...((todayStartAtRes.data ?? []) as AppointmentRow[]),
      ...((todayStartsAtRes.data ?? []) as AppointmentRow[]),
      ...((todayDateRes.data ?? []) as AppointmentRow[]),
    ];
    const todayAppointments = Array.from(new Map(todayRows.map((row) => [row.id, row])).values())
      .filter((row) => sameDayFromIso(apptISO(row), selectedDate))
      .sort((a, b) => new Date(apptISO(a) ?? 0).getTime() - new Date(apptISO(b) ?? 0).getTime());
    const weekRows = [
      ...((weekStartAtRes.data ?? []) as AppointmentRow[]),
      ...((weekStartsAtRes.data ?? []) as AppointmentRow[]),
      ...((weekDateRes.data ?? []) as AppointmentRow[]),
    ];
    const weekAppointments = Array.from(new Map(weekRows.map((row) => [row.id, row])).values())
      .filter((row) => inRangeFromIso(apptISO(row), monday, sunday))
      .sort((a, b) => new Date(apptISO(a) ?? 0).getTime() - new Date(apptISO(b) ?? 0).getTime());
    const tomorrowAppointments = weekAppointments.filter((row) => sameDayFromIso(apptISO(row), tomorrow));

    console.log("[hoy:load]", {
      org: orgId,
      apptsError: todayStartAtRes.error?.message ?? todayStartsAtRes.error?.message ?? todayDateRes.error?.message ?? null,
      apptsCount: todayAppointments.length,
      msgsTodayCount: msgsRes.count ?? 0,
      pendingOutbox: outboxRes.count ?? 0,
    });

    if (!todayStartAtRes.error && !todayStartsAtRes.error && !todayDateRes.error) setAppointments(todayAppointments);
    if (!todayStartAtRes.error && !todayStartsAtRes.error && !todayDateRes.error) {
      const leadIds = todayAppointments.map((a) => a.lead_id).filter(Boolean) as string[];
      if (leadIds.length > 0) {
        const { data: leadsData } = await supabase
          .from("leads")
          .select("id, channel")
          .eq("organization_id", orgId)
          .in("id", leadIds);
        const map: Record<string, string> = {};
        for (const row of (leadsData ?? []) as Array<{ id: string; channel: string | null }>) {
          if (row.id) map[row.id] = row.channel ?? "whatsapp";
        }
        setLeadChannelById(map);
      } else {
        setLeadChannelById({});
      }
    }
    if (!weekStartAtRes.error && !weekStartsAtRes.error && !weekDateRes.error) setWeekAppts(weekAppointments as WeekAppt[]);
    setNewMessages(msgsRes.count ?? 0);
    setPendingOutbox(outboxRes.count ?? 0);
    if (!alertsRes.error) setAlerts(alertsRes.data as AlertRow[] ?? []);
    setTomorrowCount(tomorrowAppointments.length);
    setWeekCount(weekAppointments.length);
    setHumanHandoffCount(handoffRes.count ?? 0);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [activeBusinessType, orgId, selectedDate]);

  async function confirmAppointment(id: string) {
    await supabase.from("appointments").update({ status: "confirmed" }).eq("id", id);
    await load();
  }
  async function completeAppointment(id: string) {
    await supabase.from("appointments").update({ status: "completed" }).eq("id", id);
    await load();
  }
  async function cancelAppointment(id: string) {
    if (!window.confirm("¿Cancelar esta cita?")) return;
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);
    await load();
  }

  function openWalkInSheet() {
    setWalkInClient("");
    setWalkInService(walkInServices[0] ?? "");
    setWalkInProvider(doctors[0] ?? "");
    setWalkInOpen(true);
    setWalkInNotice("");
  }

  function submitWalkIn() {
    setWalkInOpen(false);
    setWalkInNotice("Walk-in listo para conectar");
    window.setTimeout(() => setWalkInNotice(""), 3000);
  }

  function markVisualCheckIn(appt?: AppointmentRow | null) {
    if (!appt) {
      setWalkInNotice("No hay cita próxima para check-in");
      window.setTimeout(() => setWalkInNotice(""), 3000);
      return;
    }
    setCheckedInIds((prev) => ({ ...prev, [appt.id]: true }));
    setWalkInNotice(`${appt.patient_name || "Cliente"} marcado en espera`);
    window.setTimeout(() => setWalkInNotice(""), 3000);
  }

  const commandAppointments = useMemo(() => {
    return filteredAppts
      .filter((appt) => getStatus(appt.status) !== "cancelled")
      .sort((a, b) => new Date(apptISO(a) ?? 0).getTime() - new Date(apptISO(b) ?? 0).getTime());
  }, [filteredAppts]);
  const commandNextAppointment = commandAppointments[0] ?? nextAppointment ?? null;
  const waitingCount = Object.values(checkedInIds).filter(Boolean).length;
  const initialsFor = (name: string | null | undefined) => String(name || "Cliente").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  if (activeBusinessType === "barbershop") {
    return (
      <div className="app-page bg-[#050608] text-[#F0F4F8]">
        <section className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-[22px] font-black leading-tight tracking-tight text-[#F0F4F8]">Recepción BarberLine</h1>
              <p className="mt-1 text-xs text-[#5A6270]">
                {fmtWeekday(new Date())}, {fmtDate(new Date())} · {visibleBusinessName}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#25D366]/14 bg-[#25D366]/[0.08] px-2.5 py-1 text-[11px] font-semibold text-[#25D366]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#25D366]" />
                WhatsApp
              </span>
              <button onClick={() => markVisualCheckIn(commandNextAppointment)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-sky-400/15 bg-sky-400/[0.08] px-3 text-xs font-bold text-sky-300 transition hover:bg-sky-400/[0.12]">
                <LogIn className="h-3.5 w-3.5" />
                Check-in
              </button>
              <button onClick={openWalkInSheet} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#18C37E]/20 bg-[#18C37E]/12 px-3 text-xs font-bold text-[#18C37E] transition hover:bg-[#18C37E]/18">
                <Zap className="h-3.5 w-3.5" />
                Walk-in
              </button>
              <button onClick={() => navigate("/agenda")} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/[0.10] bg-white/[0.05] px-3 text-xs font-bold text-[#E8ECF2] transition hover:bg-white/[0.08]">
                <Calendar className="h-3.5 w-3.5" />
                Nueva cita
              </button>
              <button onClick={() => navigate("/inbox")} className="relative inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#25D366]/14 bg-[#25D366]/[0.07] px-3 text-xs font-bold text-[#25D366] transition hover:bg-[#25D366]/[0.12]">
                <MessageCircle className="h-3.5 w-3.5" />
                Inbox
                {newMessages > 0 ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#18C37E] px-1 text-[9px] text-white">{newMessages}</span> : null}
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-5 lg:items-start">
            <div className="space-y-3 lg:col-span-3">
              <section className="overflow-hidden rounded-2xl border border-[#18C37E]/[0.16] bg-[#0B1210]">
                <div className="flex items-center gap-2 border-b border-[#18C37E]/[0.08] px-4 py-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#18C37E]" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#18C37E]">Próximo turno</span>
                  <span className="ml-auto font-mono text-xs text-[#3A4248]">{commandNextAppointment ? ((commandNextAppointment as any).appointment_time || fmtTime(apptISO(commandNextAppointment))) : "Libre"}</span>
                </div>
                {loading ? (
                  <div className="p-6 text-sm text-[#5A6270]">Cargando operación...</div>
                ) : commandNextAppointment ? (
                  <>
                    <button onClick={() => setPreviewAppointment(commandNextAppointment)} className="w-full px-4 py-4 text-left transition hover:bg-white/[0.015]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#18C37E]/[0.12] bg-[#131A17]">
                            <span className="text-base font-bold text-[#8A9A94]">{initialsFor(commandNextAppointment.patient_name)}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-lg font-bold text-[#F0F4F8]">{commandNextAppointment.patient_name || "Cliente"}</p>
                            <p className="mt-0.5 truncate text-sm text-[#6A7880]">{commandNextAppointment.reason || commandNextAppointment.title || "Cita"} · {commandNextAppointment.provider_name || "Barbero"}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[getStatus(commandNextAppointment.status)].chip}`}>{checkedInIds[commandNextAppointment.id] ? "En espera" : STATUS_STYLES[getStatus(commandNextAppointment.status)].label}</span>
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-4xl font-extrabold leading-none text-[#F0F4F8] tabular-nums">{(((commandNextAppointment as any).appointment_time || fmtTime(apptISO(commandNextAppointment))).split(" ")[0])}</p>
                          <p className="mt-1 text-sm font-semibold text-[#4A5260]">{(((commandNextAppointment as any).appointment_time || fmtTime(apptISO(commandNextAppointment))).split(" ")[1] || "")}</p>
                        </div>
                      </div>
                    </button>
                    <div className="grid grid-cols-4 border-t border-[#18C37E]/[0.08]">
                      <CommandHeroAction icon={<LogIn className="h-3.5 w-3.5" />} label="Check-in" tone={checkedInIds[commandNextAppointment.id] ? "done" : "sky"} onClick={() => markVisualCheckIn(commandNextAppointment)} />
                      <CommandHeroAction icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Atendida" tone="emerald" onClick={() => setPreviewAppointment(commandNextAppointment)} />
                      <CommandHeroAction icon={<RotateCcw className="h-3.5 w-3.5" />} label="Reagendar" tone="muted" onClick={() => setPreviewAppointment(commandNextAppointment)} />
                      <CommandHeroAction icon={<MessageCircle className="h-3.5 w-3.5" />} label="Mensaje" tone="whatsapp" onClick={() => commandNextAppointment.lead_id ? navigate(`/inbox/${commandNextAppointment.lead_id}`) : navigate("/inbox")} />
                    </div>
                  </>
                ) : (
                  <div className="p-6 text-sm text-[#5A6270]">Todavía no hay citas para hoy.</div>
                )}
              </section>

              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                <CommandMetric label="Citas hoy" value={String(appointments.length)} />
                <CommandMetric label="Pendientes" value={String(pendingCount)} alert={pendingCount > 0} />
                <CommandMetric label="En espera" value={String(waitingCount)} highlight={waitingCount > 0} />
                <CommandMetric label="Mensajes" value={String(newMessages)} highlight={newMessages > 0} />
              </div>

              <div className="grid grid-cols-4 gap-2">
                <CommandQuickTile icon={<LogIn className="h-4 w-4" />} label="Check-in" onClick={() => markVisualCheckIn(commandNextAppointment)} />
                <CommandQuickTile icon={<Zap className="h-4 w-4" />} label="Walk-in" onClick={openWalkInSheet} />
                <CommandQuickTile icon={<Calendar className="h-4 w-4" />} label="Nueva cita" onClick={() => navigate("/agenda")} />
                <CommandQuickTile icon={<MessageCircle className="h-4 w-4" />} label="Inbox" badge={newMessages} onClick={() => navigate("/inbox")} />
              </div>

              <section>
                <div className="mb-2.5 flex items-center justify-between">
                  <p className="text-xs font-bold text-[#F0F4F8]">Agenda de hoy</p>
                  <button onClick={() => navigate("/agenda")} className="text-[11px] font-semibold text-[#18C37E] hover:underline">Ver todas</button>
                </div>
                <div className="space-y-2">
                  {commandAppointments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#1E2228] bg-[#0E1014] p-5 text-center text-sm text-[#5A6270]">Todavía no hay citas para hoy.</div>
                  ) : commandAppointments.slice(0, 5).map((appt) => (
                    <button key={appt.id} onClick={() => setPreviewAppointment(appt)} className="flex w-full items-center gap-3 rounded-xl border border-[#181C22] bg-[#0E1014] px-3.5 py-3 text-left transition hover:border-[#252A30] hover:bg-[#111820]">
                      <span className="w-16 shrink-0 font-mono text-xs text-[#4A5260]">{(appt as any).appointment_time || fmtTime(apptISO(appt))}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#E8ECF2]">{appt.patient_name || "Cliente"}</p>
                        <p className="truncate text-[11px] text-[#4A5260]">{appt.reason || appt.title || "Cita"} · {appt.provider_name || "Barbero"}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[getStatus(appt.status)].chip}`}>{checkedInIds[appt.id] ? "En espera" : STATUS_STYLES[getStatus(appt.status)].label}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <aside className="space-y-3 lg:col-span-2">
              <section className="rounded-xl border border-[#25D366]/[0.12] bg-[#25D366]/[0.03] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#25D366]/[0.10]">
                    <MessageCircle className="h-4 w-4 text-[#25D366]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-[#F0F4F8]">WhatsApp activo</p>
                      <span className="rounded-full border border-[#25D366]/[0.14] bg-[#25D366]/[0.10] px-1.5 py-0.5 text-[9px] font-bold text-[#25D366]">EN VIVO</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#5A6270]">{newMessages} mensajes hoy · Bot activo</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-white/[0.05] bg-white/[0.03] px-3 py-2">
                    <p className="text-[10px] text-[#4A5260]">Citas por bot</p>
                    <p className="mt-0.5 text-xs font-semibold text-[#E8ECF2]">{confirmedCount} hoy</p>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] bg-white/[0.03] px-3 py-2">
                    <p className="text-[10px] text-[#4A5260]">Cola</p>
                    <p className="mt-0.5 text-xs font-semibold text-[#E8ECF2]">{pendingOutbox} envíos</p>
                  </div>
                </div>
                <button onClick={() => navigate("/inbox")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#25D366]/[0.14] bg-[#25D366]/[0.08] py-2 text-xs font-bold text-[#25D366] transition hover:bg-[#25D366]/[0.14]">
                  <Wifi className="h-3.5 w-3.5" />
                  Abrir inbox
                </button>
              </section>

              <section className="rounded-xl border border-[#1E2228] bg-[#0E1014] p-4">
                <p className="text-xs font-bold text-[#F0F4F8]">Citas por barbero</p>
                <div className="mt-3 space-y-3">
                  {(doctors.length ? doctors : ["Barbero disponible"]).slice(0, 4).map((barber) => {
                    const count = appointments.filter((appt) => (appt.provider_name || "Barbero disponible") === barber).length;
                    const width = appointments.length ? `${Math.max(8, (count / appointments.length) * 100)}%` : "8%";
                    return (
                      <div key={barber} className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-[#8A9299]">{barber}</span>
                          <span className="font-bold text-[#F0F4F8]">{count} citas</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#181C22]">
                          <div className="h-full rounded-full bg-[#18C37E]/55" style={{ width }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-[#1E2228] bg-[#0E1014] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-[#F0F4F8]">Pendientes</p>
                  <span className="rounded-full bg-[#18C37E]/[0.08] px-2 py-0.5 text-[10px] font-bold text-[#18C37E]">{pendingCount}</span>
                </div>
                <div className="mt-3 space-y-2">
                  {commandAppointments.filter((appt) => getStatus(appt.status) === "pending").slice(0, 3).map((appt) => (
                    <button key={appt.id} onClick={() => setPreviewAppointment(appt)} className="flex w-full items-center gap-3 rounded-lg border border-[#181C22] bg-black/20 px-3 py-2 text-left">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#18C37E]" />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#F0F4F8]">{appt.patient_name || "Cliente"}</span>
                      <span className="text-[10px] text-[#4A5260]">{(appt as any).appointment_time || fmtTime(apptISO(appt))}</span>
                    </button>
                  ))}
                  {pendingCount === 0 ? <p className="text-xs text-[#5A6270]">Sin citas pendientes por ahora.</p> : null}
                </div>
              </section>
            </aside>
          </div>
        </section>

        {walkInNotice ? (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-[#25D366]/35 bg-[#07110C] px-4 py-2 text-xs font-bold text-[#BDF8D1] shadow-2xl">
            {walkInNotice}
          </div>
        ) : null}

        <BarberWalkInDrawer
          open={walkInOpen}
          client={walkInClient}
          service={walkInService}
          provider={walkInProvider}
          services={walkInServices}
          providers={doctors.length ? doctors : ["Barbero disponible"]}
          onClientChange={setWalkInClient}
          onServiceChange={setWalkInService}
          onProviderChange={setWalkInProvider}
          onClose={() => setWalkInOpen(false)}
          onSubmit={submitWalkIn}
        />
        <BarberAppointmentPreviewDrawer
          appointment={previewAppointment}
          checkedIn={previewAppointment ? Boolean(checkedInIds[previewAppointment.id]) : false}
          onClose={() => setPreviewAppointment(null)}
          onCheckIn={() => markVisualCheckIn(previewAppointment)}
          onMessage={() => {
            const leadId = previewAppointment?.lead_id;
            navigate(leadId ? `/inbox/${leadId}` : "/inbox");
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-page">
      {activeBusinessType === "barbershop" ? (
        <section className="space-y-3 lg:hidden">
          <MobileCard elevated>
            <MobileHeader
              title={visibleBusinessName}
              subtitle={`${fmtWeekday(new Date())}, ${fmtDate(new Date())}`}
              action={(
                <MobileStatusPill tone="success">
                Bot activo
                </MobileStatusPill>
              )}
            />

            <div className="mt-4 grid grid-cols-3 gap-2">
              <MobileStatTile label="mensajes" value={newMessages} onClick={() => navigate("/inbox")} />
              <MobileStatTile label="en humano" value={humanHandoffCount} tone="warning" onClick={() => navigate("/inbox")} />
              <MobileStatTile label="próxima" value={nextAppointment ? fmtTime(apptISO(nextAppointment)) : "Libre"} onClick={() => navigate("/agenda")} />
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              <MobileActionButton onClick={() => navigate("/inbox")}>Inbox</MobileActionButton>
              <MobileActionButton onClick={() => navigate("/agenda")} tone="accent" className="font-black">Crear cita</MobileActionButton>
              <MobileActionButton onClick={openWalkInSheet}>Walk-in</MobileActionButton>
              <MobileActionButton onClick={() => navigate("/agenda?block=1")}>Bloquear</MobileActionButton>
            </div>
          </MobileCard>

          <MobileCard>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="mobile-section-label">Agenda de hoy</h2>
                <p className="mobile-muted">{appointments.length} citas · {confirmedCount} confirmadas</p>
              </div>
              <MobileActionButton onClick={() => navigate("/agenda")} tone="muted">Ver</MobileActionButton>
            </div>
            {loading ? (
              <div className="py-8 text-center text-xs text-white/45">Cargando...</div>
            ) : filteredAppts.length === 0 ? (
              <MobileEmptyState
                icon={Calendar}
                title="Todavía no hay citas para hoy."
                description="Probá el flujo por WhatsApp o agregá una cita manual."
                action={<button onClick={() => navigate("/agenda")} className="text-xs font-bold text-[#25D366]">Crear cita</button>}
              />
            ) : (
              <div className="space-y-2">
                {filteredAppts.slice(0, 5).map((appt) => (
                  <MobileListRow key={appt.id} onClick={() => appt.lead_id ? navigate(`/inbox/${appt.lead_id}`) : navigate("/agenda")}>
                    <span className="w-14 shrink-0 text-sm font-black text-[#25D366]">{(appt as any).appointment_time || fmtTime(apptISO(appt))}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{appt.patient_name || "Cliente"}</span>
                      <span className="block truncate text-xs text-white/45">{appt.reason || appt.title || "Cita"}{appt.provider_name ? ` · ${appt.provider_name}` : ""}</span>
                    </span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[getStatus(appt.status)].chip}`}>{STATUS_STYLES[getStatus(appt.status)].label}</span>
                  </MobileListRow>
                ))}
              </div>
            )}
          </MobileCard>
          {walkInNotice ? (
            <div className="rounded-2xl border border-[#25D366]/35 bg-[#25D366]/12 px-3 py-2 text-xs font-bold text-[#BDF8D1]">
              {walkInNotice}
            </div>
          ) : null}
        </section>
      ) : null}

      <MobileBottomSheet open={walkInOpen}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-[#F8FAFC]">Agregar walk-in</h2>
            <p className="text-xs text-[#9CAAB8]">UI local, listo para conectar.</p>
          </div>
          <button onClick={() => setWalkInOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#111F2B] text-[#9CAAB8]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-bold text-[#9CAAB8]">
            Cliente
            <input value={walkInClient} onChange={(e) => setWalkInClient(e.target.value)} placeholder="Opcional" className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none" />
          </label>
          <label className="block text-xs font-bold text-[#9CAAB8]">
            Servicio
            <select value={walkInService} onChange={(e) => setWalkInService(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none">
              {walkInServices.map((service) => <option key={service} value={service}>{service}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold text-[#9CAAB8]">
            Barbero
            <select value={walkInProvider} onChange={(e) => setWalkInProvider(e.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 text-sm text-[#F8FAFC] outline-none">
              {(doctors.length ? doctors : ["Barbero disponible"]).map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>
          <div className="rounded-2xl border border-[#25384A] bg-[#111F2B] px-3 py-2 text-sm text-[#F8FAFC]">
            <div className="text-xs font-bold text-[#9CAAB8]">Hora</div>
            <div className="mt-1 font-black">{fmtTime(new Date().toISOString())}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={() => setWalkInOpen(false)} className="min-h-11 rounded-2xl border border-[#25384A] bg-[#111F2B] text-sm font-bold text-[#9CAAB8]">Cancelar</button>
            <button onClick={submitWalkIn} className="min-h-11 rounded-2xl border border-[#25D366]/35 bg-[#25D366]/12 text-sm font-black text-[#BDF8D1]">Agregar walk-in</button>
          </div>
        </div>
      </MobileBottomSheet>

      <section className={`${activeBusinessType === "barbershop" ? "hidden lg:block" : ""} relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#16110D] p-3 shadow-[0_18px_48px_rgba(0,0,0,0.28)] sm:rounded-[2rem] sm:p-6`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(201,119,56,0.22),transparent_32%),radial-gradient(circle_at_88%_20%,rgba(240,194,120,0.14),transparent_30%)]" />
        <div className="relative flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#C97738]/25 bg-[#C97738]/10 px-2.5 py-1 text-[11px] font-bold text-[#FFD7AE] sm:px-3 sm:text-xs">
              {activeBusinessType === "barbershop" ? <Scissors className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
              {activeBusinessType === "barbershop" ? "BarberLine OS" : "Recepción dental"}
            </div>
            <h1 className="text-safe mt-3 text-2xl font-black tracking-tight text-white sm:mt-4 sm:text-4xl">
              {visibleBusinessName}
            </h1>
            <p className="mt-1 text-xs text-white/60 sm:mt-2 sm:text-sm">
              {fmtWeekday(new Date())}, {fmtDate(new Date())} · {appointments.length} citas · {newMessages} mensajes nuevos
            </p>
          </div>
          <div className={`${activeBusinessType === "barbershop" ? "grid-cols-3" : "grid-cols-4"} grid min-w-0 gap-2 sm:flex sm:flex-wrap sm:justify-end`}>
            <button onClick={() => navigate("/inbox")} className="ui-button-base border border-white/10 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]">
              <MessageCircle className="h-4 w-4" />
              Inbox
            </button>
            <button onClick={() => navigate("/agenda")} className="ui-button-base bg-[#C97738] text-[#160C06] hover:brightness-110">
              {activeBusinessType === "barbershop" ? <UserPlus className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
              {activeBusinessType === "barbershop" ? "Walk-in" : "Nueva cita"}
            </button>
            {activeBusinessType !== "barbershop" ? (
              <button onClick={() => navigate("/agenda")} className="ui-button-base border border-white/10 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]">
                <Calendar className="h-4 w-4" />
                Agenda
              </button>
            ) : null}
            <button onClick={() => navigate(activeBusinessType === "barbershop" ? "/settings?tab=integraciones" : "/leads")}
              className="relative ui-button-base border border-white/10 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]">
              {activeBusinessType === "barbershop" ? <Bell className="h-4 w-4" /> : <Users className="h-4 w-4" />}
              {activeBusinessType === "barbershop" ? "Alertas" : "Pacientes"}
              {alerts.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {alerts.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </section>

      {pendingCount > 0 ? (
        <button onClick={() => navigate("/agenda")}
          className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-[#C97738]/22 bg-[#C97738]/10 px-4 py-3 text-left transition hover:bg-[#C97738]/14">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F0C278] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#F0C278]" />
          </span>
          <span className="min-w-0 flex-1 text-sm text-[#FFE3BD]">
            {pendingCount} {pendingCount === 1 ? "cita pendiente" : "citas pendientes"} necesitan confirmación hoy.
          </span>
          <span className="shrink-0 text-xs font-bold text-[#F0C278]">Ver</span>
        </button>
      ) : null}

      <div className={`${activeBusinessType === "barbershop" ? "hidden lg:grid" : "grid"} grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4`}>
        <StatPill value={appointments.length} label="citas hoy" color="bg-white/[0.07] border border-white/10 text-white" />
        <StatPill value={confirmedCount} label="confirmadas" color="bg-emerald-400/10 border border-emerald-300/20 text-emerald-200" />
        <StatPill value={newMessages} label="mensajes" color="bg-[#C97738]/12 border border-[#C97738]/24 text-[#FFD7AE]" onClick={() => navigate("/inbox")} />
        <StatPill value={weekCount} label="esta semana" color="bg-white/[0.07] border border-white/10 text-white/80" onClick={() => navigate("/agenda")} />
      </div>

      <div className={activeBusinessType === "barbershop" ? "hidden lg:block" : ""}>
        <WeekCalendar weekAppts={weekAppts} selectedDate={selectedDate} onDayClick={setSelectedDate} docFilter={docFilter} />
      </div>

      <div className={`${activeBusinessType === "barbershop" ? "hidden lg:flex" : "flex"} min-w-0 items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-2`}>
        <button onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 86_400_000))} className="rounded-xl p-3 text-white/70 hover:bg-white/10">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <button onClick={() => setSelectedDate(new Date())} className="truncate text-sm font-black text-white hover:text-[#F0C278]">
            {fmtDate(selectedDate)}
          </button>
          {!isToday ? <button onClick={() => setSelectedDate(new Date())} className="ml-2 text-xs font-bold text-[#F0C278] hover:underline">Ir a hoy</button> : null}
        </div>
        <button onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 86_400_000))} className="rounded-xl p-3 text-white/70 hover:bg-white/10">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className={`${activeBusinessType === "barbershop" ? "hidden lg:flex" : "flex"} flex-wrap gap-2`}>
        {[{ key: "all", label: `Todos los ${vertical.providersLabel.toLowerCase()}` }, ...doctors.map(d => ({ key: d, label: d })), { key: "unassigned", label: "Sin asignar" }].map(({ key, label }) => (
          <button key={key} onClick={() => setDocFilter(key)}
            className={`min-h-10 max-w-full rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              docFilter === key
                ? "border-[#C97738]/45 bg-[#C97738]/14 text-[#FFD7AE]"
                : "border-white/10 text-white/45 hover:border-white/20 hover:text-white/75"
            }`}>
            <span className="block truncate">{label}</span>
          </button>
        ))}
      </div>

      {activeBusinessType === "barbershop" ? (
        <section className="hidden space-y-3 lg:block">
          <div className="flex min-w-0 items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-black text-white sm:text-lg">Barberos en turno</h2>
              <p className="text-xs text-white/45 sm:text-sm">Vista compartida para citas, walk-ins y ocupación.</p>
            </div>
            <span className="hidden shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/55 sm:inline-flex">
              <Users className="h-3.5 w-3.5" />
              {barberSections.length} activos
            </span>
          </div>
          {loading ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {[1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-[1.35rem] border border-white/10 bg-white/5" />)}
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {barberSections.map((barber) => (
                <BarberStatusCard
                  key={barber.name}
                  name={barber.name}
                  colorClass={barber.colorClass}
                  status={barber.status}
                  nextAppointment={barber.nextAppointment}
                  appointments={barber.appointments}
                  onBusy={() => setBarberStatusOverrides((prev) => ({ ...prev, [barber.name]: "Ocupado" }))}
                  onFree={() => setBarberStatusOverrides((prev) => ({ ...prev, [barber.name]: "Disponible" }))}
                  onWalkIn={() => navigate("/agenda?view=day&date=today")}
                  onMessage={(leadId) => navigate(leadId ? `/inbox/${leadId}` : "/inbox")}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className={`${activeBusinessType === "barbershop" ? "hidden lg:block" : ""} ui-card ui-card-pad`}>
        <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-black text-white">
              {isToday ? "Agenda de hoy" : `Agenda del ${fmtDate(selectedDate)}`}
            </h2>
            <p className="text-sm text-white/45">{confirmedCount} confirmadas · {pendingCount} pendientes</p>
          </div>
          <button type="button" onClick={() => navigate("/agenda")} className="ui-button-base min-h-10 border border-white/10 bg-white/[0.06] px-3 text-xs text-white/75 hover:bg-white/10">
            Ver agenda
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-white/40">Cargando...</div>
        ) : filteredAppts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] py-10 text-center">
            <Calendar className="mx-auto mb-3 h-10 w-10 text-white/15" />
            <p className="text-sm font-semibold text-white/70">{docFilter !== "all" ? "No hay citas para este filtro." : "Todavía no hay citas para hoy."}</p>
            {docFilter === "all" ? <p className="mt-1 text-xs text-white/45">Probá el flujo por WhatsApp o agregá una cita manual.</p> : null}
            <button onClick={() => navigate("/agenda")} className="mt-3 text-sm font-bold text-[#F0C278] hover:underline">Crear nueva cita</button>
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {filteredAppts.map((a) => (
              <BusinessAppointmentCard
                key={a.id}
                time={(a as any).appointment_time || fmtTime(apptISO(a))}
                client={a.patient_name || vertical.customerLabel}
                service={a.reason || a.title || vertical.serviceLabel}
                provider={a.provider_name || vertical.providerLabel}
                status={a.status}
                accentClass={barberAccent(a.provider_name || "Sin asignar", doctors.indexOf(a.provider_name || ""))}
                onMessage={a.lead_id ? () => navigate(`/inbox/${a.lead_id}`) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <div className={`${activeBusinessType === "barbershop" ? "hidden lg:flex" : "flex"} min-w-0 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3`}>
        <div className="flex min-w-0 items-center gap-2">
          <Clock3 className="h-4 w-4 shrink-0 text-white/30" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white/70">Mañana</p>
            <p className="truncate text-xs text-white/40">{tomorrowCount} citas programadas</p>
          </div>
        </div>
        <button onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 86_400_000))}
          className="ui-button-base min-h-10 border border-white/15 bg-white/5 px-3 text-xs text-white/70 hover:bg-white/10">
          <SendHorizonal className="h-3.5 w-3.5" /> Ver
        </button>
      </div>
    </div>
  );
}
