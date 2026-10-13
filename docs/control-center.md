# Control local de servicios

Abre `tools/control-center/Abrir-Panel.cmd` con doble clic. Se abrirá `http://127.0.0.1:4400/`. El panel funciona sin API ni web activas y se mantiene abierto al cerrar la pestaña. Requiere Node.js 22, npm y las dependencias del repositorio instaladas.

El panel comprueba la conexión a PostgreSQL en `localhost:5432`, el health check real de la API en `localhost:3000/api/health` y la respuesta de Vite en `localhost:5173`. Refresca cada cuatro segundos. Al detectar que un servicio previamente activo deja de responder, presenta un aviso. Puedes habilitar las notificaciones del navegador con **Activar alertas**. El aviso visible no necesita permisos del navegador.

**DoggyPay QR** es una cuarta comprobación, no un proceso independiente. El panel detecta la IP privada de la red con puerta de enlace, compara la URL de checkout del mock con esa IP y prueba que `/doggypay-demo` y el proxy `/api/health` respondan a través de la dirección LAN. Al iniciar API/web desde el panel, configura la URL del QR con la IP actual, abre Vite en la red local y fuerza `VITE_API_URL=/api` solo en esos procesos. No escribe secretos ni edita `.env`.

Si cambias de Wi-Fi, pulsa **Preparar QR**: reinicia API y web con la IP actual. El **QR de prueba para el teléfono** abre la landing, no inicia un pago. Escanéalo con un teléfono conectado a la misma Wi-Fi antes de presentar. Que la prueba funcione en este PC no demuestra por sí sola que el firewall, el router o el aislamiento de clientes permitan el acceso desde el teléfono. Para el pago real de la demo, genera un QR nuevo desde la pantalla de contratación después de preparar la red.

**Iniciar todo** arranca PostgreSQL si hace falta y luego API y web. Los dos procesos de aplicación se lanzan en segundo plano y el panel conserva su control aunque cierres la pestaña. Una API recién iniciada puede tardar en compilar; durante ese tiempo figura como **Iniciando**. Si un proceso iniciado desde el panel se cae, el panel intenta reiniciarlo hasta tres veces en cinco minutos. Después conserva el error y su registro para revisión.

**Detener todo** pide confirmación y detiene web, API y PostgreSQL. Los botones individuales permiten actuar sobre cada servicio. Para evitar cerrar otro proyecto por accidente, API y web solo se pueden detener desde el panel cuando se iniciaron desde él; un servicio iniciado en otra terminal se muestra activo pero debe cerrarse allí. Si alguno de ellos está activo fuera del panel, **Detener todo** se cancela antes de detener ningún proceso.

PostgreSQL es un servicio de Windows. Iniciarlo o detenerlo puede requerir ejecutar `Abrir-Panel.cmd` como administrador; el panel muestra el error si Windows rechaza la operación. El nombre del servicio se descubre automáticamente. En otro equipo se puede definir `DOGGYCREDIT_POSTGRES_SERVICE` antes de abrir el panel. Este controlador no modifica datos, migraciones ni variables `.env`.

Los registros de API y web se guardan en `tools/control-center/.runtime/`, ignorado por Git. **Registro** muestra las últimas líneas sin exponer el archivo completo. El panel solo escucha en `127.0.0.1:4400`; las órdenes requieren un token de la sesión local y el origen de la página. No abras ese puerto a la red local ni ejecutes el panel en un servidor público.
