# Sprint 4 - evidencia funcional: S4-HF-06 y S4-HF-07

Este documento registra la corrección mínima y las pruebas de los dos hotfixes (DC-166 y DC-167). Distingue lo ejecutado de lo que queda pendiente. No convierte supuestos del backlog en funciones nuevas.

## S4-HF-06 - Congelar reglas y productos durante la evaluación

### Cambios

- Nueva columna `EvaluationRecommendation.productSnapshot` (JSONB, nullable) y migración `20261018000000_s4_hf06_recommendation_product_snapshot`. Las filas anteriores quedan en `NULL`.
- `RecommendationService.evaluate` lee el catálogo una sola vez por operación y guarda, junto a cada recomendación, el producto y sus reglas tal como estaban: nombre, categoría, alcance, rango de monto, DTI máximo, ingreso disponible mínimo, mora admitida y finalidades.
- Toda la operación (lectura del catálogo, recomendaciones, razones y snapshot) corre dentro de una unidad de trabajo atómica.
- `EvaluationsService.processEvaluation` confirma juntos perfil, recomendaciones, cierre a `COMPLETED` y auditoría. Las consultas a Banco y Buró siguen fuera de la transacción.
- `serializeEvaluation` muestra el snapshot (nombre, categoría, mínimo y máximo). Las recomendaciones sin snapshot siguen usando el producto vinculado.

### Alcance y límites

- HF-06 **no bloquea** editar el catálogo. Garantiza que lo ya evaluado no cambie.
- Las evaluaciones creadas antes del hotfix no tienen snapshot y siguen mostrando el producto vinculado; para ellas el problema del catálogo editado persiste.
- No se modificó el frontend: `serializeEvaluation` entrega el snapshot en los mismos campos que antes llenaba el producto vivo, de modo que la pantalla de detalle no necesita cambios. Esta conclusión se apoya en que el contrato no cambió y en que las pruebas web existentes pasan; la confirma el recorrido manual (paso 5).

## S4-HF-07 - Habilitar empresa solo con cobertura real de mocks

### Cambios en backend

- `financial-integrations/public.ts` declara la cobertura por tipo de sujeto (`SOURCE_COVERAGE`, `sourceCoversSubject`): Banco Mock cubre persona y empresa; Buró Mock cubre solo persona.
- `BankMockSource.query` recibe el tipo de sujeto. Para empresas devuelve datos a escala empresarial (cuenta corriente, crédito `COMMERCIAL`); los escenarios de fixture NO_DATA, UNAVAILABLE y ERROR se mantienen.
- `checkReadiness` calcula el soporte por tipo de sujeto desde esa cobertura. Si solo hay Buró habilitado, el motivo para empresas explica que el Buró solo cubre personas.
- `createDraft` rechaza una empresa cuyo documento no sea NIT **antes** de crear cliente o evaluación.
- `processEvaluation` revalida la elegibilidad antes de cambiar el estado o consultar fuentes: empresa sin NIT o sin producto empresarial vigente devuelve 400 con el motivo.
- Una empresa no consulta el Buró aunque esté habilitado. El Buró se consulta una sola vez por procesamiento (el estado de la fuente se reutiliza de la revisión de preparación).

### Frontend: sin cambios de código, con pruebas nuevas

`EvaluationWizard.tsx` ya consumía `supportedApplicantTypes.COMPANY` del readiness: marca la opción Empresa como "No disponible", muestra el motivo del servidor, oculta el formulario de NIT, deja "Continuar" deshabilitado y siempre envía `documentType: "NIT"` para empresas. Una vez que el backend calcula bien el readiness, el wizard bloquea antes de capturar datos sin modificarse. Se agregó un archivo de pruebas para demostrarlo (ver la sección de pruebas web).

### Cambios de comportamiento a revisar

- Una empresa nunca consulta el Buró y no queda registro de esa fuente en su evaluación.
- Si se desactiva el último producto empresarial entre el borrador y el procesamiento, el proceso devuelve 400 con motivo en vez de completar con cero recomendaciones.
- Una empresa registrada con documento distinto de NIT ya no se procesa.
- No se bloquea una persona con NIT; solo una empresa sin NIT.

### Limitación conocida (no corregida)

En `EvaluationWizard.tsx`, `isCompanySupported` vale `true` mientras el readiness no ha cargado o si su petición falla (el `.catch` ignora el error). En ese caso borde el usuario podría capturar datos de empresa aunque no esté soportada; el backend (`createDraft` y `processEvaluation`) la rechaza después y ninguna evaluación inválida se procesa. Queda fuera de este hotfix; si se decide cerrar, requiere un cambio mínimo en el wizard con su prueba.

## Pruebas automáticas de backend (15)

Archivos nuevos:

