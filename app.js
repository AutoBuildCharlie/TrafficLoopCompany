// ================================================================
//  DATA SHAPE REFERENCE
// ================================================================
// localStorage keys:
//
// tlc_messages    → [{ id, sender, text, time }]
// tlc_parsed      → [{ id, worker, date, hours, jobSite, region, raw, status: "clean"|"flagged", confidence, flagReason? }]
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
//  DEMO DATA — all natural/messy texts, no rigid format
// ================================================================
const DEMO_MESSAGES = [
  { id: 1,  sender: 'Luis Ramirez',    text: '8 hours today anaheim loop install',                   time: '6:42 AM' },
  { id: 2,  sender: 'Jose Martinez',    text: 'jose 7.5hrs santa ana ped heads job',                  time: '6:55 AM' },
  { id: 3,  sender: 'Mario Delgado',    text: 'worked all day at the anaheim site lol',               time: '7:10 AM' },
  { id: 4,  sender: 'David Chen',       text: 'did 10 hours yesterday san diego signal repair',       time: '7:22 AM' },
  { id: 5,  sender: 'Carlos Reyes',     text: 'carlos here. 8 hours sacramento loop replacement',     time: '7:30 AM' },
  { id: 6,  sender: 'Ray Thompson',     text: 'SF traffic signal upgrade 9 hrs today',                time: '7:45 AM' },
  { id: 7,  sender: 'Unknown Number',   text: '8 hours yesterday',                                    time: '8:01 AM' },
  { id: 8,  sender: 'Mike Alvarez',     text: 'hey its mike. 8 and a half hours LA loop detection',   time: '8:15 AM' },
  { id: 9,  sender: 'Tony Nguyen',      text: '7 hrs oceanside ped heads on monday',                  time: '8:28 AM' },
  { id: 10, sender: 'Jesse Ruiz',       text: 'hey i did 6 hrs on the freeway job call me',           time: '8:40 AM' },
  { id: 11, sender: 'Paul Gutierrez',   text: 'paul g - bakersfield loop install 8 hours 3/29',       time: '9:05 AM' },
  { id: 12, sender: 'Danny Flores',     text: 'late entry forgot friday. 9.5 hours san diego signal', time: '9:18 AM' },
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
    const parsedRow = parsed.find(p => p.id === msg.id);
    const statusClass = parsedRow ? (parsedRow.status === 'clean' ? 'clean' : 'messy') : '';
    bubble.className = 'text-bubble ' + statusClass;
    if (parsedRow) bubble.classList.add('parsed');
    bubble.innerHTML = `
      <div class="sender">${escapeHtml(msg.sender)}</div>
      <div>${escapeHtml(msg.text)}</div>
      <div class="time">${msg.time}</div>
    `;
    container.appendChild(bubble);
  });

  $('msg-count').textContent = messages.length + ' messages';
  container.scrollTop = container.scrollHeight;
}

