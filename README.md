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
INSTITUTION_SESSION_IDLE_MINUTES=30
INSTITUTION_SESSION_ABSOLUTE_MINUTES=480
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

El seed es idempotente. El operador personalizado se configura con `SEED_DEMO_OPERATOR=true`, `OPERATOR_SEED_NAME`, `OPERATOR_SEED_EMAIL` y `OPERATOR_SEED_PASSWORD` en `.env` local. No publiques sus credenciales reales. Todos los seeds demo están restringidos a `NODE_ENV=development` o `test`; en producción se rechazan antes de modificar datos.

### Usuarios de prueba del backoffice

Acceso: <http://localhost:5173/admin/login>. Ambas cuentas tienen el rol interno `OPERATOR` y permiten revisar solicitudes, consultar contrataciones e instituciones.

| Usuario                           | Contraseña de prueba |
| --------------------------------- | -------------------- |
| `operador.demo@doggycredit.local` | `DoggyDemo2026!`     |
| `revision.demo@doggycredit.local` | `DoggyRevision2026!` |

Estas credenciales son públicas, exclusivamente para una base local de desarrollo/pruebas. No habilites estas cuentas en producción ni en un entorno expuesto a Internet. No son cuentas bancarias ni administradores de tenants.

Para crearlas, configura `NODE_ENV=development` y `SEED_DEMO_BACKOFFICE_USERS=true` en `.env`, y ejecuta `npm run prisma:seed`. Repetirlo no duplica usuarios; si cambia su contraseña revoca sus sesiones anteriores. No cambia el operador personalizado salvo que también habilites `SEED_DEMO_OPERATOR`. El seed rechaza reutilizar una cuenta con otro rol o con memberships institucionales.

Este seed de usuarios **no crea tenants, memberships, invitaciones ni suscripciones**, ni activa administradores institucionales. Los planes demo mantienen su flag independiente `SEED_DEMO_PLANS`; los datos institucionales se generan mediante el flujo normal de solicitud, contratación y aprovisionamiento.

HU-03: abre `http://localhost:5173/admin/login` para revisar solicitudes con el rol `OPERATOR`. Sesión HttpOnly con TTL configurable (120 minutos por defecto), protección CSRF, búsqueda/filtros/paginación reales y decisión con auditoría atómica. Aprobar solo autoriza a continuar a contratación: no crea tenant ni suscripción y no activa `planInterest`. Consulta [docs/hu-03.md](docs/hu-03.md) y [ADR-002](docs/architecture/ADR-002-atomic-review-audit.md).

HU-04: desde el detalle de una solicitud aprobada, genera el enlace de contratación. Permite confirmar un plan gratuito o de pago, simular transferencia/QR/tarjeta y consultar el resultado automáticamente. `SEED_DEMO_PLANS=true` habilita tres planes ficticios en desarrollo/test; ejecuta el seed para crearlos. No se cobra dinero real. Consulta [docs/hu-04.md](docs/hu-04.md) para la demo Wi-Fi, configuración, estados y pruebas, y [ADR-003](docs/architecture/ADR-003-contracting-mock-payments.md) para las fronteras SOA.

HU-05: confirmar la contratación registra un job durable en la misma transacción. El worker aprovisiona automáticamente tenant, administrador inicial invitado y suscripción del plan confirmado, con auditoría atómica y correo recuperable posterior al commit. El backoffice muestra datos reales en `/admin/instituciones`. `TENANT_PROVISIONING_ENABLED=true` es el valor predeterminado; consulta las variables y garantías en [docs/hu-05.md](docs/hu-05.md) y [ADR-004](docs/architecture/ADR-004-durable-provisioning.md). La invitación no activa la cuenta: su pantalla y consumo corresponden a HU-06, y el login institucional a HU-07.

HU-06: el administrador invitado abre `/activar-cuenta` desde su correo, define una contraseña global cuando todavía no tiene una, y activa exclusivamente la membresía de esa institución. La invitación se consume una sola vez y la operación se audita; la tabla de Instituciones refleja el estado real sin datos duplicados. Consulta [docs/hu-06.md](docs/hu-06.md).

HU-07: `/iniciar-sesion` autentica al usuario global sin pedirle el banco. Una membresía activa abre automáticamente `/{tenantSlug}`; varias muestran un selector. El backend comprueba la membresía en cada acceso, y el cierre de sesión revoca la cookie institucional sin afectar al backoffice. Consulta [docs/hu-07.md](docs/hu-07.md) para los vencimientos, la migración y las garantías de aislamiento.

Para probar HU-07, aplica las migraciones con `npm run prisma:deploy` e inicia sesión en `http://localhost:5173/iniciar-sesion` con una cuenta institucional ya activada mediante HU-06. El seed solo crea usuarios del backoffice, no usuarios institucionales. Si la cuenta pertenece a una institución activa, se abre su espacio; si pertenece a varias, se muestra el selector. Una cuenta sin membresías activas no obtiene acceso. El inicio de sesión interno permanece separado en `/admin/login`.

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

Las pruebas cubren la base técnica y HU-01 a HU-05. Las e2e inician NestJS y verifican persistencia, autorización, concurrencia, rollback, recuperación y contratos HTTP contra PostgreSQL. El runner crea bases temporales aleatorias, aplica migraciones y elimina exclusivamente esas bases al terminar; no trunca la base local del desarrollador. La cuenta PostgreSQL de pruebas necesita permiso CREATEDB, también en CI. EmailSender se sustituye para que las pruebas no envíen correos reales.

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
