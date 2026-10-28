const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const { checkPermission } = require('../middleware/permission');
const { createTransferRecord } = require('../services/transferService');
const { createNotifications } = require('../services/notificationService');
const { resolveUserName } = require('../services/userIdentity');
const { generateInvoicePdf } = require('../utils/invoicePdf');
const { sendInvoiceEmail } = require('../utils/mailer');
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Advance a YYYY-MM-DD date by one recurrence period; null for non-recurring.
function addPeriod(dateStr, recurrence) {
  if (!dateStr || !recurrence || recurrence === 'none') return null;
  const d = new Date(dateStr);
  if (recurrence === 'daily') d.setDate(d.getDate() + 1);
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
  else return null;
  return d.toISOString().slice(0, 10);
}

// Generate the PDF and email an invoice to its client_email. Returns true if sent.
async function sendOneInvoice(invoice, userId) {
  if (!invoice.client_email) throw new Error('No client email on this invoice.');
  let companyName = 'Datum';
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    companyName = data?.user?.user_metadata?.company_name || companyName;
  } catch {}
  const pdfBuffer = await generateInvoicePdf(invoice, { name: companyName });
  const extraAttachment = invoice.attachment_data
    ? { filename: invoice.attachment_name || 'attachment', content: Buffer.from(invoice.attachment_data.split(',').pop(), 'base64') }
    : null;
  await sendInvoiceEmail({ toEmail: invoice.client_email, toName: invoice.client, invoice, pdfBuffer, companyName, extraAttachment });
  return true;
}

const INVOICE_PROMPT = `You are an invoice analysis expert. Extract structured payment information from this invoice.

CRITICAL — identifying the payee (who should be PAID):
Georgian invoices and payment orders often show TWO parties, and they are
easy to confuse: the payer (გადამხდელი / Payer / From / Client) and the
recipient (მიმღები / რეციპიენტი / Recipient / Beneficiary / Payee / To).
The "payee" field must be the RECIPIENT, never the payer. To find it:
1. Look for a name explicitly labeled "მიმღები", "რეციპიენტი", "Recipient",
   "Beneficiary", or "Payee" (Georgian or English) and use that name.
2. Explicitly ignore any name labeled "გადამხდელი", "Payer", "From", or
   "Client" — that party is PAYING, not being paid.
3. If neither label appears anywhere in the document, fall back to the
   company or person name that appears first/most prominently (e.g. in a
   letterhead or header).
The bank account_number/IBAN and bank_name you extract must belong to
this same payee entity, not the payer — if the document shows bank
details for both parties, pick the ones next to the payee's name.

Extract the following information in JSON format ONLY (no markdown, no explanation):
{
  "payee": "name of the company or person to be PAID (the recipient/beneficiary, never the payer)",
  "bank_name": "bank name if visible",
  "account_number": "bank account number or IBAN if visible",
  "swift_bic": "SWIFT/BIC code if visible",
  "amount": "numeric amount to pay (just the number)",
  "currency": "currency code e.g. USD, EUR, GEL",
  "due_date": "payment due date in YYYY-MM-DD format",
  "invoice_date": "invoice date in YYYY-MM-DD format",
  "invoice_number": "invoice number or reference",
  "description": "brief description of what is being paid for",
  "notes": "any other important payment instructions"
}
If a field is not found, use null. Return only valid JSON.`;

// Extract structured invoice fields from a base64 file using GPT-4o. Throws on failure.
async function analyzeInvoiceFile(data, mimeType) {
  if (!openai) throw new Error('OpenAI API key not configured.');
  if (!data) throw new Error('No file data provided.');

  let messages;

  if (mimeType === 'application/pdf') {
    const buffer = Buffer.from(data, 'base64');

    let pdfText = '';
    try {
      const pdf = await pdfParse(buffer);
      pdfText = pdf.text ? pdf.text.trim() : '';
    } catch (e) {
      console.error('pdf-parse error:', e.message);
    }

    if (pdfText) {
      messages = [{ role: 'user', content: `${INVOICE_PROMPT}\n\nInvoice text:\n${pdfText}` }];
    } else {
      // Scanned / image-only PDF (no extractable text). OCR rendering via
      // Chromium is disabled (not available on serverless). Ask for an image.
      throw new Error('This PDF appears to be scanned (no readable text). Please upload it as an image (JPG or PNG), or use a text-based PDF.');
    }
  } else {
    // Image — send directly to GPT-4o vision
    const imageType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)
      ? mimeType : 'image/jpeg';
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: INVOICE_PROMPT },
        { type: 'image_url', image_url: { url: `data:${imageType};base64,${data}` } },
      ],
    }];
  }

  const response = await openai.chat.completions.create({ model: 'gpt-4o', messages, max_tokens: 1000 });
  const rawText = response.choices[0].message.content.trim();
  const jsonText = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('AI returned an unexpected response. Please try again.');
  }
}

