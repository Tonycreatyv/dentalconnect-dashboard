# Run-Replies: Arquitectura actual y soporte dual (Creatyv + Dental)

## 1. Resumen de la arquitectura actual

### 1.1 Flujo de conversación (de punta a punta)

```
Request (organization_id, opcional limit/body)
    ↓
Resolución de org (body/query → DEFAULT_ORG si falta)
    ↓
Carga por organización: org_secrets (Meta), product_knowledge, clinic_knowledge, org_settings (llm_brain_enabled)
    ↓
Claim jobs (reply_outbox) para esa org
    ↓
Por cada job:
  • Si llm_brain_enabled → runLlmTurn() → reply + state_patch + tool_calls
  • Si no hay resultado LLM → runConversationEngine() (rule-based)
  • Si operator outbound → texto manual
    ↓
mergeLeadState(leadState, statePatch) → actualizar lead.state
    ↓
Enviar respuesta por Meta API, persistir mensaje, actualizar reply_outbox y leads
```

### 1.2 Componentes clave

| Archivo | Rol |
|--------|-----|
| **index.ts** | Entrypoint: auth, resolución de org, carga de knowledge/secrets, claim de jobs, envío a Meta. Orquesta LLM vs engine y actualización de estado. |
| **conversationEngine.ts** | Motor rule-based: detecta intents, elige respuestas por `orgType` (creatyv/dental/generic), devuelve `replyText` + `nextStatePatch` + opcional `toolAction`. |
| **domain/intents.ts** | Patrones por intent (handoff, emergency, pricing, services, book_appointment, demo_interest, trial_interest, confirmation, etc.). |
| **domain/llmTurn.ts** | Si `llm_brain_enabled`: llama a OpenAI, devuelve JSON con `reply`, `state_patch`, `tool_calls`. |
| **domain/actionExecutor.ts** | Ejecuta acciones: start_trial, begin_onboarding, capture_business_type, capture_lead_goal, book_appointment, show_demo; integra calendar sync. |
| **domain/responses.ts** | Usa **playbook.ts** para componer respuestas por stage/intent (templates con placeholders). No lo usa el conversationEngine actual: el engine tiene sus propios `RESPONSES` inline. |
| **domain/playbook.ts** | Stages: DISCOVERY → PAIN → IMPACT → VALUE → SOLUTION → DEMO → TRIAL_OFFER → ACTIVATION → CONVERSION. Pensado para flujo Creatyv; no se usa en el engine actual. |

### 1.3 Dos “mundos” de stages

- **conversationEngine.ts** usa: `INITIAL | DISCOVERY | QUALIFICATION | VALUE | TRIAL_OFFER | ACTIVATION | BOOKING | HANDOFF | CLOSED`.
- **playbook.ts** usa: `DISCOVERY | PAIN | IMPACT | VALUE | SOLUTION | DEMO | TRIAL_OFFER | ACTIVATION | CONVERSION`.

El engine actual no usa `playbook` ni `responses.ts`; tiene sus propios `RESPONSES` por `orgType` y su propia lógica de prioridades (handoff → high value → continuation → greeting/hours/location/emergency → fallback).

### 1.4 Cómo se elige el modo (creatyv vs dental)

- **En el engine**: `orgType = leadState?.orgType ?? determineOrgType(organizationId)`.
- **determineOrgType(orgId)** (en conversationEngine.ts):
  - `orgId` contiene `"creatyv"` o `"product"` → **creatyv**
  - `orgId` contiene `"dental"` o `"clinic"` → **dental**
  - Si no → **generic**
- Las respuestas se eligen de `RESPONSES.creatyv`, `RESPONSES.dental` o `RESPONSES.generic` (greeting, pricing, services, demo, trial, handoff, fallback; en dental además bookAppointment, hours, location, emergency).

No hay un único “org id hardcodeado”: cualquier org puede usarse; el modo depende del **nombre/id de la organización** (o de `orgType` guardado en el estado del lead).

---

## 2. Hardcodes y limitaciones

### 2.1 Que limitan a una sola organización

- **DEFAULT_ORG (index.ts)**  
  - `organization_id = body/query ?? DEFAULT_ORG_ENV`.  
  - Si no mandas `organization_id`, se usa una sola org por variable de entorno. Eso es conveniencia para un solo tenant, no un bloqueo: si siempre envías `organization_id`, puedes tener varias orgs.

### 2.2 Que fijan “dental” o un solo producto en la experiencia

- **llmTurn.ts – prompt del LLM**  
  - Texto fijo: *"Eres el asistente conversacional de **DentalConnect**."*  
  - Con LLM activado, la personalidad es siempre DentalConnect, sin distinguir Creatyv vs Dental.

- **determineOrgType por substrings del organizationId**  
  - Si el id no contiene "creatyv", "product", "dental" o "clinic", la org se trata como **generic**.  
  - Depender del nombre/id hace frágil el modo; mejor que el modo sea explícito (p. ej. en `org_settings` o en el estado del lead).

### 2.3 Inconsistencias de integración (bugs)

- **statePatch vs nextStatePatch**  
  - **conversationEngine** devuelve `ConversationResult` con **nextStatePatch**.  
  - **index.ts** hace `statePatch = engineResult.statePatch ?? {}`.  
  - Como la propiedad se llama `nextStatePatch`, el patch del engine **nunca** se aplica cuando se usa el motor rule-based; el estado del lead no avanza bien.

