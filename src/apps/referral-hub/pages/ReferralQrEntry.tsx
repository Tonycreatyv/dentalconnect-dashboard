import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";

type Resolution = { available: boolean; title?: string; whatsapp_url?: string };

function safeWhatsAppUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "wa.me" ? url.toString() : null;
  } catch { return null; }
}

export default function ReferralQrEntry() {
  const { publicCode = "" } = useParams();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    void supabase.functions.invoke("referral-qr-resolve", { body: { public_code: publicCode } })
      .then(({ data, error }) => { if (current) setResolution(!error && data?.available ? data as Resolution : { available: false }); })
      .catch(() => { if (current) setResolution({ available: false }); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [publicCode]);
  const whatsappUrl = safeWhatsAppUrl(resolution?.whatsapp_url);
  useEffect(() => {
    if (!whatsappUrl) return;
    const timer = window.setTimeout(() => window.location.assign(whatsappUrl), 80);
    return () => window.clearTimeout(timer);
  }, [whatsappUrl]);
  if (loading) return <main className="coupon-public"><section className="coupon-card"><p className="coupon-eyebrow">Conexxion · LG Community Network</p><h1>Abriendo WhatsApp…</h1></section></main>;
  if (!resolution?.available || !whatsappUrl) return <main className="coupon-public"><section className="coupon-card" role="status"><p className="coupon-eyebrow">Conexxion · LG Community Network</p><h1>Este código no está disponible</h1><p className="coupon-notice">Puede haber vencido o estar pausado. Pide un enlace actualizado a la organización.</p></section></main>;
  return <main className="coupon-public"><section className="coupon-card"><p className="coupon-eyebrow">Conexxion · {resolution.title || "LG Community Network"}</p><h1>Abriendo WhatsApp…</h1><p className="coupon-notice">Si WhatsApp no se abre automáticamente, continúa con el botón.</p><a className="coupon-primary" href={whatsappUrl}>Abrir WhatsApp</a></section></main>;
}
