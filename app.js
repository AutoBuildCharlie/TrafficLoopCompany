// ================================================================
//  DATA SHAPE REFERENCE
// ================================================================
// localStorage keys:
//
// tlc_messages         → [{ id, sender, text, time }]
// tlc_parsed           → [{ idx, msgId, worker, date, hours, jobSite, region, raw, status, confidence, flagReason? }]
// tlc_region_overrides → { "torrance": "socal" } — manual city→region corrections
//
// External API: Groq via Cloudflare Worker proxy
// Model: llama-3.3-70b-versatile
// ================================================================

// ================================================================
//  CONFIG
// ================================================================
const GROQ_PROXY = 'https://fittrack-proxy.aestheticcal22.workers.dev';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ================================================================
//  DEMO DATA — 15 fake workers, full week Mon-Fri (3/24-3/28)
//  3 foremen, 3 crews across NorCal / SoCal / San Diego
// ================================================================
const DEMO_MESSAGES = [
  // ── MONDAY 3/24 ──
  { id: 1,  sender: 'Rick Salazar (Foreman)',  text: 'Monday Anaheim loop install — Luis 8, Jose 8, Mario 8, Mike 8, Eddie 8',                time: '3:30 PM' },
  { id: 2,  sender: 'Dave Torres (Foreman)',   text: 'San Diego signal repair monday — David 9, Danny 8, Tony 8, Jesse 8',                    time: '3:45 PM' },
  { id: 3,  sender: 'Frank Molina (Foreman)',  text: 'Sacramento loop replacement mon: Carlos 8, Ray 8, Paul 8, Alex 8, Victor 8',            time: '4:00 PM' },

  // ── TUESDAY 3/25 ──
  { id: 4,  sender: 'Rick Salazar (Foreman)',  text: 'tuesday Santa Ana ped heads — Luis 8, Jose 7.5, Mario 8, Mike 9, Eddie 8',              time: '3:35 PM' },
  { id: 5,  sender: 'Dave Torres (Foreman)',   text: 'Oceanside ped heads tue — David 8, Danny 9, Tony 8.5, Jesse 8',                         time: '3:50 PM' },
  { id: 6,  sender: 'Frank Molina (Foreman)',  text: 'SF traffic signal upgrade tuesday Carlos 9 Ray 9 Paul 8 Alex 8.5 Victor 8',             time: '4:10 PM' },

  // ── WEDNESDAY 3/26 ──
  { id: 7,  sender: 'Rick Salazar (Foreman)',  text: 'wed LA loop detection crew: Luis 8, Jose 8, Mario 9, Mike 8, Eddie 7.5',                time: '3:40 PM' },
  { id: 8,  sender: 'Dave Torres (Foreman)',   text: 'wednesday San Diego signal maint — David 10, Danny 8, Tony 9, Jesse 8.5',               time: '3:55 PM' },
  { id: 9,  sender: 'Frank Molina (Foreman)',  text: 'Bakersfield loop install wed: Carlos 8 Ray 8.5 Paul 9 Alex 8 Victor 8',                 time: '4:15 PM' },

  // ── THURSDAY 3/27 ──
  { id: 10, sender: 'Rick Salazar (Foreman)',  text: 'Anaheim signal upgrade thursday — Luis 9, Jose 8, Mario 8, Mike 8.5, Eddie 8',          time: '3:30 PM' },
  { id: 11, sender: 'Dave Torres (Foreman)',   text: 'thurs Chula Vista ped heads David 8 Danny 9.5 Tony 8 Jesse 9',                          time: '3:45 PM' },
  { id: 12, sender: 'Frank Molina (Foreman)',  text: 'Sacramento loop repair thursday — Carlos 8, Ray 9, Paul 8, Alex 9, Victor 8.5',         time: '4:05 PM' },

  // ── FRIDAY 3/28 ──
  { id: 13, sender: 'Rick Salazar (Foreman)',  text: 'friday Irvine loop install Luis 8 Jose 8 Mario 7.5 Mike 8 Eddie 8',                     time: '3:25 PM' },
  { id: 14, sender: 'Dave Torres (Foreman)',   text: 'San Diego signal repair fri — David 8, Danny 8, Tony 7, Jesse 6. Jesse left early',     time: '3:40 PM' },
  { id: 15, sender: 'Frank Molina (Foreman)',  text: 'friday SF traffic signal — Carlos 8 Ray 8 Paul 8 Alex 8 Victor 8',                      time: '3:55 PM' },

  // ── LATE / MESSY INDIVIDUAL TEXTS ──
  { id: 16, sender: 'Mario Delgado',           text: 'hey forgot to tell rick i stayed an extra hour wednesday at the LA job',                  time: '6:10 PM' },
  { id: 17, sender: 'Unknown Number',          text: '8 hours yesterday',                                                                      time: '7:01 PM' },
  { id: 18, sender: 'Danny Flores',            text: 'late entry i also worked a half day last monday at the oceanside site forgot to tell dave',time: '8:15 PM' },
];

