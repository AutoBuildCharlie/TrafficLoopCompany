// ================================================================
//  DATA SHAPE REFERENCE
// ================================================================
// localStorage keys:
//
// tlc_messages    → [{ id, sender, text, time, type: "clean"|"messy" }]
// tlc_parsed      → [{ id, worker, date, hours, jobSite, region, raw, status: "clean"|"flagged", flagReason? }]
//
// No Supabase — demo only, all data is fake/local
// ================================================================

// ================================================================
//  DEMO DATA
// ================================================================
const DEMO_MESSAGES = [
  { id: 1,  sender: 'Luis Ramirez',    text: 'Luis | 3/29 | 8 | Anaheim Loop Install',        time: '6:42 AM', type: 'clean' },
  { id: 2,  sender: 'Jose Martinez',    text: 'Jose | 3/29 | 7.5 | Santa Ana Ped Heads',       time: '6:55 AM', type: 'clean' },
  { id: 3,  sender: 'Mario',            text: 'worked all day at the anaheim site lol',          time: '7:10 AM', type: 'messy' },
  { id: 4,  sender: 'David Chen',       text: 'David | 3/28 | 10 | San Diego Signal Repair',    time: '7:22 AM', type: 'clean' },
  { id: 5,  sender: 'Carlos Reyes',     text: 'Carlos | 3/29 | 8 | Sacramento Loop Replacement',time: '7:30 AM', type: 'clean' },
  { id: 6,  sender: 'Ray Thompson',     text: 'Ray | 3/29 | 9 | SF Traffic Signal Upgrade',     time: '7:45 AM', type: 'clean' },
  { id: 7,  sender: 'Unknown Number',   text: '8 hours yesterday',                               time: '8:01 AM', type: 'messy' },
  { id: 8,  sender: 'Mike Alvarez',     text: 'Mike | 3/29 | 8.5 | LA Loop Detection',          time: '8:15 AM', type: 'clean' },
  { id: 9,  sender: 'Tony Nguyen',      text: 'Tony | 3/28 | 7 | Oceanside Ped Heads',          time: '8:28 AM', type: 'clean' },
  { id: 10, sender: 'Jesse',            text: 'hey i did 6 hrs on the freeway job call me',      time: '8:40 AM', type: 'messy' },
  { id: 11, sender: 'Paul Gutierrez',   text: 'Paul | 3/29 | 8 | Bakersfield Loop Install',     time: '9:05 AM', type: 'clean' },
  { id: 12, sender: 'Danny Flores',     text: 'Danny | 3/29 | 9.5 | San Diego Signal Maint',    time: '9:18 AM', type: 'clean' },
];

// Region mapping by job site keywords
const REGION_MAP = {
  norcal: ['sacramento', 'sf', 'san francisco', 'oakland', 'fresno', 'bakersfield', 'stockton', 'san jose'],
  socal: ['anaheim', 'santa ana', 'la', 'los angeles', 'irvine', 'long beach', 'pasadena', 'riverside', 'ontario'],
  sandiego: ['san diego', 'oceanside', 'chula vista', 'escondido', 'carlsbad'],
};

// ================================================================
//  STATE
// ================================================================
let messages = [];
let parsed = [];

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
    bubble.className = 'text-bubble ' + msg.type;
    if (parsed.some(p => p.id === msg.id)) bubble.classList.add('parsed');
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
//  PROCESS MESSAGES (the core logic)
// ================================================================
function processMessages() {
  if (parsed.length > 0) {
    showToast('Already processed — hit Reset Demo to start over');
    return;
  }

  const results = [];

  messages.forEach(msg => {
    const parts = msg.text.split('|').map(p => p.trim());

    // Clean format: Name | Date | Hours | Job Site
    if (parts.length >= 4) {
      const worker = parts[0];
      const date = normalizeDate(parts[1]);
      const hours = parseFloat(parts[2]);
      const jobSite = parts[3];
      const region = detectRegion(jobSite);

      if (worker && date && !isNaN(hours) && jobSite) {
        results.push({
          id: msg.id,
          worker,
          date,
          hours,
          jobSite,
          region,
          raw: msg.text,
          status: 'clean',
        });
        return;
      }
    }

    // Couldn't parse — flag it
    let reason = 'Could not parse — missing fields';
    if (parts.length < 4) reason = 'Wrong format — expected: Name | Date | Hours | Job';
    if (msg.sender === 'Unknown Number') reason = 'Unknown sender — no worker name';

    results.push({
      id: msg.id,
      worker: msg.sender,
      date: '',
      hours: 0,
      jobSite: '',
      region: 'unknown',
      raw: msg.text,
      status: 'flagged',
      flagReason: reason,
    });
  });

  parsed = results;
  saveState();

  // Animate bubbles
  renderMessages();

  // Short delay then show results
  setTimeout(() => {
    renderParsed();
    const clean = parsed.filter(p => p.status === 'clean').length;
    const flagged = parsed.filter(p => p.status === 'flagged').length;
    showToast(`Done — ${clean} clean, ${flagged} flagged`);
  }, 400);
}

// ================================================================
//  PARSE HELPERS
// ================================================================
function normalizeDate(raw) {
  if (!raw) return '';
  // Handle "3/29" → "2026-03-29"
  const match = raw.match(/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    const month = match[1].padStart(2, '0');
    const day = match[2].padStart(2, '0');
    return `2026-${month}-${day}`;
  }
  return raw;
}

function detectRegion(jobSite) {
  const lower = jobSite.toLowerCase();
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

  // Stats
  $('stat-clean').textContent = clean.length + ' clean';
  $('stat-flagged').textContent = flagged.length + ' flagged';

  // Empty state
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
      <td><span class="status-tag ${row.status}">${row.status === 'clean' ? '✅ Clean' : '⚠️ Flagged'}</span></td>
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
  // For the demo, same as CSV but grouped
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
