const nodemailer = require('nodemailer');

let transporter = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function safeSubject(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.MAIL_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.MAIL_PORT) || 587,
    secure: (Number(process.env.MAIL_PORT) || 587) === 465,
    auth: {
      user: process.env.MAIL_USERNAME || 'awibihealth@gmail.com',
      pass: process.env.MAIL_PASSWORD,
    },
  });
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  const cleanSubject = safeSubject(subject);
  if (!t) {
    console.log(`📧  DEV EMAIL — To: ${to} | Subject: ${cleanSubject} | Body withheld from logs`);
    return;
  }
  await t.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || 'Awibi EHR'}" <${process.env.MAIL_FROM_ADDRESS || 'awibihealth@gmail.com'}>`,
    to, subject: cleanSubject, html,
  });
}

async function sendOTP(to, name, otp, purpose = 'verify your email') {
  await sendMail({
    to, subject: 'Your Awibi EHR verification code',
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your OTP to ${escapeHtml(purpose)} is: <strong>${escapeHtml(otp)}</strong></p><p>Expires in 10 minutes.</p><p>— Awibi EHR</p>`,
  });
}

async function sendPasswordReset(to, name, resetUrl) {
  await sendMail({
    to, subject: 'Reset your Awibi EHR password',
    html: `<p>Hi ${escapeHtml(name)},</p><p><a href="${escapeHtml(resetUrl)}">Click here to reset your password</a></p><p>Link expires in 1 hour.</p>`,
  });
}

module.exports = { sendMail, sendOTP, sendPasswordReset, escapeHtml, safeSubject };
