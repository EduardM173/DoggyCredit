# S4-OPS-03 — Timeouts, retry budget, backoff y circuit breaker por proveedor

**Tipo:** Task · **Prioridad:** Must · **Depende de:** RF-04 (DC-148), RF-05 (pendiente de compañero), HU-23, HU-25
**Objetivo:** evitar llamadas en cascada a una dependencia inestable y permitir recuperación sin mentir sobre el resultado de la evaluación.
**Estado:** IMPLEMENTADO Y VERIFICADO CON PRUEBAS AUTOMÁTICAS. Pendiente: prueba manual con la API real (sección 8), T05 parcial, T08 y RF-05. Los valores vienen de la sección 4 de DC-148 (PROPUESTOS, no aprobados por el equipo).

## 1. Qué se entregó

| Entregable | Ubicación (`apps/api/src/`) |
|---|---|
| Configuración (timeouts, reintentos, backoff, breaker) | `financial-integrations/resilience/resilience.config.ts` |
| Circuit breaker por proveedor | `financial-integrations/resilience/circuit-breaker.ts` |
| Ejecutor con timeout, clasificador, reintentos y presupuesto | `financial-integrations/resilience/resilient-executor.ts` |
| Métricas por proveedor (en memoria) | `financial-integrations/resilience/provider-metrics.ts` |
| Wrapper sobre `BankMockSource` y `BureauMockSource` | `financial-integrations/resilience/resilient-sources.ts` |
| Pruebas | `resilience/circuit-breaker.spec.ts`, `resilient-executor.spec.ts`, `resilient-sources.spec.ts` |
| Registro en Nest | `financial-integrations/financial-integrations.module.ts` (`ResilientSources` en `providers` y `exports`) |
| Uso en el flujo de evaluación | `evaluations/evaluations.service.ts` (`this.bank.query` → `this.resilient.queryBank`; `this.bureau.query` → `this.resilient.queryBureau`) |
| Contrato | `financial-integrations/public.ts`: `retryable` pasa de `true` literal a `boolean` en `ERROR` |
| Variables de entorno (opcionales) | `PROVIDER_TIMEOUT_MS`, `PROVIDER_MAX_RETRIES`, `PROVIDER_BACKOFF_BASE_MS`, `PROVIDER_BACKOFF_MAX_MS`, `PROVIDER_RETRY_BUDGET_MS` |

Cambios en pruebas existentes: `evaluations.spec.ts`, `s4-hf-06-07.spec.ts` y `multi-tenant-isolation.spec.ts` construyen `EvaluationsService` a mano; se les agregó el noveno argumento (`ResilientSources` falso que reenvía a los mocks de Banco/Buró que ya usaban). No se cambió ninguna aserción.

`ResilientSources` es el último parámetro del constructor de `EvaluationsService`. Se importa directamente desde su archivo y no desde `public.ts`, para evitar un import circular.

## 2. Valores configurados (DC-148 §4, PROPUESTOS)

| Parámetro | Valor |
|---|---|
| Timeout por llamada | 5 s |
| Reintentos máximos | 3 (4 llamadas en total) |
| Backoff | Exponencial, base 500 ms, factor 2, tope 8 s, **jitter completo** |
| Presupuesto total por evaluación | 20 s |
| Breaker: apertura | 5 fallos transitorios consecutivos, o ≥50 % de fallos con mínimo 10 llamadas en ventana de 60 s |
| Breaker: OPEN | 30 s sin llamar al proveedor |
| Breaker: HALF_OPEN | 1 sonda; éxito → CLOSED, fallo → OPEN |
| Alcance | Un breaker por proveedor (`BANK_MOCK`, `BUREAU_MOCK`) |

## 3. Tabla A — Clasificación (implementada en `isTransient` y `callWithTimeout`)

