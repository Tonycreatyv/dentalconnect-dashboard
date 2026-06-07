import { Scissors, Unlock, UserPlus } from "lucide-react";
import { AppointmentCard } from "./AppointmentCard";
import { cn } from "../lib/cn";

export type BarberAppointment = {
  id: string;
  time: string;
  client: string;
  service: string;
  provider: string;
  status?: string | null;
  leadId?: string | null;
};

export function BarberStatusCard({
  name,
  colorClass,
  status,
  nextAppointment,
  appointments,
  onBusy,
  onFree,
  onWalkIn,
  onMessage,
}: {
  name: string;
  colorClass: string;
  status: "Disponible" | "Ocupado" | "En corte";
  nextAppointment?: BarberAppointment | null;
  appointments: BarberAppointment[];
  onBusy?: () => void;
  onFree?: () => void;
  onWalkIn?: () => void;
  onMessage?: (leadId: string | null | undefined) => void;
}) {
  const statusClass =
    status === "Disponible"
      ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200"
      : status === "En corte"
      ? "border-[#18C37E]/30 bg-[#18C37E]/10 text-[#BDF8D1]"
      : "border-amber-300/25 bg-amber-400/10 text-amber-200";

  return (
    <section className="ui-card ui-card-pad min-w-0 overflow-hidden">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-black text-[#160C06]", colorClass)}>
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-black text-white">{name}</h3>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold", statusClass)}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {status}
              </span>
              <span className="text-xs text-white/40">{appointments.length} cita(s) hoy</span>
            </div>
          </div>
        </div>
        <Scissors className="h-5 w-5 shrink-0 text-white/25" />
      </div>

      <div className="mt-4 rounded-2xl border border-white/8 bg-black/18 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-white/35">Siguiente</div>
        <div className="mt-1 text-safe text-sm font-semibold text-white/80">
          {nextAppointment ? `${nextAppointment.time} · ${nextAppointment.client} · ${nextAppointment.service}` : "Sin próxima cita"}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onBusy} className="ui-button-base min-h-10 flex-1 border border-amber-300/20 bg-amber-400/10 px-3 text-xs text-amber-100 hover:bg-amber-400/16">
          <Scissors className="h-3.5 w-3.5" />
          Marcar ocupado
        </button>
        <button type="button" onClick={onWalkIn} className="ui-button-base min-h-10 flex-1 border border-white/10 bg-white/[0.06] px-3 text-xs text-white/80 hover:bg-white/10">
          <UserPlus className="h-3.5 w-3.5" />
          Agregar walk-in
        </button>
        <button type="button" onClick={onFree} className="ui-button-base min-h-10 flex-1 border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs text-emerald-100 hover:bg-emerald-400/16">
          <Unlock className="h-3.5 w-3.5" />
          Liberar
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {appointments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-center text-sm text-white/45">
            Agenda libre por ahora.
          </div>
        ) : (
          appointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              time={appointment.time}
              client={appointment.client}
              service={appointment.service}
              provider={appointment.provider}
              status={appointment.status}
              accentClass={colorClass}
              compact
              onMessage={appointment.leadId ? () => onMessage?.(appointment.leadId) : undefined}
            />
          ))
        )}
      </div>
    </section>
  );
}
