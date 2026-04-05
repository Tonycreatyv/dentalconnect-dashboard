import { useEffect, useMemo, useState } from "react";
import { Send, Plus, RefreshCw, Trash2, MessageCircle } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Modal } from "../components/ui/Modal";
import { Toast, type ToastKind } from "../components/ui/Toast";
import { supabase } from "../lib/supabaseClient";
import { useClinic } from "../context/ClinicContext";

const DEFAULT_ORG = "clinic-demo";

type TemplateRow = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  header_text: string | null;
  body_text: string;
  footer_text: string | null;
  buttons: any;
  meta_template_id: string | null;
};

type OrgWhatsAppSettings = {
  whatsapp_enabled: boolean;
  whatsapp_phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
};

type CreateFormState = {
  name: string;
  category: "UTILITY" | "MARKETING";
  language: string;
  body_text: string;
  header_text: string;
  footer_text: string;
};

const DEFAULT_TEMPLATES: CreateFormState[] = [
  {
    name: "appointment_reminder",
    category: "UTILITY",
    language: "es",
    body_text: "Hola {{1}}, te recordamos tu cita de mañana en {{2}}:\n\n🦷 {{3}}\n📅 {{4}}\n🕐 {{5}}\n\n¿Nos confirmas que asistirás?",
    header_text: "",
    footer_text: "",
  },
  {
    name: "appointment_confirmation",
    category: "UTILITY",
    language: "es",
    body_text: "Hola {{1}}, tu cita ha sido confirmada:\n\n🦷 {{2}}\n📅 {{3}}\n🕐 {{4}}\n📍 {{5}}\n\n¡Te esperamos!",
    header_text: "",
    footer_text: "",
  },
  {
    name: "post_visit_followup",
    category: "UTILITY",
    language: "es",
    body_text: "Hola {{1}}, gracias por visitarnos en {{2}}. ¿Cómo te sentiste después del tratamiento? Si tienes alguna duda, estamos para ayudarte.",
    header_text: "",
    footer_text: "",
  },
];

const emptyForm = (): CreateFormState => ({
  name: "",
  category: "UTILITY",
  language: "es",
  body_text: "",
  header_text: "",
  footer_text: "",
});

function normalizeTemplateName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function renderStatusClasses(status: string) {
  const normalized = String(status ?? "").toUpperCase();
  if (normalized === "APPROVED") return "bg-emerald-500/10 text-emerald-400 border-emerald-400/20";
  if (normalized === "REJECTED") return "bg-rose-500/10 text-rose-400 border-rose-400/20";
  return "bg-amber-500/10 text-amber-400 border-amber-400/20";
}

