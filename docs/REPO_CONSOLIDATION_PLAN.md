# Repo Consolidation Plan (DentalConnect / Creatyv AI)

## Qué borrar / archivar
1. `supabase/functions/run-replies/index.ts.bak.*` — backups que no se usan. Movernos a `archive/` si hay valor histórico.  
2. `supabase/.temp/*` — información duplicada (por ejemplo `gotrue-version`). Elimina o gitignore.  
3. `domain/calendarAdapter.ts` (si no está importado en estaciones principales) — paperwork sin consumo.  
4. Cualquier `.bak`, `.temp` adicional en carpetas `domain/` o `supabase/functions`.  

## Qué conservar como fuente de verdad
1. `supabase/functions/run-replies/index.ts` — worker principal.  
2. `conversationEngine.ts` — motor de decisiones.  
3. `domain/intents.ts`, `domain/interpreter.ts`, `domain/playbook.ts`, `domain/responses.ts` — definiciones de intent/respuesta.  
4. `domain/actionExecutor.ts` + `domain/tools.ts` — efectos secundarios (trials/booking).  
5. `mergeLeadState` y `mergeStatePatches` — persistencia de state.  
6. Tests que cubren el flujo real (`tests/engine.test.ts`, `tests/calendarSync.test.ts`).  

## Qué marcar como stub (no listo para producción)
- Carpeta `domain/calendar/*` (types, provider, Google stub, sync).  
  - Añadir un README en esa carpeta o un comentario grande que diga: “Stub until OAuth tokens and real HTTP integration exist.”
  - No usarlo en negocio real ni mencionarlo en demos/casos de venta.

## Orden recomendado de limpieza (prioridad)
1. **Prioridad 2 (limpieza)**: eliminar `.bak`, `.temp`, adapters no usados.  
2. **Prioridad 1 (estabilidad)**: consolidar `index.ts` + engine + state merge en un README (ya hecho) y documentar qué se despliega realmente.  
3. **Prioridad 3 (calendar real)**: planificar un sprint con OAuth, provider real y tests; mientras tanto, dejarlo marcado como prototipo.

## Beneficios esperados
- Se reduce el ruido de archivos viejos.  
- Los nuevos ingenieros saben qué archivos sí importan.  
- El “calendar sync” no se vende como funcional hasta que lo sea.
- Los próximos cambios se hacen sobre la capa real y no sobre stubs dispersos.