| Situación | Estado | ¿Reintentar? | ¿Cuenta para breaker? |
|---|---|---|---|
| Respuesta con datos | `SUCCESS` | No aplica | No (cuenta como éxito) |
| «Sin registros» | `NO_DATA` | **No** | **No** (cuenta como respuesta válida) |
| `UNAVAILABLE` devuelto por el proveedor | `UNAVAILABLE` | Sí | Sí |
| Timeout (> 5 s) | `UNAVAILABLE` (`errorCode = TIMEOUT`) | Sí | Sí |
| Excepción lanzada por el proveedor (p. ej. `ServiceUnavailableException`) | `UNAVAILABLE` (`errorCode = PROVIDER_EXCEPTION`) | Sí | Sí |
| `ERROR` con `retryable: true` (p. ej. `BUREAU_TIMEOUT`) | `ERROR` | Sí, máx. 3 | Sí |
| `ERROR` con `retryable: false` | `ERROR` | **No** | No |
| Breaker `OPEN` | `UNAVAILABLE` (`errorCode = CIRCUIT_OPEN`) | No se llama al proveedor | — |

**Decisión tomada (a aprobar):** se reintenta según `retryable`, no según el nombre del estado. Se respeta `retryAfterMs` si un resultado lo trae (tope 8 s).

Nota de alcance: los mocks son servicios internos del backend, no HTTP. Los códigos 429/5xx no los emite el mock actual; la lógica de `retryAfterMs` y de reintento se verifica con proveedores simulados en las pruebas, no con tráfico HTTP real.

## 4. Tabla B — Breaker (implementada)

| Estado | Comportamiento | Transición |
|---|---|---|
| `CLOSED` | Llamadas normales | → `OPEN` con 5 fallos consecutivos o ≥50 % con mínimo 10 llamadas en 60 s |
| `OPEN` | Respuesta inmediata `UNAVAILABLE`, sin llamar al proveedor | → `HALF_OPEN` a los 30 s |
| `HALF_OPEN` | Permite 1 sonda; el resto se rechaza | Éxito → `CLOSED`; fallo → `OPEN` (otros 30 s) |

**Decisión C1 (a aprobar):** el breaker es **por instancia y en memoria** (opción a). Con 2 instancias de API, cada una lo aprende por separado, y al reiniciar una instancia vuelve a `CLOSED`. Es una limitación declarada del MVP.

## 5. Tabla C — Qué pasa con el mock (T07)

| El mock hace | Resultado | Verificado en |
|---|---|---|
| Responde lento (> timeout) | Corte por timeout → `UNAVAILABLE`, reintento según T03 | `resilient-executor.spec.ts` (T01) |
| Responde con `retryAfterMs` (equivalente a 429) | Espera `retryAfterMs` (con tope) y reintenta | `resilient-executor.spec.ts` |
| Fallo persistente | Reintentos agotados → `UNAVAILABLE`; el breaker abre en el umbral; luego responde sin llamar | `resilient-executor.spec.ts`, `resilient-sources.spec.ts` |
| Se recupera | Tras 30 s, 1 sonda; si responde bien, `CLOSED` | `circuit-breaker.spec.ts`, `resilient-executor.spec.ts` |
| Responde `NO_DATA` | Sin reintentos, sin efecto en el breaker | `resilient-executor.spec.ts`, `resilient-sources.spec.ts` |
| Lanza excepción | Se convierte en `UNAVAILABLE`, no se propaga | `resilient-executor.spec.ts`, `resilient-sources.spec.ts` |

## 6. Estado por subtarea

| Ticket | Subtarea | Estado | Evidencia |
|---|---|---|---|
| DC-250 | T01 Timeouts | **Hecha** | Test «corta una llamada lenta por timeout» |
| DC-251 | T02 Clasificador | **Hecha** | `isTransient` + tests de `ERROR` retryable/no retryable y de excepciones |
| DC-379 | T03 Política de intentos | **Hecha** | Tests: máx. 3 reintentos con esperas 500/1000/2000 ms; no supera el presupuesto de 20 s |
| DC-380 | T04 Breaker | **Hecha** | 7 tests de `circuit-breaker.spec.ts` + tests de integración |
| DC-381 | T05 Métricas | **Parcial** | `ProviderMetrics` (llamadas, estados, reintentos, latencia p50/p95/p99, estado del breaker, cambios) y log de cada cambio de estado del breaker. **Falta:** `correlationId` desde la petición, `tenantId`/`instanceId`, exponer `snapshot()` y alertas; depende de RF-05 |
| DC-382 | T06 No reintentar | **Hecha en el wrapper** | Tests de `NO_DATA` y `ERROR retryable=false`. Ver nota 1 en sección 9 |
| DC-383 | T07 Escenarios del mock | **Hecha** | Tabla C |
| DC-384 | T08 Propagación | **Parcial** | `EvaluationSourceResult.status` y `Evaluation.status` ya se guardan. **Falta:** actualizar `TenantIntegration.status/lastHealthAt/lastErrorCode` (`DEGRADED` cuando el breaker abre) y leerlo en el panel de operador; depende de RF-05 y HU-23 |
| DC-385 | T09 Tormentas | **Hecha** | Solo `ResilientSources` reintenta; los tests cuentan llamadas reales con `toHaveBeenCalledTimes` |

