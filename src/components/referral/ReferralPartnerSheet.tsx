import { Check, Loader2, X } from "lucide-react";
import { MobileBottomSheet } from "../mobile/MobilePrimitives";
import { publicPartnerName, serviceName } from "../../referral/status";
import type { ReferralPartner, ReferralService } from "../../referral/types";

export function ReferralPartnerSheet({ open, partners, service, selectedId, busy, onClose, onConfirm }: { open: boolean; partners: ReferralPartner[]; service?: ReferralService; selectedId?: string | null; busy?: boolean; onClose: () => void; onConfirm: (partnerId: string) => void }) {
  return (
    <MobileBottomSheet open={open} className="referral-sheet">
      <div className="referral-sheet-handle" />
      <div className="flex items-center justify-between gap-3">
        <div><p className="referral-eyebrow">Lead calificado</p><h2 className="referral-sheet-title">Seleccionar aliado</h2></div>
        <button type="button" onClick={onClose} className="referral-icon-button" aria-label="Cerrar"><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-2 text-xs text-[#7E8C99]">Aliados compatibles con {serviceName(service)}.</p>
      <div className="mt-5 space-y-2">
        {partners.length === 0 ? <div className="referral-empty-compact">No hay aliados configurados para este servicio.</div> : partners.map((partner) => (
          <button key={partner.id} type="button" disabled={busy} onClick={() => onConfirm(partner.id)} className="referral-sheet-option min-h-[58px]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#5B8CFF]/10 text-sm font-black text-[#9CB6FF]">{publicPartnerName(partner.nombre).slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#EAF0F5]">{publicPartnerName(partner.nombre)}</span><span className="mt-0.5 block text-[11px] text-[#748291]">Compatible con este servicio</span></span>
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-[#5B8CFF]" /> : selectedId === partner.id ? <Check className="h-4 w-4 text-[#5B8CFF]" /> : null}
          </button>
        ))}
      </div>
    </MobileBottomSheet>
  );
}
