const nodemailer = require('nodemailer');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function createTransporter() {
  const host = requiredEnv('SMTP_HOST');
  const port = Number(requiredEnv('SMTP_PORT'));
  const user = requiredEnv('SMTP_USER');
  const pass = requiredEnv('SMTP_PASS');

  if (!Number.isFinite(port)) {
    throw new Error('SMTP_PORT must be a number');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function getFromAddress() {
  const fromName = process.env.FROM_NAME || 'Disco Druif';
  const fromEmail = requiredEnv('SMTP_USER');
  return `${fromName} <${fromEmail}>`;
}

async function sendMail({ to, subject, text, html, replyTo }) {
  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject,
    text,
    html,
    replyTo,
  });
  return info;
}

module.exports = {
  sendMail,
  createTransporter,
  getFromAddress,
};