## 7. Pruebas de cierre

**Alcance de estas pruebas:** son automáticas, con proveedores simulados y reloj simulado en el ejecutor. Validan la lógica de resiliencia y que el flujo de evaluación sigue funcionando. **No sustituyen** la prueba manual con la API real (sección 8).

**Ejecución:** 2026-10-18 · `apps/api` · `npm run build` y `npm test`
**Resultado:** build sin errores · `Test Suites: 24 passed, 24 total` · `Tests: 148 passed, 148 total` (de ellos, 23 son de resiliencia: 7 del breaker, 12 del ejecutor, 4 del wrapper)

| Prueba de cierre | Resultado esperado | PASS/FAIL | Evidencia (test) |
|---|---|---|---|
| Caída persistente del Buró | Breaker abre en el umbral; llamadas limitadas; respuesta inmediata en `OPEN` sin llamar al proveedor | **PASS** | «caída persistente: el breaker abre y luego responde rápido SIN llamar al proveedor» (executor); «Buró caído: 4 llamadas por consulta, luego el breaker abre…» (wrapper) |
| Recuperación | `HALF_OPEN` con 1 sonda; vuelve a `CLOSED` solo si responde bien | **PASS** | «recuperación: tras 30 s hay 1 sonda…» (executor); «sonda exitosa → CLOSED» y «sonda fallida → OPEN otra vez y espera otros 30 s» (breaker) |
| Bank disponible, Buró caído | Bank sigue respondiendo | **PASS** | «Bank sigue operando aunque el Buró esté caído» (executor y wrapper) |
| `NO_DATA` repetido | No abre el breaker, sin reintentos | **PASS** | «NO_DATA repetido no abre el breaker» (executor y wrapper) |
| Ningún reintento infinito | Máx. 3 reintentos y 20 s por evaluación | **PASS** | «máximo 3 reintentos (4 llamadas)…» y «nunca supera el presupuesto total de 20 s» |
| Conteo de llamadas al mock | Sin tormentas combinadas entre capas | **PASS** (a nivel de wrapper) | `toHaveBeenCalledTimes` en los tests anteriores. Solo `ResilientSources` reintenta |
| Excepción del proveedor no deja la evaluación colgada | La excepción se convierte en `UNAVAILABLE` | **PASS** (a nivel de wrapper) | «una excepción del mock se convierte en UNAVAILABLE» |
| Sin regresiones | Pruebas existentes de evaluaciones, aislamiento multi-tenant y fuentes siguen pasando | **PASS** | 148/148 |

## 8. Prueba manual con la API real — PENDIENTE

Hacerla con la API levantada (`npm run dev`) y un tenant demo con Banco y Buró habilitados. **Esperar 30 s entre un bloque y otro**, porque el breaker es por proveedor y se comparte entre clientes. Anotar fecha, documento, resultado observado y adjuntar captura del log.

| Prueba | Documento | Resultado esperado | Observado | PASS/FAIL |
|---|---|---|---|---|
| Caso normal | normal (p. ej. `7812456`) | `COMPLETED`, sin logs de breaker | | |
| `NO_DATA` x6 | termina en `000` | Sin reintentos, sin `breaker … OPEN`, respuesta rápida; no se muestra como caída | | |
| `ERROR` reintentable | termina en `500` | Hasta 3 reintentos; termina `FAILED` | | |
| Caída persistente, 1.ª vez | termina en `999` | Tarda varios segundos (backoff); `FAILED` | | |
| Caída persistente, 2.ª vez | termina en `999` | Log `[BUREAU_MOCK] breaker CLOSED -> OPEN` | | |
| Caída persistente, 3.ª vez | termina en `999` | Respuesta inmediata (breaker `OPEN`) | | |
| Banco responde con Buró abierto | cliente normal | El detalle muestra la fuente Banco con datos | | |
| Recuperación | cliente normal, tras 30 s | Log `HALF_OPEN -> CLOSED`; `COMPLETED` | | |
| Sin evaluaciones atascadas | historial | Ninguna evaluación en `IN_PROGRESS` tras las fallas | | |

