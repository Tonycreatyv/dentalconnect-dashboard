import { type RefObject } from "react";
import { insertTokenAtCursor, STARTER_TEMPLATES, TOKEN_CHIPS } from "./tokenDisplay";

// "Insertar dato" toolbar (Task 4): clickable chips insert a readable
// token ("[Nombre del cliente]") at the textarea cursor. The caller stores
// the display text as-is; conversion to the canonical {{...}} contract
// happens only at save/preview time (see tokenDisplay.ts).
export default function TokenToolbar({ textareaRef, value, onChange }: {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (next: string) => void;
}) {
  function insertChip(chipId: string) {
    const chip = TOKEN_CHIPS.find((c) => c.id === chipId);
    const el = textareaRef.current;
    if (!chip) return;
    const selectionStart = el?.selectionStart ?? value.length;
    const selectionEnd = el?.selectionEnd ?? value.length;
    const { value: nextValue, cursor } = insertTokenAtCursor({ value, selectionStart, selectionEnd, chip });
    onChange(nextValue);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(cursor, cursor); });
  }

  function applyStarter(id: string) {
    const starter = STARTER_TEMPLATES.find((t) => t.id === id);
    if (!starter) return;
    onChange(starter.displayText);
  }

  return (
    <div className="hub-token-toolbar">
      <div className="hub-token-toolbar-row">
        <span className="hub-field-label">Insertar dato</span>
        <div className="hub-token-chips">
          {TOKEN_CHIPS.map((chip) => (
            <button key={chip.id} type="button" className="hub-token-chip" onClick={() => insertChip(chip.id)}>{chip.label}</button>
          ))}
        </div>
      </div>
      <div className="hub-token-toolbar-row">
        <span className="hub-field-label">Empezar con una plantilla</span>
        <div className="hub-token-chips">
          {STARTER_TEMPLATES.map((starter) => (
            <button key={starter.id} type="button" className="hub-token-chip is-outline" onClick={() => applyStarter(starter.id)}>{starter.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
