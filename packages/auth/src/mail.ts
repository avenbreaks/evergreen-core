import nodemailer from "nodemailer";

import { authEnv } from "./env";

type Recipient = string | string[];

export type SendAuthMailInput = {
  to: Recipient;
  subject: string;
  html: string;
  text?: string;
};

export type AuthEmailInput = {
  email: string;
  name?: string | null;
  url: string;
};

let smtpTransport: nodemailer.Transporter | null = null;

const toRecipientList = (recipient: Recipient): string[] =>
  Array.isArray(recipient) ? recipient : [recipient];

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getSmtpTransport = (): nodemailer.Transporter => {
  if (smtpTransport) {
    return smtpTransport;
  }

  const auth =
    authEnv.mail.smtp.user && authEnv.mail.smtp.pass
      ? {
          user: authEnv.mail.smtp.user,
          pass: authEnv.mail.smtp.pass,
        }
      : undefined;

  smtpTransport = nodemailer.createTransport({
    host: authEnv.mail.smtp.host,
    port: authEnv.mail.smtp.port,
    secure: authEnv.mail.smtp.secure,
    ignoreTLS: authEnv.mail.smtp.ignoreTls,
    auth,
  });

  return smtpTransport;
};

const sendUsingSmtp = async (input: SendAuthMailInput): Promise<void> => {
  const transporter = getSmtpTransport();

  await transporter.sendMail({
    from: authEnv.mail.from,
    to: toRecipientList(input.to).join(", "),
    replyTo: authEnv.mail.replyTo,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
};

const sendUsingUnosend = async (input: SendAuthMailInput): Promise<void> => {
  const apiKey = authEnv.mail.unosend.apiKey;
  if (!apiKey) {
    throw new Error("UNOSEND_API_KEY is missing for Unosend provider");
  }

  const controller = new AbortController();
  const timeoutMs = authEnv.mail.unosend.timeoutMs;
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${authEnv.mail.unosend.baseUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: authEnv.mail.from,
        to: toRecipientList(input.to),
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Unosend request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Unosend email request failed: ${response.status} ${body}`);
  }
};

export const sendAuthMail = async (input: SendAuthMailInput): Promise<void> => {
  if (authEnv.mail.provider === "unosend") {
    await sendUsingUnosend(input);
    return;
  }

  await sendUsingSmtp(input);
};

const buildEmailHtml = (title: string, body: string, ctaUrl: string, ctaLabel: string): string => {
  const escapedTitle = escapeHtml(title);
  const escapedBody = escapeHtml(body);
  const escapedUrl = escapeHtml(ctaUrl);
  const escapedLabel = escapeHtml(ctaLabel);

  return [
    "<div style=\"font-family:Arial,sans-serif;line-height:1.5;color:#111827\">",
    `<h2>${escapedTitle}</h2>`,
    `<p>${escapedBody}</p>`,
    `<p><a href=\"${escapedUrl}\">${escapedLabel}</a></p>`,
    `<p>Jika tombol tidak bekerja, salin link ini: ${escapedUrl}</p>`,
    "</div>",
  ].join("");
};

const greet = (name?: string | null): string => {
  if (!name) {
    return "Halo";
  }

  return `Halo ${name}`;
};

export const sendVerificationEmail = async (input: AuthEmailInput): Promise<void> => {
  const subject = "Verifikasi email Evergreen Devparty";
  const intro = `${greet(input.name)}, klik link berikut untuk memverifikasi email akun kamu.`;

  await sendAuthMail({
    to: input.email,
    subject,
    html: buildEmailHtml(subject, intro, input.url, "Verifikasi Email"),
    text: `${intro}\n\n${input.url}`,
  });
};

export const sendResetPasswordEmail = async (input: AuthEmailInput): Promise<void> => {
  const subject = "Reset password Evergreen Devparty";
  const intro = `${greet(input.name)}, kami menerima permintaan reset password untuk akun kamu.`;

  await sendAuthMail({
    to: input.email,
    subject,
    html: buildEmailHtml(subject, intro, input.url, "Reset Password"),
    text: `${intro}\n\n${input.url}`,
  });
};
