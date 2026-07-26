import { Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MobileEmptyState, MobileFilterChips, MobileHeader } from "../../components/mobile/MobilePrimitives";
import { ReferralLeadCard } from "../../components/referral/ReferralLeadCard";
import { isUrgent, leadName, normalizeReferralStatus, serviceName } from "../../referral/status";
import { useReferralData } from "../../referral/useReferralData";
import { ReferralConfigurationState, ReferralError, ReferralLoading } from "./ReferralHome";

export default function ReferralLeads() {
  const navigate = useNavigate(); const data = useReferralData();
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState("all");
  const filtered = useMemo(() => data.leads.filter((lead) => {
    if (filter === "new" && normalizeReferralStatus(lead.status) !== "new") return false;
    if (filter === "urgent" && !isUrgent(lead)) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [leadName(lead), serviceName(lead.service_id ? data.services[lead.service_id] : undefined)].some((value) => value.toLowerCase().includes(needle));
  }), [data.leads, data.services, filter, query]);
  if (!data.isReferralMode || (!data.organizationId && !data.loading)) return <ReferralConfigurationState />;
  return <main className="referral-page"><MobileHeader eyebrow="Operación" title="Leads" subtitle={`${data.leads.length} solicitudes`} />
    <label className="referral-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o servicio" /></label>
    <MobileFilterChips items={[{ value: "all", label: "Todos" }, { value: "new", label: "Nuevos" }, { value: "urgent", label: "Urgentes" }]} value={filter} onChange={setFilter} />
    {data.loading ? <ReferralLoading /> : data.error ? <ReferralError message={data.error} onRetry={() => void data.load()} /> : filtered.length === 0 ? <MobileEmptyState icon={Users} title="No hay leads aquí" description="Prueba otro filtro o búsqueda." /> : <div className="space-y-2.5">{filtered.map((lead) => <ReferralLeadCard key={lead.id} lead={lead} service={lead.service_id ? data.services[lead.service_id] : undefined} onOpen={() => navigate(`/leads/${lead.id}`)} />)}</div>}
  </main>;
}
