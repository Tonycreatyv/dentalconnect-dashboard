import { Pencil } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ContactDetailScreen } from "./DashboardScreens";
import CaseDetailScreen from "./CaseDetailScreen";
import "./adminDetailRoutes.css";

export function AdminClientDetailRoute() {
  const { leadId = "" } = useParams();
  return (
    <>
      <ContactDetailScreen />
      {leadId ? <Link className="hub-detail-edit-fab" to={`/clientes/${leadId}/editar`}><Pencil size={16} />Editar cliente</Link> : null}
    </>
  );
}

export function AdminCaseDetailRoute() {
  const { requestId = "" } = useParams();
  return (
    <>
      <CaseDetailScreen />
      {requestId ? <Link className="hub-detail-edit-fab" to={`/operacion/${requestId}/editar`}><Pencil size={16} />Editar caso</Link> : null}
    </>
  );
}
