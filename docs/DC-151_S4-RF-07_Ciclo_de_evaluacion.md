# DC-151 — S4-RF-07: Ciclo de evaluación, reintentos, frescura y autorización

**Tipo:** Task · **Sprint:** 4 · **Bloquea:** HU-20, HU-23, HU-25, OPS-01/04/07
**Estado:** BORRADOR PARA APROBACIÓN. Las reglas son PROPUESTAS salvo que ya estén implementadas en S2/S3: contrastar con el código real antes de aprobar. No crea un módulo nuevo.

## 1. Momentos de la Evaluation

| Momento | Definición propuesta |
|---|---|
| Creación | Al confirmar «Iniciar evaluación» (autorización ya registrada). Se fija `evaluationId` |
| Inicio | Cuando pasa a `IN_PROGRESS` y se lanzan las consultas a fuentes |
| Cierre | Al llegar a `COMPLETED`, `FAILED` o `INCOMPLETE` final. Se congelan snapshots y versiones |

Al crear/iniciar se capturan: versión de reglas, versión de perfil, versión/snapshot de productos del tenant, fuentes usadas, sujeto y autorización. Ningún cambio posterior altera lo capturado.

## 2. Tabla de estados × acciones × evidencia × conteos

| Estado | ¿Reintentar la misma? | ¿Nueva Evaluation? | Evidencia | Evaluations nuevas | UsageRecord nuevo |
|---|---|---|---|---|---|
| `DRAFT` | Continuar editando/iniciar | No (es la misma) | Aún no capturada | 0 | 0 hasta iniciar |
| `IN_PROGRESS` | **No** (se consulta el estado persistido) | No | En captura | 0 | 0 |
| `INCOMPLETE` (recuperable) | **Sí**, solo fuentes fallidas (`UNAVAILABLE`/error transitorio), dentro del límite de reconsulta | No | Se agrega intento; lo ya obtenido se conserva | 0 | 0 (mismo intento comercial) |
| `INCOMPLETE` (final) | **No** | **Sí**, si el usuario lo decide | Snapshot final intacto | 1 | Según RF-03 |
| `FAILED` | Sí si la causa es transitoria y la política lo permite; si no, nueva | Opcional | Se registra el intento | 0 si reintento / 1 si nueva | 0 si reintento / según RF-03 si nueva |
| `COMPLETED` | **Nunca** | **Sí**, explícita | Snapshot inmutable | 1 | Según RF-03 |

**Decisión a registrar:** `INCOMPLETE` es *recuperable* mientras haya fuentes reintentables y no venza el límite `[A ACORDAR]`; luego pasa a *final*. Un resultado final nunca se sobrescribe. Consultar el historial **no** recalcula ni reconsulta proveedores.

Reglas adicionales:
- Respuesta tardía de un proveedor después de `FAILED`/`COMPLETED` no cambia el estado.
- Dos workers sobre la misma evaluación: una sola transición válida.
- Límite de reconsultas a fuentes por evaluación: `[A ACORDAR]`.

## 3. Regla de idempotencia

**Clave de operación = `tenantId` + `actorId` + tipo de operación + `idempotencyKey` + huella (hash) del payload.** No es solo CI/NIT.

| Situación | Resultado |
|---|---|
| Misma clave, mismo payload (doble clic, reenvío por timeout) | Devuelve la misma Evaluation; **0** Evaluations y **0** UsageRecord nuevos |
| Misma clave, payload distinto | **Conflicto (409)**; no se mezcla ni se contabiliza |
| Clave nueva, mismo sujeto, otra decisión del analista | **Nueva Evaluation** (si hay autorización vigente); 1 unidad según RF-03 |
| Reintento de fuente de la misma evaluación recuperable | Misma Evaluation; se registra el intento; no se duplica consumo |

Caducidad de la clave: `[A ACORDAR]`. Restricción única en BD + transacción; la contabilización sale de una sola ruta de escritura en backend.

## 4. Consentimiento / autorización simulada

- Se registra por **sujeto** (tipo+número de documento dentro del tenant), **fuentes** consultadas, **finalidad**, **actor** y **fecha/hora**.
- Se captura al iniciar y se guarda con la Evaluation.
- Si cambia el sujeto, o la finalidad/fuentes, se exige **nueva autorización**; nunca se hereda la anterior.
- Un reintento de la misma evaluación usa la autorización original solo para las mismas fuentes y finalidad.
- Una nueva Evaluation del mismo sujeto requiere autorización vigente `[A ACORDAR: ¿se reutiliza dentro de una ventana o siempre nueva?]`. Propuesta segura: siempre nueva.
- Al reintentar o leer se revalida que el actor siga autorizado (membresía vigente, plan/cuota).

