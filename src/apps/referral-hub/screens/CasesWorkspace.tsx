import { Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { relativeAge } from "../../../referral/status";
import { legalOpportunityPresentation } from "../operations/legalOpportunities";
import { useLegalOpportunities } from "../operations/useImmigrationInbox";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { SkeletonRows } from "../ui/Skeleton";
import StatusBadge from "../ui/StatusBadge";
import "./casesWorkspace.css";

const SERVICE_OPTIONS = [
  ["all", "Todos los servicios"],
  ["luis_accidente", "Accidente"],
  ["luis_inmigracion", "Inmigración"],
  ["luis_dui_criminal", "DUI / Criminal"],
] as const;

function statusTone(status: string) {
  if (/cerrad|convert/i.test(status)) return "success" as const;
  if (/sin aliado|rechaz|error|espera/i.test(status)) return "danger" as const;
  return "warning" as const;
}

export default function CasesWorkspace() {
  const data = useLegalOpportunities();
  const [query, setQuery] = useState("");
  const [service, setService] = useState("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...data.requests]
      .filter((item) => service === "all" || item.serviceId === service)
      .filter((item) => {
        if (!q) return true;
        const presentation = legalOpportunityPresentation(item.serviceId, item.intake, item.topic);
        return [item.leadName, item.postalCode, item.assignment?.partnerName, presentation.serviceLabel, item.operationalStatus]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [data.requests, query, service]);

  if (data.loading) return <div className="hub-page hub-page--wide"><SkeletonRows count={7} /></div>;
  if (data.error) return <div className="hub-page hub-page--wide"><EmptyState tone="error" title="No se pudieron cargar los casos" description={data.error} /></div>;

  return (
    <div className="hub-page hub-page--wide cases-workspace">
      <PageHeader eyebrow="Referrals" title="Casos" subtitle="Todos los intakes que requieren seguimiento, asignación o cierre." meta={<span className="hub-page-count">{rows.length} casos</span>} />

      <section className="cases-workspace-toolbar" aria-label="Filtros de casos">
        <label className="cases-search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nombre, ZIP, partner…" /></label>
        <label className="cases-service"><SlidersHorizontal size={17} /><select value={service} onChange={(e) => setService(e.target.value)}>{SERVICE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </section>

      {rows.length === 0 ? <EmptyState title="No hay casos con estos filtros" /> : (
        <div className="cases-list">
          {rows.map((item) => {
            const presentation = legalOpportunityPresentation(item.serviceId, item.intake, item.topic);
            return (
              <Link key={item.id} to={`/operacion/${item.id}`} className="cases-row">
                <div className="cases-row-main"><strong>{item.leadName}</strong><span>{presentation.serviceLabel || item.serviceId}{item.postalCode ? ` · ZIP ${item.postalCode}` : ""}</span></div>
                <div className="cases-row-owner"><span>{item.assignment?.partnerName || "Sin responsable"}</span><small>Recibido {relativeAge(item.createdAt)}</small></div>
                <StatusBadge tone={statusTone(item.operationalStatus)} label={item.operationalStatus} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
