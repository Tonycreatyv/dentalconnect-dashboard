import { CalendarDays, Car, ChevronRight, Clock3, FileText, Handshake, HeartPulse, MapPin, Scale, ShoppingBasket, Users } from "lucide-react";
import { MobileStatusPill } from "../mobile/MobilePrimitives";
import { isUrgent, leadLocation, leadName, leadSource, leadUrgency, normalizeReferralStatus, relativeAge, serviceName, statusLabel, statusTone } from "../../referral/status";
import type { ReferralLead, ReferralService } from "../../referral/types";

export function ReferralServiceIcon({ service, className = "h-5 w-5" }: { service?: ReferralService; className?: string }) {
  const name = serviceName(service).toLowerCase();
  const Icon = /accidente|auto|carro|veh[ií]culo/.test(name) ? Car
    : /inmigra|legal|abog/.test(name) ? Scale
    : /m[eé]dic|cl[ií]nic|salud/.test(name) ? HeartPulse
    : /super|grocery|comida|canasta|cup[oó]n/.test(name) ? ShoppingBasket
    : /evento|community|comunidad/.test(name) ? CalendarDays
    : /grupo|familia/.test(name) ? Users
    : /document|formulario/.test(name) ? FileText
    : Handshake;
  return <Icon className={className} aria-hidden="true" />;
}

export function ReferralLeadCard({ lead, service, onOpen }: { lead: ReferralLead; service?: ReferralService; onOpen: () => void }) {
  const location = leadLocation(lead);
  const source = leadSource(lead);
  const status = normalizeReferralStatus(lead.status);
  return (
    <button type="button" onClick={onOpen} className="referral-lead-card group w-full text-left">
      <div className="flex items-start gap-3.5">
        <div className="referral-service-icon"><ReferralServiceIcon service={service} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-bold tracking-[-0.015em] text-[#F4F7FA]">{leadName(lead)}</h3>
              <p className="mt-0.5 truncate text-xs text-[#8D9AA8]">{serviceName(service)}</p>
            </div>
            {isUrgent(lead) ? <span className="referral-urgency">{leadUrgency(lead) || "Urgente"}</span> : null}
          </div>
          {(location || source) ? (
            <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-[#748291]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{location || source}</span>
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-[#748291]"><Clock3 className="h-3 w-3" />{relativeAge(lead.created_at)}</div>
            <div className="flex items-center gap-2">
              <MobileStatusPill tone={statusTone[status]} className={`referral-status-pill referral-pill-${statusTone[status]}`}>{statusLabel(status)}</MobileStatusPill>
              <ChevronRight className="h-4 w-4 text-[#526170] transition duration-200 group-hover:translate-x-0.5 group-hover:text-[#5B8CFF]" />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
