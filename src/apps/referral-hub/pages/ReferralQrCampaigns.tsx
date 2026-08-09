import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, QrCode, RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import { Link } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { REFERRAL_HUB_PUBLIC_URL } from "../config/product";
import { useReferralOrganization } from "../organizations/ReferralOrganizationContext";

type QrEntry = { public_code: string; entry_type: "general" | "service" | "campaign" | "location"; active: boolean; expires_at: string | null; attribution_label: string | null };
const labels: Record<QrEntry["entry_type"], string> = { general: "Menú general", service: "Servicio configurado", campaign: "Campaña específica", location: "Ubicación específica" };
export function referralQrPublicUrl(publicCode: string) { return `${REFERRAL_HUB_PUBLIC_URL.replace(/\/$/, "")}/q/${encodeURIComponent(publicCode)}`; }
function QrPreview({ value }: { value: string }) { const canvas = useRef<HTMLCanvasElement | null>(null); useEffect(() => { if (canvas.current) void QRCode.toCanvas(canvas.current, value, { width: 152, margin: 2, errorCorrectionLevel: "M", color: { dark: "#07111A", light: "#FFFFFF" } }); }, [value]); return <canvas className="rh-qr-canvas" ref={canvas} aria-label="Código QR para clientes" />; }

export default function ReferralQrCampaigns() {
  const { resolvedOrgId } = useReferralOrganization(); const [entries, setEntries] = useState<QrEntry[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = async () => { setLoading(true); setError(""); const result = await supabase.from("referral_qr_entries").select("public_code,entry_type,active,expires_at,attribution_label").eq("organization_id", resolvedOrgId).order("created_at", { ascending: false }); if (result.error) setError("No pudimos cargar los QR y campañas."); else setEntries((result.data ?? []) as QrEntry[]); setLoading(false); };
  useEffect(() => { if (resolvedOrgId) void load(); }, [resolvedOrgId]);
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); setNotice("Enlace copiado."); } catch { setNotice("No se pudo copiar el enlace."); } };
  return <main className="rh-services-page"><Link className="bolt-rh-back" to="/more"><ArrowLeft />Más</Link><header className="rh-services-header"><div><p className="rh-eyebrow">ENTRADAS PÚBLICAS</p><h1>QR y campañas</h1><p>Comparte enlaces estables sin exponer datos internos.</p></div><button type="button" className="rh-refresh" onClick={() => void load()} disabled={loading}><RefreshCw />Actualizar</button></header>{notice ? <p className="rh-service-alert" role="status">{notice}</p> : null}{error ? <p className="rh-service-alert" role="alert">{error}</p> : null}{loading ? <div className="rh-service-empty">Cargando QR y campañas…</div> : entries.length === 0 ? <div className="rh-service-empty">Aún no hay QR configurados para esta organización.</div> : <section className="rh-service-grid" aria-label="QR y campañas configurados">{entries.map((entry) => { const url = referralQrPublicUrl(entry.public_code); return <article className="rh-service-card" key={entry.public_code}><div className="rh-service-card-top"><span className="rh-service-icon"><QrCode /></span><div><p className="rh-eyebrow">{labels[entry.entry_type]}</p><h2>{entry.attribution_label || labels[entry.entry_type]}</h2><p>{entry.active ? "Activo" : "Pausado"}{entry.expires_at ? ` · vence ${entry.expires_at.slice(0, 10)}` : ""}</p></div></div><QrPreview value={url} /><div className="rh-service-controls"><button className="rh-front-button is-on" type="button" onClick={() => void copy(url)}><Copy />Copiar enlace</button><a className="rh-service-link" href={url} target="_blank" rel="noreferrer">Vista previa</a></div></article>; })}</section>}</main>;
}
