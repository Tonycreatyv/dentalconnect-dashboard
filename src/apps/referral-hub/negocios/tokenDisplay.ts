// Human-readable ↔ canonical placeholder mapping for the WhatsApp message
// editor (Task 4). The operator only ever sees/types the bracket form
// ("[Nombre del cliente]") — the canonical {{customer_first_name}} contract
// that couponMessageTemplate.ts actually renders is an implementation
// detail translated at the edges (toStoredText before saving/previewing,
// toDisplayText when loading a saved template back into the textarea).

export type TokenChip = { id: string; label: string; placeholder: string };

export const TOKEN_CHIPS: TokenChip[] = [
  { id: "customer_first_name", label: "Nombre del cliente", placeholder: "customer_first_name" },
  { id: "business_name", label: "Negocio", placeholder: "business_name" },
  { id: "benefit_name", label: "Beneficio", placeholder: "benefit_name" },
  { id: "claim_code", label: "Código", placeholder: "claim_code" },
  { id: "address", label: "Dirección", placeholder: "address" },
];

function displayToken(chip: TokenChip): string {
  return `[${chip.label}]`;
}

// Stored ({{placeholder}}) -> what the operator sees ([Etiqueta]). Any
// {{#x}}...{{/x}} optional-segment markers (used only by the pre-seeded
// legacy medical template, never authored through this editor) pass
// through unchanged rather than being mistranslated.
export function toDisplayText(stored: string): string {
  let text = stored;
  for (const chip of TOKEN_CHIPS) {
    text = text.split(`{{${chip.placeholder}}}`).join(displayToken(chip));
  }
  return text;
}

// What the operator sees ([Etiqueta]) -> stored ({{placeholder}}).
export function toStoredText(display: string): string {
  let text = display;
  for (const chip of TOKEN_CHIPS) {
    text = text.split(displayToken(chip)).join(`{{${chip.placeholder}}}`);
  }
  return text;
}

export function insertTokenAtCursor(args: {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  chip: TokenChip;
}): { value: string; cursor: number } {
  const token = displayToken(args.chip);
  const value = args.value.slice(0, args.selectionStart) + token + args.value.slice(args.selectionEnd);
  return { value, cursor: args.selectionStart + token.length };
}

export type StarterTemplate = { id: string; label: string; displayText: string };

// Authored entirely with chips (no conditional {{#...}} syntax) so the
// operator never sees raw placeholder syntax, even in the starting point.
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "recomendado",
    label: "Recomendado",
    displayText: "¡Hola [Nombre del cliente]! 🎉\n\nTu beneficio en [Negocio] ya está disponible.\n\nCódigo: [Código]\n\nPresentalo al momento de pagar.",
  },
  {
    id: "corto",
    label: "Corto",
    displayText: "¡Listo, [Nombre del cliente]! Tu cupón de [Negocio] ya está activo. Código: [Código]",
  },
  {
    id: "promocional",
    label: "Promocional",
    displayText: "[Nombre del cliente], no te pierdas [Beneficio] en [Negocio] 🎉\n\nMostrá este mensaje con tu código [Código] en [Dirección].",
  },
];
