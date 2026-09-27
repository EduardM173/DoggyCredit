import { BadRequestException } from "@nestjs/common";

const blocked = new Set([
  "passwordpassword",
  "password123456",
  "123456789012345",
  "1234567890123456",
  "qwertyuiop12345",
  "iloveyou12345678",
  "letmein123456789",
  "adminadminadmin",
  "doggycredit2026",
  "doggycredit123",
  "doggycredit12345",
  "doggysoftware2026",
  "correct horse battery staple",
  "contraseña123456",
  "password manager",
  "bienvenido123456",
]);

export function activationPassword(password: string) {
  const normalized = password.normalize("NFC");
  const length = Array.from(normalized).length;
  if (length < 15 || length > 128)
    throw new BadRequestException("La contraseña debe tener entre 15 y 128 caracteres.");
  if (blocked.has(normalized.toLocaleLowerCase("en-US")))
    throw new BadRequestException("Elige una contraseña menos común.");
  return normalized;
}
