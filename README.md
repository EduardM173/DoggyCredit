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

La HU-01 pertenece al módulo `src/identity-tenants`. Su contrato, decisiones de alcance y pruebas están descritos en [docs/hu-01.md](docs/hu-01.md).

La decisión vigente es **SOA lógico sobre un monolito modular NestJS**: consulta el [ADR-001](docs/architecture/ADR-001-soa-modular-monolith.md), el [mapa de capacidades y propiedad de datos](docs/architecture/module-map.md) y las [reglas persistentes del backend](apps/api/AGENTS.md). Los módulos se comunican en proceso mediante interfaces públicas; compartir PostgreSQL no permite consultar datos de otro propietario directamente. La separación física requiere una razón concreta y otra decisión explícita.

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
RESEND_API_KEY=""
RESEND_FROM_EMAIL=""
PUBLIC_APP_URL="http://localhost:5173"
EMAIL_VERIFICATION_TOKEN_TTL_MINUTES=30
EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS=60
```

El backend valida estas variables al arrancar y falla con un mensaje explícito cuando falta una obligatoria. En desarrollo, copia también `apps/web/.env.example` como `apps/web/.env`: `VITE_API_URL` debe apuntar a `http://localhost:3000/api` (o al puerto configurado). Sin esta variable React utiliza `/api` en el mismo origen, apropiado para despliegues con proxy inverso.

Los archivos `.env` están ignorados por Git. Nunca subas contraseñas, tokens ni secretos reales.

HU-02 utiliza Resend desde backend. Configura `RESEND_API_KEY` y una dirección autorizada en `RESEND_FROM_EMAIL`; `PUBLIC_APP_URL` es el origen del frontend que abrirá el destinatario. En desarrollo sin credenciales la solicitud se guarda y la pantalla informa fallo de envío. Producción exige esas variables y HTTPS. TTL técnico: 30 minutos; cooldown persistente: 60 segundos, ambos configurables. Consulta [docs/hu-02.md](docs/hu-02.md) para estados, reenvío, despliegue seguro y pruebas. Los tests automatizados sustituyen `EmailSender` y nunca envían correos reales.

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

El seed es idempotente y solo crea el operador de demo cuando `SEED_DEMO_OPERATOR=true` y `NODE_ENV=development` o `test`. Configura `OPERATOR_SEED_NAME`, `OPERATOR_SEED_EMAIL` y `OPERATOR_SEED_PASSWORD` en `.env` local; no hay contraseña compartida en el código. En producción no está permitido.

HU-03: abre `http://localhost:5173/admin/login` para revisar solicitudes con el rol `OPERATOR`. Sesión HttpOnly con TTL configurable (120 minutos por defecto), protección CSRF, búsqueda/filtros/paginación reales y decisión con auditoría atómica. Aprobar solo autoriza a continuar a contratación: no crea tenant ni suscripción y no activa `planInterest`. Consulta [docs/hu-03.md](docs/hu-03.md) y [ADR-002](docs/architecture/ADR-002-atomic-review-audit.md).

HU-04: desde el detalle de una solicitud aprobada, genera el enlace de contratación. Permite confirmar un plan gratuito o de pago, simular transferencia/QR/tarjeta y consultar el resultado automáticamente. `SEED_DEMO_PLANS=true` habilita tres planes ficticios en desarrollo/test; ejecuta el seed para crearlos. No se cobra dinero real. El aprovisionamiento de HU-05 sigue pendiente: confirmar no crea tenants, usuarios institucionales ni suscripciones. Consulta [docs/hu-04.md](docs/hu-04.md) para la demo Wi-Fi, configuración, estados y pruebas, y [ADR-003](docs/architecture/ADR-003-contracting-mock-payments.md) para las fronteras SOA.

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

El backend de desarrollo compila con TypeScript y ejecuta el resultado con `node --watch`; así conserva los metadatos de los decoradores necesarios para la inyección de dependencias y la validación de DTOs de NestJS.

## Calidad

```bash
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
```

Las pruebas cubren la base técnica y el flujo de solicitud institucional. Las e2e inician NestJS y verifican persistencia, validación, duplicados (incluidos envíos concurrentes), estado inicial y OpenAPI contra PostgreSQL. Crean datos ficticios identificados por ejecución y eliminan exclusivamente esos registros al terminar. Para CI se utiliza una base de pruebas dedicada.

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
