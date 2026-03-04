/* ============================================================
   EasyVista Dashboard — js/dashboard.js
   Light theme — no emoji icons — Apple-inspired palette
   Source unique : feuille Tickets (Google Sheets API v4)
   ============================================================ */

// ---------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------
const SPREADSHEET_ID = '1i303xNPkcKNWBTnT3sPKUah37EQfxJpqQZv_ajvV6rA';
const API_KEY        = 'AIzaSyDHcUatCqO65UoDe-iMDZIh2NntcShEckM';
const API_BASE       = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;

const SHEET_NAMES = {
  tickets: 'Tickets',
};

// ---------------------------------------------------------------
// CLASSIFICATION DES STATUTS (adapter si besoin)
// ---------------------------------------------------------------
const STATUS_CLOSED    = ['closed','fermé','ferme','resolved','résolu','resolu','solved','clos','terminé','termine','clôturé','cloture','clotûré','done','completed'];
const STATUS_SOLVED    = ['resolved','résolu','resolu','solved'];
const STATUS_CANCELLED = ['cancelled','canceled','annulé','annule'];
const STATUS_REJECTED  = ['rejected','rejeté','rejete'];
const STATUS_SUSPENDED = ['suspended','suspendu','on hold','en attente'];

function classifyStatus(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (STATUS_CLOSED.some(v    => s.includes(v))) return 'closed';
  if (STATUS_CANCELLED.some(v => s.includes(v))) return 'cancelled';
  if (STATUS_REJECTED.some(v  => s.includes(v))) return 'rejected';
  if (STATUS_SUSPENDED.some(v => s.includes(v))) return 'suspended';
  return 'open';
}

// ---------------------------------------------------------------
// PALETTE
// ---------------------------------------------------------------
const C = {
  accent:  '#0071e3',
  success: '#34c759',
  warning: '#ff9f0a',
  danger:  '#ff3b30',
  purple:  '#5856d6',
  teal:    '#32ade6',
  text2:   '#6e6e73',
  text3:   '#aeaeb2',
  grid:    'rgba(0,0,0,0.06)',
};

const CHART_COLORS = [
  '#0071e3','#34c759','#ff9f0a','#ff3b30',
  '#5856d6','#32ade6','#ff6b35','#bf5af2',
  '#8e8e93','#30d158',
];

// ---------------------------------------------------------------
// STATE
// ---------------------------------------------------------------
const STATE = {
  raw:              { tickets: [] },
  filteredTickets:  [],
  trendGranularity: 'month',   // 'month' | 'week'
  currentView:      'dashboard',
};

// ---------------------------------------------------------------
// DATE HELPERS
// ---------------------------------------------------------------
function parseFlexDate(str) {
  if (!str || String(str).trim() === '') return null;
  str = String(str).trim();

  // ISO format uniquement : YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS (non ambigu)
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str.length === 10 ? str + 'T00:00:00' : str);
    if (!isNaN(d.getTime())) return d;
  }

  // Format DD/MM/YYYY HH:MM:SS (ex: 27/02/2026 13:55:45)
  const dmyTime = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (dmyTime) {
    const d = new Date(`${dmyTime[3]}-${dmyTime[2].padStart(2,'0')}-${dmyTime[1].padStart(2,'0')}T${dmyTime[4]}`);
    if (!isNaN(d.getTime())) return d;
  }

  // Format DD/MM/YYYY HH:MM (ex: 27/02/2026 13:55)
  const dmyShortTime = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2}:\d{2})$/);
  if (dmyShortTime) {
    const d = new Date(`${dmyShortTime[3]}-${dmyShortTime[2].padStart(2,'0')}-${dmyShortTime[1].padStart(2,'0')}T${dmyShortTime[4]}:00`);
    if (!isNaN(d.getTime())) return d;
  }

  // Format DD/MM/YYYY (ex: 27/02/2026)
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }

  const ym1 = str.match(/^(\d{4})-(\d{2})$/);
  if (ym1) return new Date(`${ym1[1]}-${ym1[2]}-01T00:00:00`);

  const ym2 = str.match(/^(\d{2})\/(\d{4})$/);
  if (ym2) return new Date(`${ym2[2]}-${ym2[1]}-01T00:00:00`);

  return null;
}

// Calcule les heures ouvrées entre deux dates (Lun-Ven, 9h-18h)
function workingHoursBetween(start, end) {
  if (!start || !end || end <= start) return null;
  const WORK_START = 9;
  const WORK_END   = 18;
  let ms  = 0;
  let cur = new Date(start);
  while (cur < end) {
    const day = cur.getDay(); // 0=Dim, 1=Lun … 5=Ven, 6=Sam
    if (day >= 1 && day <= 5) {
      const dayStart = new Date(cur); dayStart.setHours(WORK_START, 0, 0, 0);
      const dayEnd   = new Date(cur); dayEnd.setHours(WORK_END,   0, 0, 0);
      const from = Math.max(cur.getTime(),  dayStart.getTime());
      const to   = Math.min(end.getTime(),  dayEnd.getTime());
      if (to > from) ms += to - from;
    }
    cur.setDate(cur.getDate() + 1);
    cur.setHours(0, 0, 0, 0);
  }
  const h = ms / 3600000;
  return h > 0 ? h : null;
}

function inRange(dateStr, from, to) {
  if (!from && !to) return true;
  const d = parseFlexDate(dateStr);
  if (!d) return true;
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

// ---------------------------------------------------------------
// GOOGLE SHEETS API v4 — FETCH & PARSE
// ---------------------------------------------------------------
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
  if (pct >= goodAbove)       return C.success;
  if (pct >= goodAbove * 0.8) return C.warning;
  return C.danger;
}

