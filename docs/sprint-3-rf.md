# Especificaciones Técnicas y Cierre de Requisitos Fundacionales — Sprint 3 (S3-RF-01 a S3-RF-06)

Este documento formaliza las decisiones de arquitectura, contratos de datos, fórmulas y evidencia técnica de los 6 Requisitos Fundacionales (RF / Spikes) del Sprint 3 de DoggyCredit. Todos los requerimientos cuentan con cobertura de pruebas automatizadas y contratos validados con desarrollo y QA.

---

## S3-RF-01 — Definir contrato, cobertura y escenarios reproducibles de Buró Mock

### Decisiones y Contrato
1. **Identificadores Soportados**:
   - Personas naturales: Documento de identidad `CI` (ej. `4892019`, `7891234`).
   - Empresas / Personas jurídicas: `NIT` (ej. `1020304050`, `3040506070`).
2. **Estados y Fixtures Deterministas del Proveedor (`IntegrationProvider: BUREAU_MOCK`)**:
   - `SUCCESS`: Retorna historial crediticio, deudas vigentes, créditos activos y estado de morosidad reciente.
   - `NO_DATA`: Solicitante sin historial reportado en Buró (retorno no bloqueante).
   - `UNAVAILABLE`: Buró en degradación o mantenimiento técnico.
   - `ERROR`: Falla de conexión o timeout simulado.
3. **Versión de Contrato**: `1.0.0`
4. **Evidencia de Implementación y Tests**:
   - Adaptador: `apps/api/src/financial-integrations/bureau-mock-source.ts`
   - Pruebas unitarias: `apps/api/src/financial-integrations/bureau-mock-source.spec.ts` (100% passing).

---

## S3-RF-02 — Definir identificación y datos mínimos de empresa para nueva evaluación

### Decisiones y Contrato
1. **Normalización y Clave Única**:
   - Clave única de expediente por tenant: `(tenantId, documentType, documentNumber)`.
   - Normalización de NIT: Caracteres numéricos limpios, sin guiones ni espacios superfluos.
2. **Campos Mínimos de Empresa (`COMPANY`)**:
   - Razón social oficial (`name`).
   - Número de Identificación Tributaria (`documentNumber` con `documentType: NIT`).
   - Rubro o actividad comercial declarada (`economicActivity`).
3. **Consentimiento Obligatorio y Snapshot**:
   - El consentimiento para empresas es específico a la persona jurídica y no se infiere de evaluaciones pasadas.
   - Snapshot inmutable registrado en `Evaluation.applicantSnapshot` al momento de crear el borrador.
4. **Evidencia de Implementación y Tests**:
   - Backend: `apps/api/src/evaluations/evaluations.service.ts` y `apps/api/src/clients/clients.service.ts`.
   - Frontend: `apps/web/src/features/institution/EvaluationWizard.tsx` (flujo persona vs empresa, cambio de tipo resetea consentimiento - CA-14.08).
   - Pruebas: `EvaluationWizard.test.tsx` (PA-14.01, PA-14.02) y `evaluations.spec.ts`.

---

## S3-RF-03 — Definir consolidación Banco + Buró, fórmulas y estados de cobertura

### Decisiones y Fórmulas
1. **Normalización e Indicadores Financieros**:
   - **Ingreso mensual promedio (`averageMonthlyIncome`)**: Banco Mock (`BANK_MOCK`).
   - **Gastos mensuales promedio (`averageMonthlyExpenses`)**: Banco Mock (`BANK_MOCK`).
   - **Margen neto disponible (`disposableIncome`)**: `Ingreso - Gasto`.
   - **Deuda total acumulada (`totalDebt`)**: Buró Mock (`BUREAU_MOCK`).
   - **Créditos activos (`activeCredits`)**: Buró Mock (`BUREAU_MOCK`).
   - **Relación Deuda/Ingreso (`debtToIncome`)**: `(totalDebt / averageMonthlyIncome)` redondeado a 4 decimales.
   - **Mora reciente (`hasRecentArrears`)**: Buró Mock (`BUREAU_MOCK`).
2. **Procedencia por Indicador (`indicatorProvenance`)**:
   - Cada indicador etiqueta explícitamente su fuente: `BANK_MOCK`, `BUREAU_MOCK`, `CONSOLIDATED` o `NOT_AVAILABLE`.
3. **Estados de Evaluación del Perfil**:
   - `COMPLETED`: Ambas fuentes respondieron con éxito o información suficiente para dictamen de políticas.
   - `INCOMPLETE`: Faltan datos críticos por `NO_DATA` o fuente deshabilitada (ej. evaluación sin Buró).
   - `FAILED`: Error técnico de conexión que permite reintento sobre el mismo caso.
