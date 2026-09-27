# ADR-003: Contratacion y proveedor de pagos simulado

Estado: aceptado para HU-04. Complementa ADR-001 y ADR-002; no cambia el despliegue de monolito modular SOA logico.

## Responsabilidades

Plans & Metering implementa la contratacion y posee Plan, Contracting, Payment, ContractingCredential y PaymentProviderEvent. Identity & Tenants sigue siendo propietario de InstitutionRequest y de la autenticacion del operador. RequestContextReader publica solo el contexto necesario y exige APPROVED; Plans no consulta tablas de Identity ni atraviesa relaciones Prisma hacia ellas. Audit es el unico escritor de AuditLog.

Los guards administrativos de Identity se reutilizan exclusivamente en la frontera HTTP. Nest necesita exportar tambien su dependencia AdminAuthService para instanciarlos en el modulo consumidor; no se publica ese servicio en public.ts ni se invoca desde la logica comercial. Las interfaces de aplicacion no reciben Request, Response ni tipos Prisma.

PaymentProvider es un puerto de infraestructura. MockPaymentProvider posee solamente MockPaymentCheckout y no lee o escribe Payment/Contracting. El controller recibe el resultado normalizado del adapter y lo entrega a PaymentEventProcessor, propietario de las transiciones comerciales. No existe un webhook ficticio ni una llamada HTTP interna. Un futuro proveedor real tendra otra frontera autenticada; no se puede reutilizar el endpoint de simulacion como webhook real.

Dependencias actuales: Plans -> Identity, Plans -> Audit, Plans -> infraestructura; Identity -> Audit/infraestructura; Audit -> infraestructura. No hay dependencias inversas, forwardRef ni modulos globales. HU-05 necesitara revisar su composicion sin introducir Identity -> Plans -> Identity.

## Dinero e invariantes

Se conserva Decimal(14,2), la convencion monetaria existente; JSON lleva cadenas decimales. El servidor obtiene importe, moneda y periodicidad del Plan activo y guarda un snapshot en Contracting. La demo admite BOB/MONTHLY. Las columnas comerciales de planes antiguos son anulables para que la migracion no convierta planes incompletos en gratuitos.

Un Contracting por solicitud, un Payment PENDING por contratacion mediante indice parcial PostgreSQL, y una clave de idempotencia unica por contratacion. Locks transaccionales ordenan la confirmacion del plan y creacion de intentos. Las condiciones PENDING -> terminal impiden reescribir un resultado. Los intentos FAILED/CANCELLED conservan su historia; reintentar crea otro Payment. Los terminos quedan inmutables al confirmar el plan.

El plan sin pago confirma sin crear Payment. El plan de pago no confirma hasta PAID. No se crea Tenant, TenantSubscription, TenantMembership, MembershipInvitation ni User institucional. El planInterest original permanece informativo.

## Fallos y atomicidad

Crear Payment PENDING y su auditoria es atomico. Inicializar el proveedor ocurre fuera de esa transaccion con referencia estable, por lo que una falla deja el mismo intento recuperable. Nunca mantener transacciones abiertas durante una futura llamada externa.

El mock guarda de forma durable un unico resultado y eventId por checkout antes de entregarlo a negocio. Si falla el procesamiento posterior, repetir la accion devuelve ese mismo evento. PaymentEventProcessor valida proveedor, referencia, importe, moneda, tipo y fecha; deduplica por (provider,eventId), rechaza duplicados alterados, y persiste Payment + Contracting + Audit + PaymentProviderEvent en una transaccion compartida por DatabaseUnitOfWork. Un fallo de auditoria revierte todos esos cambios, sin perder el resultado durable del proveedor. No hay worker de reconciliacion automatico: el reintento del checkout/operador recupera el caso.

## Acceso y limites

El operador genera un enlace de un solo uso para una solicitud APPROVED. Se canjea por cookie HttpOnly/SameSite=Strict, con Secure en produccion y path limitado. Tokens aleatorios de 256 bits, SHA-256 en persistencia, vencimiento y revocacion; generar otro enlace invalida accesos previos. Identificadores de otra solicitud no son parametros admitidos en operaciones del representante.

El checkout publico usa otro token independiente, en fragmento de URL, retirado al montar la pagina y enviado en un header; no usa cookies para autorizar resultados ni expone contacto institucional. Regenerar invalida el anterior sin duplicar Payment. Solo memoria del frontend; no localStorage/sessionStorage. Expiracion obliga a regenerar, no a reescribir pagos terminales.

Los endpoints del mock y sus controles se deshabilitan con PAYMENT_PROVIDER=disabled (predeterminado en produccion). La simulacion es explicita, no procesa dinero ni recoge PAN/CVV/cuentas. HTTP Wi-Fi es exclusivamente demo local en una red confiable; produccion requiere HTTPS y una decision separada sobre proveedor real. La limitacion de solicitudes es en memoria por proceso, coherente con el despliegue local actual, no un rate limiter distribuido.