// ---------------------------------------------------------------
// COMPUTE — KPIs depuis les tickets bruts
// ---------------------------------------------------------------
function computeKPIs(tickets) {
  const total     = tickets.length;
  const closed    = tickets.filter(t => classifyStatus(t.status) === 'closed').length;
  const solved    = tickets.filter(t => { const s = (t.status || '').toLowerCase().trim(); return STATUS_SOLVED.some(v => s.includes(v)); }).length;
  const cancelled = tickets.filter(t => classifyStatus(t.status) === 'cancelled').length;
  const rejected  = tickets.filter(t => classifyStatus(t.status) === 'rejected').length;
  const suspended = tickets.filter(t => classifyStatus(t.status) === 'suspended').length;
  const open      = total - closed - cancelled - rejected - suspended;

  const isOverdue = t => classifyStatus(t.status) === 'open' && (
    (t.tto_status || '').toUpperCase() === 'BREACH' ||
    (t.ttr_status || '').toUpperCase() === 'BREACH'
  );

  const overdue = tickets.filter(isOverdue).length;

  const atRisk = tickets.filter(t => {
    const ts = (t.time_status || t.time_status_label || '').toLowerCase();
    return classifyStatus(t.status) === 'open' && ts.includes('risk');
  }).length;

  const reopened = tickets.filter(t => {
    const v = (t.rejection || '').trim().toUpperCase();
    return v !== '' && v !== 'NON';
  }).length;

  const reopening = tickets.filter(t => {
    const v = (t.reopening || '').trim().toUpperCase();
    return v !== '' && v !== 'NON';
  }).length;

  // Debug — valeurs distinctes des colonnes rejection et reopening
  const rejectionValues = {};
  const reopeningValues = {};
  tickets.forEach(t => {
    const r = (t.rejection  || '(vide)').trim(); rejectionValues[r]  = (rejectionValues[r]  || 0) + 1;
    const o = (t.reopening  || '(vide)').trim(); reopeningValues[o]  = (reopeningValues[o]  || 0) + 1;
  });
  console.group('[Rejetés / Réouvertures — valeurs brutes]');
  console.log(`Rejetés comptés   : ${reopened}  (logique: rejection != vide && != NON)`);
  console.log(`Réouvertures comptées : ${reopening}  (logique: reopening != vide && != NON)`);
  console.log('Valeurs distinctes — colonne rejection :');  console.table(rejectionValues);
  console.log('Valeurs distinctes — colonne reopening :'); console.table(reopeningValues);
  console.groupEnd();

  // Temps de résolution en heures ouvrées (Lun-Ven, 9h-18h) pour les tickets fermés
  const closedTickets = tickets.filter(t => classifyStatus(t.status) === 'closed');
  const resTimes = closedTickets
    .map(t => workingHoursBetween(parseFlexDate(t.creation_date), parseFlexDate(t.end_date)))
    .filter(h => h !== null);

  console.group('[Résolution moyenne — heures ouvrées Lun-Ven 9h-18h]');
  console.log('Tickets fermés total :', closedTickets.length);
  console.log('Tickets avec heures ouvrées > 0 :', resTimes.length);
  console.log('Tickets exclus (end_date absente, ≤ creation_date, ou 0h ouvrées) :', closedTickets.length - resTimes.length);
  if (resTimes.length) {
    const sample = closedTickets
      .map(t => {
        const s = parseFlexDate(t.creation_date);
        const e = parseFlexDate(t.end_date);
        const ho = workingHoursBetween(s, e);
        const hc = (s && e && e > s) ? +((e - s) / 3600000).toFixed(2) : null;
        return {
          id: t.ticket_id || t.id || '?',
          creation_date: t.creation_date,
          end_date: t.end_date,
          'h_ouvrées': ho !== null ? +ho.toFixed(2) : null,
          'h_calendaires': hc,
        };
      })
      .filter(r => r['h_ouvrées'] !== null)
      .slice(0, 10);
    console.table(sample);
    const sum = resTimes.reduce((a, b) => a + b, 0);
    console.log('Somme h ouvrées :', sum.toFixed(2));
    console.log('Moyenne h ouvrées :', (sum / resTimes.length).toFixed(2));
    console.log('Moyenne jours ouvrés (÷9h) :', (sum / resTimes.length / 9).toFixed(2));
  }
  console.groupEnd();

  const avgRes = resTimes.length
    ? resTimes.reduce((a, b) => a + b, 0) / resTimes.length : 0;

  const sortedRes = [...resTimes].sort((a, b) => a - b);
  const medianRes = sortedRes.length ? sortedRes[Math.floor(sortedRes.length / 2)] : 0;
  // P90 création→clôture (Math.ceil pour éviter de sous-estimer avec peu de données)
  const p90Res    = sortedRes.length ? sortedRes[Math.max(0, Math.ceil(sortedRes.length * 0.9) - 1)] : 0;

  // P90 SLA : sla_assignment_date → sla_resolution_date (heures ouvrées)
  const slaResTimes = closedTickets
    .map(t => workingHoursBetween(parseFlexDate(t.sla_assignment_date), parseFlexDate(t.sla_resolution_date)))
    .filter(h => h !== null);
  const sortedSlaTimes = [...slaResTimes].sort((a, b) => a - b);
  const p90ResSla = sortedSlaTimes.length ? sortedSlaTimes[Math.max(0, Math.ceil(sortedSlaTimes.length * 0.9) - 1)] : 0;

  console.group('[P90 résolution — comparaison]');
  console.log('P90 création→clôture     :', p90Res.toFixed(2), 'h ouvrées');
  console.log('P90 sla_assign→sla_reso  :', p90ResSla.toFixed(2), 'h ouvrées', `(sur ${slaResTimes.length} tickets)`);
  console.groupEnd();

  // SLA : ticket conforme si ni tto_status ni ttr_status ne valent 'BREACH'
  const isBreach   = t => (t.tto_status || '').toUpperCase() === 'BREACH'
                       || (t.ttr_status || '').toUpperCase() === 'BREACH';
  const slaOk      = tickets.filter(t => !isBreach(t)).length;
  const slaCompPct = total > 0 ? (slaOk / total) * 100 : 0;
  const resoPct    = total > 0 ? (closed / total) * 100 : 0;

  // TTO / TTR Breach counts et ratios
  const ttoBreach    = tickets.filter(t => (t.tto_status || '').toUpperCase() === 'BREACH').length;
  const ttrBreach    = tickets.filter(t => (t.ttr_status || '').toUpperCase() === 'BREACH').length;
  const ttoBreachPct = total > 0 ? (ttoBreach / total) * 100 : 0;
  const ttrBreachPct = total > 0 ? (ttrBreach / total) * 100 : 0;

  // Ratios par mois — 3 derniers mois présents dans les tickets
  const _mBreachMap = {};
  tickets.forEach(t => {
    const d = parseFlexDate(t.creation_date);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!_mBreachMap[key]) _mBreachMap[key] = {
      label: d.toLocaleDateString('fr-FR', { month: 'short' }),
      total: 0, tto: 0, ttr: 0
    };
    _mBreachMap[key].total++;
    if ((t.tto_status || '').toUpperCase() === 'BREACH') _mBreachMap[key].tto++;
    if ((t.ttr_status || '').toUpperCase() === 'BREACH') _mBreachMap[key].ttr++;
  });
  const last3BreachMonths = Object.keys(_mBreachMap).sort().slice(-3).map(k => ({
    label: _mBreachMap[k].label,
    ttoRatio: _mBreachMap[k].total > 0 ? (_mBreachMap[k].tto / _mBreachMap[k].total) * 100 : 0,
    ttrRatio: _mBreachMap[k].total > 0 ? (_mBreachMap[k].ttr / _mBreachMap[k].total) * 100 : 0,
  }));

  // Alertes synthétiques — comptés depuis buildAlerts pour cohérence avec la liste
  const allAlerts      = buildAlerts(tickets);
  const criticalAlerts = allAlerts.filter(a => a.severity === 'CRITICAL').length;
  const warningAlerts  = allAlerts.filter(a => a.severity === 'WARNING').length;
  const infoAlerts     = allAlerts.filter(a => a.severity === 'INFO').length;

  // Backlog cumulatif : total créés – total fermés
  const backlogCumul = total - closed;

  // Ratio entrées/sorties : créés / fermés (999 si fermés = 0)
  const ratioEntreeSortie = closed > 0 ? Math.round((total / closed) * 100) / 100 : 999;

  // Dernière date de création connue comme horodatage
  const lastDate = tickets
    .map(t => parseFlexDate(t.creation_date))
    .filter(Boolean)
    .sort((a, b) => b - a)[0];

  return {
    total, open, closed, solved, cancelled, rejected, suspended,
    overdue, atRisk, reopened, reopening,
    resoPct, slaCompPct,
    avgRes, medianRes, p90Res, p90ResSla,
    criticalAlerts, warningAlerts, infoAlerts,
    backlogCumul, ratioEntreeSortie,
    ttoBreach, ttrBreach, ttoBreachPct, ttrBreachPct, last3BreachMonths,
    lastDate,
  };
}

