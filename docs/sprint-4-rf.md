# Especificaciones Técnicas y Cierre de Requisitos Fundacionales — Sprint 4 (S4-RF-02, S4-RF-03, S4-RF-05)

Este documento formaliza las decisiones de arquitectura, contratos de datos, modelos de permisos, fórmulas matemáticas y directrices de auditoría para cerrar los Requisitos Fundacionales (Ready Gates) **S4-RF-02**, **S4-RF-03** y **S4-RF-05** del Sprint 4 de DoggyCredit.

---

## S4-RF-02 — Definir necesidades de dashboard y permisos por actor

**Tipo:** Task · **Prioridad:** Bloqueante HU-20 / HU-22.  
**Cierre:** Para cada métrica existe actor, pregunta de negocio, fórmula (numerador y denominador), estados incluidos, período, latencia, manejo de denominador cero, comportamiento ante degradación y acción/navegación a HU-18.

### 1. Frontera Conceptual: Tablero Operativo vs Panel de Decisión Crediticia

* **El Dashboard es un tablero operativo y analítico agregado**: Provee visibilidad de gestión sobre el volumen, distribución, cuota consumida y estado operativo del equipo.
* **Qué NO es el Dashboard**:
  * **No** es un motor de scoring masivo ni altera dictámenes crediticios en lote.
  * **No** recalcula ni muta el pasado: las evaluaciones completadas conservan sus snapshots congelados.
  * **No** expone PII sensible ni registros individuales en tarjetas de resumen.
  * **No** incluye componentes decorativos vacíos: cada tarjeta está estrictamente vinculada a una pregunta operativa y a una navegación interactiva con filtros hacia el listado de evaluaciones ([HU-18](file:///d:/DEV/doggycreadit/apps/web/src/features/institution/EvaluationsList.tsx)).

---

### 2. Preguntas de Negocio por Actor

#### Ana — Administrador Institucional
1. **Volumen del período**: ¿Cuántas evaluaciones ha gestionado la institución en el ciclo actual y cómo se distribuyen por estado (`COMPLETED`, `INCOMPLETE`, `FAILED`, `IN_PROGRESS`)?
2. **Efectividad y colocación**: ¿Qué porcentaje de las evaluaciones completadas resultaron compatibles con al menos un producto crediticio activo de nuestro catálogo?
3. **Composición de cartera**: ¿Cuál es la proporción de solicitudes recibidas entre Personas Naturales (`PERSON`) y Empresas (`COMPANY`)?
4. **Capacidad del plan**: ¿Cuántas evaluaciones hemos consumido frente al límite contratado en nuestro plan mensual y cuándo renueva el ciclo?
5. **Casos trabados / Contingencias**: ¿Cuántas evaluaciones requieren atención inmediata por fallas de fuentes o datos incompletos?

#### Carlos — Analista de Crédito
1. **Bandeja de pendientes**: ¿Cuántas evaluaciones iniciadas por mí están actualmente en `IN_PROGRESS` o `INCOMPLETE` pendientes de reintento o resolución?
2. **Productividad personal**: ¿Cuántas evaluaciones he completado en el período y cuál es la tasa de compatibilidad obtenida?
3. **Acceso directo**: ¿Cómo accedo con 1 clic al caso específico que debo retomar sin buscar en toda la lista?

#### Operador de Plataforma (Backoffice)
1. **Salud del ecosistema**: ¿Qué volumen transaccional global están procesando las instituciones activas?
2. **Disponibilidad de proveedores**: ¿Se encuentra algún proveedor simulado (Banco Mock o Buró Mock) con su Circuit Breaker abierto o degradado afectando a los tenants?
3. **Atención de onboarding**: ¿Existen solicitudes pendientes de revisión o contrataciones con provisionamiento fallido que requieran reintento manual ([HU-28](file:///d:/DEV/doggycreadit/apps/web/src/features/contracting/AdminContractingsPage.tsx))?

---

### 3. Diccionario Exhaustivo de Métricas

| Métrica | Definición | Numerador | Denominador | Manejo de Cero / Vacíos | Recencia y Fuente | Permisos | Acción / Navegación HU-18 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Total Evaluaciones** (`totalEvaluations`) | Volumen de evaluaciones que ingresaron a procesamiento en el período. | $\sum \text{Evaluations}$ con `status` $\in$ `{COMPLETED, INCOMPLETE, FAILED, IN_PROGRESS}` | N/A (conteo absoluto) | Muestra `0` con mensaje "Sin actividad en el período" | Tiempo real (`< 500 ms`) desde réplica de lectura / transaccional. | Admin: tenant completo. Analista: tenant completo. | Clic abre `/:tenantSlug/evaluaciones?status=ALL&from=...&to=...` |
| **Tasa de Finalización** (`completionRate`) | Proporción de evaluaciones procesadas que concluyeron exitosamente con dictamen. | $\text{COUNT}(\text{status} = \text{'COMPLETED'})$ | $\text{COUNT}(\text{status} \in \{\text{'COMPLETED'}, \text{'INCOMPLETE'}, \text{'FAILED'}\})$ | Si denominador = 0, muestra `N/A` (nunca `NaN`, `null` ni error 500) | Agregación indexada sobre `Evaluation(tenantId, status, createdAt)`. | Admin / Analista | Clic abre listado filtrado por `status=COMPLETED`. |
| **Casos que Requieren Atención** (`attentionRequiredCount`) | Evaluaciones detenidas por error transitorio o falta de datos suficientes. | $\text{COUNT}(\text{status} \in \{\text{'FAILED'}, \text{'INCOMPLETE'}\})$ | N/A (conteo absoluto) | Muestra `0` con badge verde "Al día" | Tiempo real. | Admin / Analista | Clic abre `/:tenantSlug/evaluaciones?status=FAILED`. |
| **Tasa de Compatibilidad con Catálogo** (`catalogCompatibilityRate`) | Porcentaje de evaluaciones completadas que encontraron al menos un producto activo recomendado. | $\text{COUNT}(\text{DISTINCT } evaluationId$ con $\text{outcome} = \text{'RECOMMENDED'})$ | $\text{COUNT}(\text{status} = \text{'COMPLETED'})$ | Si denominador = 0, muestra `N/A` | Consulta sobre `EvaluationRecommendation` con `product.active = true`. | Admin / Analista | Clic abre listado con filtro de recomendación favorable. |
| **Distribución Persona vs Empresa** (`scopeDistribution`) | Participación porcentual de solicitantes Persona Natural frente a Empresa. | $\text{COUNT}(\text{applicantSnapshot.type} = T)$ | $totalEvaluations$ | Si denominador = 0, muestra `0% / 0%` | Desglose sobre snapshot congelado. | Admin / Analista | Clic en segmento filtra por `applicantType=PERSON` o `COMPANY`. |
| **Consumo de Capacidad** (`planQuotaUsage`) | Evaluaciones facturables consumidas en el ciclo mensual vigente frente al límite del plan. | $\text{COUNT}(UsageRecord$ con $\text{metric} = \text{'EVALUATION'})$ | `Plan.evaluationsPerMonth` (si `LIMITADO`) | Si cupo es `null`, muestra `ILIMITADO` con barra llena. | Transaccional sobre `UsageRecord(tenantId, occurredAt)`. | Admin: completo con barra de cuota. Analista: solo porcentaje consumido. | Clic abre modal de detalle de plan / solicitud de ampliación. |

---

### 4. Períodos, Zona Horaria y Filtros

* **Período por Defecto**: Últimos 30 días móviles (`last_30_days`).
* **Selector de Rangos Soportados**:
  * Hoy (`today`)
  * Últimos 7 días (`last_7_days`)
  * Últimos 30 días (`last_30_days`)
  * Mes calendario actual (`month_to_date`)
* **Zona Horaria Oficial**: `America/La_Paz` (UTC-4) para el cálculo de límites de día/mes, almacenado en base de datos en UTC (`timestamptz`).
* **Degradación de Proveedores**: Cuando un proveedor simulado (ej. Buró Mock) se encuentra temporalmente en corte global o circuito abierto, el dashboard muestra un **Banner Operativo de Contingencia**: *"Buró de crédito en contingencia temporal. Las evaluaciones se procesan con cobertura bancaria disponible"*. Las métricas históricas no sufren alteración.
* **Privacidad y K-Anonymity (Grupos Pequeños)**: Si un tenant registra $N < 5$ evaluaciones en el período, no se desglosan micro-segmentaciones cruzadas (ej. por analista o rubro específico) para evitar la reidentificación indirecta de solicitantes.

---

## S4-RF-03 — Cerrar modelo comercial de capacidades, límites y consumo

**Tipo:** Task · **Prioridad:** Bloqueante HU-21 / HU-22, OPS-01.  
**Cierre:** Tabla determinista de planes, definición unívoca de unidad facturable, momento exacto de contabilización en base de datos, política estricta al agotar cupo (sin recargos ocultos) y reglas de idempotencia ante reintentos.

### 1. Planes del MVP y Capacidades Contratadas

| Código del Plan | Nombre Comercial | Precio Mensual (BOB) | Cuota Mensual Evaluaciones | Miembros Máximos | Fuentes Financieras | Estado de Capacidad |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BASIC` | Plan Básico | `0.00` (Gratuito) | **50** evaluaciones / mes | 1 Admin + 2 Analistas | Banco Mock | `LIMITADO` |
| `PROFESSIONAL` | Profesional | `349.00` (Simulado) | **500** evaluaciones / mes | 1 Admin + 10 Analistas | Banco Mock + Buró Mock | `LIMITADO` |
| `ENTERPRISE` | Empresarial | `799.00` (Simulado) | **Ilimitado** (`null`) | Ilimitados | Banco Mock + Buró Mock + Resiliencia | `ILIMITADO` |

#### Definición de Estados de Capacidad:
* `LIMITADO`: El plan define un entero positivo en `Plan.evaluationsPerMonth`.
* `ILIMITADO`: `Plan.evaluationsPerMonth` es `null`.
* `NO_CONFIGURADO`: Tenant recién creado previo a la activación de su suscripción.
* `NO_DISPONIBLE`: Suscripción institucional en estado `SUSPENDED` o `ENDED`.

---

### 2. Definición Exacta de Unidad Facturable (`UsageRecord`)

1. **Momento Exacto de Contabilización**:
   * Se crea un registro en la tabla `UsageRecord` **única y exclusivamente** cuando una evaluación pasa del estado `DRAFT` al estado `IN_PROGRESS` (inicio del procesamiento real y consulta a proveedores externos).
   * **Borradores (`DRAFT`)**: No consumen cuota ($0$ costo). Guardar, modificar o descartar un borrador tiene costo nulo.
2. **Reintentos de Fallas Técnicas (`FAILED` / `INCOMPLETE`)**:
   * Si una evaluación falló por indisponibilidad de red o caída de Buró y el analista hace clic en "Reintentar", el procesamiento corre sobre el **mismo** `evaluationId`.
   * **Regla**: **Cero (0)** `UsageRecord` adicionales. Un solo intento comercial cubre la resolución del caso.
3. **Idempotencia y Concurrencia (Doble Clic / Reenvíos)**:
   * La clave de idempotencia del consumo es: `idempotencyKey = "usage_eval_" + evaluationId`.
   * Gracias al índice `@unique` en `UsageRecord.idempotencyKey`, dos peticiones simultáneas sobre la misma evaluación son absorbidas sin duplicar cargos ni cuota.
4. **Nueva Evaluación del Mismo Solicitante**:
   * Si se evalúa a un cliente hoy y en el futuro se genera una nueva evaluación (nuevo `evaluationId`, nuevo consentimiento registrado), constituye un nuevo evento facturable y genera **1 nuevo `UsageRecord`**.

---

### 3. Política al Alcanzar el Límite de Cuota (`QUOTA_EXCEEDED`)

* **Bloqueo Preventivo en Escritura**:
  Cuando `COUNT(UsageRecord en ciclo) >= Plan.evaluationsPerMonth`:
  * Al intentar iniciar el procesamiento (`POST /api/institution/tenants/:tenantSlug/evaluaciones/:id/process`), el backend rechaza la transacción con **HTTP 403 Forbidden**:
    ```json
    {
      "statusCode": 403,
      "code": "PLAN_QUOTA_EXCEEDED",
      "message": "La institución ha alcanzado el límite mensual de 500 evaluaciones contratadas en su plan. Comuníquese con el administrador para solicitar una ampliación.",
      "consumed": 500,
      "limit": 500,
      "renewsAt": "2026-11-01T00:00:00.000Z"
    }
    ```
* **Transparencia en UX ("Sin inventar recargos")**:
  * **No** se permiten cargos adicionales automáticos ni sobregiros no consentidos.
  * Se despliega un banner de advertencia visual en el formulario de nueva evaluación: *"Límite de cuota alcanzado. Contacte a su administrador institucional"*.
* **Preservación Total de la Consulta**:
  * El bloqueo aplica **únicamente al procesamiento de nuevas evaluaciones**.
  * La consulta del historial, el expediente de clientes existentes, los snapshots y el dashboard permanecen **100% operativos y accesibles**.

---

### 4. Tabla de Escenarios Deterministas de Consumo

| Escenario | Acción del Usuario | Estado Inicial | Estado Final | ¿Genera UsageRecord? | Total Consumido | Respuesta HTTP |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Creación de Borrador** | Carlos ingresa CI de solicitante y guarda borrador. | — | `DRAFT` | **No** (0) | 0 | `201 Created` |
| **2. Inicio de Procesamiento** | Carlos confirma consentimiento e inicia evaluación. | `DRAFT` | `IN_PROGRESS` $\to$ `COMPLETED` | **Sí** (+1) | 1 | `200 OK` |
| **3. Doble Clic Rápido** | Carlos presiona dos veces seguidas "Procesar". | `DRAFT` | `IN_PROGRESS` | **No duplica** (1 absorbido) | 1 | `200 OK` (segunda req idempotente) |
| **4. Falla y Reintento** | Buró Mock falla (`FAILED`); Carlos presiona "Reintentar". | `FAILED` | `COMPLETED` | **No** (0 adicional) | 1 | `200 OK` (mismo `evaluationId`) |
| **5. Nueva Evaluación Mismo CI** | Próximo mes, nueva solicitud para el mismo cliente. | — | `COMPLETED` | **Sí** (+1 nuevo `evaluationId`) | 2 | `200 OK` |
| **6. Cuota Agotada (50/50)** | Analista intenta procesar con límite mensual alcanzado. | `DRAFT` | `DRAFT` (bloqueado) | **No** (0) | 50 | `403 Forbidden` (`PLAN_QUOTA_EXCEEDED`) |

---

## S4-RF-05 — Definir auditoría, privacidad y respuesta a incidentes

**Tipo:** Task · **Prioridad:** Bloqueante HU-23 / HU-24, OPS-05.  
**Cierre:** Taxonomía de eventos de negocio, lista negra de datos prohibidos en logs, modelo de permisos de consulta sin acceso indebido a expedientes y protocolo de auditoría de incidentes.

### 1. Taxonomía de Eventos de Negocio a Auditar

Los eventos registrados en `AuditLog` se dividen en dominios de negocio específicos:

| Dominio | Código de Acción (`action`) | Entidad (`entityType`) | Actor Típico | TenantId | Propósito de Seguridad / Cumplimiento |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Autenticación** | `USER_LOGIN_SUCCESS` / `USER_LOGIN_FAILED` | `User` | Usuario / Anónimo | ID o null | Detección de ataques de fuerza bruta y control de accesos. |
| **Autenticación** | `USER_LOGOUT` / `SESSION_EXPIRED` | `InstitutionSession` | Usuario | TenantId | Trazabilidad del cierre y caducidad de sesiones activas. |
| **Membresías** | `ANALYST_INVITATION_CREATED` / `RESENT` | `MembershipInvitation` | Admin Institucional | TenantId | Control del equipo de trabajo y destinatarios de acceso. |
| **Membresías** | `MEMBERSHIP_ACTIVATED` / `REVOKED` | `TenantMembership` | Usuario / Admin | TenantId | Registro formal de alta y revocación inmediata de privilegios ([HU-32](file:///d:/DEV/doggycreadit/apps/api/src/identity-tenants/institution-auth/team.controller.ts)). |
| **Evaluaciones** | `EVALUATION_DRAFT_CREATED` | `Evaluation` | Analista | TenantId | Inicio de trámite y fijación de `idempotencyKey`. |
| **Evaluaciones** | `EVALUATION_PROCESSED` | `Evaluation` | Analista | TenantId | Registro del dictamen (`COMPLETED`, `INCOMPLETE`, `FAILED`) con snapshots congelados. |
| **Expediente** | `CLIENT_DOSSIER_VIEWED` | `Client` | Analista | TenantId | Control de visualización de expedientes financieros (solo lectura). |
| **Catálogo** | `PRODUCT_CREATED` / `UPDATED` / `DEACTIVATED` | `FinancialProduct` | Admin Institucional | TenantId | Versionado y control de modificaciones en políticas crediticias institucionales. |
| **Integraciones** | `PROVIDER_INSTITUTION_ENABLED` / `DISABLED` | `TenantIntegration` | Admin Institucional | TenantId | Habilitación local de fuentes financieras en la institución. |
| **Plataforma** | `PROVIDER_GLOBALLY_ENABLED` / `DISABLED` | `IntegrationProvider` | Operador Plataforma | `null` | Corte global de emergencia de fuentes externas ([HU-30](file:///d:/DEV/doggycreadit/apps/api/src/financial-integrations/provider-administration.service.ts)). |
| **Plataforma** | `PROVISIONING_RETRIED` | `TenantProvisioning` | Operador Plataforma | TenantId | Reintento de provisionamiento tras resolución de incidente ([HU-28](file:///d:/DEV/doggycreadit/apps/api/src/onboarding/onboarding-recovery.controller.ts)). |

---

### 2. Lista Negra Estricta de Datos Prohibidos en Logs y Metadatos

> [!CAUTION]
> **Checklist de Privacidad y Cumplimiento Normativo (PII y Secreto Bancario)**:
> Queda terminantemente prohibido escribir los siguientes datos en `AuditLog.metadata`, en logs de consola de NestJS o en archivos de telemetría:
> 1. **Contraseñas o Credenciales**: Ni en texto plano, ni hashes de contraseñas, ni salts.
> 2. **Tokens Completos de Sesión o Invitación**: Únicamente se permite registrar un prefijo seguro truncado (ej. `tok_ab12****`) o el hash SHA-256 de auditoría.
> 3. **Cuentas Bancarias y Saldos Detallados**: Prohibido persistir números de cuentas completas, saldos líquidos o extractos bancarios en la columna `metadata`.
> 4. **Respuestas Crudas de Buró de Crédito**: Prohibido registrar el payload JSON completo del Buró en auditoría; solo se almacena el resumen normalizado en `EvaluationSourceResult.normalizedPayload`.
> 5. **Información Médica o Datos Sensibles**: Ningún dato de origen no crediticio.

---

### 3. Matriz de Permisos de Consulta de Auditoría

Para evitar que un actor obtenga acceso privilegiado a expedientes confidenciales mediante la auditoría:

| Actor | Alcance de Consulta Permitido | Qué ve en Pantalla | Qué tiene ESTRICTAMENTE PROHIBIDO ver |
| :--- | :--- | :--- | :--- |
| **Operador de Plataforma** | Eventos a nivel plataforma (`tenantId == null`) y trazabilidad de solicitudes de onboarding. | Altas de instituciones, provisionamiento, cortes globales de proveedores, contrataciones y pagos simulados. | **Prohibido**: No tiene acceso a leer expedientes de crédito, clientes, ni evaluaciones internas de ningún banco. |
| **Admin Institucional (Ana)** | Eventos exclusivos de **su institución** (`tenantId == session.tenantId`). | Trazabilidad del equipo (invitaciones, revocaciones), cambios en productos del catálogo y quién evaluó a qué cliente. | **Prohibido**: No puede consultar eventos de otras instituciones ni auditoría global de infraestructura. |
| **Analista de Crédito (Carlos)** | Sin acceso al módulo de auditoría de gestión. | Solo opera en su bandeja de evaluaciones y expedientes permitidos de su institución. | **Prohibido**: No tiene acceso al endpoint ni visor de `AuditLog`. |

---

### 4. Protocolo de Auditoría de Incidentes y Resiliencia

1. **Apertura de Circuit Breaker (`PROVIDER_CIRCUIT_OPEN`)**:
   * Cuando el ejecutor de resiliencia detecta fallos transitorios consecutivos que superan el umbral configurado en `S4-OPS-03` (ej. 5 fallos en 60 s), se registra un evento de auditoría de sistema:
     * `actorUserId: null` (evento automático de sistema).
     * `tenantId: null` (afecta a la plataforma).
     * `action: "PROVIDER_CIRCUIT_OPEN"`.
     * `metadata: { providerCode: "BUREAU_MOCK", failureRate: 0.6, openDurationSeconds: 30 }`.
2. **Notificación no Intrusiva**:
   * La interfaz institucional despliega un banner informativo contextual indicando la degradación de la fuente, sin exponer direcciones IP, credenciales de proveedores ni stack traces técnicos al usuario final.
3. **Restablecimiento del Servicio (`PROVIDER_CIRCUIT_CLOSED`)**:
   * Una vez que la sonda de prueba en estado `HALF_OPEN` responde exitosamente, el circuito se cierra y se audita el restablecimiento de la disponibilidad operativa.
