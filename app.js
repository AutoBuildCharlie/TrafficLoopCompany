// ================================================================
//  DATA SHAPE REFERENCE
// ================================================================
// localStorage keys:
//
// tlc_messages        → [{ id, sender, text, time }]
// tlc_parsed          → [{ msgId, worker, date, hours, jobSite, region, raw, status, confidence, flagReason? }]
// tlc_region_overrides → { "torrance": "socal", "temecula": "socal" } — aunt's manual corrections
//
// External API: Groq via Cloudflare Worker proxy (fittrack-proxy.aestheticcal22.workers.dev)
// Model: llama-3.3-70b-versatile
// ================================================================

// ================================================================
//  CONFIG
// ================================================================
const GROQ_PROXY = 'https://fittrack-proxy.aestheticcal22.workers.dev';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ================================================================
//  DEMO DATA — realistic foreman crew texts + individual worker texts
// ================================================================
const DEMO_MESSAGES = [
  { id: 1,  sender: 'Rick Salazar (Foreman)',  text: 'Anaheim loop install today — Luis 8, Jose 7.5, Mario 8, Mike 8.5',                     time: '3:45 PM' },
  { id: 2,  sender: 'Rick Salazar (Foreman)',  text: 'Santa Ana ped heads crew: Carlos 8hrs, Ray 9hrs, Paul 8hrs',                            time: '3:52 PM' },
  { id: 3,  sender: 'Dave Torres (Foreman)',   text: 'San Diego signal repair — David 10, Danny 9.5, Tony 7. Danny worked a half day friday too forgot to report that', time: '4:10 PM' },
  { id: 4,  sender: 'Dave Torres (Foreman)',   text: 'Oceanside ped heads monday — Tony 7hrs, Jesse 6hrs',                                    time: '4:15 PM' },
  { id: 5,  sender: 'Rick Salazar (Foreman)',  text: 'Sacramento loop replacement yesterday — Carlos 8, Ray 9, Paul 8',                       time: '4:30 PM' },
  { id: 6,  sender: 'Rick Salazar (Foreman)',  text: 'SF traffic signal upgrade — Ray did 9 hours today',                                     time: '4:45 PM' },
  { id: 7,  sender: 'Mario Delgado',           text: 'hey forgot yesterday. worked all day at the bakersfield site',                           time: '6:10 PM' },
  { id: 8,  sender: 'Unknown Number',          text: '8 hours yesterday',                                                                      time: '7:01 PM' },
  { id: 9,  sender: 'Jesse Ruiz',              text: 'hey i also did 6 hrs on the LA freeway job tuesday call me',                             time: '7:40 PM' },
  { id: 10, sender: 'Mike Alvarez',            text: 'late entry — 8 and a half hours LA loop detection on wednesday',                         time: '8:15 PM' },
];

// ================================================================
//  STATE
// ================================================================
let messages = [];
let parsed = [];
let regionOverrides = {};
let isProcessing = false;

// ================================================================
//  INIT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderMessages();
  renderParsed();
  setupTabs();
  setupButtons();
});

// ================================================================
//  TABS
// ================================================================
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'hours') renderHoursSheet();
      if (btn.dataset.tab === 'regions') renderRegionCards();
    });
  });
}

// ================================================================
//  BUTTONS
// ================================================================
function setupButtons() {
  $('btn-process').addEventListener('click', processMessages);
  $('btn-reset-texts').addEventListener('click', resetDemo);
  $('btn-export-csv').addEventListener('click', exportCSV);
  $('btn-export-regions').addEventListener('click', exportRegions);

  const searchInput = $('search-hours');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => renderHoursSheet(searchInput.value), 200));
  }
}

// ================================================================
//  STATE MANAGEMENT
// ================================================================
function loadState() {
  messages = storageGet('tlc_messages', null);
  parsed = storageGet('tlc_parsed', null);
  regionOverrides = storageGet('tlc_region_overrides', {});

  if (!messages) {
    messages = [...DEMO_MESSAGES];
    storageSet('tlc_messages', messages);
  }
  if (!parsed) {
    parsed = [];
  }
}

function saveState() {
  storageSet('tlc_messages', messages);
  storageSet('tlc_parsed', parsed);
  storageSet('tlc_region_overrides', regionOverrides);
}

// ================================================================
//  RENDER: PHONE MESSAGES
// ================================================================
function renderMessages() {
  const container = $('phone-messages');
  container.innerHTML = '';

  messages.forEach(msg => {
    const bubble = document.createElement('div');
    const parsedRows = parsed.filter(p => p.msgId === msg.id);
    const hasClean = parsedRows.some(p => p.status === 'clean');
    const hasFlagged = parsedRows.some(p => p.status === 'flagged');
    const statusClass = parsedRows.length ? (hasFlagged && !hasClean ? 'messy' : 'clean') : '';
    bubble.className = 'text-bubble ' + statusClass;
    if (parsedRows.length) bubble.classList.add('parsed');

    const countTag = parsedRows.length > 1 ? `<span class="extract-count">${parsedRows.length} entries extracted</span>` : '';

    bubble.innerHTML = `
      <div class="sender">${escapeHtml(msg.sender)}</div>
      <div>${escapeHtml(msg.text)}</div>
      <div class="time">${msg.time} ${countTag}</div>
    `;
    container.appendChild(bubble);
  });

  $('msg-count').textContent = messages.length + ' messages';
  container.scrollTop = container.scrollHeight;
}

// ================================================================
//  AI SYSTEM PROMPT — AI now handles region detection too
// ================================================================
const PARSE_SYSTEM_PROMPT = `You are a text message parser for a traffic loop and electrical construction company in California. Foremen and workers text in hours in casual, messy language. Your job is to extract structured data from each message.

Today's date is ${localDateStr()}.

IMPORTANT: A single message can contain MULTIPLE workers. Foremen often send crew texts like "Anaheim loop install — Luis 8, Jose 7.5, Mario 8". You must return a SEPARATE entry for EACH worker mentioned.

A single message might also mention multiple days for the same worker (e.g. "Danny worked friday too"). Return separate entries for each day.

For EACH worker entry, extract:
- msgId: the message ID number from the [ID:X] tag
- worker: the worker's full name if known, first name if that's all you have. Use sender name ONLY if the message is clearly about themselves (not a foreman reporting for others)
- date: the work date in YYYY-MM-DD format. "today" = ${localDateStr()}. "yesterday" = yesterday's date. "monday", "friday" etc = most recent past occurrence. If unclear, use today.
- hours: number of hours worked (decimal). "all day" = 8. "half day" = 4. "8 and a half" = 8.5.
- jobSite: the job site or project name. Include the city and job description from the message.
- region: which California reporting region this job site is in. Use your knowledge of California geography:
  - "norcal" = Northern California (Sacramento, SF, Oakland, Bakersfield, Fresno, Stockton, San Jose, Redding, etc.)
  - "socal" = Southern California (LA, Anaheim, Santa Ana, Irvine, Long Beach, Riverside, Torrance, Pasadena, etc.)
  - "sandiego" = San Diego area (San Diego, Oceanside, Chula Vista, Escondido, Carlsbad, El Cajon, etc.)
  If the city is unclear or not mentioned, use "unknown".
- confidence: "high" if all fields are clear, "low" if you had to guess on any field

Respond with JSON: {"entries": [...]}
Each entry: {"msgId":1,"worker":"...","date":"YYYY-MM-DD","hours":0,"jobSite":"...","region":"norcal|socal|sandiego|unknown","confidence":"high|low"}

If a message is truly unparseable (no hours info at all), return:
{"msgId":1,"worker":"...","date":"","hours":0,"jobSite":"","region":"unknown","confidence":"none"}`;

// ================================================================
//  PROCESS MESSAGES WITH AI
// ================================================================
async function processMessages() {
  if (parsed.length > 0) {
    showToast('Already processed — hit Reset Demo to start over');
    return;
  }
  if (isProcessing) return;
  isProcessing = true;

  const btn = $('btn-process');
  btn.textContent = 'AI is reading messages...';
  btn.disabled = true;

  try {
    const aiEntries = await callGroq(true);
    parsed = buildResults(aiEntries);
    finishProcessing();
  } catch (err) {
    console.error('Process error:', err);
    showToast('Retrying...');
    try {
      const aiEntries = await callGroq(false);
      parsed = buildResults(aiEntries);
      finishProcessing();
    } catch (e2) {
      console.error('Fallback error:', e2);
      showToast('Could not reach AI — check connection');
    }
  } finally {
    btn.textContent = 'Process Messages';
    btn.disabled = false;
    isProcessing = false;
  }
}

// ================================================================
//  CALL GROQ
// ================================================================
async function callGroq(useJsonMode) {
  const batch = messages.map(m => `[ID:${m.id}] From: ${m.sender} — "${m.text}"`).join('\n');

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: PARSE_SYSTEM_PROMPT + (useJsonMode ? '' : '\n\nIMPORTANT: Respond with ONLY valid JSON. No extra text.') },
      { role: 'user', content: `Parse these ${messages.length} text messages. One message can have MULTIPLE workers — return a separate entry for each.\n\n${batch}` }
    ],
    max_tokens: 2500,
    temperature: 0.1,
  };
  if (useJsonMode) body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  const res = await fetch(GROQ_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: ctrl.signal,
    body: JSON.stringify(body)
  });
  clearTimeout(timeout);

  if (!res.ok) throw new Error(`API error: ${res.status}`);

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';

  let entries;
  try {
    const j = JSON.parse(raw);
    entries = Array.isArray(j) ? j : (j.entries || j.results || j.data || Object.values(j)[0]);
    if (!Array.isArray(entries)) throw new Error('Not an array');
  } catch (e) {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found');
    entries = JSON.parse(match[0]);
  }

  return entries;
}

// ================================================================
//  BUILD RESULTS — map AI entries to parsed rows
// ================================================================
function buildResults(aiEntries) {
  const results = [];

  aiEntries.forEach((ai, idx) => {
    const msg = messages.find(m => m.id === ai.msgId);
    const rawText = msg ? msg.text : '';
    const sender = msg ? msg.sender : 'Unknown';

    if (!ai || ai.confidence === 'none' || !ai.hours) {
      results.push({
        idx,
        msgId: ai.msgId,
        worker: ai?.worker || sender,
        date: '',
        hours: 0,
        jobSite: '',
        region: 'unknown',
        raw: rawText,
        status: 'flagged',
        confidence: 'none',
        flagReason: 'Couldn\'t extract hours — needs manual entry',
      });
    } else {
      const jobSite = ai.jobSite || 'Not specified';
      // Check if aunt has overridden the region for this city
      let region = ai.region || 'unknown';
      const cityKey = extractCity(jobSite);
      if (cityKey && regionOverrides[cityKey]) {
        region = regionOverrides[cityKey];
      }
      const isFlagged = ai.confidence === 'low';

      results.push({
        idx,
        msgId: ai.msgId,
        worker: ai.worker || sender,
        date: ai.date || localDateStr(),
        hours: parseFloat(ai.hours) || 0,
        jobSite,
        region,
        raw: rawText,
        status: isFlagged ? 'flagged' : 'clean',
        confidence: ai.confidence,
        flagReason: isFlagged ? 'Low confidence — please verify' : undefined,
      });
    }
  });

  return results;
}

// ================================================================
//  EXTRACT CITY from job site string (first word or known pattern)
// ================================================================
function extractCity(jobSite) {
  if (!jobSite) return '';
  // Try to grab the city — usually the first word(s) before the job description
  const lower = jobSite.toLowerCase().trim();
  // Check for two-word cities first
  const twoWord = lower.match(/^(san diego|san francisco|san jose|santa ana|los angeles|long beach|chula vista|el cajon)/);
  if (twoWord) return twoWord[1];
  // Single word city
  const oneWord = lower.match(/^([a-z]+)/);
  return oneWord ? oneWord[1] : '';
}

// ================================================================
//  CHANGE REGION — called when aunt clicks a region tag
// ================================================================
function changeRegion(idx, currentRegion) {
  const regions = ['norcal', 'socal', 'sandiego'];
  const labels = { norcal: 'NorCal', socal: 'SoCal', sandiego: 'San Diego' };
  const nextIdx = (regions.indexOf(currentRegion) + 1) % regions.length;
  const newRegion = regions[nextIdx];

  const row = parsed.find(p => p.idx === idx);
  if (!row) return;

  // Save the override so this city is always correct next time
  const cityKey = extractCity(row.jobSite);
  if (cityKey) {
    regionOverrides[cityKey] = newRegion;
  }

  // Update ALL rows with the same city
  parsed.forEach(p => {
    const pCity = extractCity(p.jobSite);
    if (pCity && pCity === cityKey) {
      p.region = newRegion;
    }
  });

  saveState();
  renderParsed();
  showToast(`${cityKey ? cityKey.charAt(0).toUpperCase() + cityKey.slice(1) : 'Entry'} → ${labels[newRegion]}. Saved for next time.`);
}

// ================================================================
//  APPROVE FLAGGED ROW — aunt reviewed it and it's good
// ================================================================
function approveRow(idx) {
  const row = parsed.find(p => p.idx === idx);
  if (!row) return;
  row.status = 'clean';
  row.flagReason = undefined;
  saveState();
  renderParsed();
  showToast(`${row.worker} approved`);
}

// ================================================================
//  EDIT FLAGGED ROW — inline edit then approve
// ================================================================
function saveEdit(idx) {
  const row = parsed.find(p => p.idx === idx);
  if (!row) return;

  const card = document.querySelector(`[data-idx="${idx}"]`);
  if (!card) return;

  row.worker = card.querySelector('.edit-worker').value || row.worker;
  row.date = card.querySelector('.edit-date').value || row.date;
  row.hours = parseFloat(card.querySelector('.edit-hours').value) || row.hours;
  row.jobSite = card.querySelector('.edit-site').value || row.jobSite;

  // Re-detect region from updated job site (or use override)
  const cityKey = extractCity(row.jobSite);
  if (cityKey && regionOverrides[cityKey]) {
    row.region = regionOverrides[cityKey];
  }

  row.status = 'clean';
  row.flagReason = undefined;
  saveState();
  renderParsed();
  showToast(`${row.worker} updated and approved`);
}

// ================================================================
//  FINISH PROCESSING
// ================================================================
function finishProcessing() {
  saveState();
  renderMessages();
  setTimeout(() => {
    renderParsed();
    const clean = parsed.filter(p => p.status === 'clean').length;
    const flagged = parsed.filter(p => p.status === 'flagged').length;
    const total = parsed.length;
    showToast(`${total} entries from ${messages.length} texts — ${clean} clean, ${flagged} need review`);
  }, 400);
}

// ================================================================
//  RENDER: PARSED RESULTS (TAB 1)
// ================================================================
function renderParsed() {
  const clean = parsed.filter(p => p.status === 'clean');
  const flagged = parsed.filter(p => p.status === 'flagged');

  $('stat-clean').textContent = clean.length + ' clean';
  $('stat-flagged').textContent = flagged.length + ' flagged';
  $('empty-state').style.display = parsed.length ? 'none' : 'block';

  // Clean table — every cell is editable
  const cleanSection = $('clean-section');
  cleanSection.style.display = clean.length ? 'block' : 'none';
  const tbody = $('clean-tbody');
  tbody.innerHTML = '';
  clean.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="editable" onclick="editCell(this,${row.idx},'worker')">${escapeHtml(row.worker)}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'date')">${row.date}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'hours')">${row.hours}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'jobSite')">${escapeHtml(row.jobSite)}</span></td>
      <td><span class="region-tag ${row.region} clickable" onclick="changeRegion(${row.idx},'${row.region}')" title="Click to change region">${regionLabel(row.region)}</span></td>
    `;
    tbody.appendChild(tr);
  });

  // Flagged list
  const flaggedSection = $('flagged-section');
  flaggedSection.style.display = flagged.length ? 'block' : 'none';
  const flagList = $('flagged-list');
  flagList.innerHTML = '';
  flagged.forEach(row => {
    const card = document.createElement('div');
    card.className = 'flagged-card';
    card.dataset.idx = row.idx;
    card.innerHTML = `
      <div class="flag-raw">"${escapeHtml(row.raw)}"</div>
      <div class="flag-reason">⚠️ ${escapeHtml(row.flagReason)} — from ${escapeHtml(row.worker)}</div>
      <div class="flag-edit-row">
        <input class="edit-input edit-worker" value="${escapeHtml(row.worker)}" placeholder="Worker name">
        <input class="edit-input edit-date" type="date" value="${row.date}">
        <input class="edit-input edit-hours" type="number" step="0.5" value="${row.hours || ''}" placeholder="Hours">
        <input class="edit-input edit-site" value="${escapeHtml(row.jobSite)}" placeholder="Job site / city">
        <button class="btn-approve" onclick="saveEdit(${row.idx})">Save & Approve</button>
        ${row.hours ? `<button class="btn-approve-small" onclick="approveRow(${row.idx})">Approve As-Is</button>` : ''}
      </div>
    `;
    flagList.appendChild(card);
  });
}

// ================================================================
//  RENDER: HOURS SHEET (TAB 2)
// ================================================================
function renderHoursSheet(filter = '') {
  const tbody = $('hours-tbody');
  const empty = $('hours-empty');

  if (!parsed.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const lower = filter.toLowerCase();
  const filtered = lower
    ? parsed.filter(r =>
        r.worker.toLowerCase().includes(lower) ||
        r.jobSite.toLowerCase().includes(lower) ||
        r.region.includes(lower) ||
        r.raw.toLowerCase().includes(lower))
    : parsed;

  tbody.innerHTML = '';
  filtered.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="editable" onclick="editCell(this,${row.idx},'worker')">${escapeHtml(row.worker)}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'date')">${row.date || '—'}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'hours')">${row.hours || '—'}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'jobSite')">${escapeHtml(row.jobSite) || '—'}</span></td>
      <td><span class="region-tag ${row.region} clickable" onclick="changeRegion(${row.idx},'${row.region}')" title="Click to change region">${regionLabel(row.region)}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8892a8;font-size:12px;">${escapeHtml(row.raw)}</td>
      <td><span class="status-tag ${row.status}">${row.status === 'clean' ? '✅ Clean' : '⚠️ Review'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ================================================================
//  RENDER: REGION CARDS (TAB 3)
// ================================================================
function renderRegionCards() {
  const container = $('region-cards');
  const empty = $('regions-empty');
  const clean = parsed.filter(p => p.status === 'clean');

  if (!clean.length) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const regions = [
    { key: 'norcal',   label: 'Northern California', color: 'norcal' },
    { key: 'socal',    label: 'Southern California',  color: 'socal' },
    { key: 'sandiego', label: 'San Diego',            color: 'sandiego' },
  ];

  container.innerHTML = '';
  regions.forEach(region => {
    const rows = clean.filter(r => r.region === region.key);
    const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);

    const card = document.createElement('div');
    card.className = 'region-card';
    card.innerHTML = `
      <div class="region-card-header ${region.color}">
        <div>
          <h3>${region.label}</h3>
          <span style="font-size:12px;color:#8892a8;">${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'}</span>
        </div>
        <div style="text-align:right;">
          <div class="hours-total">${totalHours}</div>
          <div class="hours-label">total hours</div>
        </div>
      </div>
      <div class="region-card-body">
        ${rows.length ? `
          <table>
            <thead><tr><th>Worker</th><th>Date</th><th>Hours</th><th>Job Site</th><th></th></tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td><strong>${escapeHtml(r.worker)}</strong></td>
                  <td>${r.date}</td>
                  <td>${r.hours}</td>
                  <td>${escapeHtml(r.jobSite)}</td>
                  <td><span class="region-tag ${r.region} clickable" onclick="changeRegion(${r.idx},'${r.region}')" title="Click to change region">✎</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div style="padding:20px;color:#556178;text-align:center;">No hours for this region</div>'}
      </div>
    `;
    container.appendChild(card);
  });
}

// ================================================================
//  EXPORT
// ================================================================
function exportCSV() {
  if (!parsed.length) { showToast('Nothing to export yet'); return; }
  const clean = parsed.filter(p => p.status === 'clean');
  let csv = 'Worker,Date,Hours,Job Site,Region,Status\n';
  clean.forEach(r => {
    csv += `"${r.worker}","${r.date}",${r.hours},"${r.jobSite}","${regionLabel(r.region)}","${r.status}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'traffic-loop-hours-' + localDateStr() + '.csv';
  a.click();
  showToast('CSV downloaded');
}

function exportRegions() {
  if (!parsed.filter(p => p.status === 'clean').length) {
    showToast('No clean hours to export');
    return;
  }
  exportCSV();
  showToast('Region report exported as CSV');
}

// ================================================================
//  RESET
// ================================================================
function resetDemo() {
  storageRemove('tlc_messages');
  storageRemove('tlc_parsed');
  messages = [...DEMO_MESSAGES];
  parsed = [];
  storageSet('tlc_messages', messages);
  renderMessages();
  renderParsed();
  showToast('Demo reset — region corrections kept');
}

// ================================================================
//  INLINE CELL EDITING — click any cell to edit it
// ================================================================
function editCell(el, idx, field) {
  // Don't stack inputs if already editing
  if (el.querySelector('input')) return;

  const row = parsed.find(p => p.idx === idx);
  if (!row) return;

  const oldValue = row[field] || '';
  const inputType = field === 'date' ? 'date' : field === 'hours' ? 'number' : 'text';

  const input = document.createElement('input');
  input.type = inputType;
  input.className = 'inline-edit';
  input.value = oldValue;
  if (field === 'hours') input.step = '0.5';

  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();

  function save() {
    let newValue = input.value.trim();
    if (field === 'hours') newValue = parseFloat(newValue) || oldValue;

    row[field] = newValue;

    // If they changed the job site, re-check region
    if (field === 'jobSite') {
      const cityKey = extractCity(newValue);
      if (cityKey && regionOverrides[cityKey]) {
        row.region = regionOverrides[cityKey];
      }
    }

    saveState();
    // Re-render whichever tab is active
    renderParsed();
    renderHoursSheet($('search-hours')?.value || '');
    showToast(`Updated ${row.worker}'s ${field === 'jobSite' ? 'job site' : field}`);
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { el.textContent = oldValue; }
  });
}

// ================================================================
//  HELPERS
// ================================================================
function regionLabel(key) {
  const labels = { norcal: 'NorCal', socal: 'SoCal', sandiego: 'San Diego', unknown: 'Unknown' };
  return labels[key] || key;
}