- **Llamada a runConversationEngine desde index**  
  - index pasa: `organizationId`, `leadState`, `inboundText`, `knowledge`, `clinicKnowledge`.  
  - El engine declara: `organizationId`, `leadId`, `leadState`, `inboundText`, `channel`.  
  - El engine **no usa** `knowledge` ni `clinicKnowledge` en su código actual; esas tablas se cargan pero no se inyectan en las respuestas del engine.  
  - Falta `leadId` y `channel` en la llamada (el engine no los usa en la lógica actual, pero la firma sí los exige).

- **toolAction del engine vs actionExecutor**  
  - El engine devuelve por ejemplo `toolAction: { name: "request_handoff" }` o `{ name: "schedule_demo" }`.  
  - actionExecutor espera: `show_demo`, `start_trial`, `begin_onboarding`, `capture_business_type`, `capture_lead_goal`, `book_appointment`.  
  - Nombres no alineados: `request_handoff` y `schedule_demo` no tienen implementación en el executor actual.

---

## 3. Qué hace falta para que funcione bien en ambos modos (Creatyv + Dental)

### 3.1 Corregir bugs de integración

1. **Unificar nombre del patch de estado**  
   - En **conversationEngine**: devolver `statePatch` (o en index leer `engineResult.nextStatePatch`).  
   - Recomendación: que el tipo `ConversationResult` tenga `statePatch` y que el engine lo rellene; así index y tests siguen usando `statePatch`.

2. **Llamada a runConversationEngine**  
   - Pasar al menos `organizationId`, `leadState`, `inboundText` y, si quieres usar knowledge en el futuro, `knowledge` y `clinicKnowledge`.  
   - Añadir `leadId` y `channel` desde el job (aunque el engine no los use aún) para cumplir la firma, o hacer opcionales esos parámetros en el engine.

3. **Tool actions**  
   - O bien el engine emite los mismos nombres que el executor (`handoff_to_human`, `show_demo`, etc.), o el index/executor traducen `request_handoff` → `handoff_to_human` y `schedule_demo` → `show_demo` (o la acción que corresponda).

### 3.2 Modo explícito por organización (Creatyv vs Dental)

- Añadir en **org_settings** (o en configuración por org) un campo como `conversation_mode: "creatyv" | "dental" | "generic"`.  
- En **index**: al armar el contexto para el engine (y para el LLM), leer ese modo y pasarlo (p. ej. `orgType` o `conversationMode`).  
- En **conversationEngine**: usar ese modo cuando exista, y solo hacer fallback a `determineOrgType(organizationId)` si no está configurado.  
- Así no dependes de que el `organization_id` contenga "creatyv" o "dental".

### 3.3 LLM (llmTurn) multi-modo

- El prompt en **llmTurn.ts** no debe decir siempre "DentalConnect".  
- Incluir en el contexto: `conversation_mode` (o orgType) y un resumen de rol, por ejemplo:  
  - creatyv: "Eres el asistente de Creatyv. Ayudas a prospectos a conocer el producto, agendar demos y capturar leads."  
  - dental: "Eres el asistente de la clínica. Ayudas a pacientes a agendar citas, resolver dudas y reducir no-shows."  
- Opcional: inyectar en el prompt fragmentos de `product_knowledge` o `clinic_knowledge` según el modo, para que el LLM cite precios/servicios/horarios reales.

### 3.4 Uso real de product_knowledge y clinic_knowledge

- Hoy **product_knowledge** y **clinic_knowledge** se cargan en index pero el **conversationEngine** no los recibe ni usa.  
- Para que ambos modos se beneficien:  
  - Pasar `knowledge` y `clinicKnowledge` al engine.  
  - En el engine: en respuestas de pricing/services/hours/location, completar con contenido de esas estructuras (o al menos para dental: clinic_knowledge; para creatyv: product_knowledge).  
- Para el LLM: incluir en el prompt (o en RAG) los fragmentos relevantes según el modo.

### 3.5 Respuestas y flujos por modo

- **Creatyv**: ya tienes greeting, pricing, services, demo, trial, handoff, valueMoreAppointments. Revisar que los tool actions (demo, trial, handoff) estén mapeados y ejecutados.  
- **Dental**: ya tienes bookAppointment, hours, location, emergency. Asegurar que `book_appointment` en el engine dispare la acción `book_appointment` del actionExecutor con los datos necesarios (fecha/hora o slot) cuando el flujo de booking esté completo.  
- **generic**: mantener como fallback cuando no haya modo explícito.

### 3.6 Resumen de prioridad

| Prioridad | Cambio |
|----------|--------|
| Alta | Corregir `nextStatePatch` → `statePatch` (o su uso en index) para que el estado del lead se actualice. |
| Alta | Alinear tool actions del engine con actionExecutor (nombres y payloads). |
| Alta | Modo explícito en org (org_settings.conversation_mode) y usarlo en engine y LLM. |
| Media | Prompt del LLM según modo (Creatyv vs Dental), sin hardcode "DentalConnect". |
| Media | Pasar y usar product_knowledge / clinic_knowledge en engine (y/o en LLM). |
| Baja | Unificar stages/playbook si quieres un solo modelo mental (opcional; el engine actual ya funciona por intents + orgType). |

Con esto tienes una base clara para que Creatyv Mode y Dental Mode coexistan sin hardcodes que limiten a una sola organización y con estado y herramientas funcionando bien en ambos.
