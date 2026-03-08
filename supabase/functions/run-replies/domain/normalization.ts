export function stripDiacritics(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeText(text: string) {
  const cleaned = String(text ?? "").trim();
  return stripDiacritics(cleaned).toLowerCase();
}
