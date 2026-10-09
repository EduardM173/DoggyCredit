# ADR-001: SOA logico sobre monolito modular

Estado: aceptado. Fecha: 2026-09-26.

Actualizacion HU-02: se implemento la frontera de email prevista en este ADR, sin cambiar la decision arquitectonica. Ver [HU-02](../hu-02.md). Las menciones a HU-02 como futura describen el alcance de la iteracion arquitectonica original.

## Contexto y fuente

DoggyCredit es un MVP universitario cuyo kata requiere SOA. El Documento Maestro de Contexto, version de handoff del 26 de septiembre de 2026, establece separacion logica con despliegue conjunto permitido (secciones 2, 12, 17, 18 y 20; paginas 4, 15, 22, 24 y 26). Su archivo fuente es `DoggyCredit_Documento_Maestro_Contexto.pdf`, situado actualmente en la carpeta padre del repositorio; no esta versionado aqui.

DEFINIDO es decision vigente; PENDIENTE no autoriza inventar una decision definitiva; FUTURO/FUERA DE MVP no se implementa sin nueva decision explicita. Este ADR registra la iteracion arquitectonica solicitada antes de HU-02. No reemplaza las decisiones funcionales del maestro.

## Decision

SOA logico mediante capacidades verticales con responsabilidades, propiedad de datos y contratos explicitos. React consume HTTPS; un backend NestJS con adaptador Express constituye la unidad desplegable actual. Prisma 7 y PostgreSQL son infraestructura compartida controlada.

El despliegue conjunto no garantiza por si solo SOA: las fronteras deben cumplirse en imports, contratos y acceso a datos. Los modulos no se separan fisicamente por haber terminado una HU o por estar maduros.

Los ocho servicios logicos son Identity & Tenants, Clients / Expedientes, Evaluations, Financial Integrations, Financial Profile, Recommendations, Plans & Metering y Audit. Sus responsabilidades, propiedad y dependencias estan en [module-map.md](module-map.md). Se documenta el mapa objetivo; solo se crean modulos con funcionalidad real.

## Motivos y dependencias

- Mantener cohesion por capacidad y reducir el coste de cambios internos.
- Exponer solamente providers/casos de uso consumidos mediante exports de Nest y contratos propios. El consumidor importa el modulo y su interfaz `public.ts`; el modulo conserva sus clases internas y persistencia.
- Usar llamadas en proceso. HTTP pertenece a la frontera con React/proveedores; no se usa REST interno, colas ni event bus para imitar microservicios.
- Mantener DTO HTTP, contrato de aplicacion y persistencia diferenciados donde aporte valor. No publicar tipos Prisma, `TransactionClient`, repositorios ni entidades internas como contrato entre capacidades.
- Mantener controllers pequenos: validar, delegar y representar respuesta. Los servicios actuales pueden usar Prisma para operaciones propias sin repository obligatorio.
- Evitar dependencias circulares, imports profundos y modulos de negocio globales. `forwardRef()` requiere analizar primero ubicacion de responsabilidades e inversion de dependencias.
- Common solo contiene infraestructura HTTP transversal; no es un destino para reglas/DTOs de negocio compartidos.

## Datos e infraestructura

Se mantiene un PrismaClient administrado por `PrismaModule`, importado explicitamente por quien lo necesita, y una PostgreSQL. Compartir cliente no permite consultar tablas ajenas, ni mediante `include`, joins, SQL raw o una transaccion compartida. Las FK existentes protegen invariantes, no conceden propiedad de datos.

Cada capacidad controla sus consultas y mutaciones; otra capacidad solicita operaciones por su contrato publico. Los contratos transportan datos minimos, identificadores/contexto autorizado y resultados propios. Los futuros workflows transaccionales entre propietarios deben disenar atomicidad e idempotencia antes de implementarse, sin entregar el cliente Prisma al consumidor ni introducir sagas preventivamente.

Prisma, configuracion, logging tecnico y proveedores son infraestructura. La configuracion global actual es transversal y justificada para validar el entorno al iniciar; los modulos de negocio permanecen locales. Email no es un servicio de negocio separado: HU-02 implementa `EmailVerificationService -> EmailSender -> SmtpEmailAdapter -> SMTP`. El proveedor concreto permanece en infraestructura y puede sustituirse sin alterar las capacidades que usan el port.

## Consecuencias

Beneficios: una operacion local sencilla, pruebas integradas sin despliegues distribuidos, contratos claros y posibilidad de extraccion futura con cambios acotados.

Costes: una unidad de despliegue y menor aislamiento de fallos/recursos; las fronteras requieren disciplina, revision y lint. La base compartida permite acoplamiento accidental si no se revisan las consultas. Una futura extraccion puede requerir migracion de datos, autorizacion entre servicios y redisenar transacciones; no se promete que baste con cambiar un transporte.

No se incorporan microservicios, API Gateway, RabbitMQ/Kafka, Redis arquitectonico, CQRS, event sourcing, sagas, service mesh, Kubernetes, schemas/bases/clientes Prisma por servicio, repositorios genericos ni capas vacias.

## Extraccion futura

Requiere un beneficio concreto: escalado o despliegue independiente, aislamiento de fallos, ritmos de cambio distintos, equipo propietario separado, frontera de seguridad, tecnologia o carga operacional diferente. Registrar un nuevo ADR con evidencia, coste operacional, contrato, datos y estrategia de transicion. La estabilidad de un modulo no es un criterio suficiente.

## Aplicacion actual y verificacion

HU-01 conserva `src/identity-tenants/institution-requests/`; no se mueve por estetica. Se explicita su entrada/recibo de aplicacion sin Prisma y la dependencia de `PrismaModule`. Identity & Tenants no exporta providers porque todavia no tiene consumidores de negocio. El contrato HTTP sigue siendo `POST /api/institution-requests` y conserva `EMAIL_PENDING`, validacion, normalizacion y conflictos.

ESLint existente restringe imports entre capacidades, Prisma en controllers/DTOs/contratos y dependencias de infraestructura hacia negocio. No se instalan herramientas. La revision manual sigue cubriendo propiedad de queries, exports de Nest y ciclos; los detalles y limites estan en el mapa.

Ejecutar `npm run lint`, `npm test`, `npm run test:e2e` (incluye build backend e inicio real de Nest con PostgreSQL) y `npm run prisma:validate` si cambia persistencia. HU-02 sigue fuera de esta iteracion.
