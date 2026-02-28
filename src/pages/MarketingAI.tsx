import { useEffect, useMemo, useState } from "react";
import { Image, Sparkles } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";
import { SectionCard } from "../components/SectionCard";
import { EmptyState } from "../components/EmptyState";
import PageHeader from "../components/PageHeader";

const DEFAULT_ORG = "clinic-demo";

type BrandProfileRow = {
  id?: string;
  organization_id: string;
  tone: string | null;
  emojis: string[] | null;
  services: string[] | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  auto_reply_enabled: boolean | null;
  auto_reply_requires_review: boolean | null;
  auto_reply_daily_limit: number | null;
  style_preset: string | null;
};

type CampaignRow = {
  id: string;
  organization_id: string;
  prompt: string | null;
  tone: string | null;
  style_preset: string | null;
  status: string | null;
  created_at: string | null;
};

type PostItemRow = {
  id: string;
  campaign_id: string;
  platform: string | null;
  caption: string | null;
  hashtags: string[] | null;
  cta: string | null;
  image_url: string | null;
  image_prompt: string | null;
  scheduled_at: string | null;
  status: string | null;
};

const TONE_OPTIONS = [
  { value: "profesional", label: "Profesional" },
  { value: "cercano", label: "Cercano" },
  { value: "promocional", label: "Promocional" },
];

function buildCaption(day: number, objective: string, service: string, tone: string, city?: string) {
  const base =
    tone === "promocional"
      ? `Semana ${day}: ${service}. ${objective}.`
      : tone === "cercano"
      ? `Hoy cuidamos tu sonrisa con ${service}. ${objective}.`
      : `Agenda tu ${service} con nuestro equipo. ${objective}.`;

  const location = city ? ` Atención en ${city}.` : "";
  return `${base}${location}`.trim();
}

function buildHashtags(service: string, city?: string) {
  const tags = ["#Sonrisa", "#SaludDental", "#Citas", `#${service.replace(/\s+/g, "")}`];
  if (city) tags.push(`#${city.replace(/\s+/g, "")}`);
  return tags.slice(0, 6);
}

