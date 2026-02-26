#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { sendMail, createTransporter } = require('./smtp-mailer');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    max: Infinity,
    minDelay: 20,
    maxDelay: 60,
    log: 'data/campaign-sends.jsonl',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      i += 1;

      if (key === 'leads') args.leads = value;
      else if (key === 'template') args.template = value;
      else if (key === 'max') args.max = Number(value);
      else if (key === 'min-delay') args.minDelay = Number(value);
      else if (key === 'max-delay') args.maxDelay = Number(value);
      else if (key === 'log') args.log = value;
      else if (key === 'unsubscribe-base-url') args.unsubscribeBaseUrl = value;
      else throw new Error(`Unknown argument: --${key}`);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.leads) throw new Error('Missing required --leads <path>');
  if (!args.template) throw new Error('Missing required --template <path>');
  if (!Number.isFinite(args.max) || args.max <= 0) throw new Error('--max must be a positive number');
  if (!Number.isFinite(args.minDelay) || args.minDelay < 0) throw new Error('--min-delay must be >= 0');
  if (!Number.isFinite(args.maxDelay) || args.maxDelay < 0) throw new Error('--max-delay must be >= 0');
  if (args.maxDelay < args.minDelay) throw new Error('--max-delay must be >= --min-delay');

  return args;
}

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    return row;
  });
}

function readLeads(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    const data = readJson(filePath);
    if (!Array.isArray(data)) throw new Error('JSON leads file must be an array');
    return data;
  }

  if (ext === '.csv') {
    return readCsv(filePath);
  }

  throw new Error('Unsupported leads file type. Use .json or .csv');
}

function renderTemplate(template, variables) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_\.\-]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

function makeUnsubscribeToken(email) {
  return Buffer.from(String(email || '').toLowerCase()).toString('base64url');
}

function randomBetween(min, max) {
  if (min === max) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendJsonl(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  const leadsPath = resolvePath(args.leads);
  const templatePath = resolvePath(args.template);
  const logPath = resolvePath(args.log);

  const leads = readLeads(leadsPath).slice(0, args.max);
  const template = readJson(templatePath);

  if (!template.subject || !template.body) {
    throw new Error('Template JSON must include "subject" and "body"');
  }

  const unsubscribeBase = args.unsubscribeBaseUrl || template.unsubscribeBaseUrl || 'https://example.com/unsubscribe';

  if (!args.dryRun) {
    // Validate SMTP config once before loop to fail fast.
    await createTransporter().verify();
  }

  console.log(`Loaded ${leads.length} leads from ${path.basename(leadsPath)}. dryRun=${args.dryRun}`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i] || {};
    const to = lead.email || lead.Email || lead.recipient;

    if (!to) {
      failed += 1;
      const missingEmailLog = {
        timestamp: new Date().toISOString(),
        recipient: null,
        subject: null,
        status: 'failed',
        error: 'Lead missing email field',
      };
      appendJsonl(logPath, missingEmailLog);
      console.error(`Skipping lead ${i + 1}: missing email field.`);
      continue;
    }

    const unsubscribeToken = makeUnsubscribeToken(to);
    const separator = unsubscribeBase.includes('?') ? '&' : '?';
    const unsubscribeLink = `${unsubscribeBase}${separator}email=${encodeURIComponent(to)}&token=${encodeURIComponent(unsubscribeToken)}`;

    const templateVars = {
      ...lead,
      email: to,
      unsubscribe_token: unsubscribeToken,
      unsubscribe_link: unsubscribeLink,
    };

    const subject = renderTemplate(template.subject, templateVars);
    const body = renderTemplate(template.body, templateVars);
    const footer = `\n\n---\nIf you no longer want outreach emails, unsubscribe here: ${unsubscribeLink}`;
    const text = `${body}${footer}`;

    const logBase = {
      timestamp: new Date().toISOString(),
      recipient: to,
      subject,
    };

    if (args.dryRun) {
      sent += 1;
      appendJsonl(logPath, {
        ...logBase,
        status: 'dry_run',
        providerResponseId: null,
      });
      console.log(`[DRY RUN ${i + 1}/${leads.length}] ${to} | ${subject}`);
    } else {
      try {
        const info = await sendMail({
          to,
          subject,
          text,
        });

        sent += 1;
        appendJsonl(logPath, {
          ...logBase,
          status: 'sent',
          providerResponseId: info.messageId || null,
        });
        console.log(`[SENT ${i + 1}/${leads.length}] ${to} | messageId=${info.messageId || 'n/a'}`);
      } catch (error) {
        failed += 1;
        appendJsonl(logPath, {
          ...logBase,
          status: 'failed',
          error: error.message,
        });
        console.error(`[FAILED ${i + 1}/${leads.length}] ${to} | ${error.message}`);
      }
    }

    if (i < leads.length - 1) {
      const delaySeconds = randomBetween(args.minDelay, args.maxDelay);
      console.log(`Waiting ${delaySeconds}s before next send...`);
      await sleep(delaySeconds * 1000);
    }
  }

  console.log(`Done. sent=${sent}, failed=${failed}, total=${leads.length}`);
}

main().catch((error) => {
  console.error(`Campaign send failed: ${error.message}`);
  process.exit(1);
});
