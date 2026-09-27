export function verificationEmail(url: string, ttlMinutes: number) {
  const safeUrl = url
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return {
    subject: "Confirma tu correo para continuar con DoggyCredit",
    text: `DoggyCredit\nSolicitud recibida. Confirma tu correo para que nuestro equipo pueda revisar tu solicitud.\n${url}\nEste enlace expira en ${ttlMinutes} minutos y solo puede usarse una vez. Si no realizaste la solicitud, ignora este correo. Verificar tu correo no implica la aprobación de tu institución.`,
    html: `<!doctype html><html lang="es"><body style="margin:0;background:#f4f8fc;font-family:Arial,sans-serif;color:#092548"><main style="max-width:560px;margin:32px auto;background:#fff;padding:32px"><h1 style="font-size:26px">Doggy<span style="color:#0874bb">Credit</span></h1><h2>Solicitud recibida</h2><p>Confirma tu correo para que nuestro equipo pueda revisar tu solicitud de acceso.</p><p style="margin:32px 0"><a href="${safeUrl}" style="background:#18cf92;color:#062b38;padding:14px 24px;border-radius:6px;font-weight:bold;text-decoration:none">Confirmar correo</a></p><p>Este enlace expira en ${ttlMinutes} minutos y solo puede usarse una vez.</p><p>Si el botón no funciona, abre este enlace:</p><p style="overflow-wrap:anywhere"><a href="${safeUrl}">${safeUrl}</a></p><p>Si no realizaste esta solicitud, puedes ignorar este correo.</p><hr style="border:0;border-top:1px solid #dae5ed"><p style="font-size:13px;color:#52677c">Confirmar tu correo no implica la aprobación de tu institución. Nuestro equipo revisará la solicitud.</p></main></body></html>`,
  };
}