- `apps/api/src/recommendations/s4-hf-06.spec.ts`
- `apps/api/src/evaluations/s4-hf-06-07.spec.ts`
- `apps/api/src/financial-integrations/s4-hf-07.spec.ts`

| ID | Qué comprueba | Resultado |
| --- | --- | --- |
| HF-06/1 | Cada recomendación guarda el producto y sus reglas tal como estaban al evaluar. | Pasa. |
| HF-06/2 | El catálogo se lee una vez por operación y todo se escribe dentro de una unidad de trabajo atómica. | Pasa. |
| HF-06/3 | El historial muestra el producto congelado aunque el producto vivo fue editado después. | Pasa. |
| HF-06/4 | Las filas anteriores al hotfix, sin snapshot, siguen usando el producto vinculado. | Pasa. |
| HF-06/5 | Perfil, recomendaciones y cierre ocurren en una sola unidad de trabajo. | Pasa. |
| HF-07/1 | Se declara que el Banco cubre personas y empresas y el Buró solo personas. | Pasa. |
| HF-07/2 | El Banco Mock devuelve datos a escala empresarial para una empresa (NIT). | Pasa. |
| HF-07/3 | Los escenarios NO_DATA, UNAVAILABLE y ERROR se mantienen para empresas. | Pasa. |
| HF-07/4 | Una empresa no consulta el Buró aunque esté habilitado. | Pasa. |
| HF-07/5 | Una persona sí consulta Banco y Buró; el Banco recibe el tipo de sujeto. | Pasa. |
| HF-07/6 | `createDraft` rechaza empresa con documento CI antes de crear cliente o evaluación. | Pasa. |
| HF-07/7 | `createDraft` sigue aceptando una empresa con NIT. | Pasa. |
| HF-07/8 | `processEvaluation` revalida la elegibilidad antes de cambiar estado o consultar fuentes. | Pasa. |
| HF-07/9 | `processEvaluation` rechaza una empresa registrada con documento que no es NIT. | Pasa. |
| HF-07/10 | El motivo de readiness explica que el Buró habilitado no cubre empresas. | Pasa. |

### Ajustes mínimos a pruebas existentes

- `evaluations.spec.ts`: la verificación de `bank.query` ahora espera el tercer argumento `"PERSON"`; el fixture de la empresa agrega `documentType: "NIT"` (una fila real siempre lo tiene).
- `recommendation.spec.ts`: el mock agrega `run`, porque el recomendador ahora usa la unidad de trabajo.

## Pruebas web del wizard (6)

Archivo nuevo: `apps/web/src/features/institution/EvaluationWizard.hf07.test.tsx`. Es de verificación: `EvaluationWizard.tsx` no cambió. El frontend ya cumplía; dejan como evidencia automática la frase del ticket "bloquear antes de capturar datos".

| ID | Qué comprueba |
| --- | --- |
| HF-07/UI-1 | Empresa sin cobertura: se muestra la etiqueta "No disponible", la alerta con el motivo del servidor, desaparecen el campo NIT y el botón Buscar, "Continuar" queda deshabilitado e intentar continuar no dispara ninguna petición. |
| HF-07/UI-2 | Sin motivo del servidor se usa el mensaje por defecto y el formulario de NIT sigue oculto. |
| HF-07/UI-3 | Sin `initialReadiness`, el wizard lee la cobertura del endpoint de readiness y bloquea la empresa; no hay POST de borrador. |
| HF-07/UI-4 | Con la empresa bloqueada, persona sigue habilitada y crea su borrador con `clientType: "PERSON"` y `documentType: "CI"`. |
| HF-07/UI-5 | Al volver de Empresa bloqueada a Persona, el formulario reaparece y la alerta desaparece. |
| HF-07/UI-6 | Con la institución no preparada (`ready=false`), persona y empresa quedan bloqueadas antes de capturar datos y no hay peticiones. |

## Evidencia ejecutada

Ejecutada por el equipo en `C:\PROYECTO ARQUITECTURA\DoggyCredit` (18 de octubre de 2026), con el código final: incluye los cambios de backend, la migración y el archivo de pruebas del wizard.

