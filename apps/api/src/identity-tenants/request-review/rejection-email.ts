const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function rejectionEmail(name: string, institution: string) {
  return {
    subject: "Resultado de tu solicitud a DoggyCredit",
    text: `DoggyCredit\nHola ${name}. La solicitud de ${institution} fue revisada y no fue aprobada. No es posible continuar a contratación con esta solicitud. Para consultas, responde a este correo.`,
    html: `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f4f8fc;color:#092548;padding:24px"><main style="max-width:560px;margin:auto;background:white;padding:32px"><h1>DoggyCredit</h1><h2>Resultado de tu solicitud</h2><p>Hola ${escapeHtml(name)}.</p><p>La solicitud de <strong>${escapeHtml(institution)}</strong> fue revisada y no fue aprobada. No es posible continuar a contratación con esta solicitud.</p><p>Para consultas, responde a este correo.</p></main></body></html>`,
  };
}
