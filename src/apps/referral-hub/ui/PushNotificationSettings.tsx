import { Bell, BellOff, Check, Smartphone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type PushPreferences = {
  push_enabled: boolean;
  new_case: boolean;
  unassigned_case: boolean;
  exception_case: boolean;
  partner_assignment: boolean;
  partner_access: boolean;
  benefit_changes: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
};

type PushStatus = {
  configured: boolean;
  vapid_public_key: string | null;
  preferences: PushPreferences | null;
};

const DEFAULT_PREFERENCES: PushPreferences = {
  push_enabled: true,
  new_case: true,
  unassigned_case: true,
  exception_case: true,
  partner_assignment: true,
  partner_access: true,
  benefit_changes: false,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
};

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "Este dispositivo";
}

function isStandaloneWebApp() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || navigatorWithStandalone.standalone === true;
}

export default function PushNotificationSettings() {
  const isIos = typeof navigator !== "undefined" && /iPhone|iPad/i.test(navigator.userAgent);
  const standalone = typeof window !== "undefined" && isStandaloneWebApp();
  const iosNeedsInstall = isIos && !standalone;
  const supported = typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [preferences, setPreferences] = useState<PushPreferences>(DEFAULT_PREFERENCES);
  const [currentSubscription, setCurrentSubscription] = useState<PushSubscription | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function invoke(body: Record<string, unknown>) {
    const result = await supabase.functions.invoke("admin-push-subscriptions", { body });
    if (result.error) throw new Error(result.error.message);
    if (!result.data?.success) throw new Error(result.data?.error || "No se pudo completar la acción.");
    return result.data;
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [remote, subscription] = await Promise.all([
        invoke({ action: "status" }),
        supported
          ? navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription())
          : Promise.resolve(null),
      ]);
      const nextStatus = remote as PushStatus;
      setStatus(nextStatus);
      setPreferences({ ...DEFAULT_PREFERENCES, ...(nextStatus.preferences ?? {}) });
      setCurrentSubscription(subscription);
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const permission = supported ? Notification.permission : "unsupported";
  const activeOnThisDevice = Boolean(currentSubscription);
  const readyToEnable = supported && !iosNeedsInstall && Boolean(status?.configured && status.vapid_public_key);
  const canConfigurePreferences = activeOnThisDevice || readyToEnable;
  const dirty = useMemo(() => {
    if (!status?.preferences) return true;
    return JSON.stringify(preferences) !== JSON.stringify({ ...DEFAULT_PREFERENCES, ...status.preferences });
  }, [preferences, status]);

  async function enableThisDevice() {
    if (!readyToEnable || !status?.vapid_public_key) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const requested = await Notification.requestPermission();
      if (requested !== "granted") throw new Error("El navegador no dio permiso para notificaciones.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(status.vapid_public_key),
      });
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) throw new Error("La suscripción del dispositivo está incompleta.");
      await invoke({
        action: "subscribe",
        endpoint: serialized.endpoint,
        p256dh: serialized.keys.p256dh,
        auth_key: serialized.keys.auth,
        device_label: deviceLabel(),
        user_agent: navigator.userAgent,
      });
      setCurrentSubscription(subscription);
      setPreferences((current) => ({ ...current, push_enabled: true }));
      setNotice("Notificaciones activadas en este dispositivo.");
      await refresh();
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setSaving(false);
    }
  }

  async function disableThisDevice() {
    if (!currentSubscription) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await invoke({ action: "unsubscribe", endpoint: currentSubscription.endpoint });
      await currentSubscription.unsubscribe();
      setCurrentSubscription(null);
      setNotice("Notificaciones desactivadas en este dispositivo.");
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setSaving(false);
    }
  }

  async function savePreferences() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = await invoke({ action: "update_preferences", ...preferences });
      const next = { ...DEFAULT_PREFERENCES, ...(data.preferences ?? {}) } as PushPreferences;
      setPreferences(next);
      setStatus((current) => current ? { ...current, preferences: next } : current);
      setNotice("Preferencias guardadas.");
    } catch (reason) {
      setError(String((reason as Error)?.message || reason));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="hub-field-hint">Comprobando este dispositivo…</p>;

  const deviceMessage = activeOnThisDevice
    ? "Notificaciones activas en este dispositivo"
    : iosNeedsInstall
      ? "Añade ConeXXion a tu pantalla de inicio para activar notificaciones."
      : !supported
        ? "Web Push no está disponible en este navegador."
        : permission === "denied"
          ? "Permiso bloqueado por el navegador."
          : status?.configured
            ? "Listo para activar en este dispositivo."
            : "Push todavía no está habilitado en producción.";

  return (
    <div className="hub-push-settings">
      <div className="hub-push-device">
        <span className={activeOnThisDevice ? "hub-push-device-icon is-active" : "hub-push-device-icon"}><Smartphone size={18} /></span>
        <div><strong>{deviceLabel()}</strong><small>{deviceMessage}</small></div>
        {activeOnThisDevice ? <span className="hub-account-success"><Check size={12} />Activo</span> : null}
      </div>

      {iosNeedsInstall ? (
        <div className="hub-blocked-note">En iPhone/iPad, instala ConeXXion desde Safari con Compartir → Añadir a pantalla de inicio. Abre esa app instalada para habilitar Web Push.</div>
      ) : !status?.configured ? (
        <div className="hub-blocked-note">Push está preparado en la app, pero el servidor todavía no tiene las claves VAPID de producción. Las alertas permanecerán desactivadas hasta completar esa configuración.</div>
      ) : null}

      <div className="hub-account-edit-actions">
        {activeOnThisDevice ? (
          <button type="button" className="hub-secondary" disabled={saving} onClick={() => void disableThisDevice()}><BellOff size={15} />Desactivar en este dispositivo</button>
        ) : readyToEnable ? (
          <button type="button" className="hub-primary" disabled={saving || permission === "denied"} onClick={() => void enableThisDevice()}><Bell size={15} />Activar notificaciones</button>
        ) : null}
      </div>

      {canConfigurePreferences ? (
        <>
          <div className="hub-push-preferences">
            <h3>Qué quieres recibir</h3>
            {([
              ["new_case", "Caso nuevo", "Cuando entra una nueva solicitud."],
              ["unassigned_case", "Caso sin responsable", "Cuando un caso necesita asignación."],
              ["exception_case", "Excepción operativa", "Errores o casos que necesitan intervención."],
              ["partner_assignment", "Asignaciones", "Cambios importantes de asignación de partner."],
              ["partner_access", "Acceso de partners", "Invitaciones, reactivaciones o revocaciones."],
              ["benefit_changes", "Cambios de beneficios", "Cambios administrativos relevantes en cupones/beneficios."],
            ] as const).map(([key, label, description]) => (
              <label className="hub-delivery-toggle" key={key}>
                <div><strong>{label}</strong><small>{description}</small></div>
                <input type="checkbox" checked={Boolean(preferences[key])} onChange={(event) => setPreferences((current) => ({ ...current, [key]: event.target.checked }))} />
              </label>
            ))}
          </div>

          <label className="hub-delivery-toggle">
            <div><strong>Silenciar por horario</strong><small>No recibir alertas push durante el intervalo elegido.</small></div>
            <input type="checkbox" checked={preferences.quiet_hours_enabled} onChange={(event) => setPreferences((current) => ({ ...current, quiet_hours_enabled: event.target.checked }))} />
          </label>
          {preferences.quiet_hours_enabled ? (
            <div className="hub-push-hours">
              <div className="hub-field"><label htmlFor="push-quiet-start">Desde</label><input id="push-quiet-start" type="time" value={preferences.quiet_hours_start ?? "22:00"} onChange={(event) => setPreferences((current) => ({ ...current, quiet_hours_start: event.target.value }))} /></div>
              <div className="hub-field"><label htmlFor="push-quiet-end">Hasta</label><input id="push-quiet-end" type="time" value={preferences.quiet_hours_end ?? "07:00"} onChange={(event) => setPreferences((current) => ({ ...current, quiet_hours_end: event.target.value }))} /></div>
            </div>
          ) : null}

          <button type="button" className="hub-secondary" disabled={saving || !dirty} onClick={() => void savePreferences()}>{saving ? "Guardando…" : "Guardar preferencias"}</button>
        </>
      ) : null}

      {notice ? <p className="hub-account-success" role="status"><Check size={12} />{notice}</p> : null}
      {error ? <p className="hub-account-error" role="alert">{error}</p> : null}
    </div>
  );
}
