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
    contact_id: contact.contactId,
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

function _unusedGenericPayload(service, contact, a, referral) {
  const out = {
    first_name: contact.firstName, last_name: contact.lastName, email: contact.email, phone: contact.phone,
    contact_id: contact.contactId,
    source: 'learn.upgradedhuman.com intake', intake_service: service, referral_source: referral,
    submitted_at: new Date().toISOString(),
  };
  Object.keys(a).forEach((k) => { if (!(k in out)) out[k] = val(a[k]); });
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
    contactId: /^[A-Za-z0-9]{10,40}$/.test(clean(c.contactId, 40)) ? clean(c.contactId, 40) : '',
  };
  // Contact details come from the quiz (or the CRM contact ID on reminder links); they are never re-asked.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email) && !contact.contactId) {
    return res.status(400).json({ ok: false, error: 'contact' });
  }
  const answers = (b.answers && typeof b.answers === 'object') ? b.answers : {};
  const referral = clean(b.referral, 200);

  // Per-service go-live switch: UH_INTAKE_LIVE="peptides,stemcell,facial" (or UH_INTAKE_MODE=live for all).
  const liveList = (process.env.UH_INTAKE_LIVE || '').split(',').map((x) => x.trim());
  const isLive = process.env.UH_INTAKE_MODE === 'live' || liveList.includes(service);
  if (!isLive) {
    console.log(JSON.stringify({ evt: 'intake_preview', service, fields: Object.keys(answers).length, signed: !!b.signed }));
    return res.status(200).json({ ok: true, mode: 'preview' });
  }

  if (service === 'peptides') {
    try {
      const r = await fetch(PEPTIDES_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(peptidesEnvelope(contact, answers, req, referral)) });
      console.log(JSON.stringify({ evt: 'intake_forward', service, status: r.status }));
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
    } catch (_) { return res.status(502).json({ ok: false }); }
  }

  // Stem cell / facial: write straight onto the lead's contact, into the clinic's existing custom fields.
  if (!process.env.UH_GHL_PIT) return res.status(503).json({ ok: false, error: 'not_configured' });
  try {
    const result = await saveToGhl(service, contact, answers, referral);
    console.log(JSON.stringify({ evt: 'intake_ghl', service, ok: result.ok, step: result.step, status: result.status }));
    return res.status(result.ok ? 200 : 502).json({ ok: result.ok });
  } catch (e) {
    console.log(JSON.stringify({ evt: 'intake_ghl', service, ok: false, error: String(e && e.message || e).slice(0, 200) }));
    return res.status(502).json({ ok: false });
  }
};

// ---------- GHL API (Private Integration token, location-scoped) ----------
const GHL = 'https://services.leadconnectorhq.com';
const FIELDS = require('./_ghlfields');
const SERVICE_TAG = { stemcell: 'lp intake - stem cell iv', facial: 'lp intake - facial' };
const SERVICE_NAME = { stemcell: 'Candidate Pre-Screening (Stem Cell / IV)', facial: 'Fountain of Youth Facial intake' };

async function ghl(method, path, body) {
  const r = await fetch(GHL + path, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.UH_GHL_PIT, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { ok: r.ok, status: r.status, json: j };
}

function buildFields(service, a, referral) {
  const map = FIELDS[service];
  const customFields = [];
  const std = {};
  Object.keys(a).forEach((k) => {
    if (map.standard[k]) { std[map.standard[k]] = val(a[k], 200); return; }
    const id = map.custom[k];
    if (!id) return;
    const v = map.multi.includes(k) ? (Array.isArray(a[k]) ? a[k].map((x) => clean(x, 200)) : [clean(a[k], 200)]) : val(a[k]);
    customFields.push({ id, field_value: v });
  });
  if (map.referralField && referral) customFields.push({ id: map.referralField, field_value: referral });
  return { customFields, std };
}

function noteBody(service, a) {
  const labels = FIELDS[service].labels;
  const lines = [SERVICE_NAME[service] + ' (submitted from learn.upgradedhuman.com)', ''];
  Object.keys(labels).forEach((k) => { if (a[k] !== undefined && a[k] !== '') lines.push(labels[k] + ': ' + val(a[k])); });
  return lines.join('\n');
}

async function saveToGhl(service, contact, a, referral) {
  const locationId = LOCATION_ID;
  const { customFields, std } = buildFields(service, a, referral);
  let id = contact.contactId;
  if (contact.email) {
    const up = await ghl('POST', '/contacts/upsert', Object.assign({
      locationId, email: contact.email,
      phone: contact.phone || undefined, firstName: contact.firstName || undefined, lastName: contact.lastName || undefined,
      customFields,
    }, std));
    if (!up.ok) return { ok: false, step: 'upsert', status: up.status };
    id = (up.json && up.json.contact && up.json.contact.id) || id;
  } else {
    const put = await ghl('PUT', '/contacts/' + id, Object.assign({ customFields }, std));
    if (!put.ok) return { ok: false, step: 'update', status: put.status };
  }
  if (!id) return { ok: false, step: 'no_id' };
  const t = await ghl('POST', '/contacts/' + id + '/tags', { tags: ['lp intake', SERVICE_TAG[service]] });
  const n = await ghl('POST', '/contacts/' + id + '/notes', { body: noteBody(service, a) });
  return { ok: true, step: 'done', status: (t.ok && n.ok) ? 200 : (t.ok ? n.status : t.status) };
}
