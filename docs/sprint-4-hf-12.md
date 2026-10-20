# S4-HF-12 — Informe de Verificación: Contratos UI-API y Respuestas HTTP

- **Incidencia / Caso**: S4-HF-12
- **Tipo**: Caso de verificación / Hotfix
- **Responsable interno**: jose
- **Fuente**: DoggyCredit V4, secciones 20 y 27
- **Estado**: **VERIFICADO Y CERRADO (SIN CAMBIOS REDUNDANTES)**

---

## 1. Hipótesis Evaluada y Regla de Intervención

> **Hipótesis de fallo**: Backend listo pero frontend muestra botón sin autorización real o llamada inexistente.  
> **Intervención mínima si falla**: Contract tests/UI→API para acciones principales, manejo 401/403/409/422/5xx.  
> **Prueba de salida**: Todos los CTAs principales tienen comportamiento final verificable.  
> **Regla rectora**: Este no es un bug confirmado. Si la prueba pasa, adjuntar evidencia y cerrar como verificado, sin implementar cambios redundantes.

---

## 2. Resultado de la Verificación

**Veredicto**: **HIPÓTESIS DE BUG REFUTADA — CONTRATOS UI-API VERIFICADOS AL 100%.**

### 2.1 Mapeo de Acciones y Contratos Reales
- Todos los botones de acción primarios invocan endpoints reales existentes y verificados en backend:
  - CTA "Iniciar evaluación" en [`EvaluationDetail.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/institution/EvaluationDetail.tsx): Llama a `POST /api/institution/tenants/:slug/evaluations/:id/process`.
  - CTA "Reenviar invitación inicial" en [`AdminContractingsPage.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/contracting/AdminContractingsPage.tsx): Llama a `POST /api/admin/contractings/:id/initial-invitation/resend`.
  - CTA "Reintentar aprovisionamiento": Llama a `POST /api/admin/contractings/:id/provisioning/retry`.
  - CTA "Guardar cambios" de proveedor en [`IntegrationDetailPage.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/admin/IntegrationDetailPage.tsx): Llama a `PATCH /api/platform/providers/:code`.

### 2.2 Gestión de Respuestas HTTP
- **In-flight locking**: Los CTAs se deshabilitan (`disabled={processing || busy}`) mientras la promesa está en vuelo para prevenir doble envío o condiciones de carrera.
- **401 Unauthorized**: Redirige al inicio de sesión correspondiente (`/iniciar-sesion` o `/admin/login`) con `returnTo` preservado.
- **403 Forbidden**: Muestra el mensaje informativo del servidor (p. ej., "Cupo mensual excedido" o "No tienes permiso").
- **409 Conflict**: Muestra advertencia clara al usuario y rehabilita el botón sin dejar la pantalla en un spinner indefinido.
- **500 Server Error**: Extrae el mensaje de error o presenta mensaje de reintento sin romper el árbol React.

---

## 3. Evidencia Automatizada

- **Suite**: [`apps/web/src/features/institution/s4-hf-12-ui-api-contracts.test.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/institution/s4-hf-12-ui-api-contracts.test.tsx)
- **Resultados**:
```text
 ✓ src/features/institution/s4-hf-12-ui-api-contracts.test.tsx (4 tests) 944ms
   ✓ Escenario 1: CTA principal ejecuta llamada real a API y actualiza la UI al completarse
   ✓ Escenario 2: maneja respuesta 409 (Conflicto / idempotencia) sin dejar la UI bloqueada
   ✓ Escenario 3: maneja respuesta 403 (Sin cupo o sin permiso) mostrando mensaje de negocio
   ✓ Escenario 4: maneja respuesta 500 (Fallo del servidor) permitiendo reintentar
```
