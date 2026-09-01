import { FlaskConical } from "lucide-react";

// Rendered on every screen in the /negocios tree while getActiveNegociosDataSource()
// resolves to the demo adapter (currently always, until the draft migration
// is applied and the Supabase adapter is wired in). Must never be silently
// dropped — this is what keeps demo data from being mistaken for real data.
export default function DemoBadge() {
  return (
    <span className="hub-demo-badge">
      <FlaskConical size={13} />
      Datos de ejemplo
    </span>
  );
}