function makeImagePlaceholder(text: string) {
  const safe = text.slice(0, 42);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'>
  <defs>
    <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0%' stop-color='#EEF2FF'/>
      <stop offset='100%' stop-color='#E0EAFF'/>
    </linearGradient>
  </defs>
  <rect width='100%' height='100%' fill='url(#g)'/>
  <text x='50%' y='50%' fill='#1F2937' font-size='32' font-family='Arial' text-anchor='middle'>${safe}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default function MarketingAI() {
  const { clinic } = useClinic();
  const ORG = clinic?.organization_id ?? DEFAULT_ORG;

  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [items, setItems] = useState<PostItemRow[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<CampaignRow | null>(null);

  const [objective, setObjective] = useState("");
  const [tone, setTone] = useState("profesional");
  const [city, setCity] = useState("");
  const [services, setServices] = useState<string[]>(["Limpieza", "Valoración", "Ortodoncia"]);
  const [serviceInput, setServiceInput] = useState("");

  const [brandProfile, setBrandProfile] = useState<BrandProfileRow | null>(null);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const [autoReplyReview, setAutoReplyReview] = useState(false);
  const [autoReplyLimit, setAutoReplyLimit] = useState(30);

  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);

      const profileRes = await supabase
        .from("brand_profile")
        .select("organization_id, tone, emojis, services, city, phone, website, auto_reply_enabled, auto_reply_requires_review, auto_reply_daily_limit, style_preset")
        .eq("organization_id", ORG)
        .maybeSingle();

      if (!mounted) return;

      if (profileRes.data) {
        setBrandProfile(profileRes.data as any);
        setTone(profileRes.data.tone ?? "profesional");
        setCity(profileRes.data.city ?? "");
        setServices((profileRes.data.services as string[]) ?? services);
        setAutoReplyEnabled(profileRes.data.auto_reply_enabled ?? true);
        setAutoReplyReview(profileRes.data.auto_reply_requires_review ?? false);
        setAutoReplyLimit(profileRes.data.auto_reply_daily_limit ?? 30);
      }

      const campaignRes = await supabase
        .from("post_campaigns")
        .select("id, organization_id, prompt, tone, style_preset, status, created_at")
        .eq("organization_id", ORG)
        .order("created_at", { ascending: false })
        .limit(12);

      if (!mounted) return;

      setCampaigns((campaignRes.data as any) ?? []);
      const first = campaignRes.data?.[0] ?? null;
      setActiveCampaign(first);

      if (first) {
        const itemsRes = await supabase
          .from("post_items")
          .select("id, campaign_id, platform, caption, hashtags, cta, image_url, image_prompt, scheduled_at, status")
          .eq("campaign_id", first.id)
          .order("scheduled_at", { ascending: true });

        if (!mounted) return;
        setItems((itemsRes.data as any) ?? []);
      }

      setLoading(false);
    }

    load();
    return () => {
      mounted = false;
    };
  }, [ORG]);

  const activeItems = useMemo(() => {
    if (!activeCampaign) return [];
    return items.filter((item) => item.campaign_id === activeCampaign.id);
  }, [items, activeCampaign]);

  async function saveBrandProfile() {
    const payload = {
      organization_id: ORG,
      tone,
      services,
      city: city.trim() || null,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_requires_review: autoReplyReview,
      auto_reply_daily_limit: autoReplyLimit,
      style_preset: brandProfile?.style_preset ?? "studio",
    };

    const res = await supabase.from("brand_profile").upsert(payload, { onConflict: "organization_id" });
    if (!res.error) {
      setBrandProfile(payload as any);
    }
  }

  async function generateCampaign() {
    if (!objective.trim()) return;
    setGenerating(true);

    const campaignRes = await supabase.from("post_campaigns").insert({
      organization_id: ORG,
      prompt: objective.trim(),
      tone,
      style_preset: brandProfile?.style_preset ?? "studio",
      status: "draft",
    }).select("id, organization_id, prompt, tone, style_preset, status, created_at").maybeSingle();

    if (campaignRes.error || !campaignRes.data) {
      setGenerating(false);
      return;
    }

    const campaign = campaignRes.data as CampaignRow;
    const list = Array.from({ length: 7 }).map((_, i) => {
      const service = services[i % services.length] ?? "Limpieza";
      const caption = buildCaption(i + 1, objective.trim(), service, tone, city || undefined);
      return {
        campaign_id: campaign.id,
        platform: "instagram",
        caption,
        hashtags: buildHashtags(service, city || undefined),
        cta: "Reservá tu cita",
        image_prompt: `Fotografía clínica premium sobre ${service}`,
        scheduled_at: null,
        status: "draft",
      };
    });

    const itemsRes = await supabase.from("post_items").insert(list).select("id, campaign_id, platform, caption, hashtags, cta, image_url, image_prompt, scheduled_at, status");

    const nextCampaigns = [campaign, ...campaigns];
    setCampaigns(nextCampaigns);
    setActiveCampaign(campaign);
    setItems((itemsRes.data as any) ?? []);
    setObjective("");
    setGenerating(false);
  }

  async function updateItem(id: string, patch: Partial<PostItemRow>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    await supabase.from("post_items").update(patch).eq("id", id);
  }

  async function generateImages() {
    const updates = activeItems.map((item) => ({
      id: item.id,
      image_url: makeImagePlaceholder(item.caption ?? "DentalConnect"),
    }));

    setItems((prev) => prev.map((item) => {
      const match = updates.find((u) => u.id === item.id);
      return match ? { ...item, image_url: match.image_url } : item;
    }));

    await Promise.all(updates.map((u) => supabase.from("post_items").update({ image_url: u.image_url }).eq("id", u.id)));
  }

  function addService() {
    const trimmed = serviceInput.trim();
    if (!trimmed) return;
    setServices((prev) => Array.from(new Set([...prev, trimmed])));
    setServiceInput("");
  }

  return (
    <div className="space-y-6 min-w-0 overflow-x-hidden">
      <PageHeader
        title="Marketing IA"
        subtitle="Planificá tu semana con un flujo simple y activá publicaciones consistentes."
        showBackOnMobile
        backTo="/overview"
      />

      <div className="space-y-4">
        <SectionCard title="1. Objetivo" description="Definí qué querés lograr esta semana.">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-700">Objetivo</label>
              <input
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                className="mt-2 h-12 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
                placeholder="Ej: aumentar citas de limpieza"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-slate-700">Tono</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="mt-2 h-12 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                >
                  {TONE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Ciudad</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-2 h-12 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
                  placeholder="Ej: Tegucigalpa"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Servicios a destacar</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {services.map((service) => (
                  <span
                    key={service}
                    className="rounded-full border border-[#E5E7EB] bg-[#F4F5F7] px-3 py-1 text-xs text-slate-700"
                  >
                    {service}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={serviceInput}
                  onChange={(e) => setServiceInput(e.target.value)}
                  className="h-11 flex-1 rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                  placeholder="Agregar servicio"
                />
                <button
                  type="button"
                  onClick={addService}
                  className="rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] px-4 text-sm font-semibold text-slate-900 hover:bg-[#F4F5F7]"
                >
                  Agregar
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={generateCampaign}
              disabled={generating || !objective.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-[#F4F5F7] disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {generating ? "Generando…" : "Generar contenido"}
            </button>
          </div>
        </SectionCard>

        <SectionCard title="2. Contenido" description="Revisá y ajustá el texto de cada publicación.">
          {loading ? (
            <div className="text-sm text-slate-700">Cargando…</div>
          ) : activeItems.length === 0 ? (
            <EmptyState title="Sin contenido" message="Genera una campaña para ver las publicaciones." />
          ) : (
            <div className="space-y-4">
              {activeItems.map((item, idx) => (
                <div key={item.id} className="rounded-2xl border border-[#E5E7EB] bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">Día {idx + 1}</div>
                    <span className="text-xs text-slate-500">{item.platform ?? "instagram"}</span>
                  </div>
                  <textarea
                    value={item.caption ?? ""}
                    onChange={(e) => updateItem(item.id, { caption: e.target.value })}
                    className="mt-3 min-h-[110px] w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-300"
                  />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="3. Publicación" description="Elegí fecha y hora para cada publicación.">
          {activeItems.length === 0 ? (
            <EmptyState title="Sin programación" message="Genera contenido para programar publicaciones." />
          ) : (
            <div className="space-y-3">
              {activeItems.map((item, idx) => (
                <div key={item.id} className="rounded-2xl border border-[#E5E7EB] bg-white p-4">
                  <div className="text-sm font-semibold text-slate-900">Día {idx + 1}</div>
                  <input
                    type="datetime-local"
                    value={item.scheduled_at ? item.scheduled_at.slice(0, 16) : ""}
                    onChange={(e) => updateItem(item.id, { scheduled_at: e.target.value })}
                    className="mt-3 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-300"
                  />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="4. Vista previa" description="Cómo se verá tu publicación destacada.">
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <div className="h-48 w-full overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#F4F5F7] md:w-64">
              {activeItems[0]?.image_url ? (
                <img src={activeItems[0].image_url as string} alt="Preview" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">
                  Imagen pendiente
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-900">Texto principal</div>
              <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
                {activeItems[0]?.caption ?? "Generá contenido para ver la vista previa."}
              </div>
              {activeItems.length > 0 ? (
                <button
                  type="button"
                  onClick={generateImages}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-[#F4F5F7]"
                >
                  <Image className="h-4 w-4" />
                  Actualizar imagen
                </button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="5. Activar" description="Listo para comenzar con Marketing IA.">
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Respuestas en comentarios</div>
                <div className="text-xs text-slate-700">Respondé consultas frecuentes automáticamente.</div>
              </div>
              <button
                type="button"
                onClick={() => setAutoReplyEnabled((prev) => !prev)}
                className={`h-8 w-14 rounded-full border transition ${autoReplyEnabled ? "bg-blue-600 border-blue-600" : "border-[#E5E7EB] bg-[#F4F5F7]"}`}
              >
                <span
                  className={`block h-6 w-6 rounded-full bg-white transition ${autoReplyEnabled ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Revisión manual</div>
                <div className="text-xs text-slate-700">Aprobá respuestas antes de publicar.</div>
              </div>
              <button
                type="button"
                onClick={() => setAutoReplyReview((prev) => !prev)}
                className={`h-8 w-14 rounded-full border transition ${autoReplyReview ? "bg-blue-600 border-blue-600" : "border-[#E5E7EB] bg-[#F4F5F7]"}`}
              >
                <span
                  className={`block h-6 w-6 rounded-full bg-white transition ${autoReplyReview ? "translate-x-6" : "translate-x-1"}`}
                />
              </button>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Límite diario de respuestas</label>
              <input
                type="number"
                value={autoReplyLimit}
                onChange={(e) => setAutoReplyLimit(Number(e.target.value))}
                className="mt-2 h-11 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm text-slate-900 outline-none focus:border-blue-300"
              />
            </div>

            <button
              type="button"
              onClick={saveBrandProfile}
              className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Activar Marketing IA
            </button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