4. **Evidencia de Implementación y Tests**:
   - Servicio: `apps/api/src/financial-profile/financial-profile.service.ts`
   - Pruebas: `apps/api/src/financial-profile/financial-profile.spec.ts` (5 combinaciones de cobertura evaluadas determinísticamente).

---

## S3-RF-04 — Definir campos, validaciones y versionado del catálogo institucional

### Decisiones y Contrato
1. **Campos Configurables**:
   - Nombre del producto (`name`, max 120 caracteres).
   - Categoría (`category`: `MICRO_CREDIT`, `GREEN_CREDIT`, `SME_CREDIT`).
   - Alcance del solicitante (`applicantScope`: `PERSON`, `COMPANY`, `BOTH`).
   - Monto mínimo y máximo (`minAmount`, `maxAmount` con validación `minAmount <= maxAmount` y ambos > 0).
   - Finalidades admitidas (`purposes`: lista finita de enums válidos).
   - Estado (`active`: boolean).
2. **Versionado de Reglas**:
   - Campo `ruleVersion: "1.0.0"` registrado en cada recomendación emitida para garantizar reproducibilidad histórica.
3. **Readiness y Guardas de Negocio**:
   - Si la institución desactiva todos sus productos, el estado de preparación (`home.ready`) pasa a `false`, impidiendo iniciar nuevas evaluaciones hasta contar con al menos un producto activo.
4. **Evidencia de Implementación y Tests**:
   - Backend: `apps/api/src/recommendations/products-catalog.service.ts`
   - Frontend: `apps/web/src/features/institution/ProductsCatalogPanel.tsx`
   - Pruebas: `products-catalog.spec.ts` y `ProductsCatalogPanel.test.tsx` (PA-16.01, PA-16.02).

---

## S3-RF-05 — Definir búsqueda, filtros, visibilidad y estados de evaluación y expediente

### Decisiones y Contrato
1. **Estados del Ciclo de Vida**:
   - `DRAFT`: Borrador creado con datos del solicitante y monto.
   - `IN_PROGRESS`: En ejecución de consultas a fuentes y evaluación de reglas.
   - `COMPLETED`: Evaluación completada con recomendaciones explicables.
   - `INCOMPLETE`: Evaluación con información parcial documentada.
   - `FAILED`: Evaluación con error recuperable; habilita acción de reintento.
2. **Búsqueda y Filtros**:
   - Búsqueda en memoria/backend por nombre del solicitante y número de documento (CI/NIT).
   - Filtro por estado con botón de limpieza de filtros que no fuerza navegación externa.
3. **Expediente Trazable sin Mutación (HU-19)**:
   - Vista de solo consulta del expediente (`/:tenantSlug/clientes/:clientId`).
   - Consulta protegida: no altera evaluaciones pasadas ni recalcula snapshots inmutables.
4. **Evidencia de Implementación y Tests**:
   - Backend: `apps/api/src/evaluations/evaluations.service.ts` y `apps/api/src/clients/clients.service.ts`.
   - Frontend: `EvaluationsList.tsx`, `ClientDossier.tsx`, `EvaluationDetail.tsx`.
   - Pruebas: `EvaluationsList.test.tsx` (PA-18.01, PA-18.02) y `ClientDossier.test.tsx` (PA-19.01 a PA-19.04).

---

## S3-RF-06 — Validar incremento real de Sprint 2 y compatibilidad de contratos para Sprint 3

### Decisiones y Compatibilidad
1. **Continuidad de HU-08 a HU-12**:
   - La preparación inicial de la institución (`tenant-preparation`) preserva su retrocompatibilidad retornando `source: { available, enabled }` junto con el nuevo array extendido `sources: SourceItemDto[]`.
   - No se duplican entidades; `Client` y `Evaluation` conservan los campos y snapshots creados en Sprint 2.
2. **Migraciones Prisma Idempotentes**:
   - Migración `20261011110000_hu13_bureau_mock_provider` para Buró Mock.
   - Campos de entidad `Product`, `FinancialProfile` y `EvaluationSourceResult` integrados sin romper la base preexistente.
3. **Evidencia de Pruebas Integrales**:
   - 29 suites de prueba en verde (13 backend + 16 frontend), totalizando 214 tests unitarios e integrados pasando sin regresiones.
   - ESLint con 0 advertencias y compilación TypeScript sin errores.
