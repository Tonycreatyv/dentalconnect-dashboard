import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

const DEFAULT_ORG = "clinic-demo";

type MetaPageOption = {
  id: string;
  name: string;
  access_token: string;
};

export default function MetaCallback() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<MetaPageOption[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>("");

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const code = params.get("code") ?? "";
  const stateRaw = params.get("state") ?? "";
  const stateOrg = stateRaw.startsWith("org:") ? stateRaw.slice(4) : DEFAULT_ORG;

  useEffect(() => {
    let mounted = true;

    async function runExchange() {
      if (!code) {
        setError("No se pudo completar la conexión con Meta.");
        setLoading(false);
        return;
      }

      const redirectUri = `${window.location.origin}/auth/meta/callback`;
      const res = await supabase.functions.invoke("meta-oauth", {
        body: {
          action: "exchange",
          code,
          redirect_uri: redirectUri,
          organization_id: stateOrg,
        },
      });

      if (!mounted) return;

      if (res.error || !res.data?.ok) {
        setError("No fue posible traer tus páginas de Facebook.");
        setLoading(false);
        return;
      }

      const nextPages = (res.data.pages as MetaPageOption[]) ?? [];
      setPages(nextPages);
      setSelectedPageId(nextPages[0]?.id ?? "");
      setLoading(false);
    }

    runExchange();
    return () => {
      mounted = false;
    };
  }, [code, stateOrg]);

  async function saveSelection() {
    const selected = pages.find((p) => p.id === selectedPageId);
    if (!selected) return;

    setSaving(true);
    setError(null);

    const res = await supabase.functions.invoke("meta-oauth", {
      body: {
        action: "save_page",
        organization_id: stateOrg,
        page_id: selected.id,
        page_name: selected.name,
        page_access_token: selected.access_token,
      },
    });

    setSaving(false);

    if (res.error || !res.data?.ok) {
      setError("No se pudo guardar la página seleccionada.");
      return;
    }

    navigate("/settings", { replace: true });
  }

  return (
    <div className="min-h-screen dc-bg">
      <div className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4 py-10">
        <div className="dc-card w-full p-6">
          <h1 className="text-xl font-semibold text-white/95">Conectar Messenger</h1>
          <p className="mt-2 text-sm text-white/72">
            Seleccioná la página de Facebook que querés usar para responder mensajes.
          </p>

          {loading ? <div className="mt-5 text-sm text-white/72">Cargando páginas…</div> : null}
          {error ? <div className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div> : null}

          {!loading && !error && pages.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/72">
              No encontramos páginas administrables en esta cuenta.
            </div>
          ) : null}

          {!loading && pages.length > 0 ? (
            <div className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-white/80">Página</label>
                <select
                  value={selectedPageId}
                  onChange={(e) => setSelectedPageId(e.target.value)}
                  className="dc-select mt-2"
                >
                  {pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/settings", { replace: true })}
                  className="dc-btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveSelection}
                  disabled={!selectedPageId || saving}
                  className="dc-btn-primary"
                >
                  {saving ? "Guardando…" : "Guardar conexión"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
