# HU-30 — Resultados de pruebas (automáticas y manuales)

Fecha: 18 oct 2026 · Rama: `sprint-4/hu-30` (sobre `sprint/sprint-4` hasta el commit `a90df50`, con HU-28 y HU-32) · Estado global: **verificada**, con 2 observaciones de interfaz abiertas (ver §5)

## 1. Pruebas automáticas

| Comprobación | Resultado |
|---|---|
| `npx prisma validate` | Esquema válido |
| `npm run build` (API) | Sin errores |
| `npm test` (API) | 29 suites / 195 tests en verde |
| `npx vitest run` (web) | 19 archivos / 145 tests en verde (incluye `ProvidersPage.test.tsx`, 6 tests) |
| `npx eslint .` | 4 errores `no-restricted-imports` de OPS-03 (`resilient-sources.js`), ya existentes. Ninguno en archivos de HU-30 |

Nota: la primera ejecución falló porque la rama local estaba atrasada respecto a `sprint/sprint-4` (faltaban `request-decision-delivery.service.ts` e `initial-admin-recovery.service.ts`). Se resolvió con `git merge --ff-only` y una rama nueva `sprint-4/hu-30`; el stash se reaplicó sin conflictos.

## 2. Preparación del entorno

- `.env` con `SEED_DEMO_OPERATOR=true`, `SEED_DEMO_EVALUATIONS=true`, `OPERATOR_SEED_*` y `PLATFORM_ADMIN_SEED_*`.
- `prisma migrate dev` detectó drift: la base local tenía una migración inexistente en el repo (`20260929024255_npm_run_prisma_seed`). Se ejecutó `prisma migrate reset` (base de desarrollo). Se aplicaron las 16 migraciones, incluida `20261018100000_hu30_provider_global_enablement`. `migrate status`: «Database schema is up to date».
- Usuarios demo usados:
  - Plataforma: `admin.plataforma@doggycredit.local`
  - Operador: `operador.demo@doggycredit.local`
  - Analista (Banco del Sol Demo): `carlos.hu10@doggycredit.local`
  - Administrador inicial de la institución: `ana.hu10@doggycredit.local` (contraseña distinta a la de los analistas; ver `prisma/seed.ts`)

## 3. Defectos encontrados durante la prueba manual

| # | Defecto | Causa | Corrección |
|---|---|---|---|
| D1 | Tras iniciar sesión, `PLATFORM_ADMIN` veía «No tienes autorización para esta operación». `GET /api/admin/auth/session` respondía 403 | El endpoint `session` en `admin-auth.controller.ts` usaba `@UseGuards(AdminAuthGuard, OperatorGuard)` y `OperatorGuard` no admite a `PLATFORM_ADMIN` | Dejar solo `AdminAuthGuard` en `session`; los permisos por rol siguen en cada ruta. Actualizado el resumen de Swagger del login |
| D2 | El login mandaba a todos a `/admin/solicitudes` | `AdminLoginPage` no miraba el rol | Función `destination(session)`: `PLATFORM_ADMIN` → `/admin/proveedores`, resto → `/admin/solicitudes` |

Los tests automáticos no detectaron D1 porque `admin-auth-platform-admin.spec.ts` prueba el servicio de login, no el guard del endpoint `session`. **Recomendación:** añadir un test que cubra `GET /admin/auth/session` con `PLATFORM_ADMIN`.

## 4. Recorrido manual

| Paso | Acción | Resultado esperado | Resultado | Criterio |
|---|---|---|---|---|
| 1 | Login de plataforma en `/admin/login` | Va a Proveedores; menú de una sola opción; rol «Administrador de plataforma» | **OK** (tras corregir D1 y D2) | CA-30.02 |
| 2 | Revisar tarjetas | Habilitación global, salud, instituciones y cobertura por separado; sin URL/claves/timeouts | **OK**. Bank: Habilitado, sin incidencias, 2 instituciones, Personas y Empresas (NIT). Buró: Habilitado, sin incidencias, 0 instituciones, Personas | CA-30.01, 30.04, 30.05 |
| 3 | Login de operador | No ve Proveedores; `/admin/proveedores` directo no funciona | **OK**. Menú: Solicitudes, Contrataciones, Instituciones, Bandeja de pruebas. `GET /api/admin/platform/providers` → **403**; la pantalla solo muestra «No tienes autorización para esta operación» | CA-30.02 |
| 4 | Evaluación histórica con Carlos, documento 7812456 | COMPLETED | **OK**. María Fernanda Rojas, CI 7812456, Capital de trabajo, Bs. 10.000,00, COMPLETADA, «Fuente bancaria simulada: Disponible», Microcrédito Emprendedor «Compatible» | — |
| 5 | Plataforma deshabilita Bank Mock con motivo | Global «Deshabilitado»; nuevas consultas «No se aceptan»; salud sin cambio | **OK**. Muestra «Último cambio: 18 oct de 2026, 11:30 p. m.»; salud sigue «Sin incidencias observadas»; instituciones sigue en 2; Buró sin cambios | CA-30.03, 30.05 |
| 6B | Ana revisa su institución | Distingue indisponibilidad global de su habilitación | **OK con observaciones** (ver §5). Inicio: 2 de 3 pasos (67%), «Habilitar fuente financiera» pasa a «Por completar». Fuentes financieras: etiqueta «Deshabilitada por la plataforma» y mensaje «Tu configuración se conserva y las evaluaciones anteriores no cambian». Buró no se ve afectado | CA-30.03, 30.05 |
| 6A | Carlos intenta evaluar | No puede iniciar evaluación | **OK**. Inicio de Carlos muestra «La institución debe completar su preparación antes de evaluar» | CA-30.03 |
| 7 | Reabrir la evaluación histórica | Idéntica | **OK**. Mismo estado, monto, fuente «Disponible», recomendación y criterios (relación deuda/ingreso 6,9%, ingreso disponible Bs. 3.700) | CA-30.03, escenario Gherkin |
| 8 | Plataforma rehabilita Bank Mock | La institución vuelve a evaluar sin reactivar nada | **OK**. Panel: Bank «Habilitado», «Último cambio: 18 oct de 2026, 11:39 p. m.», «Nuevas consultas: Aceptadas», 2 instituciones. Ana ve «Fuente bancaria habilitada» sin haber hecho nada; Carlos pudo evaluar | CA-30.03 |
| 9 | Ciclo con Buró Mock | Bank sigue funcionando mientras el Buró está deshabilitado | **OK**. Ana habilitó el Buró (panel: 1 institución). Plataforma lo deshabilitó. Ana ve el Buró «Deshabilitada por la plataforma» y la fuente bancaria «habilitada», sin etiqueta de plataforma. Carlos creó una evaluación nueva (María Fernanda Rojas, CI 7812456) que terminó **COMPLETADA** con «Fuente bancaria simulada: Disponible» | CA-30.05 |

