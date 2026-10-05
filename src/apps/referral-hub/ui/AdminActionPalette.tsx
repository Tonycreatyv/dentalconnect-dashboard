import { Building2, ClipboardList, Command, MessageCircle, Plus, Search, Settings, Tag, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import NewBusinessDrawer from "../negocios/NewBusinessDrawer";
import { getActiveNegociosDataSource } from "../negocios/dataSource";
import "./adminActionPalette.css";

const dataSource = getActiveNegociosDataSource();

type PaletteAction = {
  id: string;
  label: string;
  description: string;
  keywords: string;
  icon: typeof Search;
  run: () => void;
};

export default function AdminActionPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creatingPartner, setCreatingPartner] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function go(to: string) {
    setOpen(false);
    setQuery("");
    navigate(to);
  }

  const actions = useMemo<PaletteAction[]>(() => [
    {
      id: "find-client",
      label: "Buscar cliente",
      description: "Abrir Clientes para localizar una persona o caso.",
      keywords: "buscar cliente lead persona telefono",
      icon: Users,
      run: () => go("/clientes"),
    },
    {
      id: "create-partner",
      label: "Agregar partner",
      description: "Crear un aliado y después configurar servicios y acceso.",
      keywords: "crear agregar partner aliado clinica abogado negocio red",
      icon: Building2,
      run: () => { setOpen(false); setCreatingPartner(true); },
    },
    {
      id: "benefits",
      label: "Administrar beneficios y cupones",
      description: "Editar, activar o pausar beneficios existentes.",
      keywords: "crear beneficio cupon coupon promocion editar",
      icon: Tag,
      run: () => go("/negocios?view=cupones"),
    },
    {
      id: "operations",
      label: "Resolver casos",
      description: "Abrir la cola operativa para asignar o corregir casos.",
      keywords: "asignar caso sin responsable excepcion operacion",
      icon: ClipboardList,
      run: () => go("/operacion"),
    },
    {
      id: "messages",
      label: "Abrir mensajes",
      description: "Ir al workspace de conversaciones.",
      keywords: "mensajes whatsapp conversacion",
      icon: MessageCircle,
      run: () => go("/messages"),
    },
    {
      id: "network",
      label: "Administrar Red",
      description: "Partners, negocios, servicios aceptados y accesos.",
      keywords: "red partner negocio aliado servicio acceso",
      icon: Building2,
      run: () => go("/negocios"),
    },
    {
      id: "settings",
      label: "Configuración",
      description: "Organización, equipo e integraciones.",
      keywords: "configuracion settings equipo permisos",
      icon: Settings,
      run: () => go("/configuracion"),
    },
  ], [navigate]);

  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? actions.filter((action) => `${action.label} ${action.description} ${action.keywords}`.toLowerCase().includes(normalized))
    : actions;

  return (
    <>
      <button type="button" className="admin-action-fab" onClick={() => setOpen(true)} aria-label="Abrir acciones administrativas">
        <Plus size={20} />
        <span>Acción</span>
      </button>

      {open ? (
        <div className="admin-action-layer" role="dialog" aria-modal="true" aria-label="Acciones administrativas">
          <button type="button" className="admin-action-scrim" onClick={() => setOpen(false)} aria-label="Cerrar acciones" />
          <section className="admin-action-panel">
            <header className="admin-action-header">
              <div><span>Operator Mode</span><h2>¿Qué necesitas hacer?</h2></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={19} /></button>
            </header>

            <label className="admin-action-search">
              <Search size={18} />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar acción…" />
              <kbd>⌘K</kbd>
            </label>

            <div className="admin-action-list">
              {visible.map((action) => {
                const Icon = action.icon;
                return (
                  <button key={action.id} type="button" className="admin-action-item" onClick={action.run}>
                    <span className="admin-action-icon"><Icon size={18} /></span>
                    <span><strong>{action.label}</strong><small>{action.description}</small></span>
                  </button>
                );
              })}
              {visible.length === 0 ? <p className="admin-action-empty">No hay acciones que coincidan.</p> : null}
            </div>

            <footer className="admin-action-footer"><Command size={14} /> Acciones rápidas del administrador</footer>
          </section>
        </div>
      ) : null}

      {creatingPartner ? (
        <NewBusinessDrawer
          onClose={() => setCreatingPartner(false)}
          onCreate={async (input) => {
            const created = await dataSource.createBusiness(input);
            setCreatingPartner(false);
            setNotice(`${created.name} creado.`);
            navigate(`/negocios/negocio/${created.id}`);
          }}
        />
      ) : null}

      {notice ? <div className="admin-action-toast" role="status" onAnimationEnd={() => setNotice("")}>{notice}</div> : null}
    </>
  );
}
