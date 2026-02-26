// Vercel serverless function entry point
const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
app.use(express.json({ limit: '200kb' }));

const DATA_DIR = path.join('/tmp', 'data');
const FILES = {
  leads: path.join(DATA_DIR, 'leads.jsonl'),
};

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function appendJsonl(filePath, obj) {
  await fs.appendFile(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

// Calculate qualification score
function calculateScore(budget, urgency, taskVolume) {
  let score = 0;
  
  // Budget scoring
  if (budget === '500+') score += 40;
  else if (budget === '250-499') score += 25;
  else if (budget === '99-249') score += 10;
  
  // Urgency scoring
  if (urgency === 'asap') score += 30;
  else if (urgency === 'this-week') score += 20;
  else if (urgency === 'this-month') score += 10;
  
  // Task volume scoring
  if (taskVolume === 'high') score += 30;
  else if (taskVolume === 'medium') score += 15;
  
  return Math.min(score, 100);
}

// Get packages based on qualification
function getPackages(qualified) {
  if (!qualified) return [];
  
  return [
    {
      key: 'starter',
      name: 'AI Starter',
      priceEur: 99,
      description: 'Single automation workflow — perfect for one specific task'
    },
    {
      key: 'growth',
      name: 'AI Growth',
      priceEur: 249,
      description: 'Multi-step automation + integrations — ideal for connected workflows'
    },
    {
      key: 'pro',
      name: 'AI Pro',
      priceEur: 499,
      description: 'Full custom AI agent setup — voice, chat, and automation'
    }
  ];
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Lead capture endpoint
app.post('/api/leads', async (req, res) => {
  try {
    await ensureStorage();
    const { name, email, message, budget, urgency, taskVolume } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Name and email required' });
    }
    
    const leadId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const score = calculateScore(budget, urgency, taskVolume);
    const qualified = score > 60;
    
    const lead = {
      id: leadId,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      message: String(message || '').trim(),
      budget: budget || '',
      urgency: urgency || '',
      taskVolume: taskVolume || '',
      qualificationScore: score,
      qualified: qualified,
      source: 'landing_page',
      createdAt: new Date().toISOString(),
    };
    
    await appendJsonl(FILES.leads, lead);
    
    // Forward to Formspree for email notifications
    try {
      await fetch('https://formspree.io/f/xlgwzkjr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          name: lead.name,
          email: lead.email,
          message: lead.message,
          budget: lead.budget,
          urgency: lead.urgency,
          taskVolume: lead.taskVolume,
          qualificationScore: score,
          qualified: qualified,
          leadId: leadId
        })
      });
    } catch (formspreeErr) {
      console.error('Formspree forward error (non-blocking):', formspreeErr);
    }
    
    // Build response based on qualification
    const response = {
      success: true,
      id: leadId,
      qualified: qualified,
      qualificationScore: score,
    };
    
    if (qualified) {
      response.packages = getPackages(true);
      response.statusUrl = `/status.html?id=${leadId}`;
    }
    
    res.status(200).json(response);
  } catch (err) {
    console.error('Lead capture error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET handler for leads (returns error - POST required)
app.get('/api/leads', (_req, res) => {
  res.status(405).json({ error: 'Method not allowed. Use POST to submit leads.' });
});

// Export handler for Vercel
module.exports = app;
