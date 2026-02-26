# AI Automation Setup Landing — Payment Link Pivot (No-KvK)

PM-044 replaces Stripe dependency with a generic payment-link flow (PayPal/Tikkie/manual compatible).

## What this build does now

1. **Lead form + qualification stays the same**
   - `POST /api/leads`
   - Scores and marks as `QUALIFIED` or `NEEDS_REVIEW`.

2. **Generic secure payment link (no Stripe hard dependency)**
   - `GET /api/payment-link?email=...&lead_id=...&package=starter|growth|scale`
   - Redirects to `PAYMENT_LINK_URL` (or package-specific override).
   - Email prefill support:
     - `{email}` placeholder replacement in URL
     - PayPal mode adds `payer_email`
     - Existing `email` / `prefilled_email` query params are updated when present

3. **Manual/async payment confirmation endpoint (admin protected)**
   - `POST /api/payments/mark-paid`
   - Auth via `Authorization: Bearer <PAYMENT_ADMIN_TOKEN>` or `x-admin-token` header.
   - Finds lead by `leadId` or `email`, writes payment record, updates lead to `PAID`, adds status event, queues payment-confirmed email.
   - Returns `nextUrl` to open intake success page with payment reference.

4. **Paid-state + intake flow still works**
   - `GET /api/payments/confirm?payment_ref=...&lead_id=...` (or `session_id` legacy ref)
   - `payment-success.html` now supports `payment_ref` + `lead_id`.
   - `POST /api/intake` accepts either `sessionId` or `paymentRef` (with `leadId`).

5. **Status + persistence unchanged**
   - Timeline + brief generation still in place.
   - JSONL files still used for MVP persistence.

---

## Env setup (No-KvK, copy/paste)

Create `.env`:

```bash
PORT=3000

# payment mode
PAYMENT_PROVIDER=paypal
PAYMENT_LINK_URL=https://www.paypal.com/ncp/payment/XXXXXXXXXXXX
# Optional package-specific overrides:
# PAYMENT_LINK_STARTER=https://...
# PAYMENT_LINK_GROWTH=https://...
# PAYMENT_LINK_SCALE=https://...

# admin token for manual async payment confirmation
PAYMENT_ADMIN_TOKEN=change-me-strong-random-token

# optional: post queued status updates to your mailer/automation endpoint
STATUS_WEBHOOK_URL=https://example.com/status-webhook
```

### Tikkie/bank-link mode

Use:

```bash
PAYMENT_PROVIDER=manual
PAYMENT_LINK_URL=https://tikkie.me/pay/your-link-or-bank-link
```

If your provider supports email via URL, include `{email}` in the link where needed.

Example:

```bash
PAYMENT_LINK_URL=https://example.com/pay?email={email}
```

---

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`

---

## Setup checklist (copy/paste)

```bash
# 1) install deps
npm install

# 2) set env (see .env block above)
cp .env .env.backup 2>/dev/null || true

# 3) run server
npm start

# 4) after buyer pays in PayPal/Tikkie, mark as paid (admin)
curl -X POST http://localhost:3000/api/payments/mark-paid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAYMENT_ADMIN_TOKEN" \
  -d '{
    "leadId": "lead_...",
    "package": "starter",
    "amount": 99,
    "currency": "EUR",
    "reference": "paypal_txn_123"
  }'
```

Use the returned `nextUrl` to continue intake immediately.

---

## Verification steps

1. Submit lead form with realistic details.
2. Confirm score response and package cards for qualified lead.
3. Click package card → confirm redirect to `PAYMENT_LINK_URL`.
4. Call `POST /api/payments/mark-paid` with admin token.
5. Confirm response includes:
   - `success: true`
   - `lead.status = PAID`
   - `nextUrl` (payment success + intake page)
6. Open `nextUrl` and submit intake.
7. Confirm brief appears and status page updates.
8. Check JSONL writes:

```bash
tail -n 5 data/leads.jsonl
tail -n 5 data/checkouts.jsonl
tail -n 5 data/payments.jsonl
tail -n 5 data/intake.jsonl
tail -n 5 data/briefs.jsonl
tail -n 10 data/status-events.jsonl
tail -n 10 data/email-events.jsonl
```

---

## Known limitations

- No direct provider webhook integration yet (still requires admin/manual mark-paid call).
- JSONL storage is single-instance MVP persistence (no locking strategy for high concurrency).
- Email prefill is best-effort and depends on provider URL behavior.
- `GET /api/payments/confirm` now validates against locally recorded payments only.
- No end-to-end automated tests yet for mark-paid + intake path.

---

## PM-050 — Outbound campaign sending via Gmail SMTP

This project now includes a production-ready Node CLI to send outreach batches from CSV/JSON leads using SMTP, with logs + safety rails.

### New env vars

Add these to `.env`:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@domain.com
SMTP_PASS=your-gmail-app-password
FROM_NAME=Disco Druif
```

> Gmail note: use an **App Password** (not your normal Gmail password).

### Features included

- SMTP sender module (`scripts/smtp-mailer.js`)
- Campaign batch sender CLI (`scripts/send-campaign.js`)
- Leads input: `.csv` or `.json`
- Template placeholders in subject/body (`{{first_name}}`, `{{company}}`, etc.)
- Per-send JSONL logging (`data/campaign-sends.jsonl` by default)
- Safeguards:
  - `--dry-run`
  - `--max`
  - randomized delay (`--min-delay` / `--max-delay`)
  - unsubscribe token + link placeholder (`{{unsubscribe_token}}`, `{{unsubscribe_link}}`)

### Input files

Sample files are included:

- `campaigns/leads.sample.csv`
- `campaigns/template.sample.json`

Template format:

```json
{
  "subject": "{{first_name}}, quick automation idea for {{company}}",
  "body": "Hey {{first_name}}, ...",
  "unsubscribeBaseUrl": "https://example.com/unsubscribe"
}
```

### Commands

Install deps:

```bash
npm install
```

#### Test with 1 email (dry run)

```bash
npm run campaign:send -- \
  --leads campaigns/leads.sample.csv \
  --template campaigns/template.sample.json \
  --max 1 \
  --dry-run \
  --min-delay 1 \
  --max-delay 2
```

#### Send first 5 real emails

```bash
npm run campaign:send -- \
  --leads campaigns/leads.sample.csv \
  --template campaigns/template.sample.json \
  --max 5 \
  --min-delay 20 \
  --max-delay 60
```

Optional flags:

- `--log data/my-log.jsonl`
- `--unsubscribe-base-url https://yourdomain.com/unsubscribe`

### Log format (JSONL)

Each line includes:

- `timestamp`
- `recipient`
- `subject`
- `status` (`dry_run` | `sent` | `failed`)
- `providerResponseId` (when sent)
- `error` (when failed)
# ai-automation-landing
