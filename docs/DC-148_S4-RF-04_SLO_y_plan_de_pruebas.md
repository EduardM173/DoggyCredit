# DC-148 — S4-RF-04: SLO y plan de pruebas de rendimiento, resiliencia y disponibilidad

**Tipo:** Task · **Sprint:** 4 · **Bloquea:** HU-23, HU-25, OPS-02/03/04
**Estado:** BORRADOR PARA APROBACIÓN DEL EQUIPO. Nada de lo marcado `[A ACORDAR]` o `PROPUESTA` es decisión tomada hasta que Product Owner y Developers lo aprueben.

## 1. Alcance y qué NO se afirma

- El objetivo **<500 ms** aplica a **consultas internas sobre datos ya almacenados** (historial, detalle de evaluación, dashboard, plan/consumo, clientes).
- **No** aplica a una evaluación nueva que llama a Bank Mock / Buró Mock. Esa operación es asíncrona y no tiene objetivo de 500 ms.
- **No se fija** RPO/RTO ni volumen de tráfico real: no figuran en las fuentes. Se **miden** en la demo y se reportan; no se prometen.
- Dos instancias de API con una sola BD **no** es HA end-to-end. La BD queda registrada como punto único de fallo.

## 2. Escenario de carga reproducible

| Elemento | Definición |
|---|---|
| Tenants | Banco X y Banco Y (mínimo 2), datos ficticios deterministas, CI/NIT coincidentes en ambos para detectar fuga |
| Infraestructura | 2 instancias NestJS + balanceador + 1 PostgreSQL. Anotar CPU/RAM/versión de cada componente en el reporte |
| Volumen inicial | Evaluaciones e historial por tenant: `[A ACORDAR]`. Debe ser desigual (X con más datos que Y) |
| Usuarios simultáneos | `[A ACORDAR]` por tenant. Perfil X (carga alta) vs Y (carga base) |
| Warm-up | Fase inicial descartada de las mediciones. Duración `[A ACORDAR]` |
| Herramienta | k6, Artillery o JMeter (elegir una; guardar script y comando en el repo) |
| Endpoints medidos | Listado y detalle de historial, dashboard, plan/consumo, listado de clientes |
| Excluido | Creación de evaluación nueva con llamadas a mocks externos |

**Escenario noisy neighbor (X/Y desequilibrado):** X ejecuta carga alta sostenida (consultas + evaluaciones) mientras Y mantiene carga normal. Se mide la latencia de Y **antes y durante** el pico de X.

## 3. Umbrales de rendimiento

| Métrica | Umbral | Origen |
|---|---|---|
| Latencia consultas almacenadas | **< 500 ms** | Documento Maestro |
| Percentil de aceptación | **p95** (se reportan también p50 y p99) | PROPUESTA, a aprobar |
| Tasa de error durante la medición | `[A ACORDAR]`; un 500 rápido NO cuenta como latencia exitosa | Criterio SRE |
| Degradación de Y bajo pico de X | `[A ACORDAR]` (cuánto puede subir p95 de Y) | — |
| Error budget | Opcional; decidir si se usa | — |

Si el resultado incumple, se abre defecto y **no** se declara cumplido el requisito.

## 4. Resiliencia frente a proveedores (Bank Mock / Buró Mock)

Valores propuestos como punto de partida; ajustar tras pruebas.

| Parámetro | Valor PROPUESTO |
|---|---|
| Timeout por llamada | 5 s |
| Reintentos máximos por llamada | 3 (finitos, sin reintento infinito) |
| Backoff | Exponencial con jitter: base 500 ms, factor 2, tope 8 s |
| Presupuesto total de reintentos por evaluación | 20 s en total, luego se marca la fuente `UNAVAILABLE` |
| Ventana del breaker | 60 s (ventana deslizante) |
| Umbral de apertura | 5 fallos transitorios consecutivos o ≥50 % de fallos con mínimo 10 llamadas en la ventana |
| Estado OPEN | 30 s sin llamar al proveedor |
| HALF_OPEN | 1 sonda controlada; éxito → CLOSED; fallo → OPEN otra vez |
| Alcance del breaker | Por proveedor (Bank / Buró), **no** global. Decidir si es por instancia o compartido (`[A ACORDAR]`) |

**Clasificación de respuestas**

| Respuesta | ¿Reintentar? | ¿Cuenta para el breaker? |
|---|---|---|
| `SUCCESS` | No aplica | No |
| `NO_DATA` | **No** | **No** (respuesta válida) |
| `UNAVAILABLE`, timeout, 5xx, 429 | Sí, dentro del presupuesto | Sí |
| `ERROR` con `retryable: true` (ej. `BUREAU_TIMEOUT`) | Sí, dentro del presupuesto | Sí |
| `ERROR` con `retryable: false` (4xx de contrato, payload inválido) | **No** | No |

## 5. Alertas

| Condición | Alerta |
|---|---|
| Breaker abierto de un proveedor | Sí, una sola alerta agregada (no una por solicitud) |
| p95 de consultas almacenadas > 500 ms sostenido | Sí. Duración sostenida `[A ACORDAR]` |
| Tasa de error por encima del umbral acordado | Sí |
| Sin señal de salud reciente de un proveedor | Estado «sin señal reciente», no «operativo» |
| `NO_DATA` repetido | **No** genera alerta de caída |

## 6. Casos de prueba

