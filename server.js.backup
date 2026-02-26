const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Detect if running on Vercel (or in serverless context)
const IS_VERCEL = process.env.VERCEL || process.env.VERCEL_URL;

// Mount path: on Vercel, routes don't have /api prefix (Vercel strips it)
// When running locally, routes DO have /api prefix
const API_PREFIX = IS_VERCEL ? '' : '/api';

const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');

const FILES = {
  leads: path.join(DATA_DIR, 'leads.jsonl'),
  payments: path.join(DATA_DIR, 'payments.jsonl'),
  checkouts: path.join(DATA_DIR, 'checkouts.jsonl'),
  intake: path.join(DATA_DIR, 'intake.jsonl'),
  briefs: path.join(DATA_DIR, 'briefs.jsonl'),
  status: path.join(DATA_DIR, 'status-events.jsonl'),
  email: path.join(DATA_DIR, 'email-events.jsonl'),
  log: path.join(DATA_DIR, 'lead-capture.log')
};

const PAYMENT_PROVIDER = String(process.env.PAYMENT_PROVIDER || 'manual').toLowerCase();
const PAYMENT_LINK_URL = process.env.PAYMENT_LINK_URL || '';
const PAYMENT_ADMIN_TOKEN = process.env.PAYMENT_ADMIN_TOKEN || '';
const STATUS_WEBHOOK_URL = process.env.STATUS_WEBHOOK_URL || '';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rateLimitWindowMs = 15 * 60 * 1000;
const maxRequestsPerWindow = 8;
const ipRequests = new Map();

const PACKAGES = [
  {
    key: 'starter',
    name: 'Starter Automation',
    priceEur: 99,
    description: 'One high-impact workflow in 48 hours',
    paymentLink: process.env.PAYMENT_LINK_STARTER || PAYMENT_LINK_URL
  },
  {
    key: 'growth',
    name: 'Growth Automation',
    priceEur: 249,
    description: 'Up to three connected automations + reporting',
    paymentLink: process.env.PAYMENT_LINK_GROWTH || PAYMENT_LINK_URL || ''
  },
  {
    key: 'scale',
    name: 'Scale Automation',
    priceEur: 499,
    description: 'Full intake-to-delivery automation with optimization',
    paymentLink: process.env.PAYMENT_LINK_SCALE || PAYMENT_LINK_URL || ''
  }
];

app.use(express.json({ limit: '200kb' }));
app.use(express.static(__dirname));

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function appendJsonl(filePath, obj) {
  await fs.appendFile(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

async function readJsonl(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function rewriteJsonl(filePath, rows) {
  const body = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  await fs.writeFile(filePath, body, 'utf8');
}

async function logEvent(level, event, payload = {}) {
  const entry = { ts: new Date().toISOString(), level, event, ...payload };
  await appendJsonl(FILES.log, entry);
}

function isRateLimited(ip) {
  const now = Date.now();
  const hits = (ipRequests.get(ip) || []).filter((t) => now - t < rateLimitWindowMs);
  if (hits.length >= maxRequestsPerWindow) {
    ipRequests.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipRequests.set(ip, hits);
  return false;
}

function scoreQualification(body = {}) {
  const message = String(body.message || '').trim();
  const budget = String(body.budget || '').trim();
  const urgency = String(body.urgency || '').trim();
  const volume = String(body.taskVolume || '').trim();

  let score = 0;
  if (message.length >= 30) score += 25;
  else if (message.length >= 10) score += 12;
  if (/crm|lead|sales|inbox|support|onboard|invoice|intake|automation|zapier|make|n8n/i.test(message)) score += 25;
  if (budget === '99-249') score += 15;
  if (budget === '250-499') score += 25;
  if (budget === '500+') score += 30;
  if (urgency === 'asap') score += 20;
  if (urgency === 'this-week') score += 15;
  if (urgency === 'this-month') score += 8;
  if (volume === 'high') score += 20;
  if (volume === 'medium') score += 12;
  if (volume === 'low') score += 6;
  return Math.min(100, score);
}

function validateLead(body = {}) {
  const errors = [];
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const message = String(body.message || '').trim();
  const website = String(body.website || '').trim();
  const startedAt = Number(body.startedAt || 0);
  const budget = String(body.budget || '').trim();
  const urgency = String(body.urgency || '').trim();
  const taskVolume = String(body.taskVolume || '').trim();

  if (!name || name.length < 2 || name.length > 100) errors.push('name must be between 2 and 100 characters');
  if (!emailRegex.test(email) || email.length > 254) errors.push('email is invalid');
  if (!message || message.length < 10 || message.length > 2000) errors.push('message must be between 10 and 2000 characters');
  if (!['under-99', '99-249', '250-499', '500+'].includes(budget)) errors.push('budget is required');
  if (!['asap', 'this-week', 'this-month', 'exploring'].includes(urgency)) errors.push('urgency is required');
  if (!['low', 'medium', 'high'].includes(taskVolume)) errors.push('task volume is required');
  if (website) errors.push('spam_detected');
  if (!startedAt || Number.isNaN(startedAt)) errors.push('invalid_form_session');
  else if (Date.now() - startedAt < 2500) errors.push('submission_too_fast');
  return { valid: errors.length === 0, errors, sanitized: { name, email, message, startedAt, budget, urgency, taskVolume } };
}

function selectPackages(qualified) {
  if (!qualified) return [];
  return PACKAGES.filter((pkg) => pkg.paymentLink).map(({ key, name, priceEur, description }) => ({ key, name, priceEur, description }));
}

function buildPaymentLink({ email = '', pkgKey = 'starter' }) {
  const pkg = PACKAGES.find((p) => p.key === pkgKey) || PACKAGES[0];
  if (!pkg?.paymentLink) return '';
  let paymentLink = String(pkg.paymentLink || '').trim();
  if (emailRegex.test(email) && paymentLink.includes('{email}')) {
    paymentLink = paymentLink.replaceAll('{email}', encodeURIComponent(email));
  }
  const url = new URL(paymentLink);
  if (emailRegex.test(email)) {
    if (PAYMENT_PROVIDER === 'paypal') url.searchParams.set('payer_email', email);
    if (url.searchParams.has('prefilled_email')) url.searchParams.set('prefilled_email', email);
    if (url.searchParams.has('email')) url.searchParams.set('email', email);
  }
  return url.toString();
}

function getAdminToken(req) {
  const auth = String(req.get('authorization') || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.get('x-admin-token') || '').trim();
}

function verifyAdminToken(req) {
  if (!PAYMENT_ADMIN_TOKEN) return false;
  return getAdminToken(req) === PAYMENT_ADMIN_TOKEN;
}

function createStatusToken() {
  return crypto.randomBytes(12).toString('hex');
}

async function addStatusEvent(leadId, stage, message, extra = {}) {
  const item = { ts: new Date().toISOString(), leadId, stage, message, ...extra };
  await appendJsonl(FILES.status, item);
}

async function queueEmailUpdate({ leadId, email, subject, bodyHtml, type }) {
  const item = {
    ts: new Date().toISOString(),
    leadId,
    email,
    subject,
    body: bodyHtml
