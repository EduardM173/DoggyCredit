# ADR-004: Aprovisionamiento durable e invitaciones recuperables

Estado: aceptado para HU-05. Complementa ADR-001/002/003; el Sprint 1 corregido prevalece sobre el flujo antiguo del maestro.

## Decision

Mantener SOA logico en el monolito modular. Identity & Tenants posee `TenantProvisioning`, Tenant, User, TenantMembership y MembershipInvitation. Plans & Metering posee Contracting, Payment, Plan y TenantSubscription. Audit es el unico escritor de AuditLog. Las llamadas entre propietarios usan contratos publicos en proceso y `DatabaseUnitOfWork`; no transfieren Prisma ni usan HTTP interno.

La confirmacion de un contrato inserta `TenantProvisioning` mediante `ProvisioningQueue` en **la misma transaccion**, tanto para plan gratuito como para pago confirmado. Un job unico por contrato es la evidencia durable; no hay evento en memoria como unico disparador. La migracion incorpora contratos historicos CONFIRMED y el worker revalida su elegibilidad.

Plans ya importa Identity para contexto y autorizacion. Para no introducir un ciclo Nest, `OnboardingModule` compone ambos modulos y registra los workflows propiedad de Identity expuestos para esa composicion. Consume `ProvisioningPlans` publico de Plans. IdentityTenantsModule no importa PlansMeteringModule; no se usa `forwardRef()`, modulo global, bus ni framework de workflows.

## Atomicidad e idempotencia

El worker reclama mediante update condicional, incrementa intentos y usa lease UUID. Recupera PROCESSING abandonados al vencer el lease; el procesamiento bloquea el job y verifica ese UUID antes de escribir. Un worker obsoleto no completa ni marca el fallo de un lease nuevo. Los bloqueos de solicitud, email normalizado y slug tienen orden estable.

Una transaccion crea/reutiliza tenant por solicitud, usuario global por email, membership inicial INVITED, suscripcion ACTIVE del confirmedPlanId e invitacion; registra TENANT_PROVISIONED con actor SYSTEM y completa el job. Un fallo revierte todos esos cambios. Indices unicos respaldan solicitud, contrato, email insensible a mayusculas, tenant/usuario, administrador inicial, suscripcion activa e invitacion vigente. El historial de suscripciones conserva multiples filas, pero solo una ACTIVE por tenant.

Solo errores transitorios conocidos de PostgreSQL/Prisma se reintentan con backoff y limite. Conflictos de datos, elegibilidad invalida y errores desconocidos quedan FAILED_PERMANENT, sin repetir indefinidamente errores de programacion. El reinicio conserva jobs, contadores y fechas.

## Correo

El correo se envia despues del commit mediante EmailSender/Resend. Su fallo no elimina la institucion. MembershipInvitation conserva digest SHA-256 de un token aleatorio de 256 bits, TTL, version, lease, intentos y resultado; nunca token plano ni password temporal. El envio no activa usuario ni membership.

Dos intentos inmediatos del mismo envio reutilizan payload y clave de idempotencia. Una recuperacion posterior rota el token y version: solo el digest nuevo es valido. Si el proceso cae despues de que Resend acepta y antes de guardar sentAt, puede llegar otro correo; el enlace anterior queda invalidado. No se promete entrega exactamente una vez ni llegada a bandeja principal. El limite es cinco ciclos de envio por defecto, con hasta dos llamadas por ciclo solo ante error transitorio.

## Operacion y alcance

El bootstrap HTTP inicia explicitamente el worker; app.init de tests no lo inicia. El cierre espera el ciclo en curso. Un flag permite pausar tanto provisioning como entrega sin perder pendientes. No hay endpoint publico de reintento/creacion de tenants. Fallos permanentes requieren diagnostico operativo antes de un reintento controlado.

HU-05 agrega la consulta OPERATOR y pantalla de instituciones. HU-06 consumira la invitacion, activara membership y gestionara credenciales; HU-07 incorporara login/contexto institucional. El sitio publico y el backoffice son superficies de acceso, no tenants bancarios. Esta HU no introduce evaluaciones, expedientes ni almacenamiento de datos financieros externos.
