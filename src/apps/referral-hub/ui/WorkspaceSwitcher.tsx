import { BriefcaseBusiness, ChevronDown, Gift, X } from "lucide-react";
import { useState } from "react";
import "./workspaceSwitcher.css";

export type WorkspaceId = "referrals" | "benefits";

const WORKSPACES = {
  referrals: {
    label: "Referrals",
    description: "Casos, intake, partners y seguimiento",
    icon: BriefcaseBusiness,
  },
  benefits: {
    label: "Benefits",
    description: "Cupones, entregas, ubicaciones y negocios",
    icon: Gift,
  },
} as const;

type Props = {
  value: WorkspaceId;
  onChange: (value: WorkspaceId) => void;
};

export default function WorkspaceSwitcher({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const active = WORKSPACES[value];
  const ActiveIcon = active.icon;

  return (
    <>
      <button type="button" className="workspace-switcher-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <ActiveIcon size={16} />
        <span>{active.label}</span>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="workspace-switcher-layer" role="dialog" aria-modal="true" aria-label="Cambiar workspace">
          <button className="workspace-switcher-scrim" type="button" onClick={() => setOpen(false)} aria-label="Cerrar" />
          <section className="workspace-switcher-panel">
            <header>
              <div><small>ConeXXion</small><h2>Cambiar workspace</h2></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={20} /></button>
            </header>
            <div className="workspace-switcher-options">
              {(Object.keys(WORKSPACES) as WorkspaceId[]).map((id) => {
                const item = WORKSPACES[id];
                const Icon = item.icon;
                const selected = id === value;
                return (
                  <button key={id} type="button" className={selected ? "is-selected" : ""} onClick={() => { onChange(id); setOpen(false); }}>
                    <span className="workspace-switcher-icon"><Icon size={20} /></span>
                    <span><strong>{item.label}</strong><small>{item.description}</small></span>
                    <span className="workspace-switcher-check">{selected ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
