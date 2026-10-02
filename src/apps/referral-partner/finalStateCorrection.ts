export type CorrectionReason = "marked_by_mistake" | "new_information" | "other";

export const CORRECTION_REASON_LABEL: Record<CorrectionReason, string> = {
  marked_by_mistake: "Marcado por error",
  new_information: "Información nueva",
  other: "Otro",
};

export function canCorrectFinalResult(workStatus: string): boolean {
  return workStatus === "converted" || workStatus === "not_converted";
}

// marked_by_mistake/new_information are self-explanatory reasons — a note
// adds nothing required to understand them. 'other' carries no information
// of its own, so it's the one reason that must not be submitted blank.
export function correctionNoteIsValid(reason: CorrectionReason, note: string): boolean {
  if (reason === "other") return Boolean(note.trim());
  return true;
}
