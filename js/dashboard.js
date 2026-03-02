/* ============================================================
   EasyVista Dashboard — js/dashboard.js
   Light theme — no emoji icons — Apple-inspired palette
   Data : Google Sheets API v4 — spreadsheet 1i303x...
   ============================================================ */

// ---------------------------------------------------------------
// CONFIG — Google Sheets API v4
// ---------------------------------------------------------------
const SPREADSHEET_ID = '1i303xNPkcKNWBTnT3sPKUah37EQfxJpqQZv_ajvV6rA';
const API_KEY        = 'AIzaSyDHcUatCqO65UoDe-iMDZIh2NntcShEckM';
const API_BASE       = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;

const SHEET_NAMES = {
  summary:       'Summary',
  monthly:       'Monthly',
  alerts:        'Alerts',
  team:          'Team',
  distributions: 'Distributions',
  tickets:       'Tickets',
};

// ---------------------------------------------------------------
// PALETTE (light theme — Apple-inspired)
// ---------------------------------------------------------------
const C = {
  accent:   '#0071e3',
  success:  '#34c759',
  warning:  '#ff9f0a',
  danger:   '#ff3b30',
  purple:   '#5856d6',
  teal:     '#32ade6',
  text2:    '#6e6e73',
  text3:    '#aeaeb2',
  grid:     'rgba(0,0,0,0.06)',
};

const CHART_COLORS = [
  '#0071e3', '#34c759', '#ff9f0a', '#ff3b30',
  '#5856d6', '#32ade6', '#ff6b35', '#bf5af2',
  '#8e8e93', '#30d158',
];

// ---------------------------------------------------------------
// STATE — raw data stored after first load
// ---------------------------------------------------------------
const STATE = {
  raw: {
    summary:       [],
    monthly:       [],
    alerts:        [],
    team:          [],
    distributions: [],
    tickets:       [],
  },
  currentView: 'dashboard',
};

// ---------------------------------------------------------------
// DATE HELPERS
// ---------------------------------------------------------------

/**
 * Parse various date string formats into a Date object.
 * Handles: YYYY-MM-DD, DD/MM/YYYY, MM/YYYY, YYYY-MM, timestamps.
 */