// ---------------------------------------------------------------
// COMPUTE — Tendance mensuelle
// ---------------------------------------------------------------
function computeMonthly(tickets, from, to) {
  const byMonth = {};

  tickets.forEach(t => {
    const d = parseFlexDate(t.creation_date);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { month: key, created: 0, closed: 0 };
    byMonth[key].created++;
  });

  tickets.filter(t => classifyStatus(t.status) === 'closed').forEach(t => {
    const d = parseFlexDate(t.end_date) || parseFlexDate(t.creation_date);
    if (!d) return;
    if (!inRange(d.toISOString().slice(0, 10), from, to)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { month: key, created: 0, closed: 0 };
    byMonth[key].closed++;
  });

  let backlog = 0;
  const sorted = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  sorted.forEach(m => {
    backlog = Math.max(0, backlog + m.created - m.closed);
    m.backlog = backlog;
  });

  return sorted;
}

// ---------------------------------------------------------------
// COMPUTE — Tendance hebdomadaire
// ---------------------------------------------------------------
function isoWeekKey(d) {
  const tmp = new Date(d);
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const jan4 = new Date(tmp.getFullYear(), 0, 4);
  const week = 1 + Math.round(((tmp - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${tmp.getFullYear()}-S${String(week).padStart(2, '0')}`;
}

function computeWeekly(tickets, from, to) {
  const byWeek = {};

  tickets.forEach(t => {
    const d = parseFlexDate(t.creation_date);
    if (!d) return;
    const key = isoWeekKey(d);
    if (!byWeek[key]) byWeek[key] = { week: key, created: 0, closed: 0 };
    byWeek[key].created++;
  });

  tickets.filter(t => classifyStatus(t.status) === 'closed').forEach(t => {
    const d = parseFlexDate(t.end_date) || parseFlexDate(t.creation_date);
    if (!d) return;
    if (!inRange(d.toISOString().slice(0, 10), from, to)) return;
    const key = isoWeekKey(d);
    if (!byWeek[key]) byWeek[key] = { week: key, created: 0, closed: 0 };
    byWeek[key].closed++;
  });

  let backlog = 0;
  const sorted = Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week));
  sorted.forEach(m => {
    backlog = Math.max(0, backlog + m.created - m.closed);
    m.backlog = backlog;
  });

  return sorted;
}

function setTrendGranularity(g) {
  STATE.trendGranularity = g;
  document.getElementById('btn-week').classList.toggle('active', g === 'week');
  document.getElementById('btn-month').classList.toggle('active', g === 'month');
  const { from, to } = getDateFilter();
  const data = g === 'week'
    ? computeWeekly(STATE.filteredTickets, from, to)
    : computeMonthly(STATE.filteredTickets, from, to);
  renderMonthlyChart(data);
}

// ---------------------------------------------------------------
// COMPUTE — Performance équipe
// ---------------------------------------------------------------
function computeTeam(tickets) {
  const byPerson = {};

  tickets.forEach(t => {
    const person = (t.support_person || '').trim() || 'Non assigné';
    if (!byPerson[person]) byPerson[person] = {
      person, assigned_total: 0, open_count: 0,
      closed_count: 0, overdue_count: 0,
    };
    const p   = byPerson[person];
    const cls = classifyStatus(t.status);
    p.assigned_total++;
    if (cls === 'closed') {
      p.closed_count++;
    } else if (cls === 'open') {
      p.open_count++;
    }
    if ((t.tto_status || '').toUpperCase() === 'BREACH' || (t.ttr_status || '').toUpperCase() === 'BREACH') {
      p.overdue_count++;
    }
  });

  return Object.values(byPerson);
}

// ---------------------------------------------------------------
// COMPUTE — Distributions par dimension
// ---------------------------------------------------------------
function computeAgeBracket(t) {
  const now     = new Date();
  const created = parseFlexDate(t.creation_date);
  if (!created) return 'Autre';
  const cls = classifyStatus(t.status);
  const ref = cls === 'closed' ? (parseFlexDate(t.end_date) || now) : now;
  const days = (ref - created) / 86400000;
  if (days <  1)  return '<1j';
  if (days <  3)  return '1-3j';
  if (days <  7)  return '3-7j';
  if (days < 15)  return '7-15j';
  if (days < 30)  return '15-30j';
  return '>30j';
}

const AGE_BRACKET_ORDER = ['<1j', '1-3j', '3-7j', '7-15j', '15-30j', '>30j'];

function computeDistributions(tickets) {
  const DIMS = ['status', 'location', 'category'];
  const result = [];

  // Dimensions standard
  DIMS.forEach(col => {
    const counts = {};
    tickets.forEach(t => {
      const val = (t[col] || '').trim() || 'Autre';
      counts[val] = (counts[val] || 0) + 1;
    });
    Object.entries(counts).forEach(([value, count]) => {
      result.push({ dimension: col, value, count });
    });
  });

  // Age bracket calculé dynamiquement
  const ageCounts = {};
  AGE_BRACKET_ORDER.forEach(b => { ageCounts[b] = 0; });
  tickets.forEach(t => {
    const b = computeAgeBracket(t);
    if (ageCounts[b] !== undefined) ageCounts[b]++;
    else ageCounts[b] = (ageCounts[b] || 0) + 1;
  });
  AGE_BRACKET_ORDER.forEach(b => {
    result.push({ dimension: 'age_bracket', value: b, count: ageCounts[b] || 0 });
  });

  return result;
}

// ---------------------------------------------------------------
// PÉRIMÈTRE KPI — tickets exclus des calculs
// ---------------------------------------------------------------
function inScope(t) {
  if ((t.scenario || '').toLowerCase() === 'exclu_no_artimis') return false;
  if (['1', 'true', 'yes', 'oui'].includes((t.is_misrouted || '').toLowerCase())) return false;
  return true;
}

// ---------------------------------------------------------------
// APPLY FILTERS — re-calcule tout depuis les tickets filtrés
// ---------------------------------------------------------------
function applyFilters() {
  const { from, to } = getDateFilter();

  // Périmètre KPI : date + hors exclusions
  const tickets = STATE.raw.tickets
    .filter(t => inRange(t.creation_date, from, to))
    .filter(inScope);

  STATE.filteredTickets = tickets;

  const kpis  = computeKPIs(tickets);

  // Backlog cumulatif : toutes périodes confondues (ignore le filtre date)
  const allInScope = STATE.raw.tickets.filter(inScope);
  const allClosed  = allInScope.filter(t => classifyStatus(t.status) === 'closed').length;
  kpis.backlogCumul = allInScope.length - allClosed;
  const trend = STATE.trendGranularity === 'week'
    ? computeWeekly(tickets, from, to)
    : computeMonthly(tickets, from, to);
  kpis.backlogTrend = trend.length >= 2
    ? trend[trend.length - 1].backlog - trend[trend.length - 2].backlog
    : null;
  const team    = computeTeam(tickets);
  const dists   = computeDistributions(tickets);

  renderKPIs(kpis);
  renderAlertsRow(kpis);
  renderMonthlyChart(trend);
  renderOverdueAlerts(tickets);
  renderTeamTable(team);
  renderDistributions(dists);
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
// CHART INSTANCES
// ---------------------------------------------------------------
let monthlyChart = null;
const distCharts = {};

// ---------------------------------------------------------------
// RENDER — KPI CARDS
// ---------------------------------------------------------------
function renderKPIs(kpis) {
  if (kpis.lastDate) {
    document.getElementById('last-updated').textContent =
      kpis.lastDate.toLocaleDateString('fr-FR');
  }

  const cards = [
    { label: 'Total Tickets',       value: fmt(kpis.total),    color: C.accent  },
    { label: 'Ouverts',             value: fmt(kpis.open),     color: kpis.open  > 0 ? C.warning : C.success,
      sub: `Backlog : ${fmt(kpis.open)}` },
    { label: 'Fermés',              value: fmt(kpis.closed),   color: C.success  },
    { label: 'Taux de résolution',  value: fmtPct(kpis.resoPct),
      color: pctColor(kpis.resoPct, 80) },
    { label: 'Backlog cumulatif', value: (() => {
        const d = kpis.backlogTrend;
        const arrow = d === null ? ''
          : d > 0 ? ` <span style="color:${C.danger};font-size:.65em;vertical-align:middle">▲</span>`
          : d < 0 ? ` <span style="color:${C.success};font-size:.65em;vertical-align:middle">▼</span>`
          : '';
        return fmt(kpis.backlogCumul) + arrow;
      })(),
      color: kpis.backlogCumul > 0 ? C.warning : C.success },
    { label: 'Ratio entrées/sorties', value: kpis.ratioEntreeSortie === 999 ? '999' : kpis.ratioEntreeSortie.toFixed(2),
      color: kpis.ratioEntreeSortie > 1.5 ? C.danger : kpis.ratioEntreeSortie > 1 ? C.warning : C.success },
    { label: 'Résolution moyenne',  value: fmtHours(kpis.avgRes),    color: C.teal,
      sub: `Médiane : ${fmtHours(kpis.medianRes)}` },
    { label: 'P90 assign→résol SLA', value: fmtHours(kpis.p90ResSla), color: C.purple,
      sub: `P90 création→clôture : ${fmtHours(kpis.p90Res)}` },
    { label: 'Rejetés',             value: fmt(kpis.reopened),  color: kpis.reopened > 0 ? C.warning : C.text2,
      sub: `Taux : ${fmtPct(kpis.solved > 0 ? kpis.reopened / kpis.solved * 100 : 0)}` },
    { label: 'Réouvertures',        value: fmt(kpis.reopening), color: kpis.reopening > 0 ? C.warning : C.text2,
      sub: `Taux : ${fmtPct(kpis.solved > 0 ? kpis.reopening / kpis.solved * 100 : 0)}` },
  ];

  document.getElementById('kpi-grid').innerHTML = cards.map(k => `
    <div class="kpi-card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="color:${k.color}">${k.value}</div>
      ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
    </div>`).join('');
}

// ---------------------------------------------------------------
// RENDER — ALERT BADGES (calculés depuis tickets)
// ---------------------------------------------------------------
function renderAlertsRow(kpis) {
  const fmtRatio = pct => `${Math.round(pct)}%`;
  const m3sub = (field) => (kpis.last3BreachMonths || [])
    .map(m => `${m.label} ${fmtRatio(m[field])}`)
    .join(' · ') || '—';

  const badges = [
    { label: 'Alertes critiques', value: fmt(kpis.criticalAlerts), color: C.danger  },
    { label: 'Alertes warning',   value: fmt(kpis.warningAlerts),  color: C.warning },
    { label: 'Alertes info',      value: fmt(kpis.infoAlerts),     color: C.accent  },
    { label: 'Ratio TTO Breach',  value: fmtRatio(kpis.ttoBreachPct),
      color: kpis.ttoBreachPct > 90 ? C.danger : kpis.ttoBreachPct >= 50 ? C.warning : C.success,
      sub: m3sub('ttoRatio') },
    { label: 'Ratio TTR Breach',  value: fmtRatio(kpis.ttrBreachPct),
      color: kpis.ttrBreachPct > 90 ? C.danger : kpis.ttrBreachPct >= 50 ? C.warning : C.success,
      sub: m3sub('ttrRatio') },
    { label: 'Conformité SLA',    value: fmtPct(kpis.slaCompPct),
      color: kpis.slaCompPct >= 98 ? C.success : kpis.slaCompPct >= 50 ? C.warning : C.danger },
  ];

  document.getElementById('alerts-row').innerHTML = badges.map(b => `
    <div class="alert-badge">
      <div class="alert-badge-value" style="color:${b.color}">${b.value}</div>
      <div class="alert-badge-label">${b.label}</div>
      ${b.sub ? `<div class="alert-badge-sub">${b.sub}</div>` : ''}
    </div>`).join('');
}

// ---------------------------------------------------------------
// RENDER — TREND CHART (mensuelle ou hebdomadaire)
// ---------------------------------------------------------------
const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

function formatTrendLabel(key) {
  // Weekly key: "2024-S03" → "S03 2024"
  if (key.includes('-S')) {
    const [yr, sw] = key.split('-');
    return `${sw} ${yr}`;
  }
  // Monthly key: "2024-01" → "Jan 2024"
  const [yr, mo] = key.split('-');
  return `${MONTHS_FR[parseInt(mo, 10) - 1]} ${yr}`;
}

function renderMonthlyChart(monthly) {
  const canvas = document.getElementById('monthly-chart');
  if (!canvas) return;
  if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }

  if (!monthly.length) {
    canvas.insertAdjacentHTML('afterend', '<p class="no-data">Aucune donnée disponible</p>');
    canvas.remove();
    return;
  }

  const keyField = monthly[0].week !== undefined ? 'week' : 'month';
  const labels  = monthly.map(m => formatTrendLabel(m[keyField]));
  const created = monthly.map(m => m.created);
  const closed  = monthly.map(m => m.closed);
  const backlog = monthly.map(m => m.backlog);

  monthlyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Créés',   data: created, backgroundColor: C.accent  + 'cc', borderWidth: 0, borderRadius: 4, order: 2 },
        { label: 'Fermés',  data: closed,  backgroundColor: C.success + 'cc', borderWidth: 0, borderRadius: 4, order: 2 },
        {
          label: 'Backlog', data: backlog, type: 'line',
          borderColor: C.warning, backgroundColor: C.warning + '18',
          fill: true, tension: 0.4, pointRadius: 4, pointHoverRadius: 6,
          pointBackgroundColor: C.warning, pointBorderColor: '#fff', pointBorderWidth: 2,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: C.text2, boxWidth: 10, boxHeight: 10, borderRadius: 2,
          useBorderRadius: true, padding: 16, font: { size: 12 } } },
      },
      scales: {
        x: { ticks: { color: C.text2, font: { size: 11 } }, grid: { color: C.grid } },
        y: { ticks: { color: C.text2, font: { size: 11 } }, grid: { color: C.grid }, beginAtZero: true },
      },
    },
  });
}

// ---------------------------------------------------------------
// BUILD ALERTS — moteur central des 10 types d'alertes
// ---------------------------------------------------------------
function buildAlerts(tickets) {
  const now = new Date();
  const daysSince = dateStr => {
    const d = parseFlexDate(dateStr);
    return d ? Math.floor((now - d) / 86400000) : null;
  };

  const alerts = [];

  tickets.forEach(t => {
    const cls     = classifyStatus(t.status);
    const id      = t.number || t.ticket_id || '';
    const title   = t.title || t.description || '';
    const date    = t.creation_date || '';
    const summary = (t.ai_summary || '').trim();

    // CRITIQUE — TTO SLA dépassé (tickets ouverts uniquement)
    if (cls === 'open' && (t.tto_status || '').toUpperCase() === 'BREACH') {
      alerts.push({ severity: 'CRITICAL', type: 'tto_breach', id, title, date, summary,
        msg: `${id} — TTO SLA dépassé${title ? ' : ' + title : ''}` });
    }

    // CRITIQUE — TTR SLA dépassé (tickets ouverts uniquement)
    if (cls === 'open' && (t.ttr_status || '').toUpperCase() === 'BREACH') {
      alerts.push({ severity: 'CRITICAL', type: 'ttr_breach', id, title, date, summary,
        msg: `${id} — TTR SLA dépassé${title ? ' : ' + title : ''}` });
    }

    // CRITIQUE — Ticket ouvert > 30j
    if (cls === 'open') {
      const age = daysSince(date);
      if (age !== null && age > 30) {
        alerts.push({ severity: 'CRITICAL', type: 'old_ticket', id, title, date, summary,
          msg: `${id} ouvert depuis ${age}j${title ? ' : ' + title : ''}` });
      }
    }

    // ATTENTION — TTR à risque
    if (cls === 'open' && (t.ttr_status || '').toUpperCase() === 'AT_RISK') {
      alerts.push({ severity: 'WARNING', type: 'ttr_at_risk', id, title, date, summary,
        msg: `${id} — TTR à risque${title ? ' : ' + title : ''}` });
    }

    // ATTENTION — Réouverture
    const reopVal = (t.reopening || '').trim().toUpperCase();
    if (cls === 'open' && (reopVal && reopVal !== 'NON')) {
      alerts.push({ severity: 'WARNING', type: 'reopened', id, title, date, summary,
        msg: `${id} — Réouverture : ${t.reopening.trim()}` });
    }

    // ATTENTION — Rejet détecté
    const rejVal = (t.rejection || '').trim().toUpperCase();
    if (cls === 'open' && (rejVal && rejVal !== 'NON')) {
      alerts.push({ severity: 'WARNING', type: 'rejection', id, title, date, summary,
        msg: `${id} — Rejet : ${t.rejection.trim()}` });
    }

    // ATTENTION — Ouvert sans assigné (support_person vide)
    if (cls === 'open' && !(t.support_person || '').trim()) {
      const age = daysSince(date);
      const sinceStr = age !== null ? ` depuis ${age}j` : '';
      alerts.push({ severity: 'WARNING', type: 'en_attente', id, title, date, summary,
        msg: `${id} — Ouvert sans assigné${sinceStr}${title ? ' : ' + title : ''}` });
    }

    // ATTENTION — Ping-pong
    const pingpong = (t.is_ping_pong || '').trim().toUpperCase();
    if (cls === 'open' && (pingpong === 'OUI' || pingpong === '1' || pingpong === 'TRUE')) {
      alerts.push({ severity: 'WARNING', type: 'ping_pong', id, title, date, summary,
        msg: `${id} — Ping-pong détecté${title ? ' : ' + title : ''}` });
    }

    // CRITIQUE — Comportement négatif détecté par IA
    if (cls === 'open' && ((t.ai_behavior_alert || '').trim() || (t.ai_behavior_severity || '').trim())) {
      const detail = [t.ai_behavior_alert, t.ai_behavior_severity].filter(v => (v || '').trim()).join(' / ');
      alerts.push({ severity: 'CRITICAL', type: 'ai_behavior', id, title, date, summary,
        msg: `${id} — Comportement négatif détecté : ${detail}${title ? ' (' + title + ')' : ''}` });
    }
  });

  // INFO — Surcharge : personne > 10 tickets ouverts
  const workload = {};
  tickets.filter(t => classifyStatus(t.status) === 'open').forEach(t => {
    const p = (t.support_person || t.last_support_person || '').trim();
    if (p) workload[p] = (workload[p] || 0) + 1;
  });
  Object.entries(workload).forEach(([person, count]) => {
    if (count > 10) {
      alerts.push({ severity: 'INFO', type: 'high_workload', id: '', title: '', date: '',
        msg: `${person} — ${count} tickets ouverts en charge` });
    }
  });

  // Tri : CRITIQUE → ATTENTION → INFO
  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  return alerts;
}

// ---------------------------------------------------------------
// RENDER — ALERTES ACTIVES
// ---------------------------------------------------------------
function renderOverdueAlerts(tickets) {
  const container = document.getElementById('alerts-table');
  const pill      = document.getElementById('active-alerts-count');

  const alerts = buildAlerts(tickets);

  if (pill) pill.textContent = alerts.length > 0 ? alerts.length : '';

  if (!alerts.length) {
    container.innerHTML = '<p class="no-data">Aucune alerte active</p>';
    return;
  }

  const SEV = {
    CRITICAL: { color: C.danger,  bg: 'rgba(255,59,48,0.07)',  label: 'CRITIQUE'  },
    WARNING:  { color: C.warning, bg: 'rgba(255,159,10,0.07)', label: 'ATTENTION' },
    INFO:     { color: C.teal,    bg: 'rgba(50,173,230,0.07)', label: 'INFO'      },
  };

  const TYPE_LABEL = {
    tto_breach:     'TTO Breach',
    ttr_breach:     'TTR Breach',
    old_ticket:     'Ticket ancien',
    ttr_at_risk:    'TTR à risque',
    reopened:       'Réouverture',
    rejection:      'Rejet',
    en_attente:     'Sans assigné',
    ping_pong:      'Ping-pong',
    ai_behavior:    'Comportement IA',
    high_workload:  'Surcharge',
  };

  container.innerHTML = `<div class="alerts-list">
    ${alerts.slice(0, 25).map(a => {
      const cfg = SEV[a.severity];
      const summaryAttr = a.summary ? ` data-summary="${a.summary.replace(/"/g, '&quot;')}"` : '';
      return `
        <div class="alert-item" style="border-left-color:${cfg.color}; background:${cfg.bg}">
          <div class="alert-item-header">
            <span class="alert-severity" style="color:${cfg.color}">${cfg.label}</span>
            <span class="alert-type-label" style="color:${cfg.color}">${TYPE_LABEL[a.type] || a.type}</span>
            ${a.id ? `<span class="alert-ticket${a.summary ? ' has-summary' : ''}"${summaryAttr}>#${a.id}</span>` : ''}
            <span class="alert-first-seen">${a.date}</span>
          </div>
          <div class="alert-message">${a.msg}</div>
        </div>`;
    }).join('')}
  </div>`;

  // Tooltip résumé au survol de l'ID ticket
  let tip = document.getElementById('ticket-summary-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'ticket-summary-tip';
    document.body.appendChild(tip);
  }
  container.querySelectorAll('.alert-ticket.has-summary').forEach(el => {
    el.addEventListener('mouseenter', e => {
      tip.textContent = el.dataset.summary;
      tip.classList.add('visible');
      const r = el.getBoundingClientRect();
      tip.style.left = `${r.left + window.scrollX}px`;
      tip.style.top  = `${r.bottom + window.scrollY + 6}px`;
    });
    el.addEventListener('mouseleave', () => tip.classList.remove('visible'));
  });
}

// ---------------------------------------------------------------
// RENDER — TEAM TABLE
// ---------------------------------------------------------------
function renderTeamTable(team) {
  const container = document.getElementById('team-table');

  if (!team.length) {
    container.innerHTML = '<p class="no-data">Aucune donnée équipe disponible</p>';
    return;
  }

  const sorted     = [...team].sort((a, b) => b.assigned_total - a.assigned_total);
  const maxAssigned = Math.max(...sorted.map(t => t.assigned_total), 1);

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Agent</th><th>Assignés</th><th>Ouverts</th>
          <th>Fermés</th><th>En retard</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(t => {
          const pct      = ((t.assigned_total / maxAssigned) * 100).toFixed(0);
          const initials = t.person.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
          return `
            <tr>
              <td><div class="person-cell">
                <div class="person-avatar">${initials}</div>
                <span>${t.person}</span>
              </div></td>
              <td><div class="progress-cell">
                <span>${fmt(t.assigned_total)}</span>
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
              </div></td>
              <td><span class="badge badge-warning">${fmt(t.open_count)}</span></td>
              <td><span class="badge badge-success">${fmt(t.closed_count)}</span></td>
              <td><span class="badge ${t.overdue_count > 0 ? 'badge-danger' : 'badge-neutral'}">${fmt(t.overdue_count)}</span></td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ---------------------------------------------------------------
// RENDER — DISTRIBUTIONS
// ---------------------------------------------------------------
function renderDistributions(distributions) {
  const container = document.getElementById('distributions');

  Object.values(distCharts).forEach(c => c.destroy());
  Object.keys(distCharts).forEach(k => delete distCharts[k]);

  if (!distributions.length) {
    container.innerHTML = '<p class="no-data">Aucune donnée de distribution</p>';
    return;
  }

  const byDim = {};
  distributions.forEach(d => {
    if (!byDim[d.dimension]) byDim[d.dimension] = [];
    byDim[d.dimension].push({ value: d.value, count: d.count });
  });

  container.innerHTML = Object.entries(byDim).map(([dim]) => {
    const id = 'dist-' + dim.replace(/[^a-z0-9]/gi, '-');
    const title = dim.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return `
      <div class="dist-chart-card">
        <div class="dist-title">${title}</div>
        <canvas id="${id}" height="220"></canvas>
      </div>`;
  }).join('');

  requestAnimationFrame(() => {
    Object.entries(byDim).forEach(([dim, items]) => {
      const id     = 'dist-' + dim.replace(/[^a-z0-9]/gi, '-');
      const canvas = document.getElementById(id);
      if (!canvas) return;

      const sorted = dim === 'age_bracket'
        ? AGE_BRACKET_ORDER.map(b => items.find(i => i.value === b) || { value: b, count: 0 })
        : [...items].sort((a, b) => b.count - a.count).slice(0, 10);
      const isLong = sorted.length > 5;

      distCharts[id] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: sorted.map(i => i.value),
          datasets: [{
            data:            sorted.map(i => i.count),
            backgroundColor: sorted.map((_, idx) => CHART_COLORS[idx % CHART_COLORS.length] + 'bb'),
            borderColor:     sorted.map((_, idx) => CHART_COLORS[idx % CHART_COLORS.length]),
            borderWidth: 1, borderRadius: 4,
          }],
        },
        options: {
          indexAxis: isLong ? 'y' : 'x',
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` ${isLong ? ctx.parsed.x : ctx.parsed.y} tickets` } },
          },
          scales: {
            x: { ticks: { color: C.text2, font: { size: 11 } }, grid: { color: C.grid } },
            y: { ticks: { color: C.text2, font: { size: 11 } }, grid: { color: C.grid } },
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
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.view === name)
  );
  document.querySelectorAll('.view-section').forEach(el =>
    el.classList.toggle('hidden', el.dataset.view !== name)
  );
}

// ---------------------------------------------------------------
// RENDER — TICKETS TABLE
// ---------------------------------------------------------------
function renderTicketsTable(tickets) {
  const container = document.getElementById('tickets-table');
  if (!container) return;

  if (!tickets.length) {
    container.innerHTML = '<p class="no-data">Aucun ticket disponible</p>';
    return;
  }

  const HIDDEN_COLS = new Set([
    'scenario', 'category', 'title', 'time_status', 'time_status_label',
    'priority', 'impact', 'origin', 'location', 'group', 'delay_minutes',
    'action_type', 'description', 'last_updated', 'last_support_person',
    'contributors', 'is_misrouted', 'misrouted_to', 'has_artimis_consultant',
    'sla_assignment_date', 'sla_ownership_date', 'sla_resolution_date',
    'assignment_count',
    'solved_by_group', 'action_count',
    'ai_behavior_alert', 'ai_behavior_severity',
    'tto_hours', 'tto_status', 'ttr_hours', 'ttr_status',
    'is_ping_pong', 'rejection',
  ]);

  const LABELS = { ai_summary: 'Résumé' };
  const cols = Object.keys(tickets[0]).filter(c => !HIDDEN_COLS.has(c));
  const TS   = { sortCol: null, sortDir: 1, filters: {} };
  cols.forEach(c => { TS.filters[c] = ''; });

  const label = c => LABELS[c] || c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  function getRows() {
    let data = tickets.filter(t =>
      cols.every(c => {
        const f = TS.filters[c];
        return !f || (t[c] || '').toLowerCase().includes(f.toLowerCase());
      })
    );
    if (TS.sortCol) {
      const sc = TS.sortCol;
      data = [...data].sort((a, b) =>
        TS.sortDir * (a[sc] || '').localeCompare(b[sc] || '', 'fr', { numeric: true })
      );
    }
    return data;
  }

  function renderHead() {
    document.getElementById('tk-head-sort').innerHTML = cols.map(c => {
      const icon = TS.sortCol !== c ? 'tks-none' : TS.sortDir === 1 ? 'tks-asc' : 'tks-desc';
      return `<th class="sortable ${icon}" data-col="${c}">${label(c)}</th>`;
    }).join('');
    document.querySelectorAll('#tk-head-sort th').forEach(th =>
      th.addEventListener('click', () => {
        if (TS.sortCol === th.dataset.col) { TS.sortDir *= -1; }
        else { TS.sortCol = th.dataset.col; TS.sortDir = 1; }
        renderHead();
        renderBody();
      })
    );
  }

  function renderBody() {
    const rows  = getRows();
    const count = document.getElementById('tk-count');
    if (count) count.textContent = `${rows.length} ticket${rows.length !== 1 ? 's' : ''}`;
    document.getElementById('tk-body').innerHTML = rows.map(t => {
      const exclu = (t.scenario || '').toLowerCase() === 'exclu_no_artimis';
      return `<tr class="${exclu ? 'ticket-excluded' : ''}">${
        cols.map(c => `<td>${t[c] || '—'}</td>`).join('')
      }</tr>`;
    }).join('');
  }

  container.innerHTML = `
    <div class="tk-toolbar">
      <span class="tk-count" id="tk-count"></span>
    </div>
    <div style="overflow-x:auto">
      <table class="data-table tk-table">
        <thead>
          <tr id="tk-head-sort"></tr>
          <tr id="tk-head-filter">${cols.map(c =>
            `<th class="tk-filter-cell">
               <input class="tk-filter-input" type="text" data-col="${c}" placeholder="Filtrer…">
             </th>`
          ).join('')}</tr>
        </thead>
        <tbody id="tk-body"></tbody>
      </table>
    </div>`;

  container.querySelectorAll('.tk-filter-input').forEach(inp =>
    inp.addEventListener('input', () => { TS.filters[inp.dataset.col] = inp.value; renderBody(); })
  );

  renderHead();
  renderBody();
}

// ---------------------------------------------------------------
// MAIN LOAD — source unique : feuille Tickets
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
    const tickets = await fetchSheet('tickets');
    STATE.raw.tickets = tickets;

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

// Init
loadAllData();
