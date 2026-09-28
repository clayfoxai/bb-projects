// Shared Meta Conversions API helpers (underscore prefix: not exposed as a route).
//
// PRIVACY RULE: only hashed contact fields and standard browser identifiers go to Meta.
// Never send quiz answers, health terms, or free text.

const crypto = require('crypto');

const DATASET_ID = '2160151605383103';
const GRAPH_VERSION = 'v21.0';

function sha256(v) {
  return crypto.createHash('sha256').update(v).digest('hex');
}
function clean(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 500);
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || '';
}

// Identifiers every event can carry: IP, user agent, Meta browser/click IDs, first-party visitor ID.
function browserUserData(req, b) {
  const ud = {
    client_ip_address: clientIp(req) || undefined,
    client_user_agent: clean(req.headers['user-agent'], 500) || undefined,
    fbp: clean(b.fbp, 200) || undefined,
    fbc: clean(b.fbc, 500) || undefined,
  };
  const vid = clean(b.vid, 100);
  if (vid) ud.external_id = [sha256(vid)];
  return ud;
}

async function sendToMeta(evt, testCode) {
  const token = process.env.UH_META_CAPI_TOKEN;
  if (!token) return { ok: false, reason: 'not_configured' };
  const body = { data: [evt] };
  const code = testCode || process.env.UH_META_TEST_EVENT_CODE;
  if (code) body.test_event_code = code;
  const r = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${DATASET_ID}/events?access_token=${encodeURIComponent(token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  let detail = null;
  try { detail = await r.json(); } catch (_) {}
  return { ok: r.ok, status: r.status, detail };
}

module.exports = { sha256, clean, clientIp, browserUserData, sendToMeta };