export default function WhatsAppTemplates() {
  const { clinic, activeOrgId } = useClinic();
  const organizationId = activeOrgId ?? clinic?.organization_id ?? DEFAULT_ORG;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [settings, setSettings] = useState<OrgWhatsAppSettings>({
    whatsapp_enabled: false,
    whatsapp_phone_number_id: null,
    whatsapp_business_account_id: null,
  });
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [sendTestOpen, setSendTestOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateRow | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testValues, setTestValues] = useState("Juan Pérez|Clínica Dental|Limpieza dental|Lunes 24 de marzo|10:00 AM");
  const [form, setForm] = useState<CreateFormState>(emptyForm());

  const previewText = useMemo(() => {
    const fallbackValues = testValues.split("|").map((item) => item.trim());
    return form.body_text.replace(/\{\{(\d+)\}\}/g, (_, rawIndex) => fallbackValues[Number(rawIndex) - 1] ?? `valor ${rawIndex}`);
  }, [form.body_text, testValues]);

  async function loadPage() {
    setLoading(true);

    const settingsRes = await supabase
      .from("org_settings")
      .select("whatsapp_enabled, whatsapp_phone_number_id, whatsapp_business_account_id")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!settingsRes.error && settingsRes.data) {
      setSettings({
        whatsapp_enabled: Boolean(settingsRes.data.whatsapp_enabled),
        whatsapp_phone_number_id: settingsRes.data.whatsapp_phone_number_id ?? null,
        whatsapp_business_account_id: settingsRes.data.whatsapp_business_account_id ?? null,
      });
    }

    const { data, error } = await supabase.functions.invoke("whatsapp-manage-templates", {
      body: { action: "list", organization_id: organizationId },
    });

    if (error) {
      setToast({ kind: "error", message: error.message || "No se pudieron cargar las plantillas." });
    } else {
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadPage();
  }, [organizationId]);

  async function createTemplate(templateOverride?: CreateFormState) {
    const payload = templateOverride ?? form;
    if (!payload.name.trim() || !payload.body_text.trim()) {
      setToast({ kind: "error", message: "Nombre y cuerpo son obligatorios." });
      return;
    }

    setSaving(true);
    const bodyComponents = [
      payload.header_text.trim() ? { type: "HEADER", format: "TEXT", text: payload.header_text.trim() } : null,
      { type: "BODY", text: payload.body_text.trim() },
      payload.footer_text.trim() ? { type: "FOOTER", text: payload.footer_text.trim() } : null,
    ].filter(Boolean);

    const { data, error } = await supabase.functions.invoke("whatsapp-manage-templates", {
      body: {
        action: "create",
        organization_id: organizationId,
        template_data: {
          name: normalizeTemplateName(payload.name),
          language: payload.language,
          category: payload.category,
          components: bodyComponents,
        },
      },
    });

    setSaving(false);

    if (error || !data?.ok) {
      setToast({ kind: "error", message: data?.data?.error?.message || error?.message || "No se pudo crear la plantilla." });
      return;
    }

    setToast({ kind: "success", message: "Plantilla enviada a Meta para aprobación." });
    setCreateOpen(false);
    setForm(emptyForm());
    await loadPage();
  }

  async function seedDefaults() {
    setSaving(true);
    for (const template of DEFAULT_TEMPLATES) {
      // eslint-disable-next-line no-await-in-loop
      await createTemplate(template);
    }
    setSaving(false);
  }

  async function deleteTemplate(template: TemplateRow) {
    if (!window.confirm(`¿Eliminar la plantilla ${template.name}?`)) return;

    const { data, error } = await supabase.functions.invoke("whatsapp-manage-templates", {
      body: {
        action: "delete",
        organization_id: organizationId,
        name: template.name,
      },
    });

    if (error || data?.ok === false) {
      setToast({ kind: "error", message: "No se pudo eliminar la plantilla." });
      return;
    }

    setToast({ kind: "success", message: "Plantilla eliminada." });
    await loadPage();
  }

  async function sendTest() {
    if (!selectedTemplate || !testPhone.trim()) {
      setToast({ kind: "error", message: "Selecciona plantilla y número de prueba." });
      return;
    }

    setSaving(true);
    const values = testValues.split("|").map((item) => item.trim()).filter(Boolean);
    const components = values.length
      ? [{ type: "body", parameters: values.map((value) => ({ type: "text", text: value })) }]
      : [];

    const { data, error } = await supabase.functions.invoke("whatsapp-send-template", {
      body: {
        organization_id: organizationId,
        to_phone: testPhone.trim(),
        template_name: selectedTemplate.name,
        template_language: selectedTemplate.language || "es",
        components,
      },
    });

    setSaving(false);

    if (error || data?.error) {
      setToast({ kind: "error", message: data?.error?.message || data?.error || error?.message || "No se pudo enviar la prueba." });
      return;
    }

    setToast({ kind: "success", message: "Mensaje de prueba enviado." });
    setSendTestOpen(false);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Plantillas de WhatsApp"
        subtitle="Crea, revisa y prueba las plantillas requeridas por Meta para WhatsApp Business."
        showBackOnMobile
        backTo="/settings?tab=integraciones"
        action={(
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadPage()}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-xl bg-[#3CBDB9] px-4 py-2 text-sm font-semibold text-[#0B1117] hover:bg-[#35a9a5]"
            >
              Crear plantilla
            </button>
          </div>
        )}
      />

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Estado de WhatsApp</div>
            <div className="mt-1 text-sm text-white/50">
              {settings.whatsapp_enabled
                ? "WhatsApp está habilitado para esta organización."
                : "Todavía no hay credenciales de WhatsApp activas para esta clínica."}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-white/50">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Phone ID: {settings.whatsapp_phone_number_id ?? "sin configurar"}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">WABA: {settings.whatsapp_business_account_id ?? "sin configurar"}</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Plantillas recomendadas</div>
            <div className="mt-1 text-sm text-white/50">
              Appointment reminder, confirmation y post-visit follow-up para la demo de App Review.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void seedDefaults()}
            disabled={saving}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            Cargar plantillas predeterminadas
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/50">Cargando plantillas...</div>
        ) : templates.length ? templates.map((template) => (
          <div key={template.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-base font-semibold text-white">{template.name}</div>
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${renderStatusClasses(template.status)}`}>
                    {template.status}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                    {template.category}
                  </span>
                </div>
                <div className="text-sm text-white/50">Idioma: {template.language || "es"}</div>
                <div className="rounded-2xl border border-white/10 bg-[#0B1117] p-4 text-sm text-white/80 whitespace-pre-wrap">
                  {template.body_text}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTemplate(template);
                    setSendTestOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#3CBDB9] px-4 py-2 text-sm font-semibold text-[#0B1117] hover:bg-[#35a9a5]"
                >
                  <Send className="h-4 w-4" />
                  Send Test
                </button>
                <button
                  type="button"
                  onClick={() => void deleteTemplate(template)}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/20"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        )) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-white/30" />
            <div className="mt-4 text-base font-semibold text-white">No hay plantillas todavía</div>
            <div className="mt-2 text-sm text-white/50">Crea la primera plantilla o carga las predeterminadas para la re-submission de Meta.</div>
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        title="Crear plantilla"
        description="Define la plantilla tal como se enviará a WhatsApp Manager."
        onClose={() => setCreateOpen(false)}
        actions={(
          <>
            <button type="button" onClick={() => setCreateOpen(false)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10">
              Cancelar
            </button>
            <button type="button" onClick={() => void createTemplate()} disabled={saving} className="rounded-xl bg-[#3CBDB9] px-4 py-2 text-sm font-semibold text-[#0B1117] hover:bg-[#35a9a5] disabled:opacity-50">
              Crear
            </button>
          </>
        )}
      >
        <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm text-white/60">Template name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: normalizeTemplateName(e.target.value) }))}
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 outline-none focus:border-[#3CBDB9]"
                placeholder="appointment_reminder"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-white/60">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as CreateFormState["category"] }))}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white outline-none focus:border-[#3CBDB9]"
                >
                  <option value="UTILITY">UTILITY</option>
                  <option value="MARKETING">MARKETING</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-white/60">Language</label>
                <input
                  value={form.language}
                  onChange={(e) => setForm((prev) => ({ ...prev, language: e.target.value }))}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white outline-none focus:border-[#3CBDB9]"
                  placeholder="es"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-white/60">Header text</label>
              <input
                value={form.header_text}
                onChange={(e) => setForm((prev) => ({ ...prev, header_text: e.target.value }))}
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 outline-none focus:border-[#3CBDB9]"
                placeholder="Opcional"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-white/60">Body text</label>
              <textarea
                value={form.body_text}
                onChange={(e) => setForm((prev) => ({ ...prev, body_text: e.target.value }))}
                className="min-h-[180px] w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-[#3CBDB9]"
                placeholder="Hola {{1}}, tu cita está confirmada..."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-white/60">Footer text</label>
              <input
                value={form.footer_text}
                onChange={(e) => setForm((prev) => ({ ...prev, footer_text: e.target.value }))}
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 outline-none focus:border-[#3CBDB9]"
                placeholder="Opcional"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0B1117] p-4">
            <div className="text-sm font-semibold text-white">Preview</div>
            <div className="mt-3 rounded-2xl bg-white/5 p-4 text-sm text-white/80 whitespace-pre-wrap">
              {previewText || "Aquí verás la previsualización con los placeholders reemplazados."}
            </div>
            <div className="mt-3 text-xs text-white/40">
              Usa {"{{1}}, {{2}}, etc."} para variables dinámicas.
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={sendTestOpen}
        title="Send Test"
        description={`Envía la plantilla ${selectedTemplate?.name ?? ""} a un número de prueba.`}
        onClose={() => setSendTestOpen(false)}
        actions={(
          <>
            <button type="button" onClick={() => setSendTestOpen(false)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10">
              Cancelar
            </button>
            <button type="button" onClick={() => void sendTest()} disabled={saving} className="rounded-xl bg-[#3CBDB9] px-4 py-2 text-sm font-semibold text-[#0B1117] hover:bg-[#35a9a5] disabled:opacity-50">
              Enviar
            </button>
          </>
        )}
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-white/60">Número de prueba</label>
            <input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 outline-none focus:border-[#3CBDB9]"
              placeholder="50499999999"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-white/60">Valores para placeholders</label>
            <input
              value={testValues}
              onChange={(e) => setTestValues(e.target.value)}
              className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder-white/30 outline-none focus:border-[#3CBDB9]"
              placeholder="Juan|Clínica|Limpieza|Lunes|10:00 AM"
            />
            <div className="mt-1 text-xs text-white/40">Separa cada variable con {"|"} en el orden {"{{1}}, {{2}}, etc."}</div>
          </div>
        </div>
      </Modal>

      <Toast open={!!toast} kind={toast?.kind ?? "success"} message={toast?.message ?? ""} onClose={() => setToast(null)} />
    </div>
  );
}
