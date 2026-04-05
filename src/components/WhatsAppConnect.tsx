// src/components/WhatsAppConnect.tsx
// Drop this into your Settings page where WhatsApp integration goes.
// Usage: <WhatsAppConnect organizationId={ORG} onConnected={() => reload()} />

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const FB_APP_ID = "1143886761216811";
const FB_CONFIG_ID = "1589112288815415";
const FB_SDK_VERSION = "v21.0";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

type ConnectionStatus = "idle" | "loading" | "connecting" | "saving" | "success" | "error";

interface Props {
  organizationId: string;
  onConnected?: () => void;
}

// Extend window for FB SDK
declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: any;
  }
}

function loadFacebookSDK(): Promise<void> {
  return new Promise((resolve) => {
    if (window.FB) {
      resolve();
      return;
    }

    window.fbAsyncInit = function () {
      window.FB.init({
        appId: FB_APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: FB_SDK_VERSION,
      });
      resolve();
    };

    if (document.getElementById("facebook-jssdk")) {
      // Script already loading
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  });
}

export default function WhatsAppConnect({ organizationId, onConnected }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [connectedName, setConnectedName] = useState<string | null>(null);
  const sdkLoaded = useRef(false);

  // Check if already connected
  useEffect(() => {
    async function checkConnection() {
      const res = await supabase
        .from("org_settings")
        .select("whatsapp_enabled, whatsapp_phone_number, whatsapp_display_name")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (!res.error && res.data?.whatsapp_enabled) {
        setConnectedPhone(res.data.whatsapp_phone_number ?? null);
        setConnectedName(res.data.whatsapp_display_name ?? null);
        setStatus("success");
      }
    }
    checkConnection();
  }, [organizationId]);

  // Load FB SDK on mount
  useEffect(() => {
    if (sdkLoaded.current) return;
    sdkLoaded.current = true;
    setStatus("loading");
    loadFacebookSDK().then(() => {
      setStatus((s) => s === "loading" ? "idle" : s);
    });
  }, []);

  const handleConnect = useCallback(() => {
    if (!window.FB) {
      setError("Facebook SDK no cargó. Recargá la página.");
      return;
    }

    setStatus("connecting");
    setError(null);

    window.FB.login(
      (response: any) => {
        if (response.status !== "connected" || !response.authResponse?.code) {
          setStatus("idle");
          setError("Conexión cancelada o sin autorización.");
          return;
        }

        const code = response.authResponse.code;

        // Listen for the Embedded Signup session info via postMessage
        // The FB SDK fires a message event with WABA ID and phone number ID
        const sessionHandler = (event: MessageEvent) => {
          if (
            event.origin !== "https://www.facebook.com" &&
            event.origin !== "https://web.facebook.com"
          ) {
            return;
          }

          try {
            const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
            if (data.type === "WA_EMBEDDED_SIGNUP") {
              window.removeEventListener("message", sessionHandler);

              const wabaId = data.data?.waba_id ?? "";
              const phoneNumberId = data.data?.phone_number_id ?? "";

              exchangeToken(code, wabaId, phoneNumberId);
            }
          } catch {
            // Ignore non-JSON messages
          }
        };

        window.addEventListener("message", sessionHandler);

        // Fallback: if no postMessage received within 5 seconds, proceed without WABA ID
        setTimeout(() => {
          window.removeEventListener("message", sessionHandler);
          if (status === "connecting") {
            exchangeToken(code, "", "");
          }
        }, 5000);
      },
      {
        config_id: FB_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
          sessionInfoVersion: 3,
        },
      }
    );
  }, [organizationId, status]);

  async function exchangeToken(code: string, wabaId: string, phoneNumberId: string) {
    setStatus("saving");

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          code,
          organization_id: organizationId,
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Error al conectar WhatsApp");
      }

      setConnectedPhone(data.phone_number ?? null);
      setConnectedName(data.display_name ?? null);
      setStatus("success");
      onConnected?.();
    } catch (err: any) {
      setStatus("error");
      setError(err.message ?? "Error desconocido");
    }
  }

  // Already connected state
  if (status === "success") {
    return (
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-emerald-300">WhatsApp conectado</div>
            {connectedPhone ? (
              <div className="mt-1 text-sm text-white/60">
                {connectedName ? `${connectedName} · ` : ""}
                {connectedPhone}
              </div>
            ) : (
              <div className="mt-1 text-sm text-white/60">
                Número conectado y recibiendo mensajes.
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setConnectedPhone(null);
                setConnectedName(null);
              }}
              className="mt-3 text-xs text-white/40 underline hover:text-white/60"
            >
              Reconectar con otro número
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-500/20">
          <MessageCircle className="h-5 w-5 text-green-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">Conectar WhatsApp</div>
          <div className="mt-1 text-sm text-white/50">
            Conectá el número de WhatsApp de tu clínica para recibir y responder pacientes automáticamente.
          </div>

          {error ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleConnect}
            disabled={status === "loading" || status === "connecting" || status === "saving"}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#20bd5a] disabled:opacity-50"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando...
              </>
            ) : status === "connecting" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Conectando...
              </>
            ) : status === "saving" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <MessageCircle className="h-4 w-4" />
                Conectar WhatsApp Business
              </>
            )}
          </button>

          <div className="mt-3 text-[11px] text-white/30">
            Se abrirá una ventana de Meta para autorizar la conexión. Necesitás acceso admin al WhatsApp Business de la clínica.
          </div>
        </div>
      </div>
    </div>
  );
}
