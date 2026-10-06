const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function invitationEmail(
  name: string,
  institution: string,
  url: string,
  ttl: number,
  role: "INSTITUTION_ADMIN" | "ANALYST" = "INSTITUTION_ADMIN",
) {
  const analyst = role === "ANALYST";
  const roleText = analyst ? "analista" : "administrador inicial";
  return {
    subject: analyst
      ? "Tu invitación de analista a DoggyCredit"
      : "Tu invitacion de administrador a DoggyCredit",
    text: `DoggyCredit\nHola ${name}. Has sido invitado como ${roleText} de ${institution}.\nActivar cuenta: ${url}\nEl enlace es de un solo uso y expira en ${ttl} horas. Si no esperabas esta invitación, ignora el correo. Nunca compartas el enlace ni tus credenciales.`,
    html: `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;background:#f4f8fc;color:#092548;padding:24px"><main style="max-width:560px;margin:auto;background:white;padding:32px"><h1>DoggyCredit</h1><h2>${analyst ? "Únete al equipo de tu institución" : "Tu institución está lista"}</h2><p>Hola ${escape(name)}.</p><p>Has sido invitado como <strong>${roleText}</strong> de <strong>${escape(institution)}</strong>.</p><p style="margin:30px 0"><a style="background:#18cf92;color:#062b38;padding:14px 24px;border-radius:6px;font-weight:bold;text-decoration:none" href="${escape(url)}">Activar cuenta</a></p><p>El enlace es de un solo uso y expira en ${ttl} horas.</p><p>Si no esperabas esta invitación, ignora este correo. Nunca compartas el enlace ni tus credenciales.</p></main></body></html>`,
  };
}
