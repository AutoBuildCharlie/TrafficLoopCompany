// ================================================================
//  DATA SHAPE REFERENCE
// ================================================================
// localStorage keys:
//
// tlc_messages    → [{ id, sender, text, time }]
// tlc_parsed      → [{ msgId, worker, date, hours, jobSite, region, raw, status: "clean"|"flagged", confidence, flagReason? }]
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
  // Foreman crew texts — multiple workers in one message
  { id: 1,  sender: 'Rick Salazar (Foreman)',  text: 'Anaheim loop install today — Luis 8, Jose 7.5, Mario 8, Mike 8.5',                     time: '3:45 PM' },
  { id: 2,  sender: 'Rick Salazar (Foreman)',  text: 'Santa Ana ped heads crew: Carlos 8hrs, Ray 9hrs, Paul 8hrs',                            time: '3:52 PM' },
  { id: 3,  sender: 'Dave Torres (Foreman)',   text: 'San Diego signal repair — David 10, Danny 9.5, Tony 7. Danny worked a half day friday too forgot to report that', time: '4:10 PM' },
  { id: 4,  sender: 'Dave Torres (Foreman)',   text: 'Oceanside ped heads monday — Tony 7hrs, Jesse 6hrs',                                    time: '4:15 PM' },
  { id: 5,  sender: 'Rick Salazar (Foreman)',  text: 'Sacramento loop replacement yesterday — Carlos 8, Ray 9, Paul 8',                       time: '4:30 PM' },
  { id: 6,  sender: 'Rick Salazar (Foreman)',  text: 'SF traffic signal upgrade — Ray did 9 hours today',                                     time: '4:45 PM' },

  // Individual worker texts — messy, casual
  { id: 7,  sender: 'Mario Delgado',           text: 'hey forgot yesterday. worked all day at the bakersfield site',                           time: '6:10 PM' },
  { id: 8,  sender: 'Unknown Number',          text: '8 hours yesterday',                                                                      time: '7:01 PM' },
  { id: 9,  sender: 'Jesse Ruiz',              text: 'hey i also did 6 hrs on the LA freeway job tuesday call me',                             time: '7:40 PM' },
  { id: 10, sender: 'Mike Alvarez',            text: 'late entry — 8 and a half hours LA loop detection on wednesday',                         time: '8:15 PM' },
];

// Region mapping by job site keywords
const REGION_MAP = {
  norcal: ['sacramento', 'sf', 'san francisco', 'oakland', 'fresno', 'bakersfield', 'stockton', 'san jose'],
  socal: ['anaheim', 'santa ana', 'la', 'los angeles', 'irvine', 'long beach', 'pasadena', 'riverside', 'ontario', 'freeway'],
  sandiego: ['san diego', 'oceanside', 'chula vista', 'escondido', 'carlsbad'],
};

// ================================================================
//  STATE
// ================================================================
let messages = [];
let parsed = [];
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

    // Show how many workers were extracted from this message
    const countTag = parsedRows.length > 1 ? `<span class="extract-count">${parsedRows.length} workers extracted</span>` : '';

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
- jobSite: the job site or project name. Use the city + job description from the message.
- confidence: "high" if all 4 fields are clear, "low" if you had to guess on any field

Respond with JSON: {"entries": [...]}
Each entry: {"msgId":1,"worker":"...","date":"YYYY-MM-DD","hours":0,"jobSite":"...","confidence":"high|low"}

