import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { SERVICE_LABELS, type LuisServiceId } from "../operations/luisCatalog";

const ORGANIZATION_ID = "luis-gabriel-referral-hub";

type ServiceOption = { id: string; name: string };
type PartnerRule = {
  id: string;
  service_id: string;
  active: boolean;
  assignment_priority: number;
  partner_location_id: string | null;
  postal_codes: string[];
  cities: string[];
  languages: string[];
  specialties: string[];
  capacity_limit: number | null;
  acceptance_sla_minutes: number;
  starts_at: string | null;
  expires_at: string | null;
  workspace_config: Record<string, unknown>;
};

type RuleDraft = {
  priority: string;
  capacity: string;
  sla: string;
  postalCodes: string;
  cities: string;
};

function normalizeRule(row: Partial<PartnerRule> & { id: string; service_id: string }): PartnerRule {
  return {
    id: row.id,
    service_id: row.service_id,
    active: row.active ?? true,
    assignment_priority: row.assignment_priority ?? 10,
    partner_location_id: row.partner_location_id ?? null,
    postal_codes: row.postal_codes ?? [],
    cities: row.cities ?? [],
    languages: row.languages ?? [],
    specialties: row.specialties ?? [],
    capacity_limit: row.capacity_limit ?? null,
    acceptance_sla_minutes: row.acceptance_sla_minutes ?? 120,
    starts_at: row.starts_at ?? null,
    expires_at: row.expires_at ?? null,
    workspace_config: row.workspace_config ?? {},
  };
}