Hasta llenar esta tabla, **no** se declara verificado el comportamiento de extremo a extremo.

## 9. Limitaciones, observaciones y riesgos

1. **Reproceso manual.** El botón «Reintentar» del analista vuelve a llamar a `processEvaluation`, que reconsulta toda fuente no `SUCCESS`, incluida `NO_DATA`. T06 se cumple dentro del wrapper (un `NO_DATA` no se reintenta automáticamente), pero el reproceso manual de una evaluación `INCOMPLETE` sigue consultando de nuevo. Es una decisión pendiente de DC-151 (qué se puede reintentar y cuántas veces).
2. **Breaker por instancia y en memoria (C1).** Con 2 instancias no se comparte; al reiniciar la API vuelve a `CLOSED`.
3. **Métricas solo en memoria.** No hay endpoint ni panel que las muestre.
4. **El breaker es por proveedor, no por tenant.** Un fallo de `BUREAU_MOCK` abre el breaker para todos los tenants durante 30 s. Es el diseño de DC-148; también afecta a las pruebas manuales.
5. **Latencia de la petición.** El procesamiento es síncrono: ante una caída, una consulta puede tardar varios segundos (esperas de backoff). El presupuesto de 20 s incluye el tiempo transcurrido, pero una última llamada iniciada cerca del límite puede extenderlo hasta un timeout (5 s).
6. **Riesgo 1 (evaluación atascada en `IN_PROGRESS`).** Mitigado para excepciones de los mocks (ahora se convierten en `UNAVAILABLE` y la evaluación termina `FAILED`). **No** cubre una caída de la instancia a mitad de la petición; eso requiere criterio de recuperación por tiempo o lease (B7/C3, OPS-04). Verificar en la prueba manual.
7. **Riesgo 2 (dos procesamientos simultáneos de la misma evaluación).** No se resuelve aquí; no hay bloqueo (B7/C3).
8. **Riesgo 3 (resultado parcial).** Sin cambios: Banco OK + Buró `UNAVAILABLE`/`ERROR` termina `FAILED` recuperable; se conserva el resultado `SUCCESS` de la fuente que respondió y no se genera perfil parcial (decisión de DC-151 §8, a aprobar).
9. **Valores propuestos.** Los de DC-148 §4 siguen sin aprobación del Product Owner y del equipo; se pueden cambiar con las variables de entorno sin tocar código.
10. **Un `UNAVAILABLE` nunca se muestra como crédito rechazado.** El estado de la evaluación pasa a `FAILED` con `failureCode` de la fuente; la regla de negocio no cambió.

## 10. Sección RF-05 — a completar por el compañero

> **[PENDIENTE — RF-05]** Debe definir: qué se registra en logs/métricas/auditoría, datos prohibidos (CI/NIT, ingresos, deudas, tokens, payloads), reglas de redacción, correlación segura, quién consulta qué, y condiciones de alerta al operador. T05 (DC-381) y T08 (DC-384) no se cierran hasta tenerlo.

Lo que el código actual ya respeta: no escribe CI/NIT, ingresos, deudas, tokens ni payloads. Solo registra `providerCode`, estado, latencia, intentos y cambios de estado del breaker (los logs de cambio de estado no incluyen `tenantId` ni datos del sujeto).

## 11. Pendientes

1. Ejecutar y documentar la prueba manual (sección 8).
2. Aprobación del equipo de los valores de DC-148 §4 y de la decisión C1 (breaker por instancia).
3. RF-05: qué registrar, correlación y alertas. Luego cerrar T05 (correlación, `instanceId`, exposición de métricas) y T08 (`lastHealthAt`, `lastErrorCode`, `DEGRADED`, panel de operador).
4. Decidir con DC-151 si el reproceso manual de `INCOMPLETE` y `NO_DATA` se limita.
5. B7/C3: recuperación de evaluaciones `IN_PROGRESS` huérfanas (OPS-04).
