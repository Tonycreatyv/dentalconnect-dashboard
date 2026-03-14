# Ver logs y outbox de run-replies

## Ver logs de la función

La CLI de Supabase **no** incluye un comando `supabase functions logs`. Los logs se ven así:

### Opción 1: Dashboard (recomendado)

1. Entra al [Dashboard](https://supabase.com/dashboard) → tu proyecto.
2. **Edge Functions** → elige **run-replies**.
3. Pestaña **Logs**: eventos, excepciones y `console.log` (puedes filtrar por tiempo/nivel).
4. Pestaña **Invocations**: requests/responses, headers, status, duración.

### Opción 2: Log Explorer

Para búsquedas avanzadas: **Logs** → **Log Explorer** y filtra por función o mensaje.

### Opción 3: CLI (si tu versión lo soporta)

Algunas versiones o extensiones pueden tener algo como:

```bash
supabase functions logs run-replies
```

Si no existe, usa el Dashboard.

---

## Ver jobs pendientes en el outbox

Ejecuta esto en **Supabase → SQL Editor**:

```sql
-- Resumen por estado
SELECT status, count(*) AS count
FROM reply_outbox
GROUP BY status
ORDER BY count DESC;

-- Últimos 20 jobs (cualquier estado)
SELECT id, organization_id, lead_id, status, channel,
       created_at, scheduled_for, attempt_count, last_error
FROM reply_outbox
ORDER BY created_at DESC
LIMIT 20;

-- Solo pendientes (queued o processing)
SELECT id, organization_id, lead_id, status, channel,
       created_at, scheduled_for, attempt_count, last_error
FROM reply_outbox
WHERE status IN ('queued', 'processing')
ORDER BY created_at ASC
LIMIT 50;
```

Estados que usa la función: `queued` (pendiente), `processing` (en curso), `sent`, `skipped`, `failed`, `dead`.