function parseFlexDate(str) {
  if (!str || String(str).trim() === '') return null;
  str = String(str).trim();

  // ISO: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  let d = new Date(str.length === 10 ? str + 'T00:00:00' : str);
  if (!isNaN(d.getTime())) return d;

  // DD/MM/YYYY
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    d = new Date(`${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }

  // YYYY-MM (month only → 1st of month)
  const ym1 = str.match(/^(\d{4})-(\d{2})$/);
  if (ym1) return new Date(`${ym1[1]}-${ym1[2]}-01T00:00:00`);

  // MM/YYYY
  const ym2 = str.match(/^(\d{2})\/(\d{4})$/);
  if (ym2) return new Date(`${ym2[2]}-${ym2[1]}-01T00:00:00`);

  return null;
}

function inRange(dateStr, from, to) {
  if (!from && !to) return true;
  const d = parseFlexDate(dateStr);
  if (!d) return true; // unparseable dates are kept
  if (from && d < from) return false;
  if (to   && d > to)   return false;
  return true;
}

function getDateFilter() {
  const fromVal = document.getElementById('date-from')?.value;
  const toVal   = document.getElementById('date-to')?.value;
  const from    = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const to      = toVal   ? new Date(toVal   + 'T23:59:59') : null;
  return { from, to };
}

function updateFilterTag(from, to) {
  const tag = document.getElementById('filter-tag');
  const ind = document.getElementById('filter-indicator');
  if (!tag || !ind) return;
  if (from || to) {
    const f = from ? from.toLocaleDateString('fr-FR') : '…';
    const t = to   ? to.toLocaleDateString('fr-FR')   : '…';
    ind.textContent = `${f} → ${t}`;
    tag.classList.remove('hidden');
  } else {
    tag.classList.add('hidden');
  }
}

/** Apply current date filter and re-render all sections */
function applyFilters() {
  const { from, to } = getDateFilter();

  // Monthly → filter by month field
  const monthly       = STATE.raw.monthly.filter(m => inRange(m.month, from, to));
  // Alerts → filter by first_seen (creation date)
  const alerts        = STATE.raw.alerts.filter(a => inRange(a.first_seen, from, to));
  // Team → filter by last_updated
  const team          = STATE.raw.team.filter(t => inRange(t.last_updated, from, to));
  // Distributions → filter by last_updated
  const distributions = STATE.raw.distributions.filter(d => inRange(d.last_updated, from, to));

  // Summary KPIs are always global (not filtered)
  renderKPIs(STATE.raw.summary);
  renderAlertsRow(STATE.raw.summary);
  renderMonthlyChart(monthly);
  renderAlertsTable(alerts);
  renderTeamTable(team);
  renderDistributions(distributions);
  updateFilterTag(from, to);
}

function resetFilters() {
  const f = document.getElementById('date-from');
  const t = document.getElementById('date-to');
  if (f) f.value = '';
  if (t) t.value = '';
  applyFilters();
}

// ---------------------------------------------------------------
// GOOGLE SHEETS API v4 — FETCH & PARSE
// ---------------------------------------------------------------

/** Convert the API response (array of rows) into array of objects */
function sheetsToObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? String(row[i]) : ''; });
    return obj;
  });
}

async function fetchSheet(name) {
  try {
    const sheet = SHEET_NAMES[name];
    const url   = `${API_BASE}/${encodeURIComponent(sheet)}?key=${API_KEY}`;
    const res   = await fetch(url);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || `HTTP ${res.status} — feuille "${sheet}"`);
    }

    const data = await res.json();
    return sheetsToObjects(data.values || []);
  } catch (e) {
    console.error(`[fetchSheet] ${name}:`, e);
    return [];
  }
}

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------
const num = v => parseFloat(v) || 0;

function fmt(val, dec = 0) {
  const n = parseFloat(val);
  if (isNaN(n)) return val || '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: dec });
}

function fmtPct(val) {
  const n = parseFloat(val);
  if (isNaN(n) || n === 0) return '—';
  const pct = n <= 1 ? n * 100 : n;
  return pct.toFixed(1) + ' %';
}

function fmtHours(val) {
  const h = parseFloat(val);
  if (isNaN(h) || h === 0) return '—';
  if (h >= 48) return (h / 24).toFixed(1) + ' j';
  return h.toFixed(1) + ' h';
}

function normPct(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return 0;
  return n <= 1 ? n * 100 : n;
}

function pctColor(pct, goodAbove = 80) {
  if (pct >= goodAbove)          return C.success;
  if (pct >= goodAbove * 0.8)    return C.warning;
  return C.danger;
}

const SEV_COLOR = { critical: C.danger,  warning: C.warning, info: C.accent };
const SEV_BG    = {
  critical: 'rgba(255,59,48,0.07)',
  warning:  'rgba(255,159,10,0.07)',
  info:     'rgba(0,113,227,0.07)',
};

// ---------------------------------------------------------------
// CHART INSTANCES
// ---------------------------------------------------------------
let monthlyChart = null;
const distCharts = {};

// ---------------------------------------------------------------
// RENDER — KPI CARDS  (no emojis)
// ---------------------------------------------------------------
function renderKPIs(summary) {
  const s = summary[summary.length - 1] || {};

  if (s.report_date) {
    document.getElementById('last-updated').textContent =
      `${s.report_date} ${s.report_time || ''}`.trim();
  }

  const resoPct = normPct(s.resolution_rate);
  const slaPct  = normPct(s.sla_compliance);

  const kpis = [
    {
      label: 'Total Tickets',
      value: fmt(s.total_tickets),
      color: C.accent,
    },
    {
      label: 'Ouverts',
      value: fmt(s.open_tickets),
      color: num(s.open_tickets) > 0 ? C.warning : C.success,
      sub: `Backlog : ${fmt(s.current_backlog)}`,
    },
    {
      label: 'Fermés',
      value: fmt(s.closed_tickets),
      color: C.success,
    },
    {
      label: 'Taux de résolution',
      value: fmtPct(s.resolution_rate),
      color: pctColor(resoPct, 80),
    },
    {
      label: 'Conformité SLA',
      value: fmtPct(s.sla_compliance),
      color: pctColor(slaPct, 90),
    },
    {
      label: 'En retard',
      value: fmt(s.overdue_count),
      color: num(s.overdue_count) > 0 ? C.danger : C.success,
    },
    {
      label: 'À risque',
      value: fmt(s.at_risk_count),
      color: num(s.at_risk_count) > 0 ? C.warning : C.success,
    },
    {
      label: 'Résolution moyenne',
      value: fmtHours(s.avg_resolution_hours),
      color: C.teal,
      sub: `Médiane : ${fmtHours(s.median_resolution_hours)}`,
    },
    {
      label: 'Réouvertures',
      value: fmt(s.reopened_count),
      color: num(s.reopened_count) > 0 ? C.warning : C.text2,
      sub: `Taux : ${fmtPct(s.reopening_rate)}`,
    },
    {
      label: 'Suspendus',
      value: fmt(s.suspended_count),
      color: C.text2,
    },
  ];

  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="color:${k.color}">${k.value}</div>
      ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
    </div>
  `).join('');
}

// ---------------------------------------------------------------
// RENDER — ALERT BADGES (from Summary)
// ---------------------------------------------------------------
function renderAlertsRow(summary) {
  const s = summary[summary.length - 1] || {};

  const badges = [
    { label: 'Alertes critiques', value: fmt(s.critical_alerts), color: C.danger  },
    { label: 'Alertes warning',   value: fmt(s.warning_alerts),  color: C.warning },
    { label: 'Alertes info',      value: fmt(s.info_alerts),     color: C.accent  },
    { label: 'Annulés',           value: fmt(s.cancelled_count), color: C.text2   },
    { label: 'Rejetés',           value: fmt(s.rejected_count),  color: C.text2   },
    { label: 'P90 résolution',    value: fmtHours(s.p90_resolution_hours), color: C.purple },
  ];

  document.getElementById('alerts-row').innerHTML = badges.map(b => `
    <div class="alert-badge">
      <div class="alert-badge-value" style="color:${b.color}">${b.value}</div>
      <div class="alert-badge-label">${b.label}</div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------
// RENDER — MONTHLY TREND CHART
// ---------------------------------------------------------------
function renderMonthlyChart(monthly) {
  const canvas = document.getElementById('monthly-chart');
  if (!canvas) return;

  if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }

  if (!monthly.length) {
    canvas.insertAdjacentHTML('afterend', '<p class="no-data">Aucune donnée mensuelle</p>');
    canvas.remove();
    return;
  }

  const sorted  = [...monthly].sort((a, b) => (a.month > b.month ? 1 : -1));
  const labels  = sorted.map(m => m.month);
  const created = sorted.map(m => num(m.created));
  const closed  = sorted.map(m => num(m.closed));
  const backlog = sorted.map(m => num(m.backlog));

  monthlyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Créés',
          data: created,
          backgroundColor: C.accent + 'cc',
          borderColor: C.accent,
          borderWidth: 0,
          borderRadius: 4,
          order: 2,
        },
        {
          label: 'Fermés',
          data: closed,
          backgroundColor: C.success + 'cc',
          borderColor: C.success,
          borderWidth: 0,
          borderRadius: 4,
          order: 2,
        },
        {
          label: 'Backlog',
          data: backlog,
          type: 'line',
          borderColor: C.warning,
          backgroundColor: C.warning + '18',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: C.warning,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: C.text2,
            boxWidth: 10,
            boxHeight: 10,
            borderRadius: 2,
            useBorderRadius: true,
            padding: 16,
            font: { size: 12 },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: C.text2, font: { size: 11 } },
          grid: { color: C.grid },
        },
        y: {
          ticks: { color: C.text2, font: { size: 11 } },
          grid: { color: C.grid },
          beginAtZero: true,
        },
      },
    },
  });
}

// ---------------------------------------------------------------
// RENDER — ACTIVE ALERTS TABLE (from Alerts sheet)
// ---------------------------------------------------------------
function renderAlertsTable(alerts) {
  const container = document.getElementById('alerts-table');
  const pill      = document.getElementById('active-alerts-count');

  const active = alerts.filter(a =>
    ['1', 'true', 'yes', 'oui'].includes((a.is_active || '').toLowerCase())
  );

  if (pill) pill.textContent = active.length > 0 ? active.length : '';

  if (!active.length) {
    container.innerHTML = '<p class="no-data">Aucune alerte active</p>';
    return;
  }

  const ORDER = { critical: 0, warning: 1, info: 2 };
  const sorted = [...active].sort((a, b) => {
    const sa = ORDER[(a.severity || '').toLowerCase()] ?? 9;
    const sb = ORDER[(b.severity || '').toLowerCase()] ?? 9;
    return sa - sb;
  });

  container.innerHTML = `<div class="alerts-list">
    ${sorted.slice(0, 12).map(a => {
      const sev   = (a.severity || 'info').toLowerCase();
      const color = SEV_COLOR[sev] || C.text2;
      const bg    = SEV_BG[sev]   || 'rgba(0,0,0,0.04)';
      return `
        <div class="alert-item" style="border-left-color:${color}; background:${bg}">
          <div class="alert-item-header">
            <span class="alert-severity" style="color:${color}">${(a.severity || 'INFO').toUpperCase()}</span>
            ${a.type   ? `<span class="alert-type">${a.type}</span>` : ''}
            ${a.ticket ? `<span class="alert-ticket">#${a.ticket}</span>` : ''}
            ${a.first_seen ? `<span class="alert-first-seen">${a.first_seen}</span>` : ''}
          </div>
          <div class="alert-message">${a.message || '—'}</div>
        </div>`;
    }).join('')}
  </div>`;
}

// ---------------------------------------------------------------
// RENDER — TEAM PERFORMANCE TABLE
// ---------------------------------------------------------------
function renderTeamTable(team) {
  const container = document.getElementById('team-table');

  if (!team.length) {
    container.innerHTML = '<p class="no-data">Aucune donnée équipe disponible</p>';
    return;
  }

  const sorted     = [...team].sort((a, b) => num(b.assigned_total) - num(a.assigned_total));
  const maxAssigned = Math.max(...sorted.map(t => num(t.assigned_total)), 1);

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Assignés</th>
          <th>Ouverts</th>
          <th>Fermés</th>
          <th>En retard</th>
          <th>Résolus</th>
          <th>Moy. résolution</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(t => {
          const pct      = ((num(t.assigned_total) / maxAssigned) * 100).toFixed(0);
          const initials = (t.person || '?')
            .split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
          return `
            <tr>
              <td>
                <div class="person-cell">
                  <div class="person-avatar">${initials}</div>
                  <span>${t.person || '—'}</span>
                </div>
              </td>
              <td>
                <div class="progress-cell">
                  <span>${fmt(t.assigned_total)}</span>
                  <div class="progress-bar">
                    <div class="progress-fill" style="width:${pct}%"></div>
                  </div>
                </div>
              </td>
              <td><span class="badge badge-warning">${fmt(t.open_count)}</span></td>
              <td><span class="badge badge-success">${fmt(t.closed_count)}</span></td>
              <td>
                <span class="badge ${num(t.overdue_count) > 0 ? 'badge-danger' : 'badge-neutral'}">
                  ${fmt(t.overdue_count)}
                </span>
              </td>
              <td>${fmt(t.solved_count)}</td>
              <td>${fmtHours(t.avg_resolution_hours)}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ---------------------------------------------------------------
// RENDER — DISTRIBUTIONS CHARTS
// ---------------------------------------------------------------
function renderDistributions(distributions) {
  const container = document.getElementById('distributions');

  Object.values(distCharts).forEach(c => c.destroy());
  Object.keys(distCharts).forEach(k => delete distCharts[k]);

  if (!distributions.length) {
    container.innerHTML = '<p class="no-data">Aucune donnée de distribution</p>';
    return;
  }

  // Group by dimension (exclude unwanted dimensions)
  const EXCLUDED_DIMS = new Set(['Group', 'Impact', 'Origin', 'Priority', 'Time Status']);
  const byDim = {};
  distributions.forEach(d => {
    const dim = d.dimension || 'Autre';
    if (EXCLUDED_DIMS.has(dim)) return;
    if (!byDim[dim]) byDim[dim] = [];
    byDim[dim].push({ value: d.value || '?', count: num(d.count) });
  });

  container.innerHTML = Object.entries(byDim).map(([dim]) => {
    const id = 'dist-' + dim.replace(/[^a-z0-9]/gi, '-');
    return `
      <div class="dist-chart-card">
        <div class="dist-title">${dim}</div>
        <canvas id="${id}" height="220"></canvas>
      </div>`;
  }).join('');

  requestAnimationFrame(() => {
    Object.entries(byDim).forEach(([dim, items]) => {
      const id     = 'dist-' + dim.replace(/[^a-z0-9]/gi, '-');
      const canvas = document.getElementById(id);
      if (!canvas) return;

      const sorted = [...items].sort((a, b) => b.count - a.count).slice(0, 10);
      const isLong = sorted.length > 5;

      distCharts[id] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: sorted.map(i => i.value),
          datasets: [{
            data:            sorted.map(i => i.count),
            backgroundColor: sorted.map((_, idx) => CHART_COLORS[idx % CHART_COLORS.length] + 'bb'),
            borderColor:     sorted.map((_, idx) => CHART_COLORS[idx % CHART_COLORS.length]),
            borderWidth: 1,
            borderRadius: 4,
          }],
        },
        options: {
          indexAxis: isLong ? 'y' : 'x',
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => ` ${isLong ? ctx.parsed.x : ctx.parsed.y} tickets`,
              },
            },
          },
          scales: {
            x: {
              ticks: { color: C.text2, font: { size: 11 } },
              grid:  { color: C.grid },
            },
            y: {
              ticks: { color: C.text2, font: { size: 11 } },
              grid:  { color: C.grid },
            },
          },
        },
      });
    });
  });
}

// ---------------------------------------------------------------
// NAVIGATION — SPA view switcher
// ---------------------------------------------------------------
function showView(name) {
  STATE.currentView = name;

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === name);
  });

  // Show / hide views
  document.querySelectorAll('.view-section').forEach(el => {
    el.classList.toggle('hidden', el.dataset.view !== name);
  });
}

// ---------------------------------------------------------------
// RENDER — TICKETS TABLE (from Tickets sheet)
// ---------------------------------------------------------------
function renderTicketsTable(tickets) {
  const container = document.getElementById('tickets-table');
  if (!container) return;

  if (!tickets.length) {
    container.innerHTML = '<p class="no-data">Aucun ticket disponible</p>';
    return;
  }

  // Columns are whatever the sheet provides
  const cols = Object.keys(tickets[0]);

  const headerRow = cols.map(c =>
    `<th>${c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</th>`
  ).join('');

  const bodyRows = tickets.map(t =>
    `<tr>${cols.map(c => `<td>${t[c] || '—'}</td>`).join('')}</tr>`
  ).join('');

  container.innerHTML = `
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>${headerRow}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------
// MAIN LOAD
// ---------------------------------------------------------------
async function loadAllData() {
  const loading = document.getElementById('loading');
  const main    = document.getElementById('main-content');
  const errDiv  = document.getElementById('error-state');
  const errMsg  = document.getElementById('error-msg');

  loading.classList.remove('hidden');
  main.classList.add('hidden');
  errDiv.classList.add('hidden');

  try {
    const [summary, monthly, alerts, team, distributions, tickets] = await Promise.all([
      fetchSheet('summary'),
      fetchSheet('monthly'),
      fetchSheet('alerts'),
      fetchSheet('team'),
      fetchSheet('distributions'),
      fetchSheet('tickets'),
    ]);

    // Store raw data for client-side filtering
    STATE.raw.summary       = summary;
    STATE.raw.monthly       = monthly;
    STATE.raw.alerts        = alerts;
    STATE.raw.team          = team;
    STATE.raw.distributions = distributions;
    STATE.raw.tickets       = tickets;

    // Render with current filter (none on first load)
    applyFilters();
    renderTicketsTable(tickets);

    loading.classList.add('hidden');
    main.classList.remove('hidden');
  } catch (err) {
    console.error('Dashboard load error:', err);
    errMsg.textContent = `Erreur de chargement : ${err.message}`;
    loading.classList.add('hidden');
    errDiv.classList.remove('hidden');
  }
}

// Init + auto-refresh (5 min)
loadAllData();
setInterval(loadAllData, 5 * 60 * 1000);
