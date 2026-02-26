const form = document.getElementById('leadForm');
const statusEl = document.getElementById('formStatus');
const submitBtn = document.getElementById('submitBtn');
const startedAtInput = document.getElementById('startedAt');
const honeypotInput = document.getElementById('website');
const yearEl = document.getElementById('year');

const packageSection = document.getElementById('packageSection');
const packageList = document.getElementById('packageList');
const qualificationSummary = document.getElementById('qualificationSummary');
const statusLinkWrap = document.getElementById('statusLinkWrap');

if (yearEl) yearEl.textContent = new Date().getFullYear();
if (startedAtInput) startedAtInput.value = String(Date.now());

let latestLead = null;

function renderPackages(packages = []) {
  if (!packageList) return;
  packageList.innerHTML = '';

  packages.forEach((pkg) => {
    const card = document.createElement('article');
    card.className = 'package-card';
    card.innerHTML = `
      <h3>${pkg.name}</h3>
      <p class="price">€${pkg.priceEur}</p>
      <p>${pkg.description}</p>
      <button class="btn" data-package="${pkg.key}">Pay Securely</button>
    `;

    card.querySelector('button').addEventListener('click', () => {
      if (!latestLead) return;
      const email = encodeURIComponent(latestLead.email);
      const leadId = encodeURIComponent(latestLead.id);
      const pkgKey = encodeURIComponent(pkg.key);
      window.location.href = `/api/payment-link?email=${email}&lead_id=${leadId}&package=${pkgKey}`;
    });

    packageList.appendChild(card);
  });
}

if (form) {
  const fields = {
    name: {
      input: document.getElementById('name'),
      error: document.getElementById('nameError'),
      validate: (v) => (v.length >= 2 ? '' : 'Please enter your name.')
    },
    email: {
      input: document.getElementById('email'),
      error: document.getElementById('emailError'),
      validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Please enter a valid email address.')
    },
    message: {
      input: document.getElementById('message'),
      error: document.getElementById('messageError'),
      validate: (v) => (v.length >= 10 ? '' : 'Please add more detail (at least 10 chars).')
    }
  };

  const setFieldState = (field, msg) => {
    field.error.textContent = msg;
    field.input.classList.toggle('invalid', Boolean(msg));
  };

  const validateForm = () => {
    let valid = true;

    Object.values(fields).forEach((field) => {
      const msg = field.validate((field.input.value || '').trim());
      setFieldState(field, msg);
      if (msg) valid = false;
    });

    ['budget', 'urgency', 'taskVolume'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.value) return;
      el.classList.add('invalid');
      valid = false;
    });

    return valid;
  };

  Object.values(fields).forEach((field) => {
    field.input.addEventListener('input', () => {
      const msg = field.validate((field.input.value || '').trim());
      setFieldState(field, msg);
    });
  });

  ['budget', 'urgency', 'taskVolume'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => el.classList.remove('invalid'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.className = '';

    if (!validateForm()) {
      statusEl.textContent = 'Please complete all required fields.';
      statusEl.className = 'error';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Scoring...';

    try {
      const payload = {
        name: (document.getElementById('name')?.value || '').trim(),
        email: (document.getElementById('email')?.value || '').trim(),
        message: (document.getElementById('message')?.value || '').trim(),
        budget: document.getElementById('budget')?.value || '',
        urgency: document.getElementById('urgency')?.value || '',
        taskVolume: document.getElementById('taskVolume')?.value || '',
        website: (honeypotInput?.value || '').trim(),
        startedAt: startedAtInput?.value || ''
      };

      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) throw new Error(data.error || 'Could not submit lead.');

      latestLead = { id: data.id, email: payload.email, statusUrl: data.statusUrl };

      if (data.qualified) {
        statusEl.textContent = 'Qualified ✅ Choose a package below to continue instantly.';
        statusEl.className = 'success';

        qualificationSummary.textContent = `Qualification score: ${data.qualificationScore}/100`;
        renderPackages(data.packages || []);
        statusLinkWrap.innerHTML = data.statusUrl ? `Status page: <a href="${data.statusUrl}">${data.statusUrl}</a>` : '';
        packageSection.classList.remove('hidden');
        packageSection.scrollIntoView({ behavior: 'smooth' });
      } else {
        packageSection.classList.add('hidden');
        statusEl.textContent = `Score ${data.qualificationScore}/100. Not auto-qualified yet — we will review and follow up by email.`;
        statusEl.className = 'success';
        if (data.statusUrl) {
          statusEl.innerHTML += ` <br/>Track status here: <a href="${data.statusUrl}">${data.statusUrl}</a>`;
        }
      }
    } catch (error) {
      statusEl.textContent = error.message || 'Something went wrong.';
      statusEl.className = 'error';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Get Qualification Result';
    }
  });
}
