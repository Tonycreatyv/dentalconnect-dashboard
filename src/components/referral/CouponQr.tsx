import { useEffect, useRef } from "react";
import QRCode from "qrcode";

export default function CouponQr({ value }: { value: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) void QRCode.toCanvas(ref.current, value, { width: 280, margin: 2, errorCorrectionLevel: "H", color: { dark: "#07111A", light: "#FFFFFF" } }); }, [value]);
  return <canvas ref={ref} aria-label="Código QR del cupón" className="mx-auto max-w-full rounded-2xl bg-white p-2" />;
}
