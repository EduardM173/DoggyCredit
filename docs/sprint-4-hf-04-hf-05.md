# Sprint 4 - evidencia funcional: S4-HF-04 y S4-HF-05

Este documento registra la verificación y la corrección mínima de los dos hotfixes. No convierte los supuestos del backlog en funciones nuevas ni afirma resultados de infraestructura que no se hayan ejecutado.

## S4-HF-04 - Entrega y reenvío de correos

### Resultado

- Se añadió `EMAIL_TRANSPORT=test_inbox` para desarrollo y pruebas. El adaptador conserva, solo en memoria del proceso, los últimos 100 mensajes de la demostración y devuelve explícitamente `TEST_INBOX`; no intenta SMTP ni afirma que una casilla externa recibió el mensaje.
- Producción solo admite `EMAIL_TRANSPORT=smtp` y exige host, usuario, contraseña y remitente. El transporte de pruebas no puede habilitarse allí.
- Un operador autenticado puede revisar `Administración > Bandeja de pruebas` (`GET /api/admin/test-inbox`). La interfaz presenta el mensaje como simulado, no renderiza HTML de correo y muestra el texto con el enlace para recorrer la demo. La bandeja se borra al reiniciar la API.
- La solicitud y el reenvío de verificación devuelven `TEST_INBOX` cuando corresponde; la pantalla pública explica que el enlace está en la bandeja protegida y que no se hizo entrega externa. Las plantillas existentes de verificación e invitación siguen indicando enlace de un uso, vencimiento y no compartirlo.
- El proceso normal de API inicia `InvitationDeliveryService`, por lo que las invitaciones iniciales pendientes tras aprovisionar un tenant se intentan y recuperan por el flujo durable existente. Un error de entrega no activa una membresía ni revierte el aprovisionamiento.
- **Correo de contratación (corrección de esta revisión).** `GET /api/admin/institution-requests/:id/contracting-email` ahora incluye `channel` (`SMTP` | `TEST_INBOX` | `null`), derivado del `EMAIL_TRANSPORT` configurado y solo cuando el mensaje fue aceptado (`SENT`); no requiere migración ni expone el enlace. `ContractingAccessAction` muestra "El enlace se generó en la bandeja de pruebas de esta demostración. No se envió a una casilla externa." con acceso a la bandeja, y reserva "fue enviado al correo verificado" para `SMTP`. Antes afirmaba envío externo aun con la bandeja de pruebas (contra el §24.3 del V4).
- SMTP mantiene timeouts, credenciales fuera de Git, sanitización de errores y resultado `SENT` únicamente después de que el transporte acepte el mensaje. `FAILED` y los reintentos existentes siguen disponibles.

### PA comprobados

| Caso | Evidencia esperada | Estado |
| --- | --- | --- |
| Verificación/invitación en demo | Se puede leer el mensaje en la bandeja de pruebas, con enlace y vencimiento; no se declara envío externo. | Cubierto por adaptador, UI y pruebas unitarias. |
| Reenvío | Un nuevo envío genera el mensaje más reciente; los flujos existentes invalidan el enlace anterior y mantienen cooldown/estado de entrega. | Cubierto por suites HU-02/HU-06/HU-09 existentes y contrato conservado. |
| Error de entrega | La solicitud o invitación queda recuperable sin activar acceso ni simular una entrega. | Cubierto por suites existentes y sin cambio de esa semántica. |
| Contratación en demo | La pantalla de la solicitud aprobada no declara envío externo si el canal es la bandeja de pruebas. | Prueba unitaria API (`contracting-access.service.spec.ts`) y prueba de UI (`admin.test.tsx`). |
| Producción | La configuración impide seleccionar bandeja de pruebas y exige SMTP. | Prueba de configuración añadida. |

### Recorrido manual de demo

1. Arrancar con `NODE_ENV=development` y omitir `EMAIL_TRANSPORT` (su valor por defecto es `test_inbox`) o definirlo explícitamente.
2. Enviar una solicitud o invitar un analista; la UI indicará “bandeja de pruebas” en vez de “correo enviado”.
3. Iniciar sesión como operador y abrir `/admin/bandeja-pruebas` para copiar el enlace del mensaje más reciente.
4. Completar el enlace y probar reenvío. El enlace anterior debe dejar de ser válido; no se debe tratar la bandeja como una casilla de correo real.