// ================================================================
//  STATE
// ================================================================
let messages = [];
let parsed = [];
let regionOverrides = {};
let isProcessing = false;
let nextIdx = 0;

// ================================================================
//  INIT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderMessages();
  renderParsed();
  updateStatsBar();
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
      if (btn.dataset.tab === 'summary') renderSummary();
      if (btn.dataset.tab === 'regions') renderRegionCards();
    });
  });
}

function updateTabBadges() {
  const flagged = parsed.filter(p => p.status === 'flagged').length;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const existing = btn.querySelector('.tab-badge');
    if (existing) existing.remove();
    if (btn.dataset.tab === 'intake' && flagged > 0) {
      btn.insertAdjacentHTML('beforeend', `<span class="tab-badge">${flagged}</span>`);
    }
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
  $('btn-add-manual').addEventListener('click', openManualEntry);

  $('search-hours').addEventListener('input', debounce(() => renderHoursSheet($('search-hours').value), 200));
  $('summary-period').addEventListener('change', renderSummary);
  $('summary-view').addEventListener('change', renderSummary);
  $('region-period').addEventListener('change', renderRegionCards);
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
  if (!parsed) parsed = [];

  // Set nextIdx higher than any existing
  nextIdx = parsed.length ? Math.max(...parsed.map(p => p.idx)) + 1 : 0;
}

function saveState() {
  storageSet('tlc_messages', messages);
  storageSet('tlc_parsed', parsed);
  storageSet('tlc_region_overrides', regionOverrides);
}

