const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function passwordRecoveryEmail(url: string, ttlMinutes: number) {
  return {
    subject: "Restablece tu contraseña de DoggyCredit",
    text: `Solicitaste restablecer tu contraseña de DoggyCredit.\nAbre este enlace: ${url}\nEl enlace vence en ${ttlMinutes} minutos y solo se puede usar una vez. Si no lo solicitaste, ignora este correo.`,
    html: `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f4f8fc;color:#092548;padding:24px"><main style="max-width:560px;margin:auto;background:#fff;padding:32px"><h1>DoggyCredit</h1><h2>Restablecer contraseña</h2><p>Recibimos una solicitud para recuperar tu acceso.</p><p><a href="${escapeHtml(url)}" style="background:#008c66;color:#fff;padding:14px 24px;display:inline-block;text-decoration:none">Establecer nueva contraseña</a></p><p>El enlace vence en ${ttlMinutes} minutos y solo se puede usar una vez. Si no lo solicitaste, ignora este correo.</p></main></body></html>`,
  };
}
