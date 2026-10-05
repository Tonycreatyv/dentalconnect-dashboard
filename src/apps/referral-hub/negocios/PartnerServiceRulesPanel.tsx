import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { SERVICE_LABELS, type LuisServiceId } from "../operations/luisCatalog";

const ORGANIZATION_ID = "luis-gabriel-referral-hub";

type ServiceOption = {
  id: string;
  name: string;
};

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

export default function PartnerServiceRulesPanel({ partnerId }: { partnerId: string }) {
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [rules, setRules] = useState<PartnerRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingServiceId, setSavingServiceId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const [serviceResult, ruleResult] = await Promise.all([
      supabase
        .from("referral_organization_services")
        .select("service_id,enabled")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("enabled", true),
      supabase
        .from("referral_partner_service_rules")
        .select("id,service_id,active,assignment_priority,partner_location_id,postal_codes,cities,languages,specialties,capacity_limit,acceptance_sla_minutes,starts_at,expires_at,workspace_config")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("partner_id", partnerId),
    ]);

    if (serviceResult.error) {
      setError(serviceResult.error.message);
      setLoading(false);
      return;
    }
    if (ruleResult.error) {
      setError(ruleResult.error.message);
      setLoading(false);
      return;
    }

    const serviceRows = (serviceResult.data ?? []) as Array<{ service_id: string; enabled: boolean }>;
    setServices(
      serviceRows
        .map((service) => ({
          id: service.service_id,
          name: SERVICE_LABELS[service.service_id as LuisServiceId] ?? service.service_id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    );
    setRules(((ruleResult.data ?? []) as Array<Partial<PartnerRule> & { id: string; service_id: string }>).map(normalizeRule));
    setLoading(false);
  }

  useEffect(() => { void load(); }, [partnerId]);

  const ruleByService = useMemo(() => new Map(rules.map((rule) => [rule.service_id, rule])), [rules]);

  async function saveRule(service: ServiceOption, patch: Partial<PartnerRule>) {
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
    const { data, error: rpcError } = await supabase.rpc("admin_save_referral_partner_service_rule", {
      p_organization_id: ORGANIZATION_ID,
      p_rule_id: current?.id ?? null,
      p_partner_id: partnerId,
      p_service_id: service.id,
      p_active: next.active,
      p_assignment_priority: next.assignment_priority,
      p_partner_location_id: next.partner_location_id,
      p_postal_codes: next.postal_codes,
      p_cities: next.cities,
      p_languages: next.languages,
      p_specialties: next.specialties,
      p_capacity_limit: next.capacity_limit,
      p_acceptance_sla_minutes: next.acceptance_sla_minutes,
      p_starts_at: next.starts_at,
      p_expires_at: next.expires_at,
      p_workspace_config: next.workspace_config,
    });
    setSavingServiceId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const saved = normalizeRule(data as Partial<PartnerRule> & { id: string; service_id: string });
    setRules((previous) => {
      const exists = previous.some((rule) => rule.service_id === service.id);
      return exists ? previous.map((rule) => rule.service_id === service.id ? saved : rule) : [...previous, saved];
    });
    setNotice(`${service.name}: ${saved.active ? "recibiendo solicitudes" : "pausado"}.`);
  }

  if (loading) {
    return <section className="hub-section"><h2>Servicios que puede recibir</h2><p className="hub-field-hint"><Loader2 size={14} /> Cargando reglas…</p></section>;
  }

  return (
    <section className="hub-section">
      <div className="hub-section-heading">
        <div>
          <h2>Servicios que puede recibir</h2>
          <p className="hub-field-hint">Controla qué tipos de leads pueden asignarse a este partner.</p>
        </div>
      </div>

      {error ? <p className="hub-account-error" role="alert"><AlertTriangle size={14} /> {error}</p> : null}
      {notice ? <p className="hub-account-success" role="status"><CheckCircle2 size={14} /> {notice}</p> : null}

      <div className="hub-list">
        {services.map((service) => {
          const rule = ruleByService.get(service.id);
          const enabled = Boolean(rule?.active);
          const saving = savingServiceId === service.id;
          return (
            <div className="hub-list-row" key={service.id}>
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
                  onChange={(event) => void saveRule(service, { active: event.target.checked })}
                />
              </label>
            </div>
          );
        })}
      </div>

      {services.length === 0 ? <p className="hub-field-hint">No hay servicios operativos configurados.</p> : null}

      <p className="hub-field-hint">Los cambios se guardan inmediatamente en las reglas reales de asignación del partner.</p>
    </section>
  );
}