## 5. Comprobaciones finales

Estas pruebas se ejecutaron y el resultado fue el esperado. No se adjuntaron capturas; el resultado lo confirma quien las ejecutó.

| Prueba | Cómo | Resultado esperado | Resultado | Criterio |
|---|---|---|---|---|
| Rehabilitar Buró | Plataforma → «Habilitar globalmente» en Buró | Buró «Habilitado» | **OK** | CA-30.03 |
| Escenarios predecibles | Evaluar con documentos terminados en `999`, `500` y `000`, sin editar la base | UNAVAILABLE, ERROR y NO_DATA respectivamente | **OK** | CA-30.06 |
| Seguridad A | Con sesión de analista, abrir `GET /api/admin/platform/providers` | 401/403, sin datos | **OK** | CA-30.02 |
| Seguridad B | `POST .../global-status` con un campo extra (`url`) | 400; el proveedor no cambia | **OK** | CA-30.02, 30.04 |
| Auditoría | `SELECT action, "entityType", "tenantId", metadata, "createdAt" FROM "AuditLog" WHERE "entityType" = 'IntegrationProvider' ORDER BY "createdAt" DESC;` | `PROVIDER_GLOBALLY_DISABLED` / `PROVIDER_GLOBALLY_ENABLED` por cada cambio, `tenantId` nulo, `providerCode`, estado anterior/nuevo y motivo en `metadata`; sin registro para el intento rechazado | **OK** | CA-30.07 |

## 6. Observaciones abiertas (no bloquean la funcionalidad)

1. **Salud técnica mezclada con la habilitación global.** En «Fuentes financieras» de la institución, la fuente deshabilitada por plataforma muestra «Salud técnica: No disponible» (se vio en Bank y en Buró) aunque el panel de plataforma indica «Sin incidencias observadas». Probablemente la pantalla deriva la salud de `available=false`, que es falso por la deshabilitación global. Toca CA-30.05. Pendiente de revisar `InstitutionHomePage.tsx` y los `status()` de `bank-mock-source.service.ts` / `bureau-mock-source.service.ts`.
2. **Etiqueta «No habilitada» junto a «Deshabilitada por la plataforma».** Se repitió en el Buró, que la institución sí había habilitado (el panel contaba 1). Puede dar a entender que la institución perdió su propia habilitación, cuando solo queda suspendida. Valorar mostrar la habilitación propia de forma independiente.
3. **Mensaje de confirmación sin estilo** en el panel de plataforma: «Fuente bancaria simulada: habilitación global desactivada.» aparece como texto suelto sobre las tarjetas. Cosmético.
4. Falta un test automático para `GET /admin/auth/session` con `PLATFORM_ADMIN` (ver D1).

Fuera del alcance de HU-30: la tabla de Solicitudes del operador aparece vacía por el filtro «En revisión» y porque el seed no crea solicitudes pendientes; y los avisos de HTML anidado (`<h2>` dentro de `<p>`) en `PublicInfo` de la pantalla pública «solicitud recibida» vienen de otra HU.

## 7. Cobertura de criterios

| Criterio | Estado | Evidencia |
|---|---|---|
| CA-30.01 Proveedores globales con nombre, alcance y cobertura | Cumple | Paso 2 |
| CA-30.02 Solo plataforma controla la habilitación global | Cumple | Pasos 1 y 3, seguridad A y B |
| CA-30.03 Desactivar no muta evaluaciones históricas; preparación real | Cumple | Pasos 5 a 8 |
| CA-30.04 Sin URLs, claves ni timeouts | Cumple | Paso 2, seguridad B |
| CA-30.05 Habilitación global, tenant y salud son hechos distintos | Cumple en el panel de plataforma; **parcial en la pantalla de la institución** (observaciones 1 y 2) | Pasos 2, 5, 6B y 9 |
| CA-30.06 Escenarios predecibles | Cumple | Comprobación de escenarios |
| CA-30.07 Auditoría de cada cambio | Cumple | Comprobación de auditoría |

## 8. Conclusión

La deshabilitación global de proveedores funciona de extremo a extremo: solo el administrador de plataforma la controla, el operador y el analista reciben 403, los campos no permitidos se rechazan, las evaluaciones históricas no cambian, la institución distingue la indisponibilidad global y conserva su configuración, la rehabilitación restablece el servicio sin acciones de la institución, los dos proveedores son independientes, los escenarios simulados son predecibles y cada cambio queda auditado. Antes de dar la HU por cerrada sin reservas, conviene decidir si se corrigen las observaciones 1 y 2, que afectan la presentación de CA-30.05 en la pantalla de la institución.
