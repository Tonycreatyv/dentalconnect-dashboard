// src/pages/Trial.tsx
import React, { useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Status = 'idle' | 'submitting' | 'success' | 'error';

export default function Trial() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [business, setBusiness] = useState('');

  const dashboardUrl = useMemo(() => {
    return (import.meta.env.VITE_DASHBOARD_URL as string | undefined) || 'https://app.creatyv.io';
  }, []);

  const canUseSupabase = useMemo(() => {
    // si no hay env vars, supabaseClient crea client con '' y fallará. Mejor avisar.
    const u = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const k = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    return Boolean(u && k);
  }, []);

  async function submitLead() {
    setStatus('submitting');
    setError(null);

    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      business: business.trim() || null,
      source: 'trial',
      product: 'DentalConnect',
      created_at: new Date().toISOString(),
    };

    // ✅ Si no hay supabase env, hacemos fallback: solo redirect con querystring
    if (!canUseSupabase) {
      const qs = new URLSearchParams({
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        business: payload.business ?? '',
        source: payload.source,
      });
      window.location.href = `${dashboardUrl}/trial?${qs.toString()}`;
      return;
    }

    // ✅ Guardar en Supabase
    // Recomendado: tabla "trial_leads". Si no existe, puedes usar "leads" con columnas compatibles.
    // Cambia el nombre de la tabla aquí si quieres.
    const table = 'trial_leads';

    const { error: insertErr } = await supabase.from(table).insert(payload);

    if (insertErr) {
      // Si la tabla no existe, intenta con "leads" como fallback
      const { error: insertErr2 } = await supabase.from('leads').insert({
        organization_id: 'clinic-demo',
        channel: 'web',
        status: 'active',
        last_message_at: new Date().toISOString(),
        // guardamos en campos genéricos si existen
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        business_name: payload.business,
        source: 'trial',
      });

      if (insertErr2) {
        setStatus('error');
        setError(
          `No pude guardar el trial en Supabase. Crea tabla "trial_leads" o ajusta columnas en "leads".\n` +
            `trial_leads error: ${insertErr.message}\nleads error: ${insertErr2.message}`
        );
        return;
      }
    }

    setStatus('success');

    // ✅ Redirect a dashboard (puedes cambiar ruta)
    const qs = new URLSearchParams({
      email: payload.email,
      name: payload.name,
      phone: payload.phone,
      business: payload.business ?? '',
      source: 'trial',
    });

    // Te mando a /trial dentro del dashboard para onboarding
    window.location.href = `${dashboardUrl}/trial?${qs.toString()}`;
  }

  return (
    <main style={{ padding: '80px 20px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 44, marginBottom: 12 }}>Prueba DentalConnect gratis 7 días</h1>

      <p style={{ opacity: 0.82, lineHeight: 1.6, maxWidth: 720 }}>
        Deja tus datos y activamos tu prueba. Te llevaremos al dashboard para completar el setup.
      </p>

      <div style={{ marginTop: 18, opacity: 0.7, fontSize: 12 }}>
        {canUseSupabase ? (
          <span>✅ Conectado a Supabase</span>
        ) : (
          <span>⚠️ Falta .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Haré redirect sin guardar.</span>
        )}
      </div>

      <form
        style={{ marginTop: 24, display: 'grid', gap: 12, maxWidth: 520 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submitLead();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" required style={inp} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono" required style={inp} />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          required
          style={inp}
        />
        <input
          value={business}
          onChange={(e) => setBusiness(e.target.value)}
          placeholder="Clínica / Negocio"
          style={inp}
        />

        <button style={btn} disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Activando...' : 'Activar prueba'}
        </button>
      </form>

      {status === 'error' && (
        <pre style={{ marginTop: 16, whiteSpace: 'pre-wrap', color: '#ffb4b4' }}>{String(error)}</pre>
      )}

      {status === 'success' && (
        <p style={{ marginTop: 16, opacity: 0.8 }}>Listo ✅ Te llevo al dashboard…</p>
      )}

      <p style={{ marginTop: 16, opacity: 0.65 }}>
        *No agenda automático: tu equipo confirma disponibilidad.
      </p>
    </main>
  );
}

const inp: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.06)',
  color: 'white',
  outline: 'none',
};

const btn: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'white',
  color: 'black',
  fontWeight: 800,
  cursor: 'pointer',
};
