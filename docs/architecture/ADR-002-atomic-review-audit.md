# ADR-002: Revision institucional y auditoria atomicas

Estado: aceptado para HU-03, 2026-09-26.

## Contexto

Se mantiene ADR-001: SOA logico en monolito modular NestJS/Express, llamadas en proceso, una PostgreSQL y PrismaService compartido mediante infraestructura explicita. El Sprint 1 corregido prevalece desde HU-03: aprobacion, luego contratacion HU-04, luego aprovisionamiento HU-05. No crear provisioning ni pagos durante la revision.

InstitutionRequest/User/AdminSession pertenecen a Identity & Tenants. AuditLog pertenece a Audit. La decision y su evento deben persistirse o revertirse juntos sin que Identity escriba tablas de Audit ni que el contrato publico transporte Prisma.TransactionClient.

## Decision

Identity contiene auth y request-review como features internas. AuditModule expone un unico puerto `AuditWriter.recordRequestDecision`, con entrada de negocio tipada (actorUserId, requestId, decision). Audit no depende de Identity ni consulta sus tablas.

Una infraestructura pequena `DatabaseUnitOfWork` usa AsyncLocalStorage para vincular el cliente transaccional al flujo asincrono actual. Ambos propietarios la importan mediante PrismaModule. El caso de uso abre la transaccion, ejecuta el update condicional y llama a AuditWriter. El adaptador de Audit usa el cliente de ese contexto. Las llamadas anidadas reutilizan la transaccion; solicitudes concurrentes no comparten contexto.

Solo el propietario accede a sus modelos. No se exponen repositorios ni Prisma por public.ts; no hay HTTP interno, eventos genericos, colas ni compensaciones. La implementacion de auditoria se registra como provider del contrato. La transaccion es corta, sin llamadas a proveedores externos.

## Consecuencias

Garantia ACID de decision + auditoria en la topologia actual, con ownership conservado y una sola abstraccion tecnica justificada. La actualizacion `id AND status=PENDING_REVIEW AND emailVerifiedAt IS NOT NULL` impide doble resolucion; cero filas produce 409. Las pruebas ejercitan dos decisiones concurrentes y fallo posterior a insertar auditoria, comprobando rollback de ambas tablas.

El contexto transaccional implica acoplamiento deliberado al despliegue/database compartidos, no independencia distribuida. Separar servicios fisicos requeriria un nuevo ADR sobre consistencia y transporte; no se adelanta esa infraestructura. Nadie debe conservar el cliente fuera del callback ni ejecutar trabajo externo diferido dentro de la transaccion.

Rol de revision: OPERATOR exclusivamente; PLATFORM_ADMIN no hereda permisos implicitamente. Sesion opaca persistida en Identity, sin tenant artificial. Detalles y limites operativos en [HU-03](../hu-03.md).