| ID | Caso | Resultado esperado |
|---|---|---|
| PR-01 | Carga X+Y con warm-up, consultas almacenadas | p95 < 500 ms, error dentro del umbral; reporte con p50/p95/p99 |
| PR-02 | Noisy neighbor: X en pico, Y normal | Y dentro de la degradación acordada; sin fuga de datos entre tenants |
| PR-03 | Errores inyectados durante la medición | Se registran como error, no se promedian como latencia buena |
| PR-04 | Buró devuelve 5xx/timeouts persistentes | Breaker abre en el umbral; llamadas limitadas; Bank sigue operando |
| PR-05 | Buró se recupera | HALF_OPEN con sonda; vuelve a CLOSED solo con evidencia |
| PR-06 | Buró responde `NO_DATA` repetido | Sin reintentos, sin apertura de breaker, sin alerta de caída |
| PR-07 | Error permanente de contrato | Sin reintentos; estado `ERROR` correcto |
| PR-08 | Detener una instancia API durante carga | La otra atiende; la evaluación persistida se consulta; el balanceador deja de enviar tráfico a la caída |
| PR-09 | Reinicio durante evaluación `IN_PROGRESS` | La evaluación se recupera o termina con error explícito; sin duplicar consumo |
| PR-10 | Backup y restauración en entorno aislado | Datos de ambos tenants íntegros, sin mezcla; **RPO/RTO medidos y reportados**, no prometidos |
| PR-11 | Señal de salud vencida | Estado «sin señal reciente» |

## 7. Evidencia por prueba

ID · fecha · build · entorno (hardware) · comando/script · resultado (p50/p95/p99, errores) · PASS/FAIL · enlace al defecto si falla.

## 8. Verificación contra `schema.prisma` y `seed.ts`

**Datos de partida del seed (solo development/test):**
- Tenants listos para la prueba: `banco-del-sol-demo` (X) y `banco-luna-demo` (Y). `banco-pendiente-demo` no está listo y no sirve para carga.
- El seed **no crea evaluaciones** ni volumen de historial. Hace falta un script aparte de generación de datos para el escenario de carga (volumen desigual X/Y). Ese script debe ser solo para entorno de prueba.
- Los clientes demo tienen CI distintos (`7812456` en X, `8899001` en Y). Para la prueba de fuga se debe **crear en Y un cliente con el mismo CI que uno de X** (el esquema lo permite: unicidad por `tenantId + documentType + documentNumber`).
- El seed crea solo el proveedor `BANK_MOCK`. **No crea el proveedor de Buró** (`IntegrationKind.CREDIT_BUREAU`), así que PR-04 a PR-07 necesitan que el Buró Mock esté registrado como `IntegrationProvider` y habilitado en `TenantIntegration` para ambos tenants.
- Los productos demo de empresa se crean inactivos; para evaluar empresa hay que activarlos desde la UI (sin SQL).

**Qué ya soporta el esquema para estas pruebas:**
- Estados de proveedor: `IntegrationProvider.status` (global), `TenantIntegration.status`, `lastHealthAt`, `lastErrorCode` (por tenant). Sirven para «estado por proveedor/ámbito» y para «sin señal reciente» (comparar `lastHealthAt`).
- Índices por `tenantId + fecha/estado` en `Evaluation`, `Client`, `UsageRecord`: son la base para cumplir <500 ms; se verifican con el reporte de carga.
- Patrón de recuperación con lease (`lockedAt`, `leaseToken`, `nextAttemptAt`) existe en `TenantProvisioning` y en envío de invitaciones; **no** en `Evaluation`.

**Brechas para PR-04/05/08/09:**

| # | Brecha | Efecto |
|---|---|---|
| C1 | No hay tabla de estado del circuit breaker | Con 2 instancias, un breaker en memoria no se comparte. Decidir: por instancia (aceptado y documentado) o compartido vía BD |
| C2 | `TenantIntegration.status` es por tenant; no hay salud global observada por proveedor aparte de `IntegrationProvider.status` | Decidir de dónde sale el estado «operativo observado / degradado / sin señal» a nivel plataforma |
| C3 | `Evaluation` no tiene lease/lock | PR-09 (reinicio durante `IN_PROGRESS`) necesita criterio de recuperación por tiempo o un mecanismo equivalente (ver DC-151, B7) |
| C4 | Sin tabla de jobs de evaluación | Confirmar en el código si la evaluación corre síncrona en la petición o en proceso asíncrono; define PR-08/09 |

## 8.1. Resuelto con el código (rama sprint-4)

- **C4 resuelto:** la evaluación se procesa **de forma síncrona dentro de la petición** (`IN_PROGRESS` → consulta Banco → consulta Buró → resultado). No hay cola ni worker de evaluaciones. PR-09 (reinicio durante `IN_PROGRESS`) se traduce a: si la instancia cae a mitad de la petición, la evaluación queda `IN_PROGRESS`; hoy el único modo de salir es volver a procesarla manualmente. Eso es un riesgo a probar, no un comportamiento garantizado.
- **Los mocks son internos al backend** (no HTTP) y se controlan por el final del documento (`…999` UNAVAILABLE, `…500` ERROR, `…000` NO_DATA). Los casos PR-04 a PR-07 se pueden ejecutar con esos CI/NIT sin tocar la BD. «Timeout» y «429/5xx» requieren que el wrapper del adapter los simule (ver S4-OPS-03).
- **El proveedor `BUREAU_MOCK` no lo crea el `seed.ts` revisado** (solo `BANK_MOCK`). Verificar que se cree por migración o por el flujo de preparación del tenant; si no existe, el Buró aparece como no disponible.
- **No hay `UsageRecord` ni actualización de `lastHealthAt`** en el código actual: los endpoints de plan/consumo y la señal de salud por proveedor dependen de OPS-01 y OPS-03.

## 9. Pendientes de aprobación

Volumen de datos, usuarios simultáneos, duración de warm-up, umbral de error, degradación tolerada de Y, alcance del breaker (instancia vs compartido, C1), uso de error budget, confirmación de los valores PROPUESTOS de la sección 4, y registro del Buró Mock en el seed de prueba.
