import nodemailer from 'nodemailer';
import { env } from '../config.js';
import { logger } from '../lib/logger.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER && env.SMTP_PASS
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
      : {}),
  });

  return transporter;
}

export function isEmailConfigured(): boolean {
  return !!env.SMTP_HOST;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  const t = getTransporter();
  if (!t) {
    logger.warn('Email delivery skipped: SMTP not configured');
    return;
  }

  await t.sendMail({
    from: env.SMTP_FROM,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });

  logger.info({ to: params.to, subject: params.subject }, 'Email sent');
}
