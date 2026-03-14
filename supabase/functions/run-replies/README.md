# Run-Replies Core (DentalConnect / Creatyv AI)

## Qué es DentalConnect hoy
- *Mensajería activa*: la función `supabase/functions/run-replies/index.ts` sigue el patrón ``messages → reply_outbox → worker`` y es la fuente real. Procesa cada inbound, ejecuta el motor conversacional y llama a Meta.
- *Motor conversacional*: `conversationEngine.ts` (más sus dominios: intents, interpreter, playbook y responses) decide qué responder, qué stage avanzar y qué `statePatch` devolver.
- *Persistencia y acciones*: `mergeLeadState`, `mergeStatePatches` combinan los parches del engine y `actionExecutor` ejecuta acciones como `start_trial`, `capture_lead_goal` o crear citas. Ese valor cae en `leads.state`, `appointments` y la tabla `messages`.
- *Stub permanente*: la carpeta `domain/calendar/*` (providers, sync, tipos) solo contiene un prototipo. Genera UUIDs y no tiene credenciales OAuth reales, así que no es funcionalmente un calendario sincronizado.

## Flujo real del sistema
1. **Messenger / Webhook** inserta el mensaje en `messages` y/ó en `reply_outbox`.  
2. **Worker** (`supabase/functions/run-replies/index.ts`) reclama jobs (`claim_reply_outbox_jobs_v3/v2`), marca `processing_started_at`, ejecuta el engine y el `actionExecutor`, persiste respuestas y actualiza `reply_outbox` a `sent`/`failed`.  
3. **ConversationEngine** decide respuesta usando `domain/intents.ts`, `domain/interpreter.ts`, `domain/playbook.ts`, `domain/responses.ts` y la lógica de booking/knowledge. Devuelve `replyText`, `statePatch` y eventualmente `toolAction`.  
4. **ActionExecutor** ejecuta acciones (trials, booking, appointments, calendar stub) usando `domain/tools.ts` para persistir datos.  
5. **Meta send**: `sendToMeta` publica la respuesta definitiva en el canal mediante la API de Facebook/Meta.  
6. **Persistencia**: `mergeLeadState` guarda `leads.state`, `mergeStatePatches` combina parches y se actualizan `appointments` y `messages` con metadatos.  

## Fuentes de verdad
- **Worker**: `supabase/functions/run-replies/index.ts` — administración de ciclo `reply_outbox` y persistencia final.  
- **Engine**: `conversationEngine.ts` — gira de intents, knowledge, booking y respuestas.  
- **Intents/interpreter**: `domain/intents.ts`, `domain/interpreter.ts` — determinan intención + summary cuando el texto es ambiguous/typo.  
- **Playbook/responses**: `domain/playbook.ts`, `domain/responses.ts` — templates y contexto (ya tienen fallback DISCOVERY).  
- **Booking flow**: funciones internas del engine (`handleClinicBookingFlow`) que usan `collected.booking` y actualizan `appointments` a través de `actionExecutor`.  
- **ActionExecutor & tools**: `domain/actionExecutor.ts` + `domain/tools.ts` — ejecutan `ToolActionExecution` (start_trial, capture_lead_goal, book_appointment).  
- **State merge**: `mergeLeadState`, `mergeStatePatches` en `index.ts` — garantizan que `leads.state` retenga `stage`, `collected` y `last_bot_text`.

## Qué NO es productivo todavía
- **Calendario sincronizado**: `domain/calendar/types.ts`, `provider.ts`, `googleCalendarProvider.ts` y `calendarSync.ts` son stubs.  
  - Retornan UUIDs sin llamar a Google/Microsoft.  
  - No hay credenciales OAuth almacenadas ni refresco de tokens.  
  - Documenta claramente que esto es un prototipo hasta que haya `org_secrets` con tokens válidos.
- **OAuth / tokens**: todavía no hay flujo real para guardar `access_token`/`refresh_token` por organización.  
- **Providers alternativos**: Microsoft/Apple/otros no están implementados; solo existe el esqueleto (sólo Google stub internamente).  

## Campos importantes de `leads.state`
- `stage` / `phase` — etapa actual del playbook.  
- `business_type` — tipo de negocio detectado.  
- `last_user_summary` — sumario corto (interpretador o resumen de pain).  
- `collected` — objeto con:  
  - `booking`: fecha, hora, `last_question_key`, `completed`.  
  - `selected_pain`, `selected_pain_at`.  
  - `trial_offered`, `onboarding_started`.  
  - `intent_history`, `objection_flags`, `frustration_detected`.  
  - `wants_full_automation`, `secondary_goals`.  
- `last_question` — última clave de pregunta para evitar repeticiones.  
- `last_offer_type`, `last_bot_text` — ayudan a continuar la conversación.

## Riesgos actuales
1. **Persistencia del estado**: es crítico monitorear que `leads.state` realmente reciba `collected.booking`, `last_user_summary` y `selected_pain` cada turno.  
2. **One-reply-per-turn**: el engine debe continuar un solo camino; si `statePatch` se pierde o se combina mal, vuelve a mandar greeting/discovery.  
3. **Worker lifecycle**: si `processing_started_at` o `locked_*` se rompen, el TTL vuelve a reclamar; el hardening actual ya lo protege, pero mantén vigilancia.  
4. **Calendar stub**: no ofrecerlo a clientes hasta que haya credenciales, o se percibirá como feature falsa.

## Próximas prioridades
1. **Estabilidad productiva** (mantener `index.ts`, engine y state merge limpios).  
2. **Limpieza del repo** (eliminar `.bak`, `.temp`, adapters sin uso).  
3. **Calendar real** (token OAuth, Google/Microsoft real y tests de sync).

---

_Creador: Staff Eng. consolidación de repositorios._