## S4-HF-05 - Membresías vigentes por tenant

### Resultado de la reproducción

No se encontró un defecto funcional que justificara cambiar la autorización. La implementación ya resuelve la membresía desde PostgreSQL para cada consulta:

- `InstitutionAuthService.memberships()` filtra simultáneamente `TenantMembership.status = ACTIVE` y `Tenant.status = ACTIVE`; el selector recibe solo esa lista vigente.
- `TenantContextGuard` vuelve a consultar la membresía activa para toda ruta sensible. Un slug de URL solo aporta navegación; no concede acceso.
- La interfaz pide datos con `cache: no-store`, no reutiliza una lista de tenants para autorizar, y no presenta datos del tenant previo mientras cambia la URL.
- Para cero membresías, el login lleva a un mensaje de “No tienes acceso institucional activo”; para una sola, entra directamente; para varias, permite elegir solo las vigentes.

### PA comprobados

| Caso | Resultado esperado | Estado |
| --- | --- | --- |
| X/Y activas | El selector y `/auth/me` muestran X e Y. | Cubierto. |
| Revocar X | Sin reiniciar sesión, `/auth/me` muestra solo Y. | Prueba E2E de regresión añadida. |
| URL directa X | Tras revocar X, `GET /tenants/X/home` devuelve 403 y no expone datos de X. | Prueba E2E de regresión añadida. |
| Continuidad Y | La misma sesión conserva acceso a Y. | Prueba E2E de regresión añadida. |
| Tenant X suspendido | X desaparece de `/auth/me`; sus URLs devuelven 403; Y sigue operando. | E2E de regresión añadida (`institution-login`). |
| Rechazo de X en todas las áreas | Tras revocar X, equipo, productos, evaluaciones, clientes y escritura de invitaciones devuelven 403 sin datos de X. | E2E de regresión añadida (`institution-login`). |
| Sin membresías | El selector informa ausencia de acceso y cualquier URL de tenant se rechaza. | Cubierto por HU-07 existente. |

## Evidencia

Ejecutada por el equipo en una copia local con PostgreSQL, con todos los cambios de esta revisión aplicados (18 de octubre de 2026).

| Comprobación | Resultado |
| --- | --- |
| Build API y web | Correcto. |
| Lint | Sin errores. |
| Pruebas unitarias API (`npm run test --workspace=@doggycredit/api`) | 110/110, incluida `contracting-access.service.spec.ts` (4 pruebas nuevas). |
| Pruebas unitarias web (`npm run test --workspace=@doggycredit/web`) | 120/120, incluida la prueba nueva de `ContractingAccessAction` (bandeja de pruebas). |
| E2E contra PostgreSQL desechable (`npm run test:e2e --workspace=@doggycredit/api`) | 208/208, 0 fallos. |

Detalle de las suites e2e relevantes:

- `institution-login` (HU-07): 9 pruebas, incluidas las 2 de regresión S4-HF-05 (membresía X revocada y tenant X suspendido, con rechazo en inicio, equipo, productos, evaluaciones y clientes, y continuidad de Y).
- `request-review` (HU-03): 20 pruebas, incluido el envío automático del enlace de contratación y su reenvío tras un fallo de correo.
- `provisioning` (HU-05, invitaciones tras aprovisionar), `email-verification` (HU-02), `team-invitations` (HU-09), `activation` (HU-06), `institution-preparation` (HU-08), `institution-requests` (HU-01), `contracting` (HU-04) y `app`: todas en verde.

### Observaciones

- En ejecuciones previas a este cierre, `backoffice-seed` falló en 3 de 5 pruebas y una prueba de pagos concurrentes de HU-04 fue intermitente, también en `main` y sin relación con HF-04/HF-05. En la ejecución final de referencia ambas pasaron; se recomienda vigilar `backoffice-seed`, que depende del estado de la base de datos usada.
- Las pruebas web muestran advertencias de React (`<h2>` y `<p>` anidados dentro de `<p>`) originadas en `PublicInfo` dentro de `RequestReceivedPage`. Ya existían antes de estos hotfixes y no afectan sus criterios de aceptación.
- La bandeja de pruebas solo es visible para el rol `OPERATOR`, igual que el resto de la revisión de solicitudes.