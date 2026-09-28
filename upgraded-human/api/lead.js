// Upgraded Human (RegenX) - intake quiz lead handler.
// Runs as a Vercel Function in the dedicated `upgraded-human` Vercel project (root dir: upgraded-human/).
//
// 1. Forwards the full quiz submission to GoHighLevel (UH_GHL_WEBHOOK).
// 2. Sends a server-side "Lead" event to Meta Conversions API (UH_META_CAPI_TOKEN),
//    deduplicated against the browser pixel's Lead event via a shared event_id.
//
// PRIVACY RULE: quiz answers (goals / referral / notes) go ONLY to GHL. Meta receives the event
// name plus SHA-256-hashed contact fields and standard browser identifiers. Never add quiz
// answers, health terms, or free text to the Meta payload.

const crypto = require('crypto');
const { sha256, clean, browserUserData, sendToMeta } = require('./_meta');

function normEmail(e) {
  return clean(e, 254).toLowerCase();
}
function normPhone(p) {
  let d = clean(p, 40).replace(/\D/g, '');
  if (d.length === 10) d = '1' + d; // US default
  return d;
}
function normName(n) {
  return clean(n, 100).toLowerCase().replace(/[^a-zÀ-ɏ]/g, '');
}
function splitName(full) {
  const parts = clean(full, 200).split(/\s+/).filter(Boolean);
  // First token = first name, final token = last name (middle names/initials dropped).
  return { first: parts[0] || '', last: parts.length > 1 ? parts[parts.length - 1] : '' };
}
async function sendToGhl(payload) {
  const url = process.env.UH_GHL_WEBHOOK;
  if (!url) return { ok: false, reason: 'not_configured' };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: r.ok, status: r.status };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  b = b || {};

  // Honeypot: bots fill hidden fields, people don't. Pretend success, send nothing.
  if (clean(b.company)) return res.status(200).json({ ok: true });

  const fullName = clean(b.name, 200);
  const email = normEmail(b.email);
  const phoneRaw = clean(b.phone, 40);
  const phone = normPhone(phoneRaw);
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 10) {
    return res.status(400).json({ ok: false, error: 'invalid' });
  }

  const { first, last } = splitName(fullName);
  const eventId = clean(b.eventId, 100) || crypto.randomUUID();
  const pageUrl = clean(b.pageUrl, 1000);
  const utm = b.utm && typeof b.utm === 'object' ? b.utm : {};

  const ghlPayload = {
    // Same keys the live homepage "Start Your Journey" webhook already uses (name, goals, referral,
    // additional, email, phone), so a duplicate of that workflow maps with zero re-mapping.
    name: fullName,
    referral: clean(b.referral, 500),
    additional: clean(b.notes, 2000),
    first_name: first,
    last_name: last,
    full_name: fullName,
    email,
    phone: phoneRaw,
    goals: clean(b.goals, 2000),
    referral_source: clean(b.referral, 500),
    notes: clean(b.notes, 2000),
    source: 'learn.upgradedhuman.com intake quiz',
    page_url: pageUrl,
    utm_source: clean(utm.utm_source, 200),
    utm_medium: clean(utm.utm_medium, 200),
    utm_campaign: clean(utm.utm_campaign, 200),
    utm_content: clean(utm.utm_content, 200),
    utm_term: clean(utm.utm_term, 200),
    fbclid: clean(utm.fbclid, 500),
    submitted_at: new Date().toISOString(),
  };

  const userData = Object.assign(browserUserData(req, b), {
    em: [sha256(email)],
    ph: [sha256(phone)],
  });
  if (normName(first)) userData.fn = [sha256(normName(first))];
  if (normName(last)) userData.ln = [sha256(normName(last))];

  const metaEvent = {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    event_source_url: pageUrl || undefined,
    user_data: userData,
  };

  // GHL first: Meta only hears about a Lead that actually landed in the CRM, so a failed
  // submission followed by a retry never double-counts.
  let ghlRes, metaRes = { ok: false, reason: 'skipped' };
  try { ghlRes = await sendToGhl(ghlPayload); } catch (_) { ghlRes = { ok: false, reason: 'error' }; }
  if (ghlRes.ok) {
    try { metaRes = await sendToMeta(metaEvent); } catch (_) { metaRes = { ok: false, reason: 'error' }; }
  }

  // Log outcome only, never contact details or answers.
  console.log(JSON.stringify({ evt: 'lead', eventId, ghl: ghlRes.ok ? 'ok' : (ghlRes.reason || ghlRes.status), meta: metaRes.ok ? 'ok' : (metaRes.reason || metaRes.status) }));
  if (!metaRes.ok && metaRes.detail) console.log(JSON.stringify({ evt: 'meta_error', eventId, error: metaRes.detail.error && metaRes.detail.error.message }));

  // The lead is only "captured" if it reached GHL. If it didn't, tell the page so the visitor can retry
  // instead of seeing a success screen for a lead that went nowhere.
  if (!ghlRes.ok) return res.status(502).json({ ok: false, error: 'crm' });
  return res.status(200).json({ ok: true });
};