// Normalize a company name for fuzzy matching: strip common legal-entity
// markers (შპს, LLC, ltd, ...), punctuation, and extra whitespace.
function normalizeCompanyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[().,"'`]/g, '')
    .replace(/\b(შპს|სს|ip|ltd|llc|inc|corp|co|ooo|zao|gmbh|s\.?a\.?)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameSimilarity(a, b) {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = na.split(' ').filter(Boolean);
  const tb = nb.split(' ').filter(Boolean);
  const setB = new Set(tb);
  const inter = ta.filter(x => setB.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

// Suggest a counterparty already in this tenant's agents (people/companies
// they've paid before) whose name looks like the AI-extracted payee, so a
// repeat invoice from the same company doesn't need re-typing their details.
async function matchAgentForPayee(userId, payeeName) {
  if (!payeeName) return null;
  const { data: agents } = await supabase.from('accounting_agents').select('id, name, account_number').eq('user_id', userId);
  if (!agents || agents.length === 0) return null;
  let best = null, bestScore = 0;
  for (const agent of agents) {
    const score = nameSimilarity(payeeName, agent.name);
    if (score > bestScore) { bestScore = score; best = agent; }
  }
  if (!best || bestScore < 0.5) return null;
  return { id: best.id, name: best.name, account_number: best.account_number || null };
}

async function attachMatchedAgent(userId, extracted) {
  if (!extracted || !extracted.payee) return extracted;
  try {
    const match = await matchAgentForPayee(userId, extracted.payee);
    if (match) extracted.matched_agent = match;
  } catch (err) {
    console.error('matchAgentForPayee error:', err.message);
  }
  return extracted;
}

// ── INVOICE SCANNER ─────────────────────────────────────
router.post('/invoices/scan', async (req, res) => {
  try {
    const { data, mimeType } = req.body;
    const parsed = await attachMatchedAgent(req.userId, await analyzeInvoiceFile(data, mimeType));
    res.json({ result: parsed });
  } catch (err) {
    console.error('Invoice scan error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to analyze invoice.' });
  }
});

// ── PURCHASES ──────────────────────────────────────────
router.get('/purchases', async (req, res) => {
  try {
    const { data, error } = await supabase.from('accounting_purchases').select('*').eq('user_id', req.userId).order('date', { ascending: false });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/purchases', async (req, res) => {
  try {
    const { vendor, description, amount, currency, category, date } = req.body;
    const { data, error } = await supabase.from('accounting_purchases').insert([{ user_id: req.userId, vendor, description, amount: parseFloat(amount), currency, category, date }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/purchases/:id', async (req, res) => {
  try {
    const { vendor, description, amount, currency, category, date } = req.body;
    const { data, error } = await supabase.from('accounting_purchases').update({ vendor, description, amount: parseFloat(amount), currency, category, date }).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/purchases/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('accounting_purchases').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SALES ──────────────────────────────────────────────
router.get('/sales', async (req, res) => {
  try {
    const { data, error } = await supabase.from('accounting_sales').select('*').eq('user_id', req.userId).order('date', { ascending: false });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sales', async (req, res) => {
  try {
    const { client, product, description, amount, currency, category, date, hierarchy_id, hierarchy_node_id } = req.body;
    const { data, error } = await supabase.from('accounting_sales').insert([{ user_id: req.userId, client, product, description, amount: parseFloat(amount), currency, category, date, hierarchy_id: hierarchy_id || null, hierarchy_node_id: hierarchy_node_id || null }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sales/:id', async (req, res) => {
  try {
    const { client, product, description, amount, currency, category, date, hierarchy_id, hierarchy_node_id } = req.body;
    const { data, error } = await supabase.from('accounting_sales').update({ client, product, description, amount: parseFloat(amount), currency, category, date, hierarchy_id: hierarchy_id || null, hierarchy_node_id: hierarchy_node_id || null }).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/sales/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required and must not be empty' });
    }
    const { error } = await supabase.from('accounting_sales').delete().in('id', ids).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: `${ids.length} sales deleted` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/sales/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('accounting_sales').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PROJECTS ──
router.get('/projects', async (req, res) => {
  try {
    const { data, error } = await supabase.from('accounting_projects').select('*').eq('user_id', req.userId).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/projects', async (req, res) => {
  try {
    const { name, client, owner, status, budget, currency, start_date, end_date, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });
    const { data, error } = await supabase.from('accounting_projects').insert([{
      user_id: req.userId, name, client, owner: owner || null, status: status || 'Active',
      budget: budget ? parseFloat(budget) : null, currency: currency || 'GEL',
      start_date: start_date || null, end_date: end_date || null, description,
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/projects/:id', async (req, res) => {
  try {
    const { name, client, owner, status, budget, currency, start_date, end_date, description } = req.body;
    const { data, error } = await supabase.from('accounting_projects').update({
      name, client, owner: owner || null, status, budget: budget ? parseFloat(budget) : null, currency,
      start_date: start_date || null, end_date: end_date || null, description,
    }).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/projects/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required and must not be empty' });
    }
    const { error } = await supabase.from('accounting_projects').delete().in('id', ids).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: `${ids.length} projects deleted` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('accounting_projects').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── INVOICE UPLOADS (shared across devices via Supabase) ──
router.get('/invoices/uploads', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('invoice_uploads')
      .select('id, file_name, file_type, upload_date, due_date, urgent, extracted, sent, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ uploads: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/invoices/uploads/:id/file', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('invoice_uploads')
      .select('file_name, file_type, file_data')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Not found' });
    res.json({ file_name: data.file_name, file_type: data.file_type, file_data: data.file_data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/invoices/uploads', async (req, res) => {
  try {
    const { file_name, file_type, file_data, upload_date, due_date, urgent, skip_extract } = req.body;
    if (!file_name || !file_data) return res.status(400).json({ error: 'file_name and file_data are required' });

    // skip_extract lets a caller upload (and store) a batch of files first,
    // then trigger AI extraction on each separately via the rescan endpoint
    // below -- e.g. to run several one at a time and keep going past failures.
    let extracted = null;
    if (!skip_extract) {
      // Extract the raw base64 payload from a data: URL for AI analysis.
      try {
        const base64 = file_data.includes(',') ? file_data.split(',')[1] : file_data;
        extracted = await attachMatchedAgent(req.userId, await analyzeInvoiceFile(base64, file_type));
      } catch (extractErr) {
        extracted = { error: extractErr.message };
      }
    }

    const { data, error } = await supabase
      .from('invoice_uploads')
      .insert([{ user_id: req.userId, file_name, file_type, file_data, upload_date, due_date: due_date || null, urgent: !!urgent, extracted }])
      .select('id, file_name, file_type, upload_date, due_date, urgent, extracted, created_at')
      .single();
    if (error) throw error;
    res.status(201).json({ upload: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Re-run AI extraction on an already-uploaded file (e.g. after a failed first attempt).
router.post('/invoices/uploads/:id/rescan', async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('invoice_uploads')
      .select('file_data, file_type')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Not found' });

    let extracted;
    try {
      const base64 = existing.file_data.includes(',') ? existing.file_data.split(',')[1] : existing.file_data;
      extracted = await attachMatchedAgent(req.userId, await analyzeInvoiceFile(base64, existing.file_type));
    } catch (extractErr) {
      extracted = { error: extractErr.message };
    }

    const { data, error } = await supabase
      .from('invoice_uploads')
      .update({ extracted })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select('id, file_name, file_type, upload_date, due_date, urgent, extracted, created_at')
      .single();
    if (error) throw error;
    res.json({ upload: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/invoices/uploads/:id', async (req, res) => {
  try {
    const { urgent, due_date, sent } = req.body;
    const patch = {};
    if (urgent !== undefined) patch.urgent = !!urgent;
    if (due_date !== undefined) patch.due_date = due_date || null;
    if (sent !== undefined) patch.sent = !!sent;
    const { data, error } = await supabase
      .from('invoice_uploads')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select('id, file_name, file_type, upload_date, due_date, urgent')
      .single();
    if (error) throw error;
    res.json({ upload: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/invoices/uploads/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('invoice_uploads')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── INVOICES ───────────────────────────────────────────
router.get('/invoices', async (req, res) => {
  try {
    let query = supabase.from('accounting_invoices').select('*').eq('user_id', req.userId).order('date', { ascending: false });
    if (req.query.project_id) query = query.eq('project_id', req.query.project_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/invoices', async (req, res) => {
  try {
    const {
      client, client_email, invoice_number, date, due_date, currency, status, notes, account_number, items, total, recurrence, auto_send,
      project_id, scheduled_send_date, attachment_name, attachment_data,
    } = req.body;
    const rec = recurrence || 'none';
    const { data, error } = await supabase.from('accounting_invoices').insert([{
      user_id: req.userId, client, client_email, invoice_number, date, due_date: due_date || null, currency, status, notes,
      account_number: account_number || null, items, total: parseFloat(total),
      recurrence: rec, auto_send: !!auto_send,
      recurring_active: rec !== 'none',
      next_run: rec !== 'none' ? addPeriod(date, rec) : null,
      project_id: project_id || null,
      scheduled_send_date: scheduled_send_date || null,
      attachment_name: attachment_name || null,
      attachment_data: attachment_data || null,
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/invoices/:id', async (req, res) => {
  try {
    const {
      client, client_email, invoice_number, date, due_date, currency, status, notes, account_number, items, total, recurrence, auto_send,
      project_id, scheduled_send_date, attachment_name, attachment_data,
    } = req.body;
    const rec = recurrence || 'none';
    const update = {
      client, client_email, invoice_number, date, due_date: due_date || null, currency, status, notes,
      account_number: account_number || null, items, total: parseFloat(total),
      recurrence: rec, auto_send: !!auto_send, recurring_active: rec !== 'none',
      project_id: project_id || null,
      scheduled_send_date: scheduled_send_date || null,
    };
    // Only overwrite the attachment if a new one was provided — keeps the
    // existing file when a user edits other fields without re-uploading.
    if (attachment_data !== undefined) {
      update.attachment_name = attachment_name || null;
      update.attachment_data = attachment_data || null;
    }
    // Recompute the next scheduled send from the (possibly changed) date/recurrence.
    update.next_run = rec !== 'none' ? addPeriod(date, rec) : null;
    const { data, error } = await supabase.from('accounting_invoices').update(update).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send one invoice now (PDF email to its client_email).
router.post('/invoices/:id/send', async (req, res) => {
  try {
    const { data: invoice, error } = await supabase.from('accounting_invoices')
      .select('*').eq('id', req.params.id).eq('user_id', req.userId).single();
    if (error || !invoice) return res.status(404).json({ error: 'Invoice not found.' });
    await sendOneInvoice(invoice, req.userId);
    await supabase.from('accounting_invoices')
      .update({ last_sent_at: new Date().toISOString(), status: invoice.status === 'draft' ? 'sent' : invoice.status })
      .eq('id', invoice.id).eq('user_id', req.userId);
    res.json({ sent: true });
  } catch (err) {
    console.error('Invoice send error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to send invoice.' });
  }
});

router.delete('/invoices/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required and must not be empty' });
    }
    const { error } = await supabase.from('accounting_invoices').delete().in('id', ids).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: `${ids.length} invoices deleted` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/invoices/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('accounting_invoices').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TRANSACTIONS ───────────────────────────────────────
// suggest must come before /:id to avoid param collision
router.get('/transactions/suggest', async (req, res) => {
  try {
    const { client } = req.query;
    if (!client) return res.json({ suggestion: null });
    const { data, error } = await supabase
      .from('accounting_transactions')
      .select('item_type')
      .eq('user_id', req.userId)
      .eq('client', client)
      .order('created_at', { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) return res.json({ suggestion: null });
    const counts = {};
    data.forEach(r => { counts[r.item_type] = (counts[r.item_type] || 0) + 1; });
    const suggestion = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    res.json({ suggestion });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/transactions', async (req, res) => {
  try {
    const { data, error } = await supabase.from('accounting_transactions').select('*').eq('user_id', req.userId).order('date', { ascending: false });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/transactions', async (req, res) => {
  try {
    const { date, client, item_type, amount, note } = req.body;
    const { data, error } = await supabase.from('accounting_transactions').insert([{ user_id: req.userId, date, client, item_type, amount: parseFloat(amount), note }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/transactions/:id', async (req, res) => {
  try {
    const { date, client, item_type, amount, note } = req.body;
    const { data, error } = await supabase.from('accounting_transactions').update({ date, client, item_type, amount: parseFloat(amount), note }).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/transactions/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required and must not be empty' });
    }
    const { error } = await supabase.from('accounting_transactions').delete().in('id', ids).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: `${ids.length} transactions deleted` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/transactions/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('accounting_transactions').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── AGENTS ─────────────────────────────────────────────
router.get('/agents', async (req, res) => {
  try {
    const { data, error } = await supabase.from('accounting_agents').select('*').eq('user_id', req.userId).order('name', { ascending: true });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/agents', async (req, res) => {
  try {
    const { name, contact_name, type, add_date, account_number, address, phone } = req.body;
    const { data, error } = await supabase.from('accounting_agents').insert([{ user_id: req.userId, name, contact_name: contact_name || null, type, add_date: add_date || null, account_number, address, phone }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/agents/:id', async (req, res) => {
  try {
    const { name, contact_name, type, add_date, account_number, address, phone } = req.body;
    const { data, error } = await supabase.from('accounting_agents').update({ name, contact_name: contact_name || null, type, add_date: add_date || null, account_number, address, phone }).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/agents/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('accounting_agents').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/agents/bulk', async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) return res.status(400).json({ error: 'No records provided' });
    const rows = records.map(r => ({
      user_id: req.userId,
      name: r.name,
      contact_name: r.contact_name || null,
      type: r.type || 'Other',
      add_date: r.add_date || null,
      account_number: r.account_number || null,
      address: r.address || null,
      phone: r.phone || null,
    }));
    const { data, error } = await supabase.from('accounting_agents').insert(rows).select();
    if (error) throw error;
    res.status(201).json({ inserted: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SUBKONTO TYPES ─────────────────────────────────────
router.get('/subkonto-types', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subkonto_types')
      .select('*')
      .eq('user_id', req.userId)
      .order('name', { ascending: true });
    if (error) throw error;
    res.json({ types: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/subkonto-types', async (req, res) => {
  try {
    const { name, value_source } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { data, error } = await supabase
      .from('subkonto_types')
      .insert([{ user_id: req.userId, name: name.trim(), value_source: value_source || 'custom' }])
      .select().single();
    if (error) throw error;
    res.status(201).json({ type: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/subkonto-types/:id', async (req, res) => {
  try {
    const { name, value_source } = req.body;
    const { data, error } = await supabase
      .from('subkonto_types')
      .update({ name: name.trim(), value_source: value_source || 'custom' })
      .eq('id', req.params.id).eq('user_id', req.userId)
      .select().single();
    if (error) throw error;
    res.json({ type: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/subkonto-types/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('subkonto_types')
      .delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ACCOUNT SUBKONTOS ──────────────────────────────────
router.get('/account-subkontos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('account_subkontos')
      .select('*, subkonto_type:subkonto_types(id, name, value_source)')
      .eq('user_id', req.userId)
      .order('position', { ascending: true });
    if (error) throw error;
    res.json({ account_subkontos: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/account-subkontos', async (req, res) => {
  try {
    const { account_id, subkonto_type_id, position } = req.body;
    const { data, error } = await supabase
      .from('account_subkontos')
      .insert([{ user_id: req.userId, account_id, subkonto_type_id, position: position || 1 }])
      .select('*, subkonto_type:subkonto_types(id, name, value_source)').single();
    if (error) throw error;
    res.status(201).json({ account_subkonto: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/account-subkontos/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('account_subkontos')
      .delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ENTRY SUBKONTOS ────────────────────────────────────
router.post('/entry-subkontos/bulk', async (req, res) => {
  try {
    const { entry_id, subkontos } = req.body; // subkontos: [{subkonto_type_id, value, value_id}]
    if (!subkontos?.length) return res.json({ entry_subkontos: [] });
    await supabase.from('entry_subkontos').delete().eq('entry_id', entry_id).eq('user_id', req.userId);
    const rows = subkontos.map(s => ({
      user_id: req.userId,
      entry_id,
      subkonto_type_id: s.subkonto_type_id,
      value: s.value || '',
      value_id: s.value_id || null,
    }));
    const { data, error } = await supabase.from('entry_subkontos').insert(rows).select();
    if (error) throw error;
    res.status(201).json({ entry_subkontos: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── BOOKKEEPING ACCOUNTS ───────────────────────────────
router.get('/bookkeeping-accounts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookkeeping_accounts')
      .select('*')
      .eq('user_id', req.userId)
      .order('code', { ascending: true });
    if (error) throw error;

    // attach subkontos for each account
    const { data: asSubs } = await supabase
      .from('account_subkontos')
      .select('*, subkonto_type:subkonto_types(id, name, value_source)')
      .eq('user_id', req.userId)
      .order('position', { ascending: true });

    const subsByAccount = (asSubs || []).reduce((m, s) => {
      if (!m[s.account_id]) m[s.account_id] = [];
      m[s.account_id].push(s);
      return m;
    }, {});

    const accounts = (data || []).map(a => ({ ...a, subkontos: subsByAccount[a.id] || [] }));
    res.json({ accounts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bookkeeping-accounts', async (req, res) => {
  try {
    const { code, name, type, account_geo } = req.body;
    const { data, error } = await supabase
      .from('bookkeeping_accounts')
      .insert([{ user_id: req.userId, code: code || null, name, type, account_geo: account_geo || null }])
      .select().single();
    if (error) throw error;
    res.status(201).json({ account: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bookkeeping-accounts/bulk', async (req, res) => {
  try {
    const { accounts } = req.body;
    const rows = accounts.map(a => ({
      user_id: req.userId,
      code: a.code || null,
      name: a.name,
      type: a.type || 'Asset',
      account_geo: a.account_geo || null,
    }));
    const { data, error } = await supabase.from('bookkeeping_accounts').insert(rows).select();
    if (error) throw error;
    res.status(201).json({ accounts: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/bookkeeping-accounts/:id', async (req, res) => {
  try {
    const { code, name, type, account_geo } = req.body;
    const { data, error } = await supabase
      .from('bookkeeping_accounts')
      .update({ code: code || null, name, type, account_geo: account_geo || null })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select().single();
    if (error) throw error;
    res.json({ account: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/bookkeeping-accounts/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bookkeeping_accounts')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── BOOKKEEPING ────────────────────────────────────────
router.get('/bookkeeping', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookkeeping_entries')
      .select('*')
      .eq('user_id', req.userId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw error;

    // attach entry subkontos
    const entryIds = (data || []).map(e => e.id);
    let subkontoMap = {};
    if (entryIds.length) {
      const { data: subs } = await supabase
        .from('entry_subkontos')
        .select('*, subkonto_type:subkonto_types(id, name)')
        .in('entry_id', entryIds)
        .eq('user_id', req.userId);
      (subs || []).forEach(s => {
        if (!subkontoMap[s.entry_id]) subkontoMap[s.entry_id] = [];
        subkontoMap[s.entry_id].push(s);
      });
    }

    const entries = (data || []).map(e => ({ ...e, subkontos: subkontoMap[e.id] || [] }));
    res.json({ entries });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bookkeeping', async (req, res) => {
  try {
    const { transaction_id, date, description, account, debit, credit } = req.body;
    const { data, error } = await supabase
      .from('bookkeeping_entries')
      .insert([{ user_id: req.userId, transaction_id, date, description, account, debit: parseFloat(debit) || 0, credit: parseFloat(credit) || 0 }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ entry: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/bookkeeping/bulk', async (req, res) => {
  try {
    const { entries } = req.body;
    const rows = entries.map(e => ({
      user_id: req.userId,
      transaction_id: e.transaction_id,
      date: e.date,
      description: e.description,
      account: e.account,
      debit: parseFloat(e.debit) || 0,
      credit: parseFloat(e.credit) || 0,
      agent_id: e.agent_id || null,
    }));
    const { data, error } = await supabase.from('bookkeeping_entries').insert(rows).select();
    if (error) throw error;
    res.status(201).json({ entries: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/bookkeeping/:id', async (req, res) => {
  try {
    const { date, description, account, debit, credit } = req.body;
    const { data, error } = await supabase
      .from('bookkeeping_entries')
      .update({ date, description, account, debit: parseFloat(debit) || 0, credit: parseFloat(credit) || 0 })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single();
    if (error) throw error;
    res.json({ entry: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/bookkeeping/transaction/:transaction_id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bookkeeping_entries')
      .delete()
      .eq('transaction_id', req.params.transaction_id)
      .eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/bookkeeping/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('bookkeeping_entries')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── STOCK ──────────────────────────────────────────────
router.get('/stock', async (req, res) => {
  try {
    const { data, error } = await supabase.from('accounting_stock').select('*').eq('user_id', req.userId).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/stock', async (req, res) => {
  try {
    const { sku, name, stock_name, move_in_date, move_in_qty, move_in_price, move_out_date, move_out_qty, move_out_price } = req.body;
    const { data, error } = await supabase.from('accounting_stock').insert([{
      user_id: req.userId, sku, name, stock_name,
      move_in_date: move_in_date || null, move_in_qty: move_in_qty ? parseFloat(move_in_qty) : null, move_in_price: move_in_price ? parseFloat(move_in_price) : null,
      move_out_date: move_out_date || null, move_out_qty: move_out_qty ? parseFloat(move_out_qty) : null, move_out_price: move_out_price ? parseFloat(move_out_price) : null,
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/stock/:id', async (req, res) => {
  try {
    const { sku, name, stock_name, move_in_date, move_in_qty, move_in_price, move_out_date, move_out_qty, move_out_price } = req.body;
    const { data, error } = await supabase.from('accounting_stock').update({
      sku, name, stock_name,
      move_in_date: move_in_date || null, move_in_qty: move_in_qty ? parseFloat(move_in_qty) : null, move_in_price: move_in_price ? parseFloat(move_in_price) : null,
      move_out_date: move_out_date || null, move_out_qty: move_out_qty ? parseFloat(move_out_qty) : null, move_out_price: move_out_price ? parseFloat(move_out_price) : null,
    }).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/stock/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('accounting_stock').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TRANSFERS ───────────────────────────────────────────
router.get('/transfers', async (req, res) => {
  try {
    const email = req.user?.email;

    if (!req.appUserId) {
      // Owner — sees all transfers
      const { data, error } = await supabase
        .from('accounting_transfers').select('*')
        .eq('user_id', req.userId)
        .order('due_date', { ascending: true });
      if (error) throw error;
      return res.json({ records: data });
    }

    // A sub-user whose role is permitted to view all transactions (e.g. an
    // approver) sees everything too, same as the owner -- otherwise they
    // couldn't see other team members' requests to approve them, and
    // wouldn't see system-generated transfers (backfills, auto-queued
    // adjustment payouts) that have no requester_email at all.
    const { data: appUser } = await supabase.from('app_users').select('rights').eq('id', req.appUserId).maybeSingle();
    let canViewAll = false;
    if (appUser?.rights) {
      const { data: matrixRow } = await supabase.from('user_matrix').select('view_transactions').eq('user_id', req.userId).eq('role', appUser.rights).maybeSingle();
      canViewAll = matrixRow?.view_transactions === 'Yes';
    }
    if (canViewAll) {
      const { data, error } = await supabase
        .from('accounting_transfers').select('*')
        .eq('user_id', req.userId)
        .order('due_date', { ascending: true });
      if (error) throw error;
      return res.json({ records: data });
    }

    // Sub-user — sees own transfers + owner's transfers
    // Get owner email to include their transfers
    const { data: ownerData } = await supabase.auth.admin.getUserById(req.userId);
    const ownerEmail = ownerData?.user?.email;

    let query = supabase.from('accounting_transfers').select('*').eq('user_id', req.userId);
    if (email && ownerEmail && email !== ownerEmail) {
      query = query.or(`requester_email.eq.${email},requester_email.eq.${ownerEmail},requester_email.is.null`);
    } else if (email) {
      query = query.eq('requester_email', email);
    }

    const { data, error } = await query.order('due_date', { ascending: true });
    if (error) throw error;
    res.json({ records: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ── Notification helpers ─────────────────────────────────
async function getApproverEmails(user_id) {
  try {
    const { data: matrixRows } = await supabase.from('user_matrix')
      .select('role').eq('user_id', user_id).neq('approve_transfer', 'No');
    const roles = [...new Set((matrixRows || []).map(r => r.role).filter(Boolean))];
    if (roles.length === 0) return [];
    const { data: users } = await supabase.from('app_users')
      .select('email').eq('user_id', user_id).in('rights', roles);
    return (users || []).map(u => u.email).filter(Boolean);
  } catch { return []; }
}

async function getMainUserEmail(user_id) {
  try {
    const result = await supabase.auth.admin.getUserById(user_id);
    const email = result?.data?.user?.email || null;
    console.log('[notif] getMainUserEmail:', email);
    return email;
  } catch (err) {
    console.error('[notif] getMainUserEmail failed:', err.message);
    return null;
  }
}

const APPROVAL_TITLES = {
  approved: 'Transfer Approved ✅',
  rejected: 'Transfer Rejected ❌',
  partial:  'Partial Approval ½',
  wait:     'Transfer On Hold ⏸',
};

// Auto-queued transfer for an HR order that pays money out directly (Documents
// › Orders — Advance Payment, and Adjusting for addition-type units marked
// "not included in salary"). Deliberately NOT gated by
// checkPermission('initiate_transfer'): creating the order is already its
// own permissioned HR action, and queuing its payout is a required side
// effect of that — it shouldn't silently fail just because the person who
// created the order doesn't separately have accounting's "Initiate Transfer"
// right.
router.post('/auto-transfers', async (req, res) => {
  try {
    const requester_name = await resolveUserName(req);
    const requester_email = req.user?.email || null;
    const data = await createTransferRecord(req.userId, requester_name, requester_email, req.body);
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/transfers', checkPermission('initiate_transfer'), async (req, res) => {
  try {
    const requester_name = await resolveUserName(req);
    const requester_email = req.user?.email || null;
    const data = await createTransferRecord(req.userId, requester_name, requester_email, req.body);
    res.status(201).json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/transfers/:id', checkPermission('initiate_transfer'), async (req, res) => {
  try {
    const { client_name, agent_id, amount, due_date, description, status, requester_name, invoice_raw, iban, invoice_number } = req.body;
    const patch = { client_name, agent_id: agent_id || null, amount: parseFloat(amount), due_date, description, status };
    if (requester_name !== undefined) patch.requester_name = requester_name || null;
    if (invoice_raw !== undefined) patch.invoice_raw = invoice_raw || null;
    if (iban !== undefined) patch.iban = iban || null;
    if (invoice_number !== undefined) patch.invoice_number = invoice_number || null;
    const { data, error } = await supabase.from('accounting_transfers').update(patch).eq('id', req.params.id).eq('user_id', req.userId).select().single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/transfers/:id', checkPermission('initiate_transfer'), async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('accounting_transfers')
      .select('approval_status')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Not found' });
    const blocked = ['approved', 'rejected', 'partial'];
    if (blocked.includes(existing.approval_status)) {
      return res.status(400).json({ error: 'Decided transfers cannot be deleted — archive them instead' });
    }
    const { error } = await supabase.from('accounting_transfers').delete().eq('id', req.params.id).eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Approval actions on a transfer row
async function applyTransferAction(req, res, patch) {
  try {
    const approver_name = await resolveUserName(req);

    // Fetch requester info before update for notification
    const { data: existing } = await supabase
      .from('accounting_transfers')
      .select('requester_email, client_name, amount')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    const { data, error } = await supabase
      .from('accounting_transfers')
      .update({ ...patch, approver_name })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single();
    if (error) throw error;

    // Notify the requester
    if (existing?.requester_email) {
      const title = APPROVAL_TITLES[patch.approval_status] || 'Transfer Updated';
      const noteStr = patch.approver_note ? ` — ${patch.approver_note}` : '';
      const body = `Your transfer for ${existing.client_name} (${existing.amount})${noteStr}`;
      await createNotifications(req.userId, [existing.requester_email], `transfer_${patch.approval_status}`, title, body, req.params.id);
    }

    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

router.post('/transfers/:id/approve', checkPermission('approve_transfer'), async (req, res) => {
  await applyTransferAction(req, res, { approval_status: 'approved', approver_note: null, approved_amount: null });
});

router.post('/transfers/:id/reject', checkPermission('reject_transfer'), async (req, res) => {
  const { note } = req.body || {};
  await applyTransferAction(req, res, { approval_status: 'rejected', approver_note: note || null });
});

router.post('/transfers/:id/partial', checkPermission('approve_transfer'), async (req, res) => {
  const { approved_amount, note } = req.body || {};
  if (approved_amount == null || isNaN(parseFloat(approved_amount))) {
    return res.status(400).json({ error: 'approved_amount is required' });
  }
  await applyTransferAction(req, res, { approval_status: 'partial', approved_amount: parseFloat(approved_amount), approver_note: note || null });
});

router.post('/transfers/:id/wait', checkPermission('approve_transfer'), async (req, res) => {
  const { note } = req.body || {};
  await applyTransferAction(req, res, { approval_status: 'wait', approver_note: note || null });
});

router.post('/transfers/:id/archive', async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('accounting_transfers')
      .select('approval_status')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Not found' });
    const allowed = ['approved', 'rejected', 'partial'];
    if (!allowed.includes(existing.approval_status)) {
      return res.status(400).json({ error: 'Only decided transfers (approved/rejected/partial) can be archived' });
    }
    const { data, error } = await supabase
      .from('accounting_transfers')
      .update({ approval_status: 'archived' })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single();
    if (error) throw error;
    res.json({ record: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TRANSFER APPROVAL REQUESTS ──────────────────────────
router.get('/transfer-requests', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transfer_requests')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ requests: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/transfer-requests', checkPermission('initiate_transfer'), async (req, res) => {
  try {
    const { requester_name, amount, currency, recipient_name, recipient_account, description } = req.body;
    if (!requester_name || !amount || !recipient_name) {
      return res.status(400).json({ error: 'Requester name, amount and recipient are required.' });
    }
    const { data, error } = await supabase
      .from('transfer_requests')
      .insert([{
        user_id: req.userId,
        requester_name: requester_name.trim(),
        amount: parseFloat(amount),
        currency: currency || 'GEL',
        recipient_name: recipient_name.trim(),
        recipient_account: recipient_account ? recipient_account.trim() : null,
        description: description ? description.trim() : null,
        approval_status: 'pending',
      }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ request: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/transfer-requests/:id/approve', checkPermission('approve_transfer'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transfer_requests')
      .update({ approval_status: 'approved', approved_at: new Date().toISOString(), rejection_reason: null })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single();
    if (error) throw error;
    res.json({ request: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/transfer-requests/:id/reject', checkPermission('reject_transfer'), async (req, res) => {
  try {
    const { reason } = req.body;
    const { data, error } = await supabase
      .from('transfer_requests')
      .update({ approval_status: 'rejected', rejected_at: new Date().toISOString(), rejection_reason: reason || null })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select()
      .single();
    if (error) throw error;
    res.json({ request: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/transfer-requests/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('transfer_requests')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POSTING RULES ──────────────────────────────────────
router.get('/posting-rules', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('posting_rules')
      .select('*')
      .eq('user_id', req.userId)
      .order('document_type', { ascending: true });
    if (error) throw error;
    res.json({ rules: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/posting-rules', async (req, res) => {
  try {
    const { document_type, debit_account, credit_account, description_template, is_active } = req.body;
    if (!document_type || !debit_account || !credit_account) {
      return res.status(400).json({ error: 'document_type, debit_account, and credit_account are required' });
    }
    const { data, error } = await supabase
      .from('posting_rules')
      .insert([{ user_id: req.userId, document_type, debit_account, credit_account, description_template: description_template || '', is_active: is_active !== false }])
      .select().single();
    if (error) throw error;
    res.status(201).json({ rule: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/posting-rules/:id', async (req, res) => {
  try {
    const { document_type, debit_account, credit_account, description_template, is_active } = req.body;
    const { data, error } = await supabase
      .from('posting_rules')
      .update({ document_type, debit_account, credit_account, description_template: description_template || '', is_active: !!is_active })
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .select().single();
    if (error) throw error;
    res.json({ rule: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/posting-rules/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('posting_rules')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
