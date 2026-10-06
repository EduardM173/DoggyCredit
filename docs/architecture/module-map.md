# Mapa de capacidades y contratos

Decision vigente: [ADR-001](ADR-001-soa-modular-monolith.md). Fuente funcional: Documento Maestro, secciones 8-13, 17 y 20. Las asignaciones operativas de modelos de esta iteracion se indican abajo; no agregan funcionalidades al MVP.

## Mapa objetivo

```text
React
  | HTTPS (HTTP local en desarrollo)
NestJS / Express: una aplicacion backend
  |-- Identity & Tenants       [HU-01/HU-02/HU-03/HU-05 implementadas]
  |-- Clients / Expedientes   [frontera documentada]
  |-- Evaluations             [frontera documentada]
  |-- Financial Integrations  [frontera documentada]
  |-- Financial Profile       [frontera documentada]
  |-- Recommendations         [frontera documentada]
  |-- Plans & Metering         [contratacion/pagos HU-04 y suscripcion HU-05]
  `-- Audit                   [decisiones HU-03 y eventos HU-04/HU-05]
       Todas las capacidades usan infraestructura segun necesidad:
       Prisma / PostgreSQL / configuracion / adapters externos
```

El schema ya contiene modelos futuros. Eso no significa que existan servicios ejecutables para ellos. No crear modulos vacios a partir del diagrama.

HU-10 implementa Clients y Evaluations: Evaluations consume ApplicantRecords de Clients, los guards/contexto y readiness públicos de Identity, y AuditWriter. Identity no depende de Evaluations. Se guarda Client + Evaluation DRAFT + auditoría en DatabaseUnitOfWork, sin llamar a Integrations ni a Financial Profile. Ver [HU-10](../hu-10.md).

## Responsabilidades y propiedad logica

| Capacidad / slug de codigo                        | Responsabilidad y datos propios                                                                                                                                                                                       | Limite                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Identity & Tenants / `identity-tenants`           | Identidad global, autenticacion, solicitudes, verificacion, memberships, tenant context y provisioning. `InstitutionRequest`, `EmailVerificationToken`, `User`, `Tenant`, `TenantMembership`, `MembershipInvitation`. | InstitutionRequest es una feature interna. Provisioning coordina asignacion de plan por el contrato del propietario.          |
| Clients / Expedientes / `clients`                 | Identidad del solicitante, informacion editable, busqueda e historial relacionado. `Client`.                                                                                                                          | El historial de evaluaciones se obtiene de Evaluations; no reescribe snapshots ni datos financieros derivados.                |
| Evaluations / `evaluations`                       | Caso, estados, consentimiento, idempotencia, coordinacion, snapshots y resultado general. `Evaluation`, `EvaluationSourceResult`.                                                                                     | Orquesta consultas y conserva el resultado por fuente de cada caso; no calcula perfiles ni normaliza payloads de proveedores. |
| Financial Integrations / `financial-integrations` | Bank Mock, Credit Bureau Mock, futuros proveedores, adapters y respuestas normalizadas. `IntegrationProvider`, `TenantIntegration`.                                                                                   | Devuelve datos normalizados y estados SUCCESS/NO_DATA/UNAVAILABLE/ERROR; no decide recomendaciones.                           |
| Financial Profile / `financial-profile`           | Transformacion de datos normalizados, procedencia y version del perfil. `FinancialProfile`, `ProfileSource`.                                                                                                          | No conoce SDKs ni formatos particulares de proveedores.                                                                       |
| Recommendations / `recommendations`               | Productos del tenant, evaluacion del perfil contra productos activos y razones explicables. `FinancialProduct`, `FinancialProductPurpose`, `EvaluationRecommendation`, `RecommendationReason`.                        | Reglas deterministas versionadas; no aprueba creditos ni mantiene un catalogo global sustituto del tenant.                    |
| Plans & Metering / `plans-metering`               | Planes, capacidades, suscripcion y consumo. `Plan`, `TenantSubscription`, `UsageRecord`.                                                                                                                              | No crea identidades ni tenants; consumo idempotente por analisis/scoring cuando se defina.                                    |
| Audit / `audit`                                   | Eventos de negocio y trazabilidad. `AuditLog`.                                                                                                                                                                        | Recibe hechos/contexto minimo; no consulta arbitrariamente todas las tablas. Logging tecnico es infraestructura separada.     |

El maestro define capacidades y modelos, pero no asigna expresamente cada tabla a un modulo. Esta iteracion fija como convencion operativa `EvaluationSourceResult` en Evaluations (snapshot del caso) y el catalogo `FinancialProduct*` en Recommendations (junto a sus reglas consumidoras). Son decisiones arquitectonicas refinables mediante ADR al implementar sus HUs, no nuevas funcionalidades ni decisiones funcionales previamente DEFINIDAS por el maestro.

Una relacion entre tablas de dos capacidades conserva su integridad referencial sin autorizar queries cruzadas. Mantener `tenantId` y validar membership/rol para recursos sensibles; el slug solo aporta contexto. Los snapshots/versiones de casos completados no se actualizan al editar productos o expedientes.

## Dependencias y contratos futuros

Evaluations coordina llamadas en proceso a Clients, Financial Integrations, Financial Profile, Recommendations, Plans & Metering y Audit cuando su HU lo requiera. Consume datos minimos por contratos publicos; cada propietario ejecuta su logica y persistencia.

La vista de historial de Clients puede consumir una consulta publica de Evaluations. No crear simultaneamente Clients -> Evaluations -> Clients: ubicar la composicion del historial en Evaluations o en una capa de composicion HTTP con contratos publicos. Analizar responsabilidades antes de `forwardRef()`.

Identity & Tenants podra coordinar provisioning con Plans & Metering y Audit. Ninguno debe depender de detalles internos de Identity para consultar Prisma. Audit recibe hechos y no llama de vuelta al emisor. Un futuro contexto autorizado de tenant se obtiene por la interfaz de Identity, sin exponer entidades Prisma o aceptar un tenant arbitrario del navegador.

Los contratos futuros precisaran entrada, salida, errores, autorizacion e idempotencia antes de implementarse. El maestro mantiene PENDIENTES payloads finales de mocks, formulas de perfil, umbrales/tie-breaking, evidencia de consentimiento, planes/capacidades/scoring, alcance MFA, metricas y soporte. No fijar estos detalles desde este mapa. RLS es defensa opcional adicional. Pagos reales, KYC/AML completo, originacion/desembolso, IA real y soporte complejo quedan fuera del MVP.

## Contrato actual: HU-01 y extension HU-02

- Frontera externa: `POST /api/institution-requests`; ver [HU-01](../hu-01.md) y Swagger.
- Controller: transforma/valida entrada HTTP, incluidas confirmaciones verdaderas de representacion/terminos, y delega al servicio.
- Entrada de aplicacion: `SubmitInstitutionRequest`, con datos normalizados de institucion/contacto e interes provisional de plan. Cualquier futuro llamador en proceso debe cumplir esas precondiciones; no puede omitir validacion del caso de uso.
- Salida: `InstitutionRequestReceipt` con `id`, `contactEmail`, `status: EMAIL_PENDING`, `emailDelivery` y `retryAfterSeconds`. No retorna entidades Prisma ni datos administrativos.
- Persistencia: solo `InstitutionRequest`; conserva locks PostgreSQL ordenados y transaccion atomica para duplicados. Un repository no aporta suficiente valor en esta iteracion.
- Errores actuales: HTTP 400 por entrada invalida y 409 por duplicado. El servicio conserva `ConflictException` de Nest como compromiso local; si se reutiliza desde otro transporte, mapear errores propios en la frontera cuando aporte valor.
- Hasta HU-03 el contrato de solicitudes era interno. HU-04 agrega `identity-tenants/public.ts` con `RequestContextReader` para la consulta autorizada desde Plans & Metering y guards reutilizables para su frontera HTTP administrativa. No expone Prisma ni el servicio completo de solicitudes.
- HU-02 agrega `email-verification/` dentro de Identity & Tenants y controla `EmailVerificationToken`. Envia mediante `infrastructure/email/EmailSender -> SmtpEmailAdapter`. Verificacion y reenvio usan contratos propios y llamadas en proceso. No crea tenants ni usuarios. Ver [contrato HU-02](../hu-02.md).

## Convencion de interfaz publica

HU-03 agrega auth, `AdminSession` y revision dentro de Identity & Tenants. Consume `audit/public.ts` mediante AuditModule; Audit implementa AuditWriter y es el unico que inserta AuditLog. Atomicidad por DatabaseUnitOfWork compartido, sin transferir Prisma por contratos. Ver [ADR-002](ADR-002-atomic-review-audit.md) y [HU-03](../hu-03.md). El Sprint 1 corregido prevalece desde HU-03: APPROVED solo habilita contratacion posterior, no provisioning. HU-04 implementa contratacion; HU-05 aprovisiona despues de CONFIRMED.

HU-04 agrega propiedad de `Contracting`, `Payment`, `ContractingCredential` y `PaymentProviderEvent` a Plans & Metering, ademas de los modelos ya asignados. `MockPaymentCheckout` es almacenamiento tecnico exclusivo del adapter. Dependencias: Plans -> Identity (contexto/guards), Plans -> Audit y Plans -> PaymentProvider. Infrastructure no importa negocio; su resultado normalizado lo procesa Plans en una llamada en proceso. No hay HTTP interno, bus ni modulo global. Ver [ADR-003](ADR-003-contracting-mock-payments.md). Al implementar HU-05 no agregar una dependencia inversa Identity -> Plans sin revisar composicion para evitar ciclos.

HU-05 agrega `TenantProvisioning` a Identity y hace operativa TenantSubscription en Plans. `ProvisioningQueue` publica de Identity registra el pendiente dentro de la transaccion de confirmacion de Plans. La composicion raiz `OnboardingModule` registra los workflows de Identity junto al contrato `ProvisioningPlans` (eligibilidad y suscripcion) y AuditWriter. IdentityTenantsModule no importa PlansMeteringModule: no hay ciclo Nest ni forwardRef. La interfaz publica expone solo esos workflows necesarios para composicion; no son endpoints ni acceso a repositorios. Ver [ADR-004](ADR-004-durable-provisioning.md).

Mantener cada capacidad en `apps/api/src/<slug>/`. Se permite importar externamente `<slug>/<slug>.module.ts` para composicion Nest y `<slug>/public.ts` para contratos/providers deliberadamente expuestos. Los imports ESM usan extension `.js`. Los providers consumidores deben estar exportados por su modulo Nest o registrados explicitamente en la composicion documentada; no reexportar todo el directorio.

Dentro de una capacidad pueden existir controller, application/service, domain y adapters segun necesidad. No se exigen carpetas/capas por patron. Infrastructure puede ser importada explicitamente; no depende de capacidades de negocio. Las constantes comerciales/provisionales de HU-01 no representan planes comerciales definitivos.

## Gobernanza ligera

`eslint.config.mjs` registra los ocho slugs objetivo, sin crear sus carpetas. Rechaza imports/reexports estaticos profundos entre capacidades, imports de negocio desde infraestructura/common/config, y Prisma/SQL directo en controllers, DTOs y contratos. Permite imports internos dentro del propietario, composicion del modulo y su futura interfaz publica. Los contratos no importan Nest, transporte, validacion, infraestructura ni DTOs HTTP.

Al introducir una capacidad nueva o cambiar su ubicacion, actualizar las reglas. Estas restricciones se basan en rutas: no son un analizador completo de dependencias. Imports dinamicos, aliases nuevos, exposicion excesiva de `public.ts`, SQL raw, consultas de relaciones, ownership de tablas y ciclos requieren revision manual. No afirmar cobertura automatica completa.

Antes de cerrar una HU: revisar imports/exports, datos consultados, autorizacion tenant, ausencia de ciclos y necesidad real de nuevas abstracciones; ejecutar lint/build y pruebas relevantes. El CI existente ya ejecuta lint, pruebas y build.
