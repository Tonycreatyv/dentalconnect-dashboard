import { MessageCircle, Phone, SlidersHorizontal } from "lucide-react";

export function ReferralStickyActions({ primaryLabel, phone, onPrimary, onCall, onWhatsApp, onMore }: { primaryLabel: string; phone: string; onPrimary: () => void; onCall: () => void; onWhatsApp: () => void; onMore: () => void }) {
  return (
    <div className="referral-sticky-actions">
      <div className="grid grid-cols-[44px_44px_1fr_44px] gap-2">
        <button type="button" disabled={!phone} onClick={onCall} className="referral-action-icon" aria-label="Llamar"><Phone className="h-4 w-4" /></button>
        <button type="button" disabled={!phone} onClick={onWhatsApp} className="referral-action-icon" aria-label="WhatsApp"><MessageCircle className="h-4 w-4" /></button>
        <button type="button" onClick={onPrimary} className="referral-primary-button">{primaryLabel}</button>
        <button type="button" onClick={onMore} className="referral-action-icon" aria-label="Más acciones"><SlidersHorizontal className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
