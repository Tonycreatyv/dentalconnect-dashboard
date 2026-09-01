import { X } from "lucide-react";
import { useEffect } from "react";

// Full-size, uncropped image viewer. object-fit:contain everywhere (never
// "cover") so a coupon's real content — fine print, phone numbers, terms —
// is never cut off, on mobile or desktop.
export default function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="hub-lightbox" role="dialog" aria-modal="true" aria-label={alt || "Imagen"}>
      <button type="button" className="hub-lightbox-scrim" aria-label="Cerrar" onClick={onClose} />
      <button type="button" className="hub-lightbox-close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button>
      <img className="hub-lightbox-image" src={src} alt={alt} />
    </div>
  );
}
