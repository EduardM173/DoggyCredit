# DoggyCredit - base de datos

Base PostgreSQL + Prisma ORM 7 para NestJS/Express. React NO se conecta directamente a PostgreSQL ni usa Prisma; consume la API de NestJS.

## Principios del modelo

- Una identidad (`User`) puede pertenecer a uno o varios tenants mediante `TenantMembership`.
- Cada institución financiera es un `Tenant`.
- Todas las entidades de negocio sensibles tienen `tenantId`.
- Relaciones críticas usan claves compuestas `[tenantId, id]` para impedir referencias cruzadas entre tenants incluso si hay un bug en el servicio.
- `InstitutionRequest` es una solicitud comercial; no se convierte en usuario/tenant hasta aprobación.
- Las invitaciones y verificaciones almacenan hashes de tokens, nunca el token en claro.
- `Evaluation` es la entidad central del negocio; `Client` es el expediente persistente.
- Cada evaluación conserva `applicantSnapshot` para que cambios posteriores en el expediente no reescriban la historia.
- Los resultados de fuentes externas se guardan por evaluación en `EvaluationSourceResult`, con estado y fecha.
- `FinancialProfile` es un snapshot calculado por evaluación.
- Las recomendaciones y sus razones se guardan por evaluación y producto.
- `UsageRecord` es append-only para medición de consumo.
- `AuditLog` es append-only y no debe contener secretos ni datos financieros completos.

## Instalación base (Prisma 7)

```bash
npm i prisma@7 @prisma/client@7 @prisma/adapter-pg pg dotenv
npm i -D @types/pg
```

`.env`:

```env
DATABASE_URL="postgresql://doggy:doggy@localhost:5432/doggycredit?schema=public"
```

Coloca `schema.prisma` en `prisma/schema.prisma` y `prisma.config.ts` en la raíz.

```bash
npx prisma migrate dev --name init
npx prisma generate
```

## NestJS

El backend debe derivar `tenantId` desde la sesión/membresía autenticada. Nunca debe aceptar un `tenantId` arbitrario del frontend para decidir qué datos leer.

En consultas tenant-scoped siempre filtra por `tenantId`, incluso si conoces el `id` del registro.

Ejemplo conceptual:

```ts
await prisma.client.findFirstOrThrow({
  where: {
    id: clientId,
    tenantId: auth.tenantId,
  },
});
```

## RLS opcional

`rls_optional.sql` agrega defensa en profundidad usando Row-Level Security de PostgreSQL. No lo actives hasta que el backend ejecute todas las consultas tenant-scoped dentro de una transacción que configure `app.tenant_id`.

## Reglas que deben vivir en servicios, no solo en la BD

- Normalizar emails a minúsculas antes de guardar.
- Solo debe existir una suscripción `ACTIVE` por tenant.
- La aprobación de una solicitud debe ejecutarse en una transacción y ser idempotente.
- No modificar evaluaciones `COMPLETED`; crear una nueva evaluación.
- No modificar `EvaluationSourceResult`, `FinancialProfile`, recomendaciones, `UsageRecord` ni `AuditLog` una vez consolidados salvo procesos administrativos explícitos.
- No guardar API keys ni secretos de proveedores en estas tablas; usar variables de entorno/secret manager.
- `normalizedPayload` no debe contener secretos y debe minimizar datos personales innecesarios.

## Hardening PostgreSQL recomendado

`hardening_optional.sql` agrega CHECK constraints y dos índices que expresan reglas que Prisma no modela tan cómodamente: montos válidos, completitud 0..1, una sola suscripción activa y unicidad case-insensitive del correo.

## Borrado y retención

Los datos durables usan `RESTRICT` en relaciones críticas. No borres físicamente tenants, clientes con historial ni evaluaciones consolidadas; usa estados como `SUSPENDED`, `INACTIVE` o una política explícita de retención/anominización. Los `CASCADE` se reservan para artefactos efímeros como tokens/invitaciones cuando su padre desaparece.