function draftFromRule(rule?: PartnerRule): RuleDraft {
  return {
    priority: String(rule?.assignment_priority ?? 10),
    capacity: rule?.capacity_limit ? String(rule.capacity_limit) : "",
    sla: String(rule?.acceptance_sla_minutes ?? 120),
    postalCodes: (rule?.postal_codes ?? []).join(", "),
    cities: (rule?.cities ?? []).join(", "),
  };
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export default function PartnerServiceRulesPanel({ partnerId }: { partnerId: string }) {
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [rules, setRules] = useState<PartnerRule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingServiceId, setSavingServiceId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const [serviceResult, ruleResult] = await Promise.all([
      supabase.from("referral_organization_services")
        .select("service_id,enabled")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("enabled", true),
      supabase.from("referral_partner_service_rules")
        .select("id,service_id,active,assignment_priority,partner_location_id,postal_codes,cities,languages,specialties,capacity_limit,acceptance_sla_minutes,starts_at,expires_at,workspace_config")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("partner_id", partnerId),
    ]);

    if (serviceResult.error || ruleResult.error) {
      setError(serviceResult.error?.message || ruleResult.error?.message || "No se pudieron cargar las reglas.");
      setLoading(false);
      return;
    }

    const serviceRows = (serviceResult.data ?? []) as Array<{ service_id: string; enabled: boolean }>;
    const normalizedRules = ((ruleResult.data ?? []) as Array<Partial<PartnerRule> & { id: string; service_id: string }>).map(normalizeRule);
    const nextServices = serviceRows
      .map((service) => ({ id: service.service_id, name: SERVICE_LABELS[service.service_id as LuisServiceId] ?? service.service_id }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    setServices(nextServices);
    setRules(normalizedRules);
    setDrafts(Object.fromEntries(nextServices.map((service) => [service.id, draftFromRule(normalizedRules.find((rule) => rule.service_id === service.id))])));
    setLoading(false);
  }

  useEffect(() => { void load(); }, [partnerId]);

  const ruleByService = useMemo(() => new Map(rules.map((rule) => [rule.service_id, rule])), [rules]);

  async function saveRule(service: ServiceOption, patch: Partial<PartnerRule>, successMessage?: string) {
    const current = ruleByService.get(service.id);
    const next: PartnerRule = {
      id: current?.id ?? "",
      service_id: service.id,
      active: current?.active ?? false,
      assignment_priority: current?.assignment_priority ?? 10,
      partner_location_id: current?.partner_location_id ?? null,
      postal_codes: current?.postal_codes ?? [],
      cities: current?.cities ?? [],
      languages: current?.languages ?? [],
      specialties: current?.specialties ?? [],
      capacity_limit: current?.capacity_limit ?? null,
      acceptance_sla_minutes: current?.acceptance_sla_minutes ?? 120,
      starts_at: current?.starts_at ?? null,
      expires_at: current?.expires_at ?? null,
      workspace_config: current?.workspace_config ?? {},
      ...patch,
    };

    setSavingServiceId(service.id);
    setError("");
    setNotice("");
    const result = await supabase.functions.invoke("admin-partner-routing", {
      body: {
        organization_id: ORGANIZATION_ID,
        partner_id: partnerId,
        service_id: service.id,
        rule_id: current?.id ?? null,
        active: next.active,
        assignment_priority: next.assignment_priority,
        postal_codes: next.postal_codes,
        cities: next.cities,
        languages: next.languages,
        specialties: next.specialties,
        capacity_limit: next.capacity_limit,
        acceptance_sla_minutes: next.acceptance_sla_minutes,
      },
    });
    setSavingServiceId(null);

    const payload = result.data as { success?: boolean; rule?: PartnerRule; error?: string } | null;
    if (result.error || !payload?.success || !payload.rule) {
      setError(result.error?.message || payload?.error || "No se pudo guardar la configuración.");
      return;
    }

    const saved = normalizeRule(payload.rule);
    setRules((previous) => previous.some((rule) => rule.service_id === service.id)
      ? previous.map((rule) => rule.service_id === service.id ? saved : rule)
      : [...previous, saved]);
    setDrafts((previous) => ({ ...previous, [service.id]: draftFromRule(saved) }));
    setNotice(successMessage ?? `${service.name}: configuración actualizada.`);
  }

  async function saveAdvanced(service: ServiceOption) {
    const draft = drafts[service.id] ?? draftFromRule(ruleByService.get(service.id));
    const priority = Number(draft.priority);
    const capacity = draft.capacity.trim() ? Number(draft.capacity) : null;
    const sla = Number(draft.sla);
    const zips = splitList(draft.postalCodes);
    const invalidZip = zips.find((zip) => !/^\d{5}$/.test(zip));

    if (!Number.isInteger(priority) || priority < 0) { setError("La prioridad debe ser un número entero de 0 o más."); return; }
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) { setError("La capacidad debe ser un entero mayor que 0 o quedar vacía."); return; }
    if (!Number.isInteger(sla) || sla < 1) { setError("El SLA debe ser de al menos 1 minuto."); return; }
    if (invalidZip) { setError(`ZIP inválido: ${invalidZip}. Usa códigos de 5 dígitos.`); return; }

    await saveRule(service, {
      assignment_priority: priority,
      capacity_limit: capacity,
      acceptance_sla_minutes: sla,
      postal_codes: zips,
      cities: splitList(draft.cities),
    });
  }

  if (loading) {
    return <section className="hub-section"><h2>Servicios que puede recibir</h2><p className="hub-field-hint"><Loader2 size={14} /> Cargando reglas…</p></section>;
  }

  return (
    <section className="hub-section">
      <div className="hub-section-heading">
        <div>
          <h2>Servicios que puede recibir</h2>
          <p className="hub-field-hint">Controla qué tipos de leads recibe este partner y bajo qué condiciones.</p>
        </div>
      </div>

      {error ? <p className="hub-account-error" role="alert"><AlertTriangle size={14} /> {error}</p> : null}
      {notice ? <p className="hub-account-success" role="status"><CheckCircle2 size={14} /> {notice}</p> : null}

      <div className="hub-list">
        {services.map((service) => {
          const rule = ruleByService.get(service.id);
          const enabled = Boolean(rule?.active);
          const saving = savingServiceId === service.id;
          const draft = drafts[service.id] ?? draftFromRule(rule);
          return (
            <div className="hub-list-row" key={service.id} style={{ alignItems: "stretch", flexDirection: "column", gap: ".65rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".8rem" }}>
                <div>
                  <strong>{service.name}</strong>
                  <small>{enabled ? "Puede recibir nuevos leads" : "No recibe nuevos leads"}</small>
                </div>
                <label className="hub-delivery-toggle" style={{ margin: 0 }}>
                  <span className="sr-only">{service.name}</span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={saving}
                    onChange={(event) => void saveRule(service, { active: event.target.checked }, `${service.name}: ${event.target.checked ? "activado" : "pausado"}.`)}
                  />
                </label>
              </div>

              <details>
                <summary className="hub-chip-btn" style={{ width: "fit-content", cursor: "pointer" }}>
                  <ChevronDown size={14} /> Configurar routing
                </summary>
                <div className="hub-field-group" style={{ marginTop: ".7rem" }}>
                  <div className="hub-field">
                    <label>Prioridad</label>
                    <input inputMode="numeric" value={draft.priority} onChange={(e) => setDrafts((prev) => ({ ...prev, [service.id]: { ...draft, priority: e.target.value } }))} />
                    <p className="hub-field-hint">Menor número = mayor prioridad.</p>
                  </div>
                  <div className="hub-field">
                    <label>Capacidad de casos activos</label>
                    <input inputMode="numeric" placeholder="Sin límite" value={draft.capacity} onChange={(e) => setDrafts((prev) => ({ ...prev, [service.id]: { ...draft, capacity: e.target.value } }))} />
                  </div>
                  <div className="hub-field">
                    <label>SLA de aceptación (minutos)</label>
                    <input inputMode="numeric" value={draft.sla} onChange={(e) => setDrafts((prev) => ({ ...prev, [service.id]: { ...draft, sla: e.target.value } }))} />
                  </div>
                  <div className="hub-field">
                    <label>ZIPs permitidos</label>
                    <input placeholder="30071, 30341" value={draft.postalCodes} onChange={(e) => setDrafts((prev) => ({ ...prev, [service.id]: { ...draft, postalCodes: e.target.value } }))} />
                    <p className="hub-field-hint">Vacío = sin restricción por ZIP.</p>
                  </div>
                  <div className="hub-field">
                    <label>Ciudades permitidas</label>
                    <input placeholder="Atlanta, Norcross" value={draft.cities} onChange={(e) => setDrafts((prev) => ({ ...prev, [service.id]: { ...draft, cities: e.target.value } }))} />
                    <p className="hub-field-hint">Vacío = sin restricción por ciudad.</p>
                  </div>
                </div>
                <button type="button" className="hub-primary" disabled={saving} onClick={() => void saveAdvanced(service)}>
                  <Save size={14} /> {saving ? "Guardando…" : "Guardar routing"}
                </button>
              </details>
            </div>
          );
        })}
      </div>

      {services.length === 0 ? <p className="hub-field-hint">No hay servicios operativos configurados.</p> : null}
      <p className="hub-field-hint">Cada cambio se guarda en las reglas reales del partner y queda registrado en el historial operativo.</p>
    </section>
  );
}
