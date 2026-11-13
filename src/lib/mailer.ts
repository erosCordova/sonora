import "server-only";
import nodemailer from "nodemailer";

export const mailConfigured = () => Boolean(process.env.SMTP_URL);

/**
 * Envía correo vía SMTP (SMTP_URL, p. ej. smtp://user:pass@host:587).
 * Si SMTP no está configurado devuelve false: el llamador decide cómo informar.
 */
export async function sendMail(to: string, subject: string, text: string) {
  const url = process.env.SMTP_URL;
  if (!url) return false;
  const transport = nodemailer.createTransport(url);
  await transport.sendMail({
    from: process.env.MAIL_FROM ?? "Sonora <no-reply@localhost>",
    to,
    subject,
    text,
  });
  return true;
}