| Comprobación | Resultado |
| --- | --- |
| `npm test`, parte API | 125/125 en 21 suites (110 previas + 15 nuevas). Las tres suites nuevas (`s4-hf-06-07`, `s4-hf-06`, `s4-hf-07`) en verde. |
| `npm test`, parte web | **126/126 en 17 archivos** (120 previas + 6 nuevas de `EvaluationWizard.hf07.test.tsx`). |
| `npm run test --workspace=@doggycredit/web -- EvaluationWizard.hf07` | 6/6 en 1 archivo. |
| `npm run prisma:generate` | Correcto: Prisma Client 7.10.0 generado en `apps/api/src/generated/prisma`. |
| `npm run prisma:deploy` | Correcto sobre PostgreSQL `doggycredit` (`localhost:5432`, schema `public`): 13 migraciones encontradas y **"No pending migrations to apply"**. |
| Prisma Studio, tabla `_prisma_migrations` | La migración `20261018000000_s4_hf06_recommendation_product_snapshot` figura aplicada: `applied_steps_count` = 1 y `finished_at` = 2026-10-18T06:27:52Z. |
| `npm run build` (API y web) | Correcto, con el aviso habitual de tamaño de chunk (575 kB). |
| `npm run lint` (`--max-warnings=0`) | Sin errores. |
| E2E contra PostgreSQL desechable (`npm run test:e2e --workspace=@doggycredit/api`) | 208/208, 0 fallos. El runner usa una base desechable sin tocar datos de desarrollo. |
| Recorrido manual en navegador (institución `banco-del-sol-demo`, datos del seed `SEED_DEMO_EVALUATIONS`) | Realizado completo (ver sección "Recorrido manual (ejecutado)"). HF-07 y HF-06 se comportaron como se esperaba en todos los pasos. Resultado reportado por quien ejecutó la prueba; las capturas van adjuntas en Jira. |

Observaciones:

- `prisma:deploy` informa "No pending migrations" porque la migración de HF-06 ya se había aplicado antes en esa base; por eso no aparece la línea "Applying migration". La fila de `_prisma_migrations` en Prisma Studio es la evidencia de que se aplicó.
- Los avisos `stderr` del frontend (`<h2> cannot be a descendant of <p>`, `<dialog> cannot be a descendant of <p>`) vienen de `RequestReceivedPage` / `PublicInfo` en las pruebas de HU-01 y HU-02. No tienen relación con HF-06 ni HF-07, no hacen fallar ninguna prueba y ya existían antes.
- Los E2E existentes no incluyen una prueba específica de HF-06 ni de HF-07.

### Pendiente

| Comprobación | Estado |
| --- | --- |
| E2E específicos de HF-06 y HF-07 contra PostgreSQL | No existen todavía; mejora de cobertura, no bloquea el cierre. |
| `prettier --check` | Los 6 archivos modificados del backend ya incumplían Prettier antes del cambio; no se reformatearon para no ensuciar el diff. Solo se formatearon los 3 specs nuevos del backend. El archivo web nuevo se formatea con `npx prettier --write apps/web/src/features/institution/EvaluationWizard.hf07.test.tsx`. No usar `npm run format`, que reformatea todo el proyecto. |
| Estado de carga del readiness en el wizard | Limitación conocida descrita arriba; no corregida. |

## Cómo probar en VS Code

Desde la raíz del proyecto, en la terminal:

```
npm run prisma:generate
npm run prisma:deploy
npm test
npm run build
npm run lint
```

Resultado esperado: API `Test Suites: 21 passed` y `Tests: 125 passed`; web `Tests: 126 passed` (120 previas + 6 nuevas); build y lint sin errores. `prisma:deploy` solo agrega una columna nullable; no modifica ni borra datos.

Para ejecutar únicamente las pruebas de estos hotfixes:

```
npm run test --workspace=@doggycredit/api -- s4-hf
npm run test --workspace=@doggycredit/web -- EvaluationWizard.hf07
```

Para la regresión contra base de datos real (con PostgreSQL desechable configurado):

```
npm run test:e2e --workspace=@doggycredit/api
```

## Datos de prueba para el recorrido manual

El seed (`prisma/seed.ts`) se activa con variables de entorno. Para cargar usuarios internos, planes, productos y las instituciones de preparación de evaluaciones, definirlas en `.env` (o en la sesión de PowerShell) y ejecutar el seed:

```
SEED_DEMO_BACKOFFICE_USERS=true
SEED_DEMO_PLANS=true
SEED_DEMO_PRODUCTS=true
SEED_DEMO_EVALUATIONS=true
```

```
npm run prisma:seed
```

Si el seed falla con `P1000` (autenticación), definir la conexión en la misma sesión antes de ejecutarlo: `$env:DATABASE_URL="postgresql://USUARIO:CONTRASEÑA@localhost:5432/doggycredit?schema=public"`.

Cuentas de demo definidas en el seed (solo para desarrollo local):

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Operador interno | `operador.demo@doggycredit.local` | `DoggyDemo2026!` |
| Operador interno (revisión) | `revision.demo@doggycredit.local` | `DoggyRevision2026!` |
| Administrador de institución | `ana.hu10@doggycredit.local` | `DoggyInstitucion2026!` |
| Analista de institución | `carlos.hu10@doggycredit.local` | `DoggyAnalista2026!` |