// ================================================================
//  STATS BAR
// ================================================================
function updateStatsBar() {
  const bar = $('stats-bar');
  if (!parsed.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  const clean = parsed.filter(p => p.status === 'clean');
  const flagged = parsed.filter(p => p.status === 'flagged');
  const totalHours = clean.reduce((s, r) => s + r.hours, 0);
  const workers = new Set(clean.map(r => r.worker)).size;
  const projects = new Set(clean.map(r => r.jobSite)).size;

  $('sb-entries').textContent = parsed.length;
  $('sb-hours').textContent = totalHours;
  $('sb-workers').textContent = workers;
  $('sb-projects').textContent = projects;

  const flagCard = $('sb-flagged-card');
  if (flagged.length) {
    flagCard.style.display = '';
    $('sb-flagged').textContent = flagged.length;
  } else {
    flagCard.style.display = 'none';
  }

  updateTabBadges();
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
//  AI SYSTEM PROMPT
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

async function callGroq(useJsonMode) {
  const batch = messages.map(m => `[ID:${m.id}] From: ${m.sender} — "${m.text}"`).join('\n');

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: PARSE_SYSTEM_PROMPT + (useJsonMode ? '' : '\n\nRespond with ONLY valid JSON. No extra text.') },
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

function buildResults(aiEntries) {
  const results = [];
  aiEntries.forEach(ai => {
    const msg = messages.find(m => m.id === ai.msgId);
    const rawText = msg ? msg.text : '';
    const sender = msg ? msg.sender : 'Unknown';

    if (!ai || ai.confidence === 'none' || !ai.hours) {
      results.push({
        idx: nextIdx++, msgId: ai.msgId, worker: ai?.worker || sender,
        date: '', hours: 0, jobSite: '', region: 'unknown', raw: rawText,
        status: 'flagged', confidence: 'none',
        flagReason: 'Couldn\'t extract hours — needs manual entry',
      });
    } else {
      const jobSite = ai.jobSite || 'Not specified';
      let region = ai.region || 'unknown';
      const cityKey = extractCity(jobSite);
      if (cityKey && regionOverrides[cityKey]) region = regionOverrides[cityKey];
      const isFlagged = ai.confidence === 'low';

      results.push({
        idx: nextIdx++, msgId: ai.msgId, worker: ai.worker || sender,
        date: ai.date || localDateStr(), hours: parseFloat(ai.hours) || 0,
        jobSite, region, raw: rawText,
        status: isFlagged ? 'flagged' : 'clean', confidence: ai.confidence,
        flagReason: isFlagged ? 'Low confidence — please verify' : undefined,
      });
    }
  });
  return results;
}

function finishProcessing() {
  saveState();
  renderMessages();
  renderParsed();
  updateStatsBar();
  const clean = parsed.filter(p => p.status === 'clean').length;
  const flagged = parsed.filter(p => p.status === 'flagged').length;
  showToast(`${parsed.length} entries from ${messages.length} texts — ${clean} clean, ${flagged} need review`);
}

// ================================================================
//  EXTRACT CITY
// ================================================================
function extractCity(jobSite) {
  if (!jobSite) return '';
  const lower = jobSite.toLowerCase().trim();
  const twoWord = lower.match(/^(san diego|san francisco|san jose|santa ana|los angeles|long beach|chula vista|el cajon)/);
  if (twoWord) return twoWord[1];
  const oneWord = lower.match(/^([a-z]+)/);
  return oneWord ? oneWord[1] : '';
}

// ================================================================
//  CHANGE REGION
// ================================================================
function changeRegion(idx, currentRegion) {
  const regions = ['norcal', 'socal', 'sandiego'];
  const labels = { norcal: 'NorCal', socal: 'SoCal', sandiego: 'San Diego' };
  const newRegion = regions[(regions.indexOf(currentRegion) + 1) % regions.length];

  const row = parsed.find(p => p.idx === idx);
  if (!row) return;

  const cityKey = extractCity(row.jobSite);
  if (cityKey) {
    regionOverrides[cityKey] = newRegion;
    parsed.forEach(p => {
      if (extractCity(p.jobSite) === cityKey) p.region = newRegion;
    });
  } else {
    row.region = newRegion;
  }

  saveState();
  renderAll();
  showToast(`${cityKey ? cityKey.charAt(0).toUpperCase() + cityKey.slice(1) : 'Entry'} → ${labels[newRegion]}`);
}

// ================================================================
//  APPROVE / EDIT / DELETE
// ================================================================
function approveRow(idx) {
  const row = parsed.find(p => p.idx === idx);
  if (!row) return;
  row.status = 'clean';
  row.flagReason = undefined;
  saveState(); renderAll();
  showToast(`${row.worker} approved`);
}

function saveEdit(idx) {
  const row = parsed.find(p => p.idx === idx);
  if (!row) return;
  const card = document.querySelector(`[data-idx="${idx}"]`);
  if (!card) return;

  row.worker = card.querySelector('.edit-worker').value || row.worker;
  row.date = card.querySelector('.edit-date').value || row.date;
  row.hours = parseFloat(card.querySelector('.edit-hours').value) || row.hours;
  row.jobSite = card.querySelector('.edit-site').value || row.jobSite;

  const cityKey = extractCity(row.jobSite);
  if (cityKey && regionOverrides[cityKey]) row.region = regionOverrides[cityKey];

  row.status = 'clean';
  row.flagReason = undefined;
  saveState(); renderAll();
  showToast(`${row.worker} updated and approved`);
}

function deleteRow(idx) {
  const row = parsed.find(p => p.idx === idx);
  if (!row) return;
  const name = row.worker;
  parsed = parsed.filter(p => p.idx !== idx);
  saveState(); renderAll();
  showToast(`${name} removed`);
}

// ================================================================
//  INLINE CELL EDITING
// ================================================================
function editCell(el, idx, field) {
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
    let val = input.value.trim();
    if (field === 'hours') val = parseFloat(val) || oldValue;
    row[field] = val;
    if (field === 'jobSite') {
      const ck = extractCity(val);
      if (ck && regionOverrides[ck]) row.region = regionOverrides[ck];
    }
    saveState(); renderAll();
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { el.textContent = oldValue; }
  });
}

// ================================================================
//  MANUAL ENTRY
// ================================================================
function openManualEntry() {
  $('manual-date').value = localDateStr();
  $('manual-worker').value = '';
  $('manual-hours').value = '';
  $('manual-site').value = '';
  $('modal-add').style.display = 'flex';
  $('manual-worker').focus();
}

function closeModal() {
  $('modal-add').style.display = 'none';
}

function submitManualEntry() {
  const worker = $('manual-worker').value.trim();
  const date = $('manual-date').value;
  const hours = parseFloat($('manual-hours').value);
  const jobSite = $('manual-site').value.trim();
  const region = $('manual-region').value;

  if (!worker || !hours) { showToast('Need at least a name and hours'); return; }

  parsed.push({
    idx: nextIdx++, msgId: null, worker, date: date || localDateStr(),
    hours, jobSite: jobSite || 'Not specified', region,
    raw: '(manual entry)', status: 'clean', confidence: 'manual',
  });

  saveState(); renderAll(); closeModal();
  showToast(`${worker} — ${hours}hrs added`);
}

// ================================================================
//  RENDER ALL — convenience to refresh everything
// ================================================================
function renderAll() {
  renderParsed();
  updateStatsBar();
  // Only re-render active tab's heavy content
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'hours') renderHoursSheet($('search-hours')?.value || '');
  if (activeTab === 'summary') renderSummary();
  if (activeTab === 'regions') renderRegionCards();
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

  // Clean table
  $('clean-section').style.display = clean.length ? 'block' : 'none';
  const tbody = $('clean-tbody');
  tbody.innerHTML = '';
  clean.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="editable" onclick="editCell(this,${row.idx},'worker')">${escapeHtml(row.worker)}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'date')">${row.date}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'hours')">${row.hours}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'jobSite')">${escapeHtml(row.jobSite)}</span></td>
      <td><span class="region-tag ${row.region} clickable" onclick="changeRegion(${row.idx},'${row.region}')">${regionLabel(row.region)}</span></td>
      <td><button class="btn-delete" onclick="deleteRow(${row.idx})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Flagged
  $('flagged-section').style.display = flagged.length ? 'block' : 'none';
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
        <button class="btn-delete" onclick="deleteRow(${row.idx})">✕</button>
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

  if (!parsed.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  const lower = (filter || '').toLowerCase();
  const filtered = lower
    ? parsed.filter(r => r.worker.toLowerCase().includes(lower) || r.jobSite.toLowerCase().includes(lower) || r.region.includes(lower) || r.raw.toLowerCase().includes(lower))
    : parsed;

  tbody.innerHTML = '';
  filtered.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="editable" onclick="editCell(this,${row.idx},'worker')">${escapeHtml(row.worker)}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'date')">${row.date || '—'}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'hours')">${row.hours || '—'}</span></td>
      <td><span class="editable" onclick="editCell(this,${row.idx},'jobSite')">${escapeHtml(row.jobSite) || '—'}</span></td>
      <td><span class="region-tag ${row.region} clickable" onclick="changeRegion(${row.idx},'${row.region}')">${regionLabel(row.region)}</span></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8892a8;font-size:12px;">${escapeHtml(row.raw)}</td>
      <td><span class="status-tag ${row.status}">${row.status === 'clean' ? '✅' : '⚠️'}</span></td>
      <td><button class="btn-delete" onclick="deleteRow(${row.idx})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// ================================================================
//  RENDER: SUMMARY (TAB 3)
// ================================================================
function renderSummary() {
  const period = $('summary-period').value;
  const view = $('summary-view').value;
  const clean = filterByPeriod(parsed.filter(p => p.status === 'clean'), period);
  const totalsDiv = $('summary-totals');
  const tableWrap = $('summary-table-wrap');
  const empty = $('summary-empty');

  if (!clean.length) {
    totalsDiv.innerHTML = '';
    tableWrap.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  tableWrap.style.display = '';

  const totalHours = clean.reduce((s, r) => s + r.hours, 0);
  const uniqueWorkers = new Set(clean.map(r => r.worker)).size;
  const uniqueSites = new Set(clean.map(r => r.jobSite)).size;

  totalsDiv.innerHTML = `
    <div class="summary-total-card"><span class="stc-num">${totalHours}</span><span class="stc-label">Total Hours</span></div>
    <div class="summary-total-card"><span class="stc-num">${clean.length}</span><span class="stc-label">Entries</span></div>
    <div class="summary-total-card"><span class="stc-num">${uniqueWorkers}</span><span class="stc-label">Workers</span></div>
    <div class="summary-total-card"><span class="stc-num">${uniqueSites}</span><span class="stc-label">Job Sites</span></div>
  `;

  const thead = $('summary-thead');
  const tbody = $('summary-tbody');

  if (view === 'worker') {
    thead.innerHTML = '<tr><th>Worker</th><th>Entries</th><th>Total Hours</th><th>Avg Hours/Day</th><th>Job Sites</th><th>Regions</th></tr>';
    const grouped = groupBy(clean, 'worker');
    const rows = Object.entries(grouped).sort((a, b) => sum(b[1]) - sum(a[1]));
    tbody.innerHTML = '';
    rows.forEach(([worker, entries]) => {
      const total = sum(entries);
      const sites = [...new Set(entries.map(e => e.jobSite))];
      const regions = [...new Set(entries.map(e => e.region))];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(worker)}</strong></td>
        <td>${entries.length}</td>
        <td><strong>${total}</strong></td>
        <td>${(total / entries.length).toFixed(1)}</td>
        <td style="font-size:12px;color:#8892a8;">${sites.map(s => escapeHtml(s)).join(', ')}</td>
        <td>${regions.map(r => `<span class="region-tag ${r}" style="font-size:10px;">${regionLabel(r)}</span>`).join(' ')}</td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    thead.innerHTML = '<tr><th>Job Site</th><th>Entries</th><th>Total Hours</th><th>Workers</th><th>Region</th></tr>';
    const grouped = groupBy(clean, 'jobSite');
    const rows = Object.entries(grouped).sort((a, b) => sum(b[1]) - sum(a[1]));
    tbody.innerHTML = '';
    rows.forEach(([site, entries]) => {
      const total = sum(entries);
      const workers = [...new Set(entries.map(e => e.worker))];
      const region = entries[0]?.region || 'unknown';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(site)}</strong></td>
        <td>${entries.length}</td>
        <td><strong>${total}</strong></td>
        <td style="font-size:12px;color:#8892a8;">${workers.map(w => escapeHtml(w)).join(', ')}</td>
        <td><span class="region-tag ${region}">${regionLabel(region)}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// ================================================================
//  RENDER: REGION CARDS (TAB 4)
// ================================================================
function renderRegionCards() {
  const period = $('region-period').value;
  const container = $('region-cards');
  const empty = $('regions-empty');
  const clean = filterByPeriod(parsed.filter(p => p.status === 'clean'), period);

  if (!clean.length) { container.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  const regions = [
    { key: 'norcal',   label: 'Northern California', color: 'norcal' },
    { key: 'socal',    label: 'Southern California',  color: 'socal' },
    { key: 'sandiego', label: 'San Diego',            color: 'sandiego' },
  ];

  container.innerHTML = '';
  regions.forEach(region => {
    const rows = clean.filter(r => r.region === region.key);
    const totalHours = rows.reduce((s, r) => s + r.hours, 0);
    const workers = [...new Set(rows.map(r => r.worker))];

    const card = document.createElement('div');
    card.className = 'region-card';
    card.innerHTML = `
      <div class="region-card-header ${region.color}">
        <div>
          <h3>${region.label}</h3>
          <span style="font-size:12px;color:#8892a8;">${workers.length} worker${workers.length !== 1 ? 's' : ''} · ${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'}</span>
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
                  <td><span class="region-tag ${r.region} clickable" onclick="changeRegion(${r.idx},'${r.region}')" title="Click to move region">✎</span></td>
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
//  PERIOD FILTER
// ================================================================
function filterByPeriod(rows, period) {
  if (period === 'all') return rows;
  const now = new Date();
  if (period === 'week') {
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const start = localDateStr(monday);
    return rows.filter(r => r.date >= start);
  }
  if (period === 'month') {
    const start = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    return rows.filter(r => r.date >= start);
  }
  return rows;
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
  if (!parsed.filter(p => p.status === 'clean').length) { showToast('No clean hours to export'); return; }
  exportCSV();
}

// ================================================================
//  RESET
// ================================================================
function resetDemo() {
  storageRemove('tlc_messages');
  storageRemove('tlc_parsed');
  messages = [...DEMO_MESSAGES];
  parsed = [];
  nextIdx = 0;
  storageSet('tlc_messages', messages);
  renderMessages();
  renderAll();
  showToast('Demo reset — region corrections kept');
}

// ================================================================
//  HELPERS
// ================================================================
function regionLabel(key) {
  return { norcal: 'NorCal', socal: 'SoCal', sandiego: 'San Diego', unknown: 'Unknown' }[key] || key;
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'Unknown';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

function sum(entries) {
  return entries.reduce((s, e) => s + e.hours, 0);
}
