# S4-HF-08 — Informe de Verificación: Recuperación de Invitación Vencida sin Soporte SQL

- **Incidencia / Caso**: S4-HF-08
- **Tipo**: Caso de verificación / Hotfix
- **Responsable interno**: jose
- **Fuente**: DoggyCredit V4, secciones 20 y 27
- **Estado**: **VERIFICADO Y CERRADO (SIN CAMBIOS REDUNDANTES)**

---

## 1. Hipótesis Evaluada y Regla de Intervención

> **Hipótesis de fallo**: Token vencido/activación fallida deja al usuario sin acción.
> **Intervención mínima si falla**: Reenvío seguro accesible al administrador o solicitante, invalidación anterior.
> **Prueba de salida**: Expirar enlace → resolver sin soporte SQL.
> **Regla rectora**: Este no es un bug confirmado. Si la prueba pasa, adjuntar evidencia y cerrar como verificado, sin implementar cambios redundantes.

---

## 2. Resultado de la Verificación

**Veredicto**: **HIPÓTESIS DE BUG REFUTADA — COMPORTAMIENTO VERIFICADO Y OPERATIVO AL 100%.**
El sistema ya cuenta con mecanismos integrados y seguros para recuperar y reactivar invitaciones vencidas en todas las etapas, **sin requerir ninguna intervención SQL manual ni asistencia de soporte en base de datos**.

### 2.1 Flujo A: Administrador Institucional Inicial (HU-05 / HU-06 / HU-28)
1. **Detección de expiración**:
   - Cuando expira el enlace inicial (`expiresAt <= now()`), `ActivationService.valid()` rechaza cualquier intento de previsualización o activación con código HTTP `400 Bad Request` y mensaje `"El enlace de activación venció."`.
   - La cola de aprovisionamiento (`ProvisioningQueue.progress`) clasifica y expone el estado de entrega como `activation.delivery: "EXPIRED"`.
2. **Acción disponible en interfaz**:
   - En el panel del operador Doggy Software (`/admin/contrataciones` — [`AdminContractingsPage.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/contracting/AdminContractingsPage.tsx)), cuando el estado de la activación es `"EXPIRED"`, se renderiza automáticamente el botón **"Reenviar invitación"**.
3. **Resolución segura sin SQL**:
   - El operador presiona el botón, disparando `POST /api/admin/contractings/:id/initial-invitation/resend`.
   - [`InitialAdminRecoveryService.resend`](file:///d:/DEV/doggycreadit/apps/api/src/identity-tenants/provisioning/initial-admin-recovery.service.ts):
     - Invalida la invitación previa marcando `invalidatedAt = now()`.
     - Genera una nueva `MembershipInvitation` con hash SHA-256 de un token criptográfico nuevo de 32 bytes en base64url y una ventana de vigencia fresca de 48 horas (`MEMBERSHIP_INVITATION_TTL_HOURS`).
     - Registra el evento de auditoría `INITIAL_INVITATION_RESENT` con actor `OPERATOR`.
     - Despacha de inmediato el correo con el nuevo enlace mediante [`InvitationDeliveryService.deliver`](file:///d:/DEV/doggycreadit/apps/api/src/identity-tenants/provisioning/invitation-delivery.service.ts).
   - El token expirado previo queda permanentemente inhabilitado.
   - El nuevo token permite previsualizar la institución y activar la cuenta con la contraseña elegida.
   - La membresía pasa a `ACTIVE`, el usuario a `ACTIVE`, y se registra `MEMBERSHIP_ACTIVATED`.

### 2.2 Flujo B: Analista de Equipo (HU-07 / Equipo)
1. **Detección de expiración**:
   - Si el enlace del analista vence, `ActivationPage` muestra `"El enlace de activación venció. Solicita una nueva invitación al administrador."` y el botón `"Volver al inicio"`.
2. **Acción disponible en interfaz**:
   - El Administrador Institucional accede a `/:tenantSlug/equipo` ([`TeamPanel.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/institution/TeamPanel.tsx)).
   - El analista figura en estado `INVITED` ("Invitación pendiente").
   - El administrador dispone del botón contextual **"Reenviar"** (`<Send /> Reenviar`).
3. **Resolución segura sin SQL**:
   - Al pulsar "Reenviar", se invoca `POST /api/institutions/:slug/team/invitations/:id/resend`.
   - [`TeamService.resend`](file:///d:/DEV/doggycreadit/apps/api/src/identity-tenants/institution-auth/team.service.ts):
     - Rota el hash del token (`tokenHash = SHA256(newToken)`).
     - Restablece `expiresAt = now() + 48h`, `sentAt = null`, `sendAttempts = 0`.
     - Registra auditoría `ANALYST_INVITATION_RESENT`.
     - Entrega el nuevo correo.
   - El token vencido anterior es rechazado. El nuevo token activa con éxito al analista.

### 2.3 Seguridad y Prevención de Lockout / Reúso
- **Reúso de enlace ya consumido**: Rechazado con `"El enlace ya fue utilizado."`.
- **Reúso de enlace invalidado**: Rechazado con `"El enlace de activación no está disponible."`.
- **Reenvío sobre membresía activa**: Rechazado con `ConflictException`.
- **Rotura de ciclos de importación**: Se desacoplaron importaciones circulares en el módulo `plans-metering` hacia subrutas concretas de `identity-tenants` en lugar de indexar el barril `public.ts`.

---

## 3. Evidencia Automatizada

### 3.1 Suite de Integración Backend
Archivo creado: [`apps/api/src/identity-tenants/s4-hf-08-expired-invitation.spec.ts`](file:///d:/DEV/doggycreadit/apps/api/src/identity-tenants/s4-hf-08-expired-invitation.spec.ts)

Resultados de ejecución (`jest`):
```text
PASS src/identity-tenants/s4-hf-08-expired-invitation.spec.ts (5.102 s)
  S4-HF-08 — Recuperar invitación vencida sin soporte SQL
    √ Escenario 1 (Administrador Inicial): expira enlace inicial, rechaza activación, se recupera vía operador y activa sin soporte SQL (615 ms)
    √ Escenario 2 (Analista de Equipo): expira invitación de analista, el administrador institucional reenvía y se activa sin soporte SQL (478 ms)
    √ Escenario 3 (Seguridad): impide reenvío si la membresía ya fue activada (215 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

### 3.2 Suite de Interfaz Frontend
Archivo actualizado: [`apps/web/src/features/activation/ActivationPage.test.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/activation/ActivationPage.test.tsx)

Resultados de ejecución (`vitest`):
```text
 ✓ src/features/activation/ActivationPage.test.tsx (10 tests)
   ✓ displays expired invitation guidance and allows returning home without SQL support (S4-HF-08)
```

### 3.3 Regresión Global del Monorepo
- **API (`@doggycredit/api`)**: 49 suites pasadas, **297 tests pasados al 100%**.
- **Web (`@doggycredit/web`)**: 26 suites pasadas, **180 tests pasados al 100%**.
- **Total**: **477 tests aprobados en verde**, cero fallos.

---

## 4. Conclusión

Conforme a la regla expresa del caso ("*este no es un bug confirmado. Si la prueba pasa, adjuntar evidencia y cerrar como verificado, sin implementar cambios redundantes*"), se adjunta la prueba automatizada completa y se cierra el hotfix **S4-HF-08** en estado **VERIFICADO**, confirmando que DoggyCredit no requiere soporte manual SQL para recuperar invitaciones vencidas.
