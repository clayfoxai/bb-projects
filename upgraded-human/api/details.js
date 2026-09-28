// Upgraded Human (RegenX) - service intake handler (peptides / stemcell / facial).
//
// PREVIEW MODE (default): validates and returns ok WITHOUT forwarding anything to GHL.
// Set UH_INTAKE_MODE=live in Vercel only after Alex approves the pages and the GHL workflows exist.
//
// LIVE routing:
//   peptides -> existing clinical intake webhook, in the exact envelope the current intake app sends,
//               so the clinic's existing workflow and custom fields keep working unchanged.
//   stemcell -> UH_GHL_INTAKE_STEMCELL (new copy workflow; writes the Candidate Pre-Screening fields)
//   facial   -> UH_GHL_INTAKE_FACIAL   (new copy workflow; writes the Microneedling fields)
//
// HEALTH-DATA RULE: nothing here is ever sent to Meta. No pixel, no CAPI, no analytics.

const { clean } = require('./_meta');

const PEPTIDES_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/wIgYrIC0GXnIwO0WknNt/webhook-trigger/8155caf7-8037-49e4-af49-c2e853a658ad';
const LOCATION_ID = 'wIgYrIC0GXnIwO0WknNt';
const GOAL_TAGS = {
  'Weight Loss / Body Composition': 'Goal: Weight Loss',
  'Sleep Quality': 'Goal: Sleep',
  'Libido & Sexual Health': 'Goal: Libido',
  'Muscle Building & Recovery': 'Goal: Muscle & Recovery',
  'Anti-Aging & Longevity': 'Goal: Longevity',
  'Joint & Tissue Recovery': 'Goal: MSK Recovery',
};
const SERVICES = ['peptides', 'stemcell', 'facial'];

function val(v, max) {
  if (Array.isArray(v)) return v.map((x) => clean(x, 200)).filter(Boolean).join(', ');
  return clean(v, max || 4000);
}

function peptidesEnvelope(contact, a, req, referral) {
  const goals = Array.isArray(a.uy8MeZmbMVae2KZtChrz) ? a.uy8MeZmbMVae2KZtChrz : [];
  const tags = ['new lead', 'lp intake'];
  goals.forEach((g) => { if (GOAL_TAGS[g] && !tags.includes(GOAL_TAGS[g])) tags.push(GOAL_TAGS[g]); });
  if (a.xDJVynJveUJDjNNo0hTq === 'Yes') tags.push('peptide intake');
  const formData = {
    tags,
    first_name: contact.firstName, last_name: contact.lastName, email: contact.email, phone: contact.phone,
    date_of_birth: val(a.date_of_birth, 20), address: val(a.address, 200), city: val(a.city, 100),
    state: val(a.state, 50), postal_code: val(a.postal_code, 20),
  };
  if (referral) formData['5jG84mLywqb3RoQo8xMn'] = referral;
  Object.keys(a).forEach((k) => {
    if (!(k in formData) && /^[A-Za-z0-9]{20}$/.test(k)) formData[k] = val(a[k]);
  });
  const url = 'https://learn.upgradedhuman.com/next/1/';
  return {
    type: 'external_form_submission', timestamp: new Date().toISOString(),
    formId: 'Form | ReGenX Clinical Intake Form', tags, formData,
    url, title: 'Your Next Step', path: '/next/1/',
    userAgent: clean(req.headers['user-agent'], 400), locationId: LOCATION_ID,
    properties: { deviceType: /mobile/i.test(req.headers['user-agent'] || '') ? 'mobile' : 'desktop' },
  };
}

function genericPayload(service, contact, a, referral) {
  const out = {
    first_name: contact.firstName, last_name: contact.lastName, email: contact.email, phone: contact.phone,
    source: 'learn.upgradedhuman.com intake', intake_service: service, referral_source: referral,
    submitted_at: new Date().toISOString(),
  };
  Object.keys(a).forEach((k) => { out[k] = val(a[k]); });
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  b = b || {};
  if (clean(b.company, 100)) return res.status(200).json({ ok: true }); // honeypot

  const service = clean(b.service, 20);
  if (!SERVICES.includes(service)) return res.status(400).json({ ok: false, error: 'service' });
  const c = b.contact || {};
  const contact = {
    firstName: clean(c.firstName, 100), lastName: clean(c.lastName, 100),
    email: clean(c.email, 254).toLowerCase(), phone: clean(c.phone, 40),
  };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email) || contact.phone.replace(/\D/g, '').length < 10) {
    return res.status(400).json({ ok: false, error: 'contact' });
  }
  const answers = (b.answers && typeof b.answers === 'object') ? b.answers : {};
  const referral = clean(b.referral, 200);

  if (process.env.UH_INTAKE_MODE !== 'live') {
    console.log(JSON.stringify({ evt: 'intake_preview', service, fields: Object.keys(answers).length, signed: !!b.signed }));
    return res.status(200).json({ ok: true, mode: 'preview' });
  }

  let url, payload;
  if (service === 'peptides') { url = PEPTIDES_WEBHOOK; payload = peptidesEnvelope(contact, answers, req, referral); }
  else {
    url = service === 'stemcell' ? process.env.UH_GHL_INTAKE_STEMCELL : process.env.UH_GHL_INTAKE_FACIAL;
    payload = genericPayload(service, contact, answers, referral);
  }
  if (!url) return res.status(503).json({ ok: false, error: 'not_configured' });
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    console.log(JSON.stringify({ evt: 'intake_forward', service, status: r.status }));
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch (_) {
    return res.status(502).json({ ok: false });
  }
};
