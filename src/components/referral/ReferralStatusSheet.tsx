import { Check, X } from "lucide-react";
import { MobileBottomSheet } from "../mobile/MobilePrimitives";
import { normalizeReferralStatus, REFERRAL_STATUSES, statusTone } from "../../referral/status";
import type { ReferralStatus } from "../../referral/types";

export function ReferralStatusSheet({ open, current, busy, onClose, onSelect }: { open: boolean; current?: string | null; busy?: boolean; onClose: () => void; onSelect: (status: ReferralStatus) => void }) {
  const active = normalizeReferralStatus(current);
  return (
    <MobileBottomSheet open={open} className="referral-sheet">
      <div className="referral-sheet-handle" />
      <div className="flex items-center justify-between gap-3">
        <div><p className="referral-eyebrow">Estado del lead</p><h2 className="referral-sheet-title">¿Qué sigue ahora?</h2></div>
        <button type="button" onClick={onClose} className="referral-icon-button" aria-label="Cerrar"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-5 space-y-2">
        {REFERRAL_STATUSES.map((item) => (
          <button key={item.value} type="button" disabled={busy} onClick={() => onSelect(item.value)} className="referral-sheet-option">
            <span className={`referral-status-dot referral-status-${statusTone[item.value]}`} />
            <span className="flex-1 text-sm font-semibold text-[#EAF0F5]">{item.label}</span>
            {active === item.value ? <Check className="h-4 w-4 text-[#5B8CFF]" /> : null}
          </button>
        ))}
      </div>
    </MobileBottomSheet>
  );
}