El seed también define `analista.luna.hu10@doggycredit.local` y `analista.pendiente.hu10@doggycredit.local` (contraseña `DoggyAnalista2026!`) para otras instituciones de demo. Qué fuentes y productos trae cada institución depende del fixture `SEED_DEMO_EVALUATIONS`; antes del recorrido hay que revisar en **Fuentes** y **Productos** que estén habilitados Banco Mock, Buró Mock y al menos un producto empresarial.

## Recorrido manual (ejecutado)

Entorno: `npm run dev`, base de desarrollo con datos del seed (`SEED_DEMO_EVALUATIONS=true`), institución **Banco del Sol Demo** (`/banco-del-sol-demo`). Se usaron dos sesiones a la vez: Ana López Demo (administrador inicial, `ana.hu10@doggycredit.local`) y Carlos (analista, `carlos.hu10@doggycredit.local`). Las dos fuentes (Fuente bancaria simulada y Buró crediticio simulado) estaban habilitadas para la institución.

| # | Quién | Acción | Resultado esperado | Resultado |
| --- | --- | --- | --- | --- |
| 1 | Carlos | Abrir Nueva evaluación con la preparación inicial del seed. | La opción Empresa aparece como "No disponible" (HF-07: bloquear antes de capturar datos). | Correcto: Empresa se mostró como "No disponible". |
| 2 | Ana | Habilitar la cobertura empresarial (producto empresarial seleccionado) y confirmar que las dos fuentes estén habilitadas. | Fuentes y productos confirmados. | Correcto. |
| 3 | Carlos | Evaluación de **empresa** con NIT `1020304050`, con el Buró habilitado; iniciar y procesar. | Se completa; datos del Banco a escala empresarial; en "Fuentes consultadas" solo aparece la fuente bancaria simulada, sin Buró. | Correcto. Perfil con DTI 5,29 %, 1 crédito activo, "Fuentes consultadas: Fuente bancaria simulada"; recomendación compatible: Credito PAME (Microcrédito), rango admisible Bs. 1.000 - Bs. 50.000. |
| 4 | Ana | Editar el producto Credito PAME (nombre y rango de monto). | Producto editado en el catálogo. | Correcto. |
| 5 | Carlos | Reabrir la evaluación procesada antes de la edición. | HF-06: sigue mostrando el nombre y el rango anteriores (Credito PAME, Bs. 1.000 - Bs. 50.000), coherentes con las razones guardadas. | Correcto. |
| 6 | Ana / Carlos | Quitar los productos empresariales y recargar Nueva evaluación como Carlos. | HF-07: Empresa "No disponible" con alerta y motivo, sin pedir NIT ni otros datos. | Correcto. |

Notas:

- La combinación "empresa con documento CI" no se puede producir desde la interfaz, porque el wizard siempre envía NIT para empresas. Ese caso lo cubren las pruebas automáticas HF-07/6 y HF-07/9.
- La evaluación anterior a la migración sin snapshot (comportamiento de compatibilidad) está cubierta por la prueba HF-06/4; no se recorrió manualmente.
- Las capturas de los pasos anteriores se adjuntan en Jira; no forman parte de este documento.

## Archivos del cambio

Backend y base de datos (11 archivos):

- `apps/api/src/evaluations/evaluations.service.ts`
- `apps/api/src/evaluations/evaluations.spec.ts`
- `apps/api/src/evaluations/s4-hf-06-07.spec.ts` (nuevo)
- `apps/api/src/financial-integrations/bank-mock-source.service.ts`
- `apps/api/src/financial-integrations/public.ts`
- `apps/api/src/financial-integrations/s4-hf-07.spec.ts` (nuevo)
- `apps/api/src/recommendations/recommendation.service.ts`
- `apps/api/src/recommendations/recommendation.spec.ts`
- `apps/api/src/recommendations/s4-hf-06.spec.ts` (nuevo)
- `prisma/migrations/20261018000000_s4_hf06_recommendation_product_snapshot/migration.sql` (nuevo)
- `prisma/schema.prisma`

Frontend (1 archivo, solo pruebas):

- `apps/web/src/features/institution/EvaluationWizard.hf07.test.tsx` (nuevo)

## Cierre en Jira

- DC-166 (HF-06), subtarea "Corregir": adjuntar la salida en verde (API 125/125, web 126/126, E2E 208/208, `prisma:generate` y `prisma:deploy`), la captura de Prisma Studio con la fila de la migración HF-06 en `_prisma_migrations`, la captura de la evaluación con el producto y rango anteriores después de editar el catálogo (paso 5), y enlazar el commit de la corrección.
- DC-167 (HF-07), subtarea "Corregir": adjuntar la misma salida en verde, la salida de las 6 pruebas del wizard y las capturas de los pasos 1, 3 y 6 del recorrido manual (Empresa "No disponible", evaluación de empresa sin Buró con las dos fuentes habilitadas, bloqueo sin productos empresariales). Enlazar el commit de la corrección.