const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function normalizePacket(packet) {
  const string = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Review packet requires ${label}.`);
    return value;
  };
  const strings = (value, label) => {
    if (!Array.isArray(value)) throw new Error(`Review packet requires ${label}.`);
    return value.map(item => string(item, label));
  };
  const unique = (values, label) => {
    if (new Set(values).size !== values.length) throw new Error(`Review packet has duplicate ${label}.`);
  };
  if (packet?.version !== 1 || !Array.isArray(packet.criteria) || !Array.isArray(packet.items)) throw new Error('Invalid review packet.');
  const criteria = packet.criteria.map(criterion => ({ id: string(criterion.id, 'criterion ID'), label: string(criterion.label, 'criterion label'), description: string(criterion.description, 'criterion description') }));
  const items = packet.items.map(item => ({
    id: string(item.id, 'item ID'),
    target: { title: string(item.target?.title, 'target title'), seniority: string(item.target?.seniority, 'target seniority'), responsibilities: strings(item.target?.responsibilities, 'target responsibilities') },
    sourceFacts: strings(item.sourceFacts, 'source facts'), A: strings(item.A, 'version A'), B: strings(item.B, 'version B'),
  }));
  unique(criteria.map(item => item.id), 'criterion IDs');
  unique(items.map(item => item.id), 'item IDs');
  return { version: 1, packetId: string(packet.packetId, 'packet ID'), title: string(packet.title, 'title'), criteria, items };
}

// This function is serialized verbatim. It has no dependencies or network access.
function reviewApp() {
  const packet = JSON.parse(document.getElementById('review-packet').textContent);
  const key = 'nextresume:uplift-review:v1:' + packet.packetId;
  const validCriteria = new Set(packet.criteria.map(item => item.id));
  const state = { reviewer: '', attested: false, ratings: Object.create(null) };
  const status = document.getElementById('save-status');
  const exportButton = document.getElementById('download-review');
  const reviewer = document.getElementById('reviewer');
  const attestation = document.getElementById('attestation');
  let storageUnavailable = false;

  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved?.version === 1 && saved.packetId === packet.packetId && Array.isArray(saved.ratings)) {
      state.reviewer = typeof saved.reviewer === 'string' ? saved.reviewer.slice(0, 80) : '';
      state.attested = saved.attested === true;
      for (const item of packet.items) {
        const rating = saved.ratings.find(candidate => candidate?.itemId === item.id);
        if (!rating) continue;
        state.ratings[item.id] = {
          itemId: item.id,
          preference: (JSON.stringify(item.A) === JSON.stringify(item.B) ? ['tie', 'neither'] : ['A', 'B', 'tie', 'neither']).includes(rating.preference) ? rating.preference : '',
          factualConcerns: Array.isArray(rating.factualConcerns) ? ['A', 'B'].filter(side => rating.factualConcerns.includes(side)) : [],
          criteria: Array.isArray(rating.criteria) ? [...new Set(rating.criteria.filter(id => validCriteria.has(id)))] : [],
          reason: typeof rating.reason === 'string' ? rating.reason.slice(0, 1000) : '',
        };
      }
    }
  } catch { storageUnavailable = true; }

  function draft() {
    return { version: 1, packetId: packet.packetId, reviewer: state.reviewer, attested: state.attested, ratings: packet.items.flatMap(item => state.ratings[item.id] ? [state.ratings[item.id]] : []) };
  }
  function result() {
    return { version: 1, packetId: packet.packetId, reviewer: state.reviewer.trim(), attested: true, ratings: draft().ratings.filter(rating => rating.preference) };
  }
  function update() {
    const count = result().ratings.length;
    document.getElementById('review-progress').textContent = `${count} of ${packet.items.length} comparisons reviewed`;
    document.getElementById('progress-meter').value = count;
    document.getElementById('export-note').textContent = count === 0 ? 'Choose a preference to start your review.' : count < packet.items.length ? `Partial review: ${count} answered; ${packet.items.length - count} unanswered will be omitted.` : 'All comparisons answered. Your download contains your choices and notes.';
    exportButton.disabled = count === 0 || !state.attested || !state.reviewer.trim();
    const readiness = document.getElementById('readiness-link');
    readiness.hidden = count === 0 || Boolean(state.reviewer.trim() && state.attested);
    readiness.href = state.reviewer.trim() ? '#attestation' : '#reviewer';
    readiness.textContent = state.reviewer.trim() ? 'Confirm your review to enable download.' : 'Add a reviewer code to enable download.';
    exportButton.textContent = count > 0 && count < packet.items.length ? `Download partial review (${count})` : 'Download review JSON';
    document.getElementById('attestation-hint').hidden = state.attested || count === 0;
    if (storageUnavailable) status.textContent = 'Local saving is unavailable. Download your review before closing this page.';
  }
  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify(draft()));
      storageUnavailable = false;
      status.textContent = 'Draft saved in this browser.';
    } catch { storageUnavailable = true; }
    update();
  }

  reviewer.value = state.reviewer;
  attestation.checked = state.attested;
  reviewer.addEventListener('input', () => { state.reviewer = reviewer.value; persist(); });
  attestation.addEventListener('change', () => { state.attested = attestation.checked; persist(); });
  for (const [index, item] of packet.items.entries()) {
    const card = document.getElementById('comparison-' + index);
    const preferenceInputs = [...card.querySelectorAll('[data-preference]')];
    const concernInputs = [...card.querySelectorAll('[data-concern]')];
    const criteriaInputs = [...card.querySelectorAll('[data-criterion]')];
    const reason = card.querySelector('[data-reason]');
    function refresh() {
      const rating = state.ratings[item.id];
      for (const input of preferenceInputs) input.checked = rating?.preference === input.value;
      for (const input of concernInputs) input.checked = rating?.factualConcerns.includes(input.value) || false;
      for (const input of criteriaInputs) input.checked = rating?.criteria.includes(input.value) || false;
      reason.value = rating?.reason || '';
      card.querySelector('[data-item-status]').textContent = rating?.preference ? 'Reviewed' : 'Awaiting your choice';
      card.querySelector('[data-clear]').hidden = !rating?.preference;
    }
    refresh();
    function changed() {
      state.ratings[item.id] = {
        itemId: item.id, preference: preferenceInputs.find(input => input.checked && !input.disabled)?.value || '',
        factualConcerns: concernInputs.filter(input => input.checked).map(input => input.value),
        criteria: criteriaInputs.filter(input => input.checked).map(input => input.value), reason: reason.value,
      };
      card.querySelector('[data-item-status]').textContent = state.ratings[item.id].preference ? 'Reviewed' : 'Awaiting your choice';
      card.querySelector('[data-clear]').hidden = !state.ratings[item.id].preference;
      persist();
    }
    for (const input of [...preferenceInputs, ...concernInputs, ...criteriaInputs]) input.addEventListener('change', changed);
    reason.addEventListener('input', changed);
    card.querySelector('[data-clear]').addEventListener('click', () => {
      if (state.ratings[item.id]) state.ratings[item.id].preference = '';
      refresh(); persist(); preferenceInputs.find(input => !input.disabled)?.focus();
    });
  }
  exportButton.addEventListener('click', () => {
    if (!state.attested || !state.reviewer.trim() || !result().ratings.length) return;
    const blob = new Blob([JSON.stringify(result(), null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'resume-review-' + packet.packetId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) + '.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = storageUnavailable ? 'Review downloaded. Local saving remains unavailable.' : 'Review downloaded. Your draft remains saved in this browser.';
  });
  update();
}

export function renderUpliftReview(input) {
  const packet = normalizePacket(input);
  const html = escapeHtml;
  const bullets = items => `<ul>${items.map(item => `<li>${html(item)}</li>`).join('')}</ul>`;
  const cards = packet.items.map((item, index) => `
    <article class="comparison" id="comparison-${index}" aria-labelledby="case-title-${index}">
      <header class="case-header"><p class="eyebrow">Comparison ${index + 1} of ${packet.items.length}</p><span class="item-status" data-item-status>Awaiting your choice</span><h2 id="case-title-${index}">${html(item.target.title)}</h2><p class="seniority">${html(item.target.seniority)}</p></header>
      <div class="brief"><section aria-label="Target responsibilities"><h3>The role</h3>${bullets(item.target.responsibilities)}</section><section aria-label="Source facts"><h3>Known facts</h3>${bullets(item.sourceFacts)}<p class="help">Use these facts to check both versions. A reasonable explanation of purpose can help; a new result or number needs evidence.</p></section></div>
      <div class="versions">${['A', 'B'].map(side => `<section class="version" aria-labelledby="version-${index}-${side}"><h3 id="version-${index}-${side}"><span class="version-letter">${side}</span> Version ${side}</h3>${bullets(item[side])}<label class="concern"><input type="checkbox" data-concern value="${side}"> Factual concern with ${side}</label></section>`).join('')}</div>
      <div class="decision"><fieldset class="preferences"><legend>Which version would you put forward for this role?</legend><p class="help" ${JSON.stringify(item.A) === JSON.stringify(item.B) ? '' : 'hidden'}>Both versions have identical text. Choose Equally strong or Neither is ready.</p><div class="preference-options">${[['A', 'Prefer A'], ['B', 'Prefer B'], ['tie', 'Equally strong'], ['neither', 'Neither is ready']].map(([value, label]) => `<label class="choice"><input type="radio" name="preference-${index}" data-preference value="${value}" ${JSON.stringify(item.A) === JSON.stringify(item.B) && ['A', 'B'].includes(value) ? 'disabled' : ''}><span>${label}</span></label>`).join('')}</div><button type="button" class="clear" data-clear hidden>Clear choice</button></fieldset>
      <fieldset class="criteria"><legend>What shaped your choice? <span class="optional">Optional</span></legend><div class="criterion-options">${packet.criteria.map(criterion => `<label title="${html(criterion.description)}"><input type="checkbox" data-criterion value="${html(criterion.id)}"><span>${html(criterion.label)}<small>${html(criterion.description)}</small></span></label>`).join('')}</div></fieldset>
      <label class="reason">Reason <span class="optional">Optional</span><textarea data-reason rows="2" maxlength="1000" placeholder="What made one version stronger, or what is still missing?"></textarea></label></div>
    </article>`).join('');
  const serialized = JSON.stringify(packet).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; object-src 'none'"><title>${html(packet.title)}</title><style>
:root{color-scheme:light;--desk:#edf3f8;--paper:#fff;--ink:#14263d;--muted:#526579;--line:#c6d3e0;--accent:#116b75;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--desk);line-height:1.55;font-size:16px}*{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit;color:inherit}button,input[type=radio],input[type=checkbox]{cursor:pointer}input{accent-color:var(--accent)}button:disabled{cursor:not-allowed}a,button,input,textarea,summary{touch-action:manipulation}:focus-visible{outline:3px solid var(--accent);outline-offset:4px}button{border:0}.shell{max-width:1120px;margin:auto;padding:52px 28px 28px}.intro{max-width:790px;margin-bottom:34px}.eyebrow,.item-status,.seniority,.optional,.help,.export-note,.save-status{font-size:.83rem;color:var(--muted)}.eyebrow{font-weight:650;letter-spacing:.08em;text-transform:uppercase;margin:0 0 12px}h1{font-family:Palatino,"Palatino Linotype","Book Antiqua",Georgia,serif;font-size:clamp(2.15rem,5vw,3.5rem);letter-spacing:-.04em;line-height:1.12;font-weight:500;margin:0 0 20px}h2{font-size:1.5rem;line-height:1.3;margin:0 0 4px;letter-spacing:-.025em}h3{font-size:.93rem;margin:0 0 10px}.intro p:last-child{font-size:1rem;max-width:680px;margin-bottom:0}.comparison{background:var(--paper);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin:0 0 28px}.case-header{padding:24px 28px 20px;position:relative}.case-header .eyebrow{margin-bottom:12px}.item-status{float:right;padding:2px 0 2px 12px}.seniority{margin:0}.brief{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:32px;padding:20px 28px;background:var(--desk);border-block:1px solid var(--line)}ul{padding-left:20px;margin:0}li+li{margin-top:10px}.brief ul{font-size:.9rem}.help{margin:12px 0 0}.versions{display:grid;grid-template-columns:1fr 1fr}.version{padding:26px 28px;min-width:0;display:flex;flex-direction:column;align-items:flex-start}.version+ .version{border-left:1px solid var(--line)}.version h3{display:flex;align-items:center;gap:12px;margin-bottom:20px}.version-letter{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid var(--ink);font-family:Palatino,Georgia,serif;font-size:1.3rem;font-weight:500}.version ul{flex:1;margin-bottom:24px}.version li{font-size:.98rem;line-height:1.7}.concern{font-size:.85rem;color:var(--muted);display:flex;align-items:flex-start;gap:8px}.concern input{margin-top:5px}.decision{padding:24px 28px 28px;border-top:1px solid var(--line)}fieldset{border:0;padding:0;margin:0 0 22px;min-width:0}legend{font-size:.93rem;font-weight:650;margin-bottom:12px;padding:0}.preference-options{display:flex;flex-wrap:wrap;gap:10px}.choice{position:relative;display:flex;align-items:center;gap:9px;border:1px solid var(--line);padding:11px 16px;border-radius:8px;cursor:pointer;min-height:46px;font-size:.93rem}.choice:has(input:checked){border-color:var(--accent);background:var(--desk);box-shadow:inset 0 0 0 1px var(--accent)}.choice input{margin:0}.choice:has(input:disabled){opacity:.55;cursor:not-allowed}.clear{color:var(--accent);text-decoration:underline;text-underline-offset:3px;background:transparent;padding:10px 0 0;font-size:.83rem}.criterion-options{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px}.criterion-options label{display:flex;gap:9px;align-items:flex-start;font-size:.88rem}.criterion-options input{margin-top:5px}.criterion-options small{display:block;font-size:.78rem;color:var(--muted);line-height:1.45;margin-top:3px}.optional{font-weight:400;margin-left:5px}.reason{display:block;font-size:.93rem;font-weight:650}textarea,input[type=text]{width:100%;background:var(--paper);border:1px solid var(--line);border-radius:7px;padding:10px 12px}textarea{display:block;margin-top:8px;resize:vertical;font-weight:400;min-height:80px}.reviewer{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:24px 28px;margin-top:32px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:28px;align-items:center}.reviewer label{font-size:.9rem}.reviewer input[type=text]{margin-top:7px}.attestation{display:flex;gap:10px;align-items:flex-start}.attestation input{margin-top:5px}.receipt{position:sticky;bottom:0;background:var(--ink);color:var(--paper);padding:18px max(28px,calc((100vw - 1064px)/2));display:flex;align-items:center;gap:28px;box-shadow:0 -3px 15px #14263d12}.receipt-text{flex:1;min-width:0}.receipt strong{font-size:.94rem;font-weight:600}.receipt .export-note{color:var(--paper);opacity:.85;font-size:.79rem;margin:4px 0 0}.receipt a{color:var(--paper);text-underline-offset:3px;font-size:.79rem}.receipt progress{display:block;width:100%;max-width:310px;height:4px;accent-color:var(--paper);margin-top:10px}.download{background:var(--paper);color:var(--ink);padding:12px 18px;min-height:46px;border-radius:7px;font-weight:650;white-space:nowrap;font-size:.87rem}.download:disabled{opacity:.5}.save-status{min-height:1.5em;margin:14px 0 0}.attestation-hint{font-size:.83rem;color:var(--accent);margin:14px 0 0}p,li,h1,h2,label,span,small{overflow-wrap:anywhere}[hidden]{display:none!important}@media(max-width:680px){.shell{padding:28px 16px 20px}.intro{margin-bottom:24px}.case-header,.version,.decision,.reviewer{padding:20px}.brief{padding:20px;grid-template-columns:1fr;gap:20px}.versions{grid-template-columns:1fr}.version+.version{border-left:0;border-top:1px solid var(--line)}.criterion-options{grid-template-columns:1fr}.item-status{float:none;display:block;padding:0;margin:-6px 0 14px}.preference-options{display:grid;grid-template-columns:1fr 1fr}.choice{padding:10px;font-size:.84rem;gap:7px}.reviewer{grid-template-columns:1fr;gap:20px}.receipt{padding:14px 16px;gap:14px;align-items:stretch;flex-direction:column}.receipt progress{display:none}.download{width:100%}.receipt .export-note{font-size:.75rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}@media print{.receipt,.decision,.reviewer,.save-status,.attestation-hint{display:none}.shell{padding:0}.comparison{break-inside:avoid}.version{padding:16px}}
</style></head><body><main class="shell"><header class="intro"><p class="eyebrow">NextResume · Independent review</p><h1>${html(packet.title)}</h1><p>Read the role and known facts, then compare both versions as complete resume entries. Choose the one that makes a stronger, credible case for the role. A and B carry no quality ranking.</p></header>${cards}<section class="reviewer" aria-label="Reviewer details"><label for="reviewer">Your name or reviewer code<input type="text" id="reviewer" maxlength="80" required autocomplete="off" placeholder="e.g. reviewer-river" aria-describedby="reviewer-help"><span class="help" id="reviewer-help">Use a code that distinguishes your review. No real name required.</span></label><label class="attestation"><input id="attestation" type="checkbox"> <span>I reviewed these comparisons myself</span></label></section><p class="attestation-hint" id="attestation-hint" hidden>Confirm that you reviewed the comparisons to enable download.</p><p id="save-status" class="save-status" role="status" aria-live="polite">Choices stay in this browser. Download the JSON to share your review.</p></main><footer class="receipt" aria-label="Review progress and download"><div class="receipt-text"><strong id="review-progress" aria-live="polite">0 of ${packet.items.length} comparisons reviewed</strong><progress id="progress-meter" max="${Math.max(1, packet.items.length)}" value="0" aria-label="Comparisons reviewed"></progress><p class="export-note" id="export-note">Choose a preference to start your review.</p><a id="readiness-link" href="#reviewer" hidden>Add a reviewer code to enable download.</a></div><button id="download-review" class="download" type="button" disabled>Download review JSON</button></footer><script id="review-packet" type="application/json">${serialized}</script><script>(${reviewApp.toString()})();</script></body></html>`;
}
