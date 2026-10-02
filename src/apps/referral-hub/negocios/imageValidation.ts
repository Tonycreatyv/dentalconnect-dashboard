// Pure image-file validation for the local coupon/business image picker
// (Task 5). Extracted from StorageUploadField.tsx so it's testable without
// pulling React/DOM into the test.
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "Formato no soportado. Usá JPG, PNG o WebP.";
  if (file.size > MAX_IMAGE_BYTES) return "La imagen pesa demasiado. Máximo 5 MB.";
  return null;
}
