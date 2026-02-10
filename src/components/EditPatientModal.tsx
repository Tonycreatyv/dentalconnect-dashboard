import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Props = {
  open: boolean;
  onClose: () => void;
  leadId: string;
  organizationId: string;
  initialPhone?: string | null;
  initialNote?: string | null;
  onSaved?: () => void;
};

export function EditPatientModal({
  open,
  onClose,
  leadId,
  organizationId,
  initialPhone,
  initialNote,
  onSaved,
}: Props) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    if (open) {
      setPhone(initialPhone ?? "");
      setNote(initialNote ?? "");
      setErr("");
    }
  }, [open, initialPhone, initialNote]);

  if (!open) return null;

  async function save() {
    if (!leadId || !organizationId) return;

    setSaving(true);
    setErr("");

    const upd = await supabase
      .from("leads")
      .update({
        phone: phone.trim() || null,
        note: note.trim() || null,
      })
      .eq("id", leadId)
      .eq("organization_id", organizationId);

    setSaving(false);

    if (upd.error) {
      setErr(upd.error.message);
      return;
    }

    onSaved?.();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0f14] p-5 shadow-2xl">
        <div className="text-lg font-semibold text-white">Editar paciente</div>
        <div className="mt-1 text-sm text-white/60">
          Actualiza teléfono o nota manualmente.
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <div className="text-sm text-white/70 mb-1">Teléfono</div>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-white/20"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+504 9999-8888"
            />
          </div>

          <div>
            <div className="text-sm text-white/70 mb-1">Nota</div>
            <textarea
              className="w-full min-h-[96px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-white/20"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej: prefiere mañanas, viene por blanqueamiento..."
            />
          </div>

          {err ? <div className="text-sm text-red-300">{err}</div> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white/80 hover:bg-white/10"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            className="rounded-xl bg-white px-4 py-2 font-semibold text-black hover:bg-white/90 disabled:opacity-50"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
