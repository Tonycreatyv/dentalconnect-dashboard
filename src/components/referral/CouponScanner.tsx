import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";

export default function CouponScanner({ onScan }: { onScan: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null); const [active,setActive]=useState(false); const [error,setError]=useState("");
  useEffect(() => { if (!active || !videoRef.current) return; const reader=new BrowserQRCodeReader(); let controls: IScannerControls | undefined;
    void reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => { if (result) { onScan(result.getText()); controls?.stop(); setActive(false); } }).then((value)=>{controls=value;}).catch(()=>{setError("No se pudo abrir la cámara. Usa el código manual.");setActive(false);});
    return () => controls?.stop(); }, [active,onScan]);
  return <div className="space-y-3"><button type="button" onClick={()=>{setError("");setActive(true);}} className="coupon-primary">Abrir cámara</button>{active?<video ref={videoRef} className="aspect-square w-full rounded-2xl bg-black object-cover" muted playsInline />:null}{error?<p className="text-sm text-amber-300">{error}</p>:null}</div>;
}