## 5. Frescura, cobertura y conflictos

- Cada dato guarda su fuente, `asOf` (fecha del dato) y `fetchedAt` (fecha de consulta), y se muestran.
- Umbral de «dato desactualizado» por fuente: `[A ACORDAR]`.
- Dato ausente o no calculable = `null` / «no disponible». **Nunca se completa con 0.**
- `NO_DATA` ≠ deuda cero ≠ rechazo. `UNAVAILABLE` ≠ información negativa del solicitante.
- Fuentes con períodos distintos o contradictorias: se muestran ambas con procedencia; la regla de prioridad entre fuentes se decide por indicador `[A ACORDAR]`; no se resuelve en silencio.
- Un indicador que depende de un dato desactualizado o ausente se marca «no evaluable» o «con limitaciones» según la tabla de reglas aprobada.

## 6. Ejemplos de verificación

**E1. Doble clic.** Carlos pulsa «Iniciar» dos veces (misma clave y payload). → 1 Evaluation, 1 unidad de consumo según RF-03.

**E2. Dos reevaluaciones legítimas.** Carlos evalúa al mismo cliente hoy y otra vez la semana siguiente con clave nueva. → 2 Evaluations independientes, cada una con su snapshot; la primera no cambia.

**E3. Bank actualizado, Buró desactualizado.** Bank devuelve `SUCCESS` reciente; Buró devuelve datos con `asOf` anterior al umbral. → Se muestran ambas fechas; los indicadores dependientes del Buró quedan con limitaciones; no se asumen ceros.

**E4. Producto editado después.** Ana modifica un producto tras un resultado `COMPLETED`. → El resultado conserva el snapshot y la versión originales; una nueva evaluación usaría el producto actualizado.

**E5. Consentimiento de otro sujeto.** Carlos autoriza a la persona A y luego intenta evaluar a la persona B. → Se exige nueva autorización; la de A no se reutiliza.

## 7. Verificación contra `schema.prisma` (versión sprint-4)

**Coincide con el esquema:**
- Estados `EvaluationStatus`: `DRAFT, IN_PROGRESS, COMPLETED, INCOMPLETE, FAILED`. Estados de fuente `SourceResultStatus`: `SUCCESS, NO_DATA, UNAVAILABLE, ERROR`.
- Idempotencia: `Evaluation.idempotencyKey` y `Evaluation.requestFingerprint` (huella del payload) ya existen. `UsageRecord.idempotencyKey` también.
- Versiones capturadas: `Evaluation.ruleVersion`, `FinancialProfile.profileVersion`, `EvaluationRecommendation.ruleVersion` y `productSnapshot` (HF-06; las filas anteriores a ese hotfix quedan en `NULL`).
- Un solo UsageRecord por evaluación es verificable con `UsageRecord.referenceType/referenceId` (`metric = EVALUATION`).
- Intentos por fuente: `EvaluationSourceResult.attemptCount`, `requestedAt`, `respondedAt`.
- Historial inmutable: las relaciones usan `onDelete: Restrict`.

**Brechas detectadas (decidir en este RF; no implican cambiar el esquema):**

| # | Brecha | Decisión propuesta |
|---|---|---|
| B1 | `idempotencyKey` es `@unique` **global**, no por tenant ni actor. Dos tenants con la misma clave chocarían (y se filtraría que la clave existe) | Decidir: unicidad `(tenantId, idempotencyKey)` o claves generadas con prefijo/UUID por tenant. Hasta entonces, la comparación de `requestFingerprint` debe hacerse solo dentro del tenant |
| B2 | `requestFingerprint` es nullable | Exigirlo siempre en creación nueva; si es `NULL`, no se puede detectar conflicto de payload |
| B3 | No hay campo de **caducidad** de clave | Decidir si hace falta; sin campo, la clave no caduca (la unicidad es permanente) |
| B4 | Consentimiento: solo `consentGivenAt` + `purpose` + `createdByMembershipId` + `applicantSnapshot`. **No** se guardan las fuentes autorizadas | Registrar las fuentes autorizadas dentro de `applicantSnapshot` o definir que equivalen a las integraciones habilitadas al iniciar |
| B5 | No existe un campo que distinga `INCOMPLETE` recuperable de final | Derivar la regla de `EvaluationSourceResult` (hay fuente `UNAVAILABLE`/`ERROR`) + ventana desde `completedAt`; o añadir un indicador. Decidir |
| B6 | No hay `asOf` (fecha del dato) en `EvaluationSourceResult`; solo `requestedAt`/`respondedAt` | `asOf` debe venir dentro de `normalizedPayload` por contrato del mock, o la frescura se mide solo con `respondedAt` |
| B7 | `Evaluation` no tiene campos de lease/lock (sí los tiene `TenantProvisioning`) | Para recuperar `IN_PROGRESS` huérfanas (OPS-04) se necesita un criterio por tiempo desde `startedAt`, o el mismo patrón de lease |
| B8 | `EvaluationSourceResult` no tiene unicidad por `(evaluationId, providerId)` | Decidir si un reintento actualiza la misma fila (`attemptCount`) o crea otra. Propuesta: misma fila |

