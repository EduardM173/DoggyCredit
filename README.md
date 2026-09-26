# DoggyCredit

Plataforma multiinstitución para evaluación crediticia. El frontend React consume la API de NestJS; solo la API accede a PostgreSQL mediante Prisma.

## Estructura

- `apps/api`: API REST NestJS sobre Express. Los módulos de dominio viven aquí y no exponen acceso directo a la base de datos.
- `apps/web`: cliente React con Vite.
- `prisma`: esquema Prisma operativo y futuras migraciones.
- `Data base`: documentos y scripts SQL de referencia entregados para el proyecto.

## Arquitectura orientada a servicios

La aplicación mantiene servicios de negocio independientes por dominio. El primer servicio entregado es `ClientsService`; el siguiente flujo puede añadir módulos como `EvaluationsService`, `ProductsService` e `InstitutionsService` sin acoplar React a Prisma.

Los recursos de institución se aíslan por `tenantId`. Por ahora la API lo recibe en la cabecera `x-tenant-id` para desarrollo. Cuando se incorpore autenticación, esa cabecera debe ser sustituida por el tenant resuelto desde la sesión y la membresía autenticada.

## Inicio local

1. Copia `.env.example` como `.env` y completa una URL válida, incluyendo el nombre de la base de datos.
2. Instala dependencias con `npm install`.
3. Genera el cliente con `npm run prisma:generate`.
4. Crea la migración inicial con `npm run prisma:migrate -- --name init`.
5. Inicia API y frontend con `npm run dev`.

La API escucha en `http://localhost:3000/api` y el frontend en `http://localhost:5173`.
