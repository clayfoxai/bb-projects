// Upgraded Human (RegenX) - CRM conversion events (GHL -> Meta Conversions API).
// Called by GHL workflows (Custom Webhook action) when an appointment is booked or an invoice is paid.
//
// Protected by a shared secret header (x-uh-key = UH_CRM_SECRET).
//
// HEALTH-ACCOUNT SAFETY: Meta receives only the event name (Schedule / Purchase), value + currency,
// and hashed contact identifiers. Never forward appointment titles, calendar names, invoice line
// items, product/service names, notes, or any other free text.

const { sha256, clean, sendToMeta } = require('./_meta');

const EVENTS = { schedule: 'Schedule', purchase: 'Purchase' };

function normPhone(p) {
  let d = clean(p, 40).replace(/\D/g, '');
  if (d.length === 10) d = '1' + d;
  return d;
}
function normName(n) {
  return clean(n, 100).toLowerCase().replace(/[^a-zÀ-ɏ]/g, '');
}
function isUnfilledMergeField(v) {
  return /^\s*\{\{.*\}\}\s*$/.test(v);
}
function field(b, k, max) {
  const v = clean(b[k], max);
  return isUnfilledMergeField(v) ? '' : v;
}
function toNumber(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  const secret = process.env.UH_CRM_SECRET;
  if (!secret || req.headers['x-uh-key'] !== secret) return res.status(401).json({ ok: false });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  b = b || {};

  const eventName = EVENTS[field(b, 'event', 20).toLowerCase()];
  if (!eventName) return res.status(400).json({ ok: false, error: 'event' });

  const email = field(b, 'email', 254).toLowerCase();
  const phone = normPhone(field(b, 'phone', 40));
  if (!email && phone.length < 10) return res.status(400).json({ ok: false, error: 'no_identifiers' });

  const ud = {};
  if (email) ud.em = [sha256(email)];
  if (phone.length >= 10) ud.ph = [sha256(phone)];
  const fn = normName(field(b, 'first_name', 100));
  const ln = normName(field(b, 'last_name', 100));
  if (fn) ud.fn = [sha256(fn)];
  if (ln) ud.ln = [sha256(ln)];
  const ext = [];
  const contactId = field(b, 'contact_id', 100);
  if (contactId) ext.push(sha256('ghl:' + contactId));
  // "Meta Match IDs" GHL field = fbc|fbp|visitorId (written by api/lead.js). Separate keys also accepted.
  const ids = field(b, 'meta_match_ids', 800).split('|');
  if (!b.meta_fbc && ids[0]) b.meta_fbc = ids[0];
  if (!b.meta_fbp && ids[1]) b.meta_fbp = ids[1];
  if (!b.meta_vid && ids[2]) b.meta_vid = ids[2];
  const vid = field(b, 'meta_vid', 100);
  if (vid) ext.push(sha256(vid));
  if (ext.length) ud.external_id = ext;
  const fbc = field(b, 'meta_fbc', 500);
  const fbclid = field(b, 'fbclid', 500);
  if (fbc) ud.fbc = fbc;
  else if (fbclid) ud.fbc = 'fb.1.' + Date.now() + '.' + fbclid;
  const fbp = field(b, 'meta_fbp', 200);
  if (fbp) ud.fbp = fbp;

  // Stable ID per appointment / invoice so retries never double count.
  const ref = field(b, 'ref_id', 100) || (contactId + '-' + Math.floor(Date.now() / 3600000));
  const evt = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventName.toLowerCase() + '-' + ref,
    action_source: 'system_generated',
    user_data: ud,
  };
  if (eventName === 'Purchase') {
    evt.custom_data = { value: toNumber(b.value), currency: (field(b, 'currency', 3) || 'USD').toUpperCase() };
  }

  const testCode = clean(req.headers['x-uh-test-code'], 40);
  let meta;
  try { meta = await sendToMeta(evt, testCode); } catch (_) { meta = { ok: false, reason: 'error' }; }
  console.log(JSON.stringify({ evt: 'crm_event', eventName, eventId: evt.event_id, meta: meta.ok ? 'ok' : (meta.status || meta.reason), test: !!testCode, error: !meta.ok && meta.detail && meta.detail.error ? meta.detail.error.message : undefined }));
  return res.status(meta.ok ? 200 : 502).json({ ok: meta.ok });
};