## 8. Verificación contra el código real (`evaluations.service.ts`, rama sprint-4)

**Comportamiento actual (corrige la sección 2 donde difiere):**

| Situación | Qué hace el código hoy |
|---|---|
| Crear evaluación | Estado `DRAFT`, con consentimiento y actor guardados en `applicantSnapshot.consent` |
| Procesar | Pasa a `IN_PROGRESS` y consulta Banco y luego Buró, en la misma petición (síncrono, sin cola) |
| Banco o Buró `UNAVAILABLE`/`ERROR` | Evaluación → **`FAILED`** (`failureCode`, `failureMessage`). No hay resultado parcial |
| Banco `NO_DATA` y Buró `NO_DATA` (o Buró no aplica) | Evaluación → **`INCOMPLETE`**, `failureCode = NO_FINANCIAL_DATA`, `completedAt` fijado |
| Al menos una fuente con datos | Perfil + recomendaciones congeladas → `COMPLETED` |
| Procesar de nuevo una evaluación `COMPLETED` | Devuelve el resultado sin recalcular |
| Procesar de nuevo `FAILED` / `INCOMPLETE` / `IN_PROGRESS` | **Se vuelve a ejecutar**: reutiliza fuentes ya `SUCCESS` y reconsulta las demás (`attemptCount + 1`) |

**Qué cambia en las decisiones propuestas:**
- **`INCOMPLETE` en el código significa «sin datos financieros en ninguna fuente»**, no «una fuente falló». La recuperabilidad por fuente caída corresponde hoy a `FAILED`. Decidir si se mantiene así y se ajusta la tabla de la sección 2 (recomendado, porque coincide con la implementación), o si se cambia el código.
- El reintento de la misma evaluación **ya existe** (volver a procesar). Lo que falta es limitarlo: hoy se puede repetir sin límite y sin ventana.
- `INCOMPLETE` se puede reprocesar hoy; la propuesta «INCOMPLETE final no se reintenta» exige un cambio de código o aceptar lo actual.

**Idempotencia (confirmado en código):**
- La búsqueda es solo por `idempotencyKey`; si existe, devuelve esa evaluación. **`requestFingerprint` no se usa en ninguna parte** del código (solo está en el esquema), así que «misma clave con payload distinto → 409» **no está implementado**: se devuelve la evaluación anterior.
- Si la clave pertenece a otro tenant, responde 403 («No tienes acceso a esta evaluación»). Eso confirma a quien la envía que esa clave existe en otro tenant (B1).
- El flujo es «buscar y luego crear» sin captura del error de unicidad. Dos creaciones simultáneas con la misma clave pueden terminar en error en lugar de devolver la misma evaluación.
- Si no se envía clave, se genera un UUID: cada petición sin clave crea una evaluación nueva.

**Consumo (`UsageRecord`):** el servicio de evaluaciones **no escribe `UsageRecord`**. La columna «UsageRecord nuevo» de la sección 2 queda sin comportamiento actual que contrastar; depende de OPS-01 y RF-03.

**Otros:** `ruleVersion` se fija en `"1.0.0"` al crear; el consentimiento guarda actor, fecha y texto de la declaración pero **no las fuentes autorizadas** (B4); no se registra `asOf` de los datos (B6).

**Decisión tomada (propuesta, a aprobar): resultado parcial.** Banco OK + Buró `UNAVAILABLE`/`ERROR` sigue terminando en `FAILED` **recuperable**: se conserva el resultado `SUCCESS` de la fuente que respondió (no se vuelve a consultar al reintentar), no se genera perfil ni recomendación parcial, y la pantalla indica qué fuente aportó datos y cuál falló. Motivo: es el comportamiento ya desarrollado en S3, evita completar con datos faltantes (regla «no inventar ceros») y cumple QA-S4-09 (fallo parcial con acción permitida, sin denegación de crédito). `INCOMPLETE` se mantiene como «sin datos financieros en ninguna fuente».

## 9. Criterio de cierre

HU-25 no pasa a READY hasta que el equipo apruebe la tabla de la sección 2 (ajustada con la sección 8), los `[A ACORDAR]` y la decisión sobre B1–B8.