// ================================================================
//  AI SYSTEM PROMPT
// ================================================================
const PARSE_SYSTEM_PROMPT = `You are a text message parser for a traffic loop and electrical construction company in California. Workers text in their hours in casual, messy language. Your job is to extract structured data from each message.

Today's date is ${localDateStr()}.

For EACH message, extract:
- worker: the worker's name (use sender name if not in the text)
- date: the work date in YYYY-MM-DD format. "today" = ${localDateStr()}. "yesterday" = yesterday's date. "monday", "friday" etc = most recent past occurrence. If unclear, use today.
- hours: number of hours worked (decimal). "all day" = 8. "half day" = 4. "8 and a half" = 8.5.
- jobSite: the job site or project description. If none given, use "Not specified"
- confidence: "high" if you could extract all 4 fields clearly, "low" if you had to guess on any field

Respond with ONLY a JSON array. Each element:
{"worker":"...","date":"YYYY-MM-DD","hours":0,"jobSite":"...","confidence":"high|low"}

If a message is truly unparseable (no hours info at all, just random text), return:
{"worker":"...","date":"","hours":0,"jobSite":"","confidence":"none"}`;

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
  btn.textContent = 'Reading messages...';
  btn.disabled = true;

  try {
    // Build the batch prompt
    const batch = messages.map(m => `[ID:${m.id}] From: ${m.sender} — "${m.text}"`).join('\n');

    const res = await fetch(GROQ_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: PARSE_SYSTEM_PROMPT },
          { role: 'user', content: `Parse these ${messages.length} worker text messages:\n\n${batch}` }
        ],
        max_tokens: 1500,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    let aiResults;

    // Parse the AI response — handle both array and {results: [...]} formats
    try {
      const parsed_json = JSON.parse(raw);
      aiResults = Array.isArray(parsed_json) ? parsed_json : (parsed_json.results || parsed_json.messages || parsed_json.data || Object.values(parsed_json)[0]);
      if (!Array.isArray(aiResults)) throw new Error('Not an array');
    } catch (e) {
      console.error('AI response parse error:', raw);
      throw new Error('Could not parse AI response');
    }

    // Map AI results back to messages
    const results = [];
    messages.forEach((msg, i) => {
      const ai = aiResults[i];
      if (!ai || ai.confidence === 'none' || !ai.hours) {
        results.push({
          id: msg.id,
          worker: ai?.worker || msg.sender,
          date: '',
          hours: 0,
          jobSite: '',
          region: 'unknown',
          raw: msg.text,
          status: 'flagged',
          confidence: 'none',
          flagReason: ai ? 'AI couldn\'t extract hours — needs manual entry' : 'AI skipped this message',
        });
      } else {
        const jobSite = ai.jobSite || 'Not specified';
        const region = detectRegion(jobSite);
        const isFlagged = ai.confidence === 'low';

        results.push({
          id: msg.id,
          worker: ai.worker || msg.sender,
          date: ai.date || localDateStr(),
          hours: parseFloat(ai.hours) || 0,
          jobSite,
          region,
          raw: msg.text,
          status: isFlagged ? 'flagged' : 'clean',
          confidence: ai.confidence,
          flagReason: isFlagged ? 'AI had low confidence — please verify' : undefined,
        });
      }
    });

    parsed = results;
    saveState();
    renderMessages();

    setTimeout(() => {
      renderParsed();
      const clean = parsed.filter(p => p.status === 'clean').length;
      const flagged = parsed.filter(p => p.status === 'flagged').length;
      showToast(`Done — ${clean} clean, ${flagged} need review`);
    }, 400);

  } catch (err) {
    console.error('Process error:', err);
    showToast('Error processing — trying again...');
    // Fallback: try without JSON mode
    try {
      await processMessagesFallback();
    } catch (e2) {
      showToast('Could not reach AI — check connection');
    }
  } finally {
    btn.textContent = 'Process Messages';
    btn.disabled = false;
    isProcessing = false;
  }
}

// ================================================================
//  FALLBACK: retry without json_object response_format
// ================================================================
async function processMessagesFallback() {
  const batch = messages.map(m => `[ID:${m.id}] From: ${m.sender} — "${m.text}"`).join('\n');

  const res = await fetch(GROQ_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: PARSE_SYSTEM_PROMPT + '\n\nIMPORTANT: Respond with ONLY valid JSON. No extra text.' },
        { role: 'user', content: `Parse these ${messages.length} worker text messages:\n\n${batch}` }
      ],
      max_tokens: 1500,
      temperature: 0.1
    })
  });

  if (!res.ok) throw new Error(`Fallback API error: ${res.status}`);

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';

  // Try to extract JSON from the response
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON found in fallback');

  const aiResults = JSON.parse(jsonMatch[0]);

  const results = [];
  messages.forEach((msg, i) => {
    const ai = aiResults[i];
    if (!ai || ai.confidence === 'none' || !ai.hours) {
      results.push({
        id: msg.id, worker: ai?.worker || msg.sender, date: '', hours: 0,
        jobSite: '', region: 'unknown', raw: msg.text, status: 'flagged',
        confidence: 'none', flagReason: 'AI couldn\'t extract hours — needs manual entry',
      });
    } else {
      const jobSite = ai.jobSite || 'Not specified';
      const region = detectRegion(jobSite);
      const isFlagged = ai.confidence === 'low';
      results.push({
        id: msg.id, worker: ai.worker || msg.sender,
        date: ai.date || localDateStr(), hours: parseFloat(ai.hours) || 0,
        jobSite, region, raw: msg.text,
        status: isFlagged ? 'flagged' : 'clean', confidence: ai.confidence,
        flagReason: isFlagged ? 'AI had low confidence — please verify' : undefined,
      });
    }
  });

  parsed = results;
  saveState();
  renderMessages();
  setTimeout(() => {
    renderParsed();
    const clean = parsed.filter(p => p.status === 'clean').length;
    const flagged = parsed.filter(p => p.status === 'flagged').length;
    showToast(`Done — ${clean} clean, ${flagged} need review`);
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
