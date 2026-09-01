import QRCode from "qrcode";
import { useEffect, useRef } from "react";

export function QrPreview({ value, size = 132 }: { value: string; size?: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (canvas.current) {
      void QRCode.toCanvas(canvas.current, value, { width: size, margin: 1, errorCorrectionLevel: "M", color: { dark: "#1C1917", light: "#FFFFFF" } });
    }
  }, [value, size]);
  return <canvas ref={canvas} aria-label="Código QR de la campaña" />;
}

export function downloadQr(publicCode: string, url: string) {
  const source = document.createElement("canvas");
  QRCode.toCanvas(source, url, { width: 512, margin: 2, errorCorrectionLevel: "M", color: { dark: "#1C1917", light: "#FFFFFF" } }, () => {
    const link = document.createElement("a");
    link.download = `qr-${publicCode}.png`;
    link.href = source.toDataURL("image/png");
    link.click();
  });
}
