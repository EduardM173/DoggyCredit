const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function contractingEmail(name: string, institution: string, url: string, ttlMinutes: number) {
  return {
    subject: "Continúa la contratación de DoggyCredit",
    text: `DoggyCredit\nHola ${name}. La solicitud de ${institution} fue aprobada. Para elegir y confirmar el plan definitivo, abre este enlace: ${url}\nEl enlace es personal, de un solo uso y vence en ${ttlMinutes} minutos. Si no esperabas este mensaje, ignóralo. No compartas el enlace.`,
    html: `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f4f8fc;color:#092548;padding:24px"><main style="max-width:560px;margin:auto;background:white;padding:32px"><h1>DoggyCredit</h1><h2>Tu solicitud fue aprobada</h2><p>Hola ${escapeHtml(name)}.</p><p>La solicitud de <strong>${escapeHtml(institution)}</strong> fue aprobada. Elige y confirma el plan definitivo para continuar con la contratación.</p><p style="margin:30px 0"><a style="background:#18cf92;color:#062b38;padding:14px 24px;border-radius:6px;font-weight:bold;text-decoration:none" href="${escapeHtml(url)}">Continuar contratación</a></p><p>El enlace es personal, de un solo uso y vence en ${ttlMinutes} minutos.</p><p>Si no esperabas este mensaje, ignóralo. No compartas el enlace.</p></main></body></html>`,
  };
}
