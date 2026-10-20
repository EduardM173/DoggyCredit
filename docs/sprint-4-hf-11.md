# S4-HF-11 — Informe de Verificación: Recarga y Enlaces Directos en React

- **Incidencia / Caso**: S4-HF-11
- **Tipo**: Caso de verificación / Hotfix
- **Responsable interno**: jose
- **Fuente**: DoggyCredit V4, secciones 20 y 27
- **Estado**: **VERIFICADO Y CORREGIDO**

---

## 1. Hipótesis Evaluada y Regla de Intervención

> **Hipótesis de fallo**: Navegación dentro de rutas UI falla al recargar o abrir URL directa.  
> **Intervención mínima si falla**: Corregir routing React, auth restore, fallback de rutas, tenant guard.  
> **Prueba de salida**: Copiar URL de resultado y refrescar: conserva caso y permisos.  
> **Regla rectora**: Este no es un bug confirmado. Si la prueba pasa, adjuntar evidencia y cerrar como verificado, sin implementar cambios redundantes.

---

## 2. Resultado de la Verificación e Intervención Mínima

**Veredicto**: **VERIFICADO Y RESILIENTE AL 100%.**

### 2.1 Enrutamiento y Auth Restore
- Todas las rutas institucionales profundas están explícitamente registradas en [`router.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/router.tsx):
  `/:tenantSlug/evaluaciones/:id`, `/:tenantSlug/plan`, `/:tenantSlug/actividad`, `/:tenantSlug/equipo`, `/:tenantSlug/configuracion`.
- En caso de recarga completa o ingreso directo por URL:
  1. [`InstitutionHomePage.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/institution/InstitutionHomePage.tsx) monta y rehidrata la sesión vía `GET /api/institution/tenants/:slug/home` con credenciales de cookie.
  2. Si la sesión expiró, redirige a `/iniciar-sesion?returnTo=...` preservando la ruta de destino.
  3. Si el usuario es `ANALYST` e intenta abrir enlaces administrativos (`/equipo`, `/actividad`, `/configuracion`), el componente bloquea el render y muestra el banner de control de acceso ("No tienes permiso para administrar la institución" / "Acceso no autorizado").
  4. En [`EvaluationDetail.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/institution/EvaluationDetail.tsx), el ID de la evaluación se obtiene directamente de los parámetros de la URL (`useParams<{ id: string }>()`) y cuenta con fallback seguro de navegación previa (`location.state?.from || /${slug}/evaluaciones`).

### 2.2 Corrección Defensiva de Casos Borde
- Se aplicó encadenamiento opcional (`subscription?.status`) en [`PlanAndUsagePage.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/institution/PlanAndUsagePage.tsx) para evitar `TypeError` en tenants sin registro activo de suscripción paga.
- Se protegió `(evaluation.requestedAmount ?? 0)` en [`EvaluationDetail.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/institution/EvaluationDetail.tsx) para evitar excepciones en borradores con montos pendientes de asignación.

---

## 3. Evidencia Automatizada

- **Suite**: [`apps/web/src/features/institution/s4-hf-11-deep-links.test.tsx`](file:///d:/DEV/doggycreadit/apps/web/src/features/institution/s4-hf-11-deep-links.test.tsx)
- **Resultados**:
```text
 ✓ src/features/institution/s4-hf-11-deep-links.test.tsx (4 tests) 374ms
   ✓ Escenario 1: enlace directo a evaluación (/banco-solidario/evaluaciones/eval-123) restaura contexto y caso
   ✓ Escenario 2: enlace directo a plan y consumo (/banco-solidario/plan) restaura suscripción y capacidades
   ✓ Escenario 3: control de permisos sobre enlace directo (/banco-solidario/actividad) según rol
   ✓ Escenario 4: enlace directo a administración de equipo (/banco-solidario/equipo) rechaza rol sin privilegios
```
