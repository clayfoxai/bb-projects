// Upgraded Human (RegenX) - server-side copies of non-lead pixel events (PageView, AssessmentStarted).
// Each carries the same event_id as the browser pixel event, so Meta keeps one and uses the server
// copy when the browser event was blocked (ad blockers, Safari tracking limits).
// No contact details are collected here: only IP, user agent, fbp/fbc and the first-party visitor ID.

const { clean, browserUserData, sendToMeta } = require('./_meta');

const ALLOWED = new Set(['PageView', 'AssessmentStarted']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  b = b || {};

  const eventName = clean(b.event, 40);
  const eventId = clean(b.eventId, 100);
  if (!ALLOWED.has(eventName) || !eventId) return res.status(400).json({ ok: false });

  const evt = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    event_source_url: clean(b.pageUrl, 1000) || undefined,
    user_data: browserUserData(req, b),
  };

  let meta;
  try { meta = await sendToMeta(evt); } catch (_) { meta = { ok: false, reason: 'error' }; }
  if (!meta.ok) console.log(JSON.stringify({ evt: 'meta_event_error', eventName, eventId, status: meta.status || meta.reason, error: meta.detail && meta.detail.error && meta.detail.error.message }));
  return res.status(200).json({ ok: true });
};
