import { ImageOff, UploadCloud, X } from "lucide-react";
import { useRef, useState } from "react";
import { ACCEPTED_IMAGE_TYPES as ACCEPTED_TYPES, validateImageFile as validateFile } from "./imageValidation";

// Local-only drag-and-drop / tap-to-select image picker (Task 5). No real
// Supabase Storage bucket exists yet (see docs/proposed-migrations/
// 20260822_draft_coupon_media_storage_BLOCKED.sql), so a selected file is
// never actually uploaded anywhere — it only produces a local
// object-URL preview, clearly labeled as such. The real, savable image
// still comes from the HTTPS URL field the parent renders alongside this.
export default function StorageUploadField({ onLocalPreview }: {
  onLocalPreview: (file: File | null, previewUrl: string | null) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined | null) {
    if (!file) return;
    const validationError = validateFile(file);
    if (validationError) { setError(validationError); return; }
    setError("");
    if (preview) URL.revokeObjectURL(preview.url);
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    onLocalPreview(file, url);
  }

  function clear() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setError("");
    onLocalPreview(null, null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="hub-upload-field">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hub-upload-input"
        aria-label="Elegir imagen"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {preview ? (
        <div className="hub-upload-preview">
          <img src={preview.url} alt="Vista previa" />
          <div className="hub-upload-preview-actions">
            <button type="button" className="hub-chip-btn" onClick={() => inputRef.current?.click()}>Reemplazar</button>
            <button type="button" className="hub-chip-btn" onClick={clear}><X size={14} />Quitar</button>
          </div>
          <p className="hub-field-hint">Vista previa local — todavía no se subió al servidor.</p>
        </div>
      ) : (
        <button
          type="button"
          className={dragActive ? "hub-upload-zone is-active" : "hub-upload-zone"}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files?.[0]); }}
        >
          <UploadCloud size={20} />
          <span>Arrastrá una imagen o tocá para elegir</span>
          <small>JPG, PNG o WebP · máximo 5 MB</small>
        </button>
      )}
      {error ? <p className="hub-account-error" role="alert"><ImageOff size={14} />{error}</p> : null}
    </div>
  );
}
