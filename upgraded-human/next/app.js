/* Upgraded Human (RegenX) - service intake engine.
   Renders the step-by-step intake from window.UH_INTAKE (schema defined on each service page).
   Contact details carry over from the landing page quiz (sessionStorage 'uh_lead', same browser tab);
   they are never re-asked when present and never placed in a URL. */
(function(){
  var S = window.UH_INTAKE;
  var root = document.getElementById('intake');
  if(!S || !root) return;

  var lead = {};
  try { lead = JSON.parse(sessionStorage.getItem('uh_lead') || '{}') || {}; } catch(e){ lead = {}; }
  // Links sent from the CRM (e.g. reminder texts) carry only the opaque CRM contact ID, never personal details.
  var contactId = '';
  try { var cq = new URLSearchParams(location.search).get('c') || ''; if(/^[A-Za-z0-9]{10,40}$/.test(cq)) contactId = cq; } catch(e){}
  var knownContact = !!(lead.email || contactId);

  var answers = {};              // field id -> value (string or array)
  var steps = S.steps.slice();
  if(!knownContact){
    // Rare case (new device or tab, no CRM link): ask only for the email they already gave, so we can match their record.
    steps.unshift({ title: 'Confirm your email', sub: 'Use the same email from your request so we can match your answers to it.', fields: [
      { id:'email', label:'Email', type:'email', required:true, autocomplete:'email' }
    ]});
  }
  // Pre-fill answers the lead already gave on the landing page (editable, never re-asked from scratch)
  steps.forEach(function(st){ st.fields.forEach(function(f){
    if(f.prefill && lead[f.prefill]){ answers[f.id] = lead[f.prefill]; }
  }); });

  var current = 0;
  var signed = false;

  function el(tag, attrs, html){
    var e = document.createElement(tag);
    if(attrs){ for(var k in attrs){ if(attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]); } }
    if(html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  function visible(f){
    if(!f.showIf) return true;
    var v = answers[f.showIf.id];
    var want = f.showIf.equals;
    if(Array.isArray(v)) return v.indexOf(want) !== -1;
    return v === want;
  }

  // ---------- layout ----------
  var shell = el('div', {'class':'ik-form'});
  var firstSlot = document.querySelector('[data-first]');
  if(firstSlot && lead.firstName){ firstSlot.textContent = ', ' + lead.firstName; }
  var progTop = el('div', {'class':'ik-progress-top'});
  var stepLabel = el('span'); var pctLabel = el('span');
  progTop.appendChild(stepLabel); progTop.appendChild(pctLabel);
  var bar = el('div', {'class':'ik-bar'}); var barFill = el('div', {'class':'ik-bar-fill'}); bar.appendChild(barFill);
  var body = el('div', {'class':'ik-body'});
  var nav = el('div', {'class':'ik-nav'});
  var backBtn = el('button', {type:'button','class':'ik-back'}, '&larr; Back');
  var nextBtn = el('button', {type:'button','class':'btn'}, 'Next');
  nav.appendChild(backBtn); nav.appendChild(nextBtn);
  var submitErr = el('p', {'class':'ik-submit-err', role:'alert', hidden:''});
  var hp = el('div', {'class':'ik-hp', 'aria-hidden':'true'}, '<label>Company<input type="text" id="ikCompany" tabindex="-1" autocomplete="off"></label>');
  shell.appendChild(progTop); shell.appendChild(bar); shell.appendChild(body); shell.appendChild(nav); shell.appendChild(submitErr); shell.appendChild(hp);
  root.appendChild(shell);

  // ---------- field renderers ----------
  function optionButton(f, opt, multi){
    var b = el('button', {type:'button', 'class':'ik-opt' + (multi ? '' : ' radio'), role: multi ? 'checkbox' : 'radio', 'aria-checked':'false', 'data-value':opt});
    b.innerHTML = '<span class="box" aria-hidden="true"></span><span>' + esc(opt) + '</span>';
    var v = answers[f.id];
    if(multi ? (Array.isArray(v) && v.indexOf(opt) !== -1) : v === opt){ b.setAttribute('aria-checked','true'); }
    b.addEventListener('click', function(){
      if(multi){
        var arr = Array.isArray(answers[f.id]) ? answers[f.id].slice() : [];
        var i = arr.indexOf(opt);
        if(i === -1){ arr.push(opt); } else { arr.splice(i,1); }
        answers[f.id] = arr;
        b.setAttribute('aria-checked', i === -1 ? 'true' : 'false');
      } else {
        answers[f.id] = opt;
        b.parentNode.querySelectorAll('.ik-opt').forEach(function(x){ x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
      }
      clearError(f.id);
      refreshVisibility();
    });
    return b;
  }

  function renderField(f){
    var wrap = el('div', {'class':'ik-field', 'data-field':f.id});
    var labelHtml = esc(f.label) + ((f.required || f.requiredIfVisible) ? '' : ' <span class="req">(optional)</span>');
    var inputId = 'ik_' + f.id;
    if(f.type === 'embed'){
      wrap.appendChild(el('span', {'class':'ik-label'}, labelHtml));
      if(f.help) wrap.appendChild(el('p', {'class':'ik-help'}, esc(f.help)));
      var box = el('div', {'class':'ik-embed'});
      box.appendChild(el('iframe', {src:f.src, title:f.label, loading:'lazy'}));
      wrap.appendChild(box);
      var st = el('p', {'class':'ik-embed-status' + (signed ? ' ok' : '')}, signed ? 'Signed. Thank you.' : 'Please complete and sign the document above to continue.');
      st.id = 'ikSignStatus';
      wrap.appendChild(st);
    } else if(f.type === 'radio' || f.type === 'yesno' || f.type === 'checkbox'){
      wrap.appendChild(el('span', {'class':'ik-label', id: inputId + '_l'}, labelHtml));
      if(f.help) wrap.appendChild(el('p', {'class':'ik-help'}, esc(f.help)));
      var opts = f.type === 'yesno' ? ['Yes','No'] : f.options;
      var group = el('div', {'class':'ik-options' + ((f.type === 'yesno' || f.inline) ? ' inline' : ''), role: f.type === 'checkbox' ? 'group' : 'radiogroup', 'aria-labelledby': inputId + '_l'});
      opts.forEach(function(o){ group.appendChild(optionButton(f, o, f.type === 'checkbox')); });
      wrap.appendChild(group);
    } else {
      wrap.appendChild(el('label', {'class':'ik-label', 'for':inputId}, labelHtml));
      if(f.help) wrap.appendChild(el('p', {'class':'ik-help'}, esc(f.help)));
      var input;
      if(f.type === 'textarea'){
        input = el('textarea', {'class':'ik-input', id:inputId, rows:'3', placeholder:f.placeholder || ''});
      } else if(f.type === 'select'){
        input = el('select', {'class':'ik-input', id:inputId});
        input.appendChild(el('option', {value:''}, esc(f.placeholder || 'Select...')));
        f.options.forEach(function(o){ input.appendChild(el('option', {value:o}, esc(o))); });
      } else {
        input = el('input', {'class':'ik-input', id:inputId, type: f.type === 'number' ? 'number' : (f.type || 'text'),
          placeholder:f.placeholder || '', autocomplete:f.autocomplete || 'off', min:f.min, max:f.max, inputmode: f.type === 'number' ? 'numeric' : undefined});
      }
      if(answers[f.id] !== undefined) input.value = answers[f.id];
      var sync = function(){ answers[f.id] = input.value; clearError(f.id); refreshVisibility(); };
      input.addEventListener('input', sync); input.addEventListener('change', sync);
      wrap.appendChild(input);
    }
    wrap.appendChild(el('p', {'class':'ik-err', hidden:''}));
    return wrap;
  }

  function renderStep(){
    var st = steps[current];
    body.innerHTML = '';
    var s = el('div', {'class':'ik-step'});
    s.appendChild(el('h2', null, esc(st.title)));
    if(st.sub) s.appendChild(el('p', {'class':'ik-step-sub'}, esc(st.sub)));
    var i = 0;
    while(i < st.fields.length){
      var f = st.fields[i];
      if(f.half && st.fields[i+1] && st.fields[i+1].half){
        var row = el('div', {'class':'ik-row two'});
        row.appendChild(renderField(f)); row.appendChild(renderField(st.fields[i+1]));
        s.appendChild(row); i += 2;
      } else { s.appendChild(renderField(f)); i++; }
    }
    body.appendChild(s);
    var pct = Math.round(((current + 1) / steps.length) * 100);
    stepLabel.textContent = 'STEP ' + (current + 1) + ' OF ' + steps.length;
    pctLabel.textContent = pct + '% Complete';
    barFill.style.width = pct + '%';
    backBtn.disabled = current === 0;
    nextBtn.textContent = current === steps.length - 1 ? 'Submit' : 'Next';
    refreshVisibility();
  }

  function refreshVisibility(){
    steps[current].fields.forEach(function(f){
      var node = body.querySelector('[data-field="' + f.id + '"]');
      if(node) node.hidden = !visible(f);
    });
  }
  function showError(id, msg){
    var node = body.querySelector('[data-field="' + id + '"]'); if(!node) return;
    node.classList.add('is-error');
    var e = node.querySelector('.ik-err'); e.textContent = msg; e.hidden = false;
  }
  function clearError(id){
    var node = body.querySelector('[data-field="' + id + '"]'); if(!node) return;
    node.classList.remove('is-error'); var e = node.querySelector('.ik-err'); if(e) e.hidden = true;
  }
  function empty(v){ return v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === ''); }

  function validateStep(){
    var firstBad = null;
    steps[current].fields.forEach(function(f){
      if(!visible(f)) return;
      var v = answers[f.id], msg = '';
      if(f.type === 'embed'){ if(f.required && !signed) msg = 'Please sign the document above to continue.'; }
      else if((f.required || f.requiredIfVisible) && empty(v)) msg = 'This one is required.';
      else if(!empty(v) && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = 'Please enter a valid email address.';
      else if(!empty(v) && f.type === 'tel' && String(v).replace(/\D/g,'').length < 10) msg = 'Please include your area code.';
      else if(!empty(v) && f.type === 'number' && (f.min !== undefined && +v < f.min || f.max !== undefined && +v > f.max)) msg = 'Please enter a number from ' + f.min + ' to ' + f.max + '.';
      if(msg){ showError(f.id, msg); if(!firstBad) firstBad = f.id; }
    });
    if(firstBad){
      var node = body.querySelector('[data-field="' + firstBad + '"]');
      if(node){ node.scrollIntoView({behavior:'smooth', block:'center'}); }
      return false;
    }
    return true;
  }

  function scrollToForm(){ var top = shell.getBoundingClientRect().top + window.scrollY - 16; window.scrollTo({top: top, behavior:'smooth'}); }

  var submitting = false;
  function submit(){
    if(submitting) return;
    submitting = true;
    submitErr.hidden = true;
    nextBtn.disabled = true; backBtn.disabled = true; nextBtn.textContent = 'Sending...';
    var contact = {
      firstName: lead.firstName || '', lastName: lead.lastName || '',
      email: lead.email || answers.email || '', phone: lead.phone || '', contactId: contactId
    };
    var clean = {};
    S.steps.forEach(function(st){ st.fields.forEach(function(f){
      if(f.type === 'embed' || !visible(f)) return;
      if(!empty(answers[f.id])) clean[f.id] = answers[f.id];
    }); });
    fetch('/api/details', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
      service: S.service, contact: contact, answers: clean, signed: signed,
      referral: lead.referral || '', company: (document.getElementById('ikCompany') || {}).value || ''
    })}).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
      .then(function(){ done(contact); })
      .catch(function(){
        submitting = false; nextBtn.disabled = false; backBtn.disabled = false; nextBtn.textContent = 'Submit';
        submitErr.textContent = "We couldn't send your answers just now. Please tap Submit to try again.";
        submitErr.hidden = false;
      });
  }

  function done(contact){
    try{ var l = JSON.parse(sessionStorage.getItem('uh_lead') || '{}'); l.intakeDone = S.service; sessionStorage.setItem('uh_lead', JSON.stringify(l)); }catch(e){}
    progTop.hidden = true; bar.hidden = true; nav.hidden = true;
    var first = contact.firstName ? ', ' + contact.firstName : '';
    body.innerHTML = '<div class="ik-done"><div class="ik-done-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg></div>'
      + '<h2>Thank you' + esc(first) + '</h2><p>' + esc(S.doneText) + '</p></div>';
    scrollToForm();
  }

  nextBtn.addEventListener('click', function(){
    if(!validateStep()) return;
    if(current === steps.length - 1){ submit(); return; }
    current++; renderStep(); scrollToForm();
  });
  backBtn.addEventListener('click', function(){ if(current > 0){ current--; renderStep(); scrollToForm(); } });

  // Signature document (GHL Documents) posts a completion message to the parent page.
  window.addEventListener('message', function(ev){
    try{
      if(!/^https:\/\/([a-z0-9-]+\.)*(trm-engine\.com|leadconnectorhq\.com|msgsndr\.com)$/.test(ev.origin || '')) return;
      var d = ev.data; if(!d) return;
      var s = (typeof d === 'string' ? d : JSON.stringify(d)).toLowerCase();
      var hit = /document[._-]?completed|doc[._-]?completed|signature_completed|document_signed/.test(s) ||
                (/form[-_]submit(ted)?/.test(s) && s.indexOf('progress') === -1);
      if(hit && !signed){
        signed = true;
        var st = document.getElementById('ikSignStatus');
        if(st){ st.textContent = 'Signed. Thank you.'; st.classList.add('ok'); }
        steps[current].fields.forEach(function(f){ if(f.type === 'embed') clearError(f.id); });
      }
    }catch(e){}
  });

  renderStep();
})();