If a message is truly unparseable (no hours info at all), return:
{"msgId":1,"worker":"...","date":"","hours":0,"jobSite":"","confidence":"none"}`;

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
    showToast('Retrying without JSON mode...');
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
//  CALL GROQ — send all messages in one batch
// ================================================================
async function callGroq(useJsonMode) {
  const batch = messages.map(m => `[ID:${m.id}] From: ${m.sender} — "${m.text}"`).join('\n');

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: PARSE_SYSTEM_PROMPT + (useJsonMode ? '' : '\n\nIMPORTANT: Respond with ONLY valid JSON. No extra text.') },
      { role: 'user', content: `Parse these ${messages.length} text messages. Remember: one message can have MULTIPLE workers — return a separate entry for each worker.\n\n${batch}` }
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

  // Parse response — handle {entries: [...]}, bare array, or other wrapper keys
  let entries;
  try {
    const j = JSON.parse(raw);
    entries = Array.isArray(j) ? j : (j.entries || j.results || j.data || Object.values(j)[0]);
    if (!Array.isArray(entries)) throw new Error('Not an array');
  } catch (e) {
    // Try extracting array from text
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

  aiEntries.forEach(ai => {
    const msg = messages.find(m => m.id === ai.msgId);
    const rawText = msg ? msg.text : '';
    const sender = msg ? msg.sender : 'Unknown';

    if (!ai || ai.confidence === 'none' || !ai.hours) {
      results.push({
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
      const region = detectRegion(jobSite);
      const isFlagged = ai.confidence === 'low';

      results.push({
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
//  FINISH PROCESSING — save, render, toast
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
//  REGION DETECTION
// ================================================================
function detectRegion(jobSite) {
  const lower = (jobSite || '').toLowerCase();
  for (const [region, keywords] of Object.entries(REGION_MAP)) {
    if (keywords.some(kw => lower.includes(kw))) return region;
  }
  return 'socal'; // default for demo
}

// ================================================================
//  RENDER: PARSED RESULTS
// ================================================================
function renderParsed() {
  const clean = parsed.filter(p => p.status === 'clean');
  const flagged = parsed.filter(p => p.status === 'flagged');

  $('stat-clean').textContent = clean.length + ' clean';
  $('stat-flagged').textContent = flagged.length + ' flagged';
  $('empty-state').style.display = parsed.length ? 'none' : 'block';

  // Clean table
  const cleanSection = $('clean-section');
  cleanSection.style.display = clean.length ? 'block' : 'none';
  const tbody = $('clean-tbody');
  tbody.innerHTML = '';
  clean.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(row.worker)}</strong></td>
      <td>${row.date}</td>
      <td>${row.hours}</td>
      <td>${escapeHtml(row.jobSite)}</td>
      <td><span class="region-tag ${row.region}">${regionLabel(row.region)}</span></td>
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
    card.innerHTML = `
      <div class="flag-raw">"${escapeHtml(row.raw)}"</div>
      <div class="flag-reason">⚠️ ${escapeHtml(row.flagReason)} — from ${escapeHtml(row.worker)}</div>
      ${row.hours ? `<div style="margin-top:6px;font-size:12px;color:#c8cdd8;">AI's best guess: ${row.hours}hrs, ${escapeHtml(row.jobSite || 'no site')}, ${row.date || 'no date'}</div>` : ''}
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
      <td><strong>${escapeHtml(row.worker)}</strong></td>
      <td>${row.date || '—'}</td>
      <td>${row.hours || '—'}</td>
      <td>${escapeHtml(row.jobSite) || '—'}</td>
      <td><span class="region-tag ${row.region}">${regionLabel(row.region)}</span></td>
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
          <span style="font-size:12px;color:#8892a8;">${rows.length} worker${rows.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="text-align:right;">
          <div class="hours-total">${totalHours}</div>
          <div class="hours-label">total hours</div>
        </div>
      </div>
      <div class="region-card-body">
        ${rows.length ? `
          <table>
            <thead><tr><th>Worker</th><th>Date</th><th>Hours</th><th>Job Site</th></tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td><strong>${escapeHtml(r.worker)}</strong></td>
                  <td>${r.date}</td>
                  <td>${r.hours}</td>
                  <td>${escapeHtml(r.jobSite)}</td>
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
  showToast('Demo reset');
}

// ================================================================
//  HELPERS
// ================================================================
function regionLabel(key) {
  const labels = { norcal: 'NorCal', socal: 'SoCal', sandiego: 'San Diego', unknown: 'Unknown' };
  return labels[key] || key;
}
