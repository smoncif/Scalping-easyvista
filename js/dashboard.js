/* ============================================================
   EasyVista Dashboard — js/dashboard.js
   Fetches data from Google Sheets (published CSV) and renders
   KPIs, charts, alerts, team table and distributions.
   ============================================================ */

// ---------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------
const SHEET_BASE =
  'https://docs.google.com/spreadsheets/d/e/' +
  '2PACX-1vSBffv2m25SV26vm_mOt0wNonxC8Ker1_W6atcDTAA6iHCpSfwq_wxAIboaOdGTZDIC8CBVFD1frCPE' +
  '/pub?output=csv&sheet=';

const SHEETS = {
  summary:       SHEET_BASE + 'Summary',
  monthly:       SHEET_BASE + 'Monthly',
  alerts:        SHEET_BASE + 'Alerts',
  team:          SHEET_BASE + 'Team',
  distributions: SHEET_BASE + 'Distributions',
};

// ---------------------------------------------------------------
// CSV PARSER
// ---------------------------------------------------------------
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] !== undefined ? values[i] : ''; });
    return obj;
  });
}

async function fetchSheet(name) {
  try {
    const res = await fetch(SHEETS[name]);
    if (!res.ok) throw new Error(`HTTP ${res.status} on sheet "${name}"`);
    return parseCSV(await res.text());
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
  // Accept both 0–1 and 0–100 ranges
  const pct = n <= 1 ? n * 100 : n;
  return pct.toFixed(1) + '%';
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
  if (pct >= goodAbove) return 'var(--success)';
  if (pct >= goodAbove * 0.8) return 'var(--warning)';
  return 'var(--danger)';
}

const SEV_COLOR = {
  critical: 'var(--danger)',
  warning:  'var(--warning)',
  info:     'var(--accent)',
};
const SEV_BG = {
  critical: 'rgba(239,68,68,0.10)',
  warning:  'rgba(245,158,11,0.10)',
  info:     'rgba(59,130,246,0.10)',
};

const CHART_COLORS = [
  '#3b82f6','#22c55e','#f59e0b','#ef4444',
  '#a855f7','#14b8a6','#f97316','#ec4899',
  '#64748b','#06b6d4',
];

// ---------------------------------------------------------------
// CHART INSTANCES (kept to allow destroy on refresh)
// ---------------------------------------------------------------
let monthlyChart = null;
const distCharts = {};

// ---------------------------------------------------------------
// RENDER — KPI CARDS
// ---------------------------------------------------------------
function renderKPIs(summary) {
  const s = summary[0] || {};

  if (s.report_date) {
    document.getElementById('last-updated').textContent =
      `${s.report_date} ${s.report_time || ''}`.trim();
  }

  const resoPct = normPct(s.resolution_rate);
  const slaPct  = normPct(s.sla_compliance);

  const kpis = [
    {
      icon: '🎫', label: 'Total Tickets',
      value: fmt(s.total_tickets),
      color: 'var(--accent)',
    },
    {
      icon: '🔓', label: 'Ouverts',
      value: fmt(s.open_tickets),
      color: num(s.open_tickets) > 0 ? 'var(--warning)' : 'var(--success)',
      sub: `Backlog : ${fmt(s.current_backlog)}`,
    },
    {
      icon: '✅', label: 'Fermés',
      value: fmt(s.closed_tickets),
      color: 'var(--success)',
    },
    {
      icon: '📊', label: 'Taux Résolution',
      value: fmtPct(s.resolution_rate),
      color: pctColor(resoPct, 80),
    },
    {
      icon: '🎯', label: 'Conformité SLA',
      value: fmtPct(s.sla_compliance),
      color: pctColor(slaPct, 90),
    },
    {
      icon: '⏰', label: 'En Retard',
      value: fmt(s.overdue_count),
      color: num(s.overdue_count) > 0 ? 'var(--danger)' : 'var(--success)',
    },
    {
      icon: '⚠️', label: 'À Risque',
      value: fmt(s.at_risk_count),
      color: num(s.at_risk_count) > 0 ? 'var(--warning)' : 'var(--success)',
    },
    {
      icon: '⏱', label: 'Résolution Moy.',
      value: fmtHours(s.avg_resolution_hours),
      color: 'var(--accent-light)',
      sub: `Médiane : ${fmtHours(s.median_resolution_hours)}`,
    },
    {
      icon: '↩', label: 'Réouvertures',
      value: fmt(s.reopened_count),
      color: num(s.reopened_count) > 0 ? 'var(--warning)' : 'var(--text-secondary)',
      sub: `Taux : ${fmtPct(s.reopening_rate)}`,
    },
    {
      icon: '⏸', label: 'Suspendus',
      value: fmt(s.suspended_count),
      color: 'var(--text-secondary)',
    },
  ];

  document.getElementById('kpi-grid').innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-body">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value" style="color:${k.color}">${k.value}</div>
        ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------
// RENDER — ALERTS BADGES (from Summary)
// ---------------------------------------------------------------
function renderAlertsRow(summary) {
  const s = summary[0] || {};

  const badges = [
    { label: 'Alertes Critiques', value: fmt(s.critical_alerts), color: 'var(--danger)',           bg: 'rgba(239,68,68,0.08)' },
    { label: 'Alertes Warning',   value: fmt(s.warning_alerts),  color: 'var(--warning)',          bg: 'rgba(245,158,11,0.08)' },
    { label: 'Alertes Info',      value: fmt(s.info_alerts),     color: 'var(--accent)',           bg: 'rgba(59,130,246,0.08)' },
    { label: 'Annulés',           value: fmt(s.cancelled_count), color: 'var(--text-secondary)',   bg: 'rgba(148,163,184,0.06)' },
    { label: 'Rejetés',           value: fmt(s.rejected_count),  color: 'var(--text-secondary)',   bg: 'rgba(148,163,184,0.06)' },
    { label: 'P90 Résolution',    value: fmtHours(s.p90_resolution_hours), color: 'var(--purple)', bg: 'rgba(168,85,247,0.08)' },
  ];

  document.getElementById('alerts-row').innerHTML = badges.map(b => `
    <div class="alert-badge" style="background:${b.bg}; border-color:${b.color}22;">
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

  const sorted = [...monthly].sort((a, b) => (a.month > b.month ? 1 : -1));
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
          backgroundColor: 'rgba(59,130,246,0.75)',
          borderRadius: 4,
          order: 2,
        },
        {
          label: 'Fermés',
          data: closed,
          backgroundColor: 'rgba(34,197,94,0.75)',
          borderRadius: 4,
          order: 2,
        },
        {
          label: 'Backlog',
          data: backlog,
          type: 'line',
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#f59e0b',
          yAxisID: 'y1',
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#94a3b8', boxWidth: 12, padding: 16 },
        },
      },
      scales: {
        x:  { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(51,65,85,0.5)' } },
        y:  { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(51,65,85,0.5)' }, beginAtZero: true },
        y1: {
          position: 'right',
          ticks: { color: '#f59e0b' },
          grid: { drawOnChartArea: false },
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
  const badge     = document.getElementById('active-alerts-count');

  const active = alerts.filter(a =>
    a.is_active === '1' || a.is_active === 'true' || a.is_active === 'TRUE'
  );

  if (badge) badge.textContent = active.length || '';

  if (!active.length) {
    container.innerHTML = '<p class="no-data">Aucune alerte active</p>';
    return;
  }

  // Sort: critical first
  const order = { critical: 0, warning: 1, info: 2 };
  const sorted = [...active].sort((a, b) => {
    const sa = order[(a.severity || '').toLowerCase()] ?? 9;
    const sb = order[(b.severity || '').toLowerCase()] ?? 9;
    return sa - sb;
  });

  container.innerHTML = `<div class="alerts-list">
    ${sorted.slice(0, 12).map(a => {
      const sev   = (a.severity || 'info').toLowerCase();
      const color = SEV_COLOR[sev] || 'var(--text-secondary)';
      const bg    = SEV_BG[sev]    || 'rgba(148,163,184,0.08)';
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

  const sorted = [...team].sort((a, b) => num(b.assigned_total) - num(a.assigned_total));
  const maxAssigned = Math.max(...sorted.map(t => num(t.assigned_total)), 1);

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Assignés</th>
          <th>Ouverts</th>
          <th>Fermés</th>
          <th>En Retard</th>
          <th>Résolus</th>
          <th>Moy. Résolution</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(t => {
          const pct = ((num(t.assigned_total) / maxAssigned) * 100).toFixed(0);
          const initials = (t.person || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
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

  // Destroy previous instances
  Object.values(distCharts).forEach(c => c.destroy());
  Object.keys(distCharts).forEach(k => delete distCharts[k]);

  if (!distributions.length) {
    container.innerHTML = '<p class="no-data">Aucune donnée de distribution</p>';
    return;
  }

  // Group by dimension
  const byDim = {};
  distributions.forEach(d => {
    const dim = d.dimension || 'Autre';
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

  // Render after DOM update
  requestAnimationFrame(() => {
    Object.entries(byDim).forEach(([dim, items]) => {
      const id = 'dist-' + dim.replace(/[^a-z0-9]/gi, '-');
      const canvas = document.getElementById(id);
      if (!canvas) return;

      const sorted   = [...items].sort((a, b) => b.count - a.count).slice(0, 10);
      const isLong   = sorted.length > 5;

      distCharts[id] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: sorted.map(i => i.value),
          datasets: [{
            data: sorted.map(i => i.count),
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
            x: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(51,65,85,0.4)' } },
            y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(51,65,85,0.4)' } },
          },
        },
      });
    });
  });
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
    const [summary, monthly, alerts, team, distributions] = await Promise.all([
      fetchSheet('summary'),
      fetchSheet('monthly'),
      fetchSheet('alerts'),
      fetchSheet('team'),
      fetchSheet('distributions'),
    ]);

    renderKPIs(summary);
    renderAlertsRow(summary);
    renderMonthlyChart(monthly);
    renderAlertsTable(alerts);
    renderTeamTable(team);
    renderDistributions(distributions);

    loading.classList.add('hidden');
    main.classList.remove('hidden');
  } catch (err) {
    console.error('Dashboard load error:', err);
    errMsg.textContent = `Erreur de chargement : ${err.message}`;
    loading.classList.add('hidden');
    errDiv.classList.remove('hidden');
  }
}

// Init
loadAllData();

// Auto-refresh every 5 minutes
setInterval(loadAllData, 5 * 60 * 1000);
