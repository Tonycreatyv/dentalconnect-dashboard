import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MobileEmptyState, MobileHeader } from "../../components/mobile/MobilePrimitives";
import { ReferralLeadCard } from "../../components/referral/ReferralLeadCard";
import { normalizeReferralStatus, REFERRAL_STATUSES } from "../../referral/status";
import { useReferralData } from "../../referral/useReferralData";
import type { ReferralStatus } from "../../referral/types";
import { ReferralConfigurationState, ReferralError, ReferralLoading } from "./ReferralHome";

export default function ReferralKanban() {
  const data = useReferralData(); const navigate = useNavigate(); const [stage, setStage] = useState<ReferralStatus>("new");
  const rows = useMemo(() => data.leads.filter((lead) => normalizeReferralStatus(lead.status) === stage), [data.leads, stage]);
  if (!data.isReferralMode || (!data.organizationId && !data.loading)) return <ReferralConfigurationState />;
  return <main className="referral-page"><MobileHeader eyebrow="Vista secundaria" title="Pipeline" subtitle="Avanza una etapa a la vez" /><div className="referral-stage-selector">{REFERRAL_STATUSES.map((item) => { const count = data.leads.filter((lead) => normalizeReferralStatus(lead.status) === item.value).length; return <button key={item.value} className={stage === item.value ? "active" : ""} onClick={() => setStage(item.value)}>{item.label}<span>{count}</span></button>; })}</div>{data.loading ? <ReferralLoading /> : data.error ? <ReferralError message={data.error} onRetry={() => void data.load()} /> : rows.length === 0 ? <MobileEmptyState title="Etapa vacía" description="No hay leads en este estado." /> : <div className="space-y-2.5">{rows.map((lead) => <ReferralLeadCard key={lead.id} lead={lead} service={lead.service_id ? data.services[lead.service_id] : undefined} onOpen={() => navigate(`/leads/${lead.id}`)} />)}</div>}</main>;
}
