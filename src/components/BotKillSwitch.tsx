import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Props = {
  orgId: string;
};

export function BotKillSwitch({ orgId }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    supabase
      .from("org_settings")
      .select("bot_enabled")
      .eq("organization_id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        setEnabled(data?.bot_enabled !== false);
      });
  }, [orgId]);

  async function toggle() {
    if (saving || enabled === null) return;
    const next = !enabled;
    setSaving(true);
    setPulse(true);
    setTimeout(() => setPulse(false), 600);

    await supabase
      .from("org_settings")
      .update({ bot_enabled: next })
      .eq("organization_id", orgId);

    setEnabled(next);
    setSaving(false);
  }

  if (enabled === null) return null;

  return (
    <div className="relative flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <div className="relative flex items-center justify-center">
          <span className={["h-3 w-3 rounded-full transition-colors duration-500", enabled ? "bg-[#59E0B8]" : "bg-white/20"].join(" ")} />
          {enabled && <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-[#59E0B8] opacity-40" />}
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-tight">Bot de respuestas automáticas</p>
          <p className="text-xs text-white/40 mt-0.5">
            {enabled ? "Respondiendo mensajes automáticamente" : "Bot pausado — responde tú manualmente"}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        aria-label={enabled ? "Apagar bot" : "Encender bot"}
        className={["relative flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border transition-all duration-300", enabled ? "border-[#3CBDB9]/60 bg-[#3CBDB9]/20" : "border-white/10 bg-white/5", pulse ? "scale-95" : "scale-100", saving ? "opacity-60 cursor-not-allowed" : ""].join(" ")}
      >
        {enabled && <span className="absolute inset-0 rounded-full bg-[#59E0B8]/10 blur-sm" />}
        <span className={["relative z-10 ml-1 h-6 w-6 rounded-full shadow-lg transition-all duration-300", enabled ? "translate-x-6 bg-[#59E0B8] shadow-[0_0_10px_rgba(89,224,184,0.5)]" : "translate-x-0 bg-white/50"].join(" ")} />
      </button>
    </div>
  );
}
