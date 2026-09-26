# DoggyCredit

Base técnica de una plataforma multiinstitución para evaluación crediticia. React consume una API HTTP construida con NestJS sobre Express; únicamente el backend accede a PostgreSQL mediante Prisma.

## Requisitos

- Node.js 22 LTS y npm 10 o superior.
- PostgreSQL 16 o una versión compatible soportada por Prisma.
- Git.

La versión de Node recomendada también está declarada en `.nvmrc`.

## Estructura

```text
DoggyCredit/
├── apps/
│   ├── api/                  # NestJS + Express
│   │   ├── src/common/       # Configuración HTTP transversal
│   │   ├── src/config/       # Validación de entorno
│   │   └── src/infrastructure/prisma/
│   └── web/                  # React + TypeScript + Vite
├── prisma/                   # Schema, migraciones y seed
├── Data base/                # Modelo y SQL de referencia originales
├── .github/workflows/ci.yml
└── package.json              # Scripts y workspaces npm
```

El backend es un monolito modular preparado con separación orientada a servicios. Los futuros módulos de Sprint 1 deben mantener el flujo `Controller -> Service -> infraestructura`, sin acceder a Prisma desde controllers ni desde React. No se han creado microservicios ni módulos funcionales vacíos.

## Instalación

Desde la raíz del repositorio:

```bash
npm install
```

Los workspaces `@doggycredit/api` y `@doggycredit/web` se instalan con el mismo comando.

## Variables de entorno

1. Copia `.env.example` como `.env`.
2. Sustituye `CHANGE_ME` por la contraseña local de PostgreSQL.
3. Si cambias puertos, mantén `WEB_ORIGIN` alineado con la URL de Vite.

```env
DATABASE_URL="postgresql://postgres:CHANGE_ME@localhost:5432/doggycredit?schema=public"
NODE_ENV="development"
API_PORT=3000
WEB_ORIGIN="http://localhost:5173"
```

El backend valida estas variables al arrancar y falla con un mensaje explícito cuando falta una obligatoria. Para cambiar la URL que consumirá React, copia `apps/web/.env.example` como `apps/web/.env` y edita `VITE_API_URL`.

Los archivos `.env` están ignorados por Git. Nunca subas contraseñas, tokens ni secretos reales.

## Base de datos

Crea una base vacía en PostgreSQL:

```sql
CREATE DATABASE doggycredit;
```

Después ejecuta desde la raíz:

```bash
npm run prisma:generate
npx prisma migrate dev
npm run prisma:seed
```

El seed es idempotente y crea únicamente el usuario técnico ficticio `dev.admin@doggysoftware.local`.

Para aplicar migraciones ya versionadas en CI o en un ambiente desplegado:

```bash
npm run prisma:deploy
```

Para revisar el modelo:

```bash
npm run prisma:format
npm run prisma:validate
```

Solo en desarrollo, si aceptas eliminar todos los datos de la base configurada:

```bash
npm run prisma:reset
npm run prisma:seed
```

No uses `prisma db push` como reemplazo de las migraciones.

## Ejecución

Inicia frontend y backend juntos:

```bash
npm run dev
```

También pueden iniciarse por separado:

```bash
npm run dev:api
npm run dev:web
```

- Frontend: <http://localhost:5173>
- Health check: <http://localhost:3000/api/health>
- Swagger/OpenAPI: <http://localhost:3000/api/docs>
- Documento OpenAPI JSON: <http://localhost:3000/api/docs-json>

## Calidad

```bash
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
```

Las pruebas unitarias cubren la base de frontend y backend. La prueba e2e inicia NestJS, conecta Prisma y comprueba tanto el health check como el documento OpenAPI.

## Integración continua

El workflow de GitHub Actions se ejecuta en cada Pull Request hacia `main` y en cada actualización de `main`. Levanta PostgreSQL 16 y comprueba:

1. instalación reproducible con `npm ci`;
2. formato y validación de Prisma;
3. generación del cliente y aplicación de migraciones;
4. lint;
5. pruebas unitarias y e2e;
6. build de backend y frontend.

No realiza despliegues.

## Flujo Git

`main` es la rama estable. Usa:

- `feature/<nombre>` para funcionalidad o preparación técnica;
- `fix/<nombre>` para correcciones.

Todo cambio debe entrar mediante Pull Request y con CI aprobado. Consulta [CONTRIBUTING.md](CONTRIBUTING.md) para el flujo y las opciones exactas de protección que un administrador debe activar en GitHub.
