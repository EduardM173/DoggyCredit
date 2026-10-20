# HU-33: recuperación de contraseña

- Las rutas públicas son `/recuperar-contrasena` y `/restablecer-contrasena`. Ambos logins enlazan al mismo flujo; el enlace interno conserva `from=internal` para volver a `/admin/login`.
- `PASSWORD_RESET_TOKEN_TTL_MINUTES` admite 5 a 120 minutos y vale 30 por defecto. `PUBLIC_APP_URL` define el origen confiable del enlace; en producción debe usar HTTPS.
- El secreto aleatorio de 32 bytes se envía en el fragmento del enlace y solo se guarda su hash SHA-256. El token queda utilizable únicamente cuando el transporte confirma la aceptación del correo. Solicitudes nuevas reemplazan el enlace anterior después de esa confirmación; un fallo de envío deja el anterior vigente.
- La petición pública responde con el mismo mensaje para direcciones existentes y desconocidas. Los límites por IP y correo se comparten mediante PostgreSQL. La entrega es asíncrona para no exponer la existencia de la cuenta por latencia SMTP. Un proceso interrumpido puede dejar una reserva no utilizable; transcurrido el intervalo de 60 segundos se puede solicitar otro enlace.
- Un cambio válido usa la política de activación y Argon2id vigentes, consume el token y revoca sesiones institucionales e internas en una transacción. Las membresías, roles y estados no cambian.
- En desarrollo, `EMAIL_TRANSPORT=test_inbox` permite leer el mensaje desde la bandeja de pruebas existente. En producción se usa SMTP; la aceptación por el proveedor no confirma llegada al buzón.
- Validación aislada: `npm run build --workspace=@doggycredit/api`, luego `$env:E2E_TEST_FILE='password-recovery.e2e-spec.mjs'; node apps/api/test/run-e2e.mjs` en PowerShell. El runner crea y elimina una base de datos temporal.
