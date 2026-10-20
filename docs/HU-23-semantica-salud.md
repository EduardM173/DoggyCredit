# HU-23 · Semántica de salud de integraciones (T01 · DC-187)

Estado: vigente tras T02–T07. Los valores marcados **PROPUESTO** requieren aprobación de RF-04.

## 1. Tres conceptos separados (CA-23.02 / CA-23.13)
| Concepto | Campo | Quién lo decide |
|---|---|---|
| Habilitación institucional | `TenantIntegration.enabled` | Doggy Software / plan de la institución |
| Habilitación global | `IntegrationProvider.globallyEnabled` (HU-30) | PLATFORM_ADMIN |
| Salud observada | Observaciones (`EvaluationSourceResult`) + breaker en memoria | Sistema. Nadie la edita a mano |

Una fuente habilitada **no** implica proveedor sano.

`IntegrationProvider.status` **no es salud observada y no se escribe** desde HU-23: `providerAcceptsQueries()` bloquea toda consulta si `status !== "ACTIVE"`, lo que impediría la sonda half-open del breaker.

## 2. Estados mostrados
`SIN_SENAL_RECIENTE` · `OPERATIVO_OBSERVADO` · `DEGRADADO_OBSERVADO` · `NO_HABILITADO_PARA_TENANT` (este último se calcula por institución, no por proveedor) · y, aparte, **"error de monitoreo"** si la lectura de salud falla (nunca se muestra como operativo).

Reglas (orden de evaluación):
1. Breaker efectivo `OPEN` o `HALF_OPEN` → degradado.
2. Sin observaciones dentro del TTL → `SIN_SENAL_RECIENTE`.
3. Muestras < mínimo → operativo con **confianza baja** (no se degrada automáticamente).
4. Fallos / muestras ≥ umbral → degradado.
5. Si no → operativo, confianza alta.

**Recuperación con evidencia (CA-23.08), `effectiveBreaker`:** con un episodio abierto y el breaker local no `OPEN`/`HALF_OPEN`, solo se considera recuperado con ≥ `minSamples` respuestas válidas (`SUCCESS`/`NO_DATA`) y 0 fallos posteriores al inicio del episodio. Cubre el episodio huérfano tras un reinicio. Pulsar "Actualizar" no cambia el estado.

Observaciones (de `EvaluationSourceResult`, agregadas por `providerId`, una fila = una observación; los reintentos internos de una misma fila no inflan el conteo):
- Fallo: `UNAVAILABLE`, `ERROR`.
- Respuesta válida: `SUCCESS`, **`NO_DATA`** (nunca cuenta como fallo; CA-23.02).

Con muy pocas muestras no se calcula ni muestra porcentaje de uptime (CA-23.12). Mientras el breaker está `OPEN`, las consultas cortadas no llegan al proveedor, por lo que `samples` y `failures` no suben; es coherente.

## 3. Ventana, caducidad y umbrales (CA-23.14)
RF-04 exige definirlos pero el documento de Sprint 4 **no fija valores**; por tanto son `PROPUESTO` y configurables por `.env`:

| Variable | Valor | Estado |
|---|---|---|
| `HEALTH_WINDOW_SECONDS` | 900 | PROPUESTO |
| `HEALTH_SIGNAL_TTL_SECONDS` | 600 (debe ser ≤ ventana) | PROPUESTO |
| `HEALTH_MIN_SAMPLES` | 10 | PROPUESTO |
| `HEALTH_FAILURE_RATIO` | 0.5 | PROPUESTO |

Breaker existente (no modificado): 5 fallos seguidos, ratio 0.5, mínimo 10 llamadas, ventana 60 s, abierto 30 s.
Para pruebas en vivo se baja `HEALTH_MIN_SAMPLES` a 3 y se restaura a 10. Si RF-04 ya tiene valores en Jira, reemplazar aquí y en la config.

## 4. Ámbito del breaker/salud (CA-23.15) — DECIDIDO
- El breaker es **por proveedor, en memoria y por instancia** de la API (`ResilientSources`; limitación C1 de DC-148).
- La UI lo declara: `advanced.scope = "INSTANCIA_API"`, "estado observado por esta instancia".
- Con varias réplicas pueden verse estados distintos; el **episodio** (AuditLog) sí es compartido.
- No hay sincronización global entre instancias: decisión técnica explícita de este alcance.

Traducción del breaker (CA-23.07; los códigos solo en "Información avanzada", nunca a Carlos):
| Técnico | Lenguaje de negocio |
|---|---|
| `CLOSED` | Operativo |
| `OPEN` | Protección temporal activa |
| `HALF_OPEN` | Comprobando recuperación |

## 5. Episodio (CA-23.04 / .16)
Un episodio es una degradación continua de un proveedor, registrada como par de eventos en `AuditLog` (`entityType=IntegrationProvider`, `entityId=providerId`, `tenantId=null`):
- `CLOSED→OPEN`: abre `PROVIDER_DEGRADED`, si no hay uno abierto.
- `OPEN↔HALF_OPEN`: no escribe.
- `HALF_OPEN→CLOSED`: cierra `PROVIDER_RECOVERED` con el **mismo** `episodeId`.
- `metadata` (lista blanca): `providerCode`, `from`, `to`, `episodeId` (UUID estable por episodio).

No hay tablas ni migraciones, ni tickets ni seguimiento manual: la UI no los promete. Los GET leen con `metrics.snapshot()` (no `breaker.getState()`): ninguna consulta escribe.

**Afectados (CA-23.05):** `known:false, count:null` = sin señal (desconocido); `known:true, count:N` = con señal (N puede ser 0).

## 6. Permisos
| Rol | `GET admin/platform/integrations[/:code]` | `GET institution/tenants/:slug/integrations/status` |
|---|---|---|
| Anónimo | 401 | 401 |
| OPERATOR | Diagnóstico agregado | — |
| PLATFORM_ADMIN | Permitido por el guard; en la web solo ve Proveedores (regla HU-30) | — |
| ANALYST, INSTITUTION_ADMIN | 403 | Solo **sus** fuentes, con `{providerName, availability, message}`; sin breaker, conteos ni infraestructura |

URLs, credenciales y secretos no se devuelven por ninguna API de diagnóstico. Todos los endpoints son solo GET.

## 7. Límites abiertos
Ver sección 7 de `HU-23-operacion-integraciones.md`.
