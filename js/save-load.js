
function __parseDate(d){ return d ? new Date(d + 'T00:00:00') : null; }
function __daysBetween(a,b){
  const da = __parseDate(a), db = __parseDate(b);
  if(!da || !db || isNaN(da) || isNaN(db)) return 0;
  return Math.floor((db - da)/86400000)+1;
}
function __computePerDay(scope, totalCost){
  if(!scope || !scope.start || !scope.end) return '';
  const days = __daysBetween(scope.start, scope.end);
  if(days <= 0) return '';
  const w = totalCost>0 ? (Number(scope.cost||0)/totalCost)*100 : 0;
  return w/days;
}
function __computeProgressValue(scope){
  if(!scope) return '';
  if(scope.totalUnits && Number(scope.totalUnits)>0){
    return scope.unitsToDate ?? '';
  }
  return scope.actualPct ?? '';
}


function generateScopeId(){
  return 'sc_' + Math.random().toString(36).slice(2,8);
}


/* ===============================
 * PRGS vNext FORCE SAVE PATH
 * Timestamp: 2026-01-01T18:28:19.623473Z
 * Fix:
 *  - Ensure Save Project ALWAYS uses buildAllCSV (vNext writer)
 *  - Legacy CSV builders are aliased to vNext
 * =============================== */

/*
© 2025 Rising Progress LLC. All rights reserved.
Save/Load/Export module extracted from progress.js
*/

let deps = null;
let __saveLoadInitialized = false;
let __saveLoadDomBound = false;
let __saveLoadAutoBound = false;


// Clear project-scoped History Date suppression keys.
// These keys persist in localStorage across page refreshes, so we must explicitly remove them
// when a *different* project is loaded via the Load dropdown.
function clearHistoryDateProjectSuppression(){
  try {
    localStorage.removeItem('rp_historyDate_lastProjectKey');
    localStorage.removeItem('rp_historyDate_activeProjectKey');
  } catch(e){}
}

// Refresh helper for dropdown preset loads.
// Ensures a clean session boundary *before* any preset data loads/renders (prevents lingering modal/session state).
function refreshWithPreset(presetKey){
  // Explicitly signal "new project" to History Date logic
  clearHistoryDateProjectSuppression();

  try{
    const url = new URL(window.location.href);
    url.searchParams.set('preset', String(presetKey || ''));
    url.searchParams.set('redirected', '1');
    window.location.replace(url.toString());
  }catch(e){
    // If URL parsing fails for any reason, fallback to a hard reload.
    window.location.reload();
  }
}


function requireDeps(){
  if(!deps) throw new Error('save-load.js not initialized. Call initSaveLoad(deps) first.');
  return deps;
}

function getModel(){
  const d = requireDeps();
  return (typeof d.getModel === 'function') ? d.getModel() : d.model;
}
function setModel(m){
  const d = requireDeps();
  if(typeof d.setModel === 'function') d.setModel(m);
  else d.model = m;
  // keep global mirror
  if (typeof window !== 'undefined') window.model = m;
}

function getLegendState(){
  const d = requireDeps();
  return (typeof d.getLegendState === 'function')
    ? d.getLegendState()
    : { baselineVisible:true, plannedVisible:true, actualVisible:true, forecastVisible:true };
}
function setLegendState(patch){
  const d = requireDeps();
  if(typeof d.setLegendState === 'function') d.setLegendState(patch);
}

/*****************
 * CSV helpers (Save/Load)
 *****************/

function escapeXml(v){
  if(v==null) return '';
  return String(v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&apos;');
}

function buildMSPXML() {
  const d = requireDeps();
  const model = getModel();
  const proj = model.project || {};

  // ---- Helpers ----
  const pad2 = (n) => String(n).padStart(2, '0');
  function nowIsoNoTZ(){
    const dt = new Date();
    return dt.getFullYear() + '-' + pad2(dt.getMonth()+1) + '-' + pad2(dt.getDate()) + 'T' +
           pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()) + ':' + pad2(dt.getSeconds());
  }
  function toMspDate(dateStr, timeStr){
    // dateStr: YYYY-MM-DD
    if (!dateStr) return '';
    const t = timeStr || '08:00:00';
    return dateStr + 'T' + t;
  }
  function shiftFinishDateForSmartsheet(dateStr){
    // Smartsheet may collapse weekend finishes. Shift Sat/Sun → Monday for XML only.
    if (!dateStr || String(dateStr).length < 10) return dateStr || '';
    const dd = String(dateStr).slice(0, 10);
    const dt = new Date(dd + 'T00:00:00Z');
    if (isNaN(dt)) return dd;
    const dow = dt.getUTCDay(); // 0=Sun ... 6=Sat
    let add = 0;
    if (dow === 6) add = 2; // Saturday → Monday
    else if (dow === 0) add = 1; // Sunday → Monday
    if (!add) return dd;
    dt.setUTCDate(dt.getUTCDate() + add);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d2 = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d2}`;
  }
  function fieldIdText(n){
    // MSPDI local task custom field IDs: Text1 = 188743731, Text2 = 188743732, ...
    return 188743730 + Number(n);
  }
  function boolTo01(v){ return v ? '1' : '0'; }
  function toIntPct(v){
    const num = (isFinite(v) ? Number(v) : 0);
    return String(d.clamp(Math.round(num), 0, 100));
  }
  function toDec(v){
    const num = (isFinite(v) ? Number(v) : 0);
    // Keep as a clean decimal string; avoid locale issues.
    return String(Math.round(num * 100) / 100);
  }

  // Derive a reasonable project start date (earliest scope start) for better imports.
  let projStart = '';
  if (Array.isArray(model.scopes)) {
    for (const s of model.scopes) {
      if (s && s.start) {
        if (!projStart || s.start < projStart) projStart = s.start;
      }
    }
  }
  if (!projStart) projStart = (new Date()).toISOString().slice(0, 10);

  // ---- Build project-level custom values (stored on Summary task UID=0) ----
  const labelToggleEl = document.getElementById('labelToggle');
  const baselineCb = document.getElementById('legendBaselineCheckbox');
  const plannedCb = document.getElementById('legendPlannedCheckbox');
  const actualCb = document.getElementById('legendActualCheckbox');
  const forecastCb = document.getElementById('legendForecastCheckbox');

  const labelToggleFlag = !!(labelToggleEl && typeof labelToggleEl.checked === 'boolean'
    ? labelToggleEl.checked
    : (proj.labelToggle || false));

  const legendBaselineFlag = !!(baselineCb && typeof baselineCb.checked === 'boolean'
    ? baselineCb.checked
    : (typeof proj.legendBaselineCheckbox !== 'undefined' ? proj.legendBaselineCheckbox : true));

  const legendPlannedFlag = !!(plannedCb && typeof plannedCb.checked === 'boolean'
    ? plannedCb.checked
    : (typeof proj.legendPlannedCheckbox !== 'undefined' ? proj.legendPlannedCheckbox : true));

  const legendActualFlag = !!(actualCb && typeof actualCb.checked === 'boolean'
    ? actualCb.checked
    : (typeof proj.legendActualCheckbox !== 'undefined' ? proj.legendActualCheckbox : true));

  const legendForecastFlag = !!(forecastCb && typeof forecastCb.checked === 'boolean'
    ? forecastCb.checked
    : (typeof proj.legendForecastCheckbox !== 'undefined' ? proj.legendForecastCheckbox : true));

  // Baseline snapshot as CSV (date,baselinePct)
  const baselineCSVLines = [];
  let baselineCSV = '';
  if (model.baseline && Array.isArray(model.baseline.days) && Array.isArray(model.baseline.planned)) {
    for (let i = 0; i < model.baseline.days.length; i++) {
      const dd = model.baseline.days[i];
      const v = model.baseline.planned[i];
      if (!dd) continue;
      baselineCSVLines.push(dd + ',' + (v == null ? '' : v) + '\n');
    }
  }

  baselineCSV = baselineCSVLines.join('');

  // History as CSV (date,actualPct)
  const actualCSVLines = [];
  let actualCSV = '';
  if (Array.isArray(model.history)) {
    model.history.forEach(h => {
      if (!h || !h.date) return;
      const v = (h.actualPct != null ? h.actualPct : 0);
      actualCSVLines.push(h.date + ',' + v + '\n');
    });
  }

  actualCSV = actualCSVLines.join('');

  // DailyActuals as CSV (date,value)
  const dailyCSVLines = [];
  let dailyCSV = '';
  if (model.dailyActuals && typeof model.dailyActuals === 'object') {
    Object.keys(model.dailyActuals).sort().forEach(dd => {
      const v = model.dailyActuals[dd];
      if (!dd) return;
      dailyCSVLines.push(dd + ',' + (v == null ? '' : v) + '\n');
    });
  }

  dailyCSV = dailyCSVLines.join('');

  // ---- Define custom fields (global definitions) ----
  // NOTE: Top-level <ExtendedAttributes> MUST ONLY contain field definitions (no values).
  const EXT_DEF = [
    { n: 1,  fieldName: 'Text1',  alias: 'Startup' },
    { n: 2,  fieldName: 'Text2',  alias: 'MarkerLabel' },
    { n: 3,  fieldName: 'Text3',  alias: 'LabelToggle' },
    { n: 4,  fieldName: 'Text4',  alias: 'LegendBaselineCheckbox' },
    { n: 5,  fieldName: 'Text5',  alias: 'LegendPlannedCheckbox' },
    { n: 6,  fieldName: 'Text6',  alias: 'LegendActualCheckbox' },
    { n: 7,  fieldName: 'Text7',  alias: 'LegendForecastCheckbox' },
    { n: 8,  fieldName: 'Text8',  alias: 'BaselineHistory' },
    { n: 9,  fieldName: 'Text9',  alias: 'ActualHistory' },
    { n: 10, fieldName: 'Text10', alias: 'DailyActuals' },
    { n: 11, fieldName: 'Text11', alias: 'UnitsToDate' },
    { n: 12, fieldName: 'Text12', alias: 'TotalUnits' },
    { n: 13, fieldName: 'Text13', alias: 'UnitsLabel' },
    { n: 14, fieldName: 'Text14', alias: 'SectionName' },
    { n: 15, fieldName: 'Text15', alias: 'TrueFinish' }
  ];

  // ---- XML ----
  const xmlLines = [];
  xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  xmlLines.push('<Project xmlns="http://schemas.microsoft.com/project">\n');
  // Required-ish core header fields (MSPDI / MS Project XML)
  xmlLines.push('  <SaveVersion>14</SaveVersion>\n');
  xmlLines.push('  <Name>' + escapeXml(proj.name || '') + '</Name>\n');
  xmlLines.push('  <LastSaved>' + nowIsoNoTZ() + '</LastSaved>\n');
  xmlLines.push('  <ScheduleFromStart>1</ScheduleFromStart>\n');
  xmlLines.push('  <StartDate>' + toMspDate(projStart, '08:00:00') + '</StartDate>\n');
  xmlLines.push('  <MinutesPerDay>480</MinutesPerDay>\n');
  xmlLines.push('  <MinutesPerWeek>2400</MinutesPerWeek>\n');
  xmlLines.push('  <DaysPerMonth>20</DaysPerMonth>\n');
  xmlLines.push('  <DefaultStartTime>08:00:00</DefaultStartTime>\n');
  xmlLines.push('  <DefaultFinishTime>17:00:00</DefaultFinishTime>\n');
  xmlLines.push('  <CalendarUID>1</CalendarUID>\n');
  // Global ExtendedAttribute field definitions
  xmlLines.push('  <ExtendedAttributes>\n');
  EXT_DEF.forEach(def => {
  xmlLines.push('    <ExtendedAttribute>\n');
  xmlLines.push('      <FieldID>' + fieldIdText(def.n) + '</FieldID>\n');
  xmlLines.push('      <FieldName>' + def.fieldName + '</FieldName>\n');
  xmlLines.push('      <Alias>' + escapeXml(def.alias) + '</Alias>\n');
  xmlLines.push('    </ExtendedAttribute>\n');
  });
  xmlLines.push('  </ExtendedAttributes>\n');
  // Base calendar definition (Standard 8-12 / 1-5)
  xmlLines.push('  <Calendars>\n');
  xmlLines.push('    <Calendar>\n');
  xmlLines.push('      <UID>1</UID>\n');
  xmlLines.push('      <Name>Standard</Name>\n');
  xmlLines.push('      <IsBaseCalendar>1</IsBaseCalendar>\n');
  xmlLines.push('      <BaseCalendarUID>-1</BaseCalendarUID>\n');
  xmlLines.push('      <WeekDays>\n');
  // Sunday (non-working)
  xmlLines.push('        <WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay>\n');
  // Monday-Friday (working 08-12, 13-17)
  [2,3,4,5,6].forEach(dt => {
  xmlLines.push('        <WeekDay>\n');
  xmlLines.push('          <DayType>' + dt + '</DayType>\n');
  xmlLines.push('          <DayWorking>1</DayWorking>\n');
  xmlLines.push('          <WorkingTimes>\n');
  xmlLines.push('            <WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime>\n');
  xmlLines.push('            <WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime>\n');
  xmlLines.push('          </WorkingTimes>\n');
  xmlLines.push('        </WeekDay>\n');
  });
  // Saturday (non-working)
  xmlLines.push('        <WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay>\n');
  xmlLines.push('      </WeekDays>\n');
  xmlLines.push('    </Calendar>\n');
  xmlLines.push('  </Calendars>\n');
  // Tasks
  xmlLines.push('  <Tasks>\n');
  function addTaskEA(fieldId, value) {
  xmlLines.push('      <ExtendedAttribute>\n');
  xmlLines.push('        <FieldID>' + fieldId + '</FieldID>\n');
  xmlLines.push('        <Value><![CDATA[' + (value || '') + ']]></Value>\n');
  xmlLines.push('      </ExtendedAttribute>\n');
  }
  // One task per scope (UIDs start at 1)
  (model.scopes || []).forEach((s, idx) => {
    const uid = idx + 1;
    const label = s.label || ('Scope #' + uid);    const startDate = s.start || '';
    const finishDate = s.end || '';    const start = startDate ? toMspDate(startDate, '08:00:00') : '';
    const finish = finishDate ? toMspDate(finishDate, '17:00:00') : '';

    const pct = toIntPct(s.actualPct);
    const cost = toDec(s.cost);
  xmlLines.push('    <Task>\n');
  xmlLines.push('      <UID>' + uid + '</UID>\n');
  xmlLines.push('      <ID>' + uid + '</ID>\n');
  xmlLines.push('      <Name>' + escapeXml(label) + '</Name>\n');
    if (start) xmlLines.push('      <Start>' + start + '</Start>\n');
    if (finish) xmlLines.push('      <Finish>' + finish + '</Finish>\n');
  xmlLines.push('      <PercentComplete>' + pct + '</PercentComplete>\n');
  xmlLines.push('      <Cost>' + cost + '</Cost>\n');
    const duration = (start && finish) ? computeDurationFromDates(start, finish) : 'PT0H0M0S';
  xmlLines.push('      <Duration>' + duration + '</Duration>\n');
    if (duration !== 'PT0H0M0S') {
  xmlLines.push('      <DurationFormat>7</DurationFormat>\n');
    }
    // Task custom fields (ExtendedAttribute values)
    // Preserve true finish for round-trip loading (do not use shifted Finish)
    addTaskEA(fieldIdText(15), finishDate);
    const unitsToDate = (s.unitsToDate != null ? String(s.unitsToDate) : '');
    const totalUnits = (s.totalUnits != null ? String(s.totalUnits) : '');
    const unitsLabel = s.unitsLabel || '';
    const sectionName = (s.sectionName || '');

    addTaskEA(fieldIdText(11), unitsToDate);
    addTaskEA(fieldIdText(12), totalUnits);
    addTaskEA(fieldIdText(13), unitsLabel);
    addTaskEA(fieldIdText(14), sectionName);

    // Optional Predecessors: expect s.predecessors = [{uid:number,type?:number}]
    if (Array.isArray(s.predecessors)) {
      s.predecessors.forEach(p => {
        const puid = (p && isFinite(p.uid)) ? Number(p.uid) : null;
        if (!puid) return;
        const type = (p && isFinite(p.type)) ? Number(p.type) : 1; // 1 = Finish-to-Start
  xmlLines.push('      <PredecessorLink>\n');
  xmlLines.push('        <PredecessorUID>' + puid + '</PredecessorUID>\n');
  xmlLines.push('        <Type>' + type + '</Type>\n');
  xmlLines.push('      </PredecessorLink>\n');
      });
    }
  xmlLines.push('    </Task>\n');
  });
  xmlLines.push('  </Tasks>\n');
  xmlLines.push('</Project>');
  return xmlLines.join('');
}

export async function saveXml(){
  const d = requireDeps();
  const model = getModel();
  try{
    const xml = buildMSPXML();
    const suggested = (model.project.name ? model.project.name.replace(/\s+/g,'_') + '_' : '') + 'progress_all.xml';
    if(!window._autoSaving && window.showSaveFilePicker){
      const handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types:[{
          description:'MS Project XML',
          accept:{ 'application/xml':['.xml'] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([xml], {type:'application/xml'}));
      await writable.close();
    } else {
      const blob = new Blob([xml], {type:'application/xml'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggested;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  }catch(e){
    alert('XML save failed: ' + e.message);
  }
}

function csvEsc(v){ if(v==null) return ''; const s = String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
function csvLine(arr){ return arr.map(csvEsc).join(',') + '\n'; }

/**
 * vNext2-only numeric formatter (write-time only)
 * - ≤2 decimals
 * - integers keep no .00
 * - rounds to 2 decimals, strips trailing zeros
 * - preserves blanks / non-finite as empty cell
 */
function __fmt2(v){
  // Preserve blanks exactly
  if (v === '' || v === null || v === undefined) return '';

  const n = Number(v);
  if (!isFinite(n)) return '';

  // Treat near-integers as integers
  if (Math.abs(n - Math.round(n)) < 1e-9) {
    return String(Math.round(n));
  }

  // Round to 2 decimals, strip trailing zeros
  const r = Math.round(n * 100) / 100;
  let s = r.toFixed(2);
  return s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}



function buildAllCSV() {
  const model = getModel();
  const lines = [];

  // FORMAT
  lines.push('#SECTION:FORMAT');
  lines.push('key,value');
  lines.push('version,2');
  lines.push('');

  // PROJECT
  lines.push('#SECTION:PROJECT');
  lines.push('key,value');
  const p = model.project || {};
  lines.push(csvLine(['name', p.name || '']));
  lines.push(csvLine(['startup', p.startup || '']));
  lines.push(csvLine(['markerLabel', p.markerLabel || '']));
  lines.push('');

  // SCOPES (current)
  lines.push('#SECTION:SCOPES');
  lines.push('scopeId,label,start,end,cost,progressValue,unitsToDate,totalUnits,unitsLabel,sectionName,sectionID');
  (model.scopes || []).forEach(s => {
    if(!s.scopeId){ s.scopeId = generateScopeId(); }
    lines.push(csvLine([
      s.scopeId || '',
      s.label || '',
      s.start || '',
      s.end || '',
      s.cost ?? '',
      s.actualPct ?? '',
      (s.totalUnits ? (s.unitsToDate ?? '') : ''),
      s.totalUnits ?? '',
      s.unitsLabel || '',
s.sectionName || '',
      s.sectionID || ''
    ]));
  });
  lines.push('');
  // TIMESERIES
  if (model.timeSeriesProject || model.timeSeriesScopes || model.timeSeriesSections) {
    lines.push('#SECTION:TIMESERIES');
    lines.push('date,baselinePct,plannedPct,dailyActual,actualPct');

    const daily = model.dailyActuals || {};
    const hist = Array.isArray(model.history) ? model.history : [];
    const histMap = {};
    hist.forEach(h=>{ if(h && h.date) histMap[h.date] = h.actualPct; });

    const days = (model.baseline && Array.isArray(model.baseline.days))
      ? model.baseline.days
      : [];

    const baselineCum = (model.baseline && Array.isArray(model.baseline.planned))
      ? model.baseline.planned
      : [];

    // Resolve daily actuals (explicit + interpolated + trailing nulls) using the same
    // UI logic in progress.js (read-only). Fall back to sparse map if unavailable.
    let resolvedDailyActual = null;
    try{
      const d = requireDeps();
      if (d && typeof d.getResolvedDailyActualSeries === 'function') {
        const res = d.getResolvedDailyActualSeries(days);
        if (res && Array.isArray(res.actual) && res.actual.length === days.length) {
          resolvedDailyActual = res.actual;
        }
      } else if (d && typeof d.calcActualSeriesByDay === 'function') {
        const arr = d.calcActualSeriesByDay(days);
        if (Array.isArray(arr) && arr.length === days.length) resolvedDailyActual = arr;
      }
    }catch(e){ /* ignore */ }

    // rebuild planned cumulative (derivable; not stored in model)
    const plannedCum = [];
    let cum = 0;
    const scopes = Array.isArray(model.scopes) ? model.scopes : [];
    const totalCost = scopes.reduce((a,b)=>a+(Number(b.cost)||0),0);

    for(let i=0;i<days.length;i++){
      const d = days[i];
      let add = 0;
      scopes.forEach(s=>{
        if(!s.start || !s.end) return;
        if(d >= s.start && d <= s.end){
          const perDay = __computePerDay(s, totalCost);
          if(isFinite(perDay)) add += perDay;
        }
      });
      cum += add;
      plannedCum.push(Math.min(100, cum));
    }

    const n = Array.isArray(days) ? days.length : 0;
    for(let i=0;i<n;i++){
      const d = days[i];
      const b = (baselineCum[i]!=null) ? baselineCum[i] : '';
      const p = (plannedCum[i]!=null) ? plannedCum[i] : '';
      const da = (resolvedDailyActual && resolvedDailyActual.length===n)
        ? resolvedDailyActual[i]
        : ((d in daily && daily[d] != null) ? daily[d] : '');
      const a = (d in histMap && histMap[d] != null) ? histMap[d] : '';
      lines.push(csvLine([d, __fmt2(b), __fmt2(p), __fmt2(da), __fmt2(a)]));
    }
    lines.push('');
  }

// TIMESERIES_PROJECT
  if (model.timeSeriesProject) {
    lines.push('#SECTION:TIMESERIES_PROJECT');
    lines.push('historyDate,key,value');
    Object.keys(model.timeSeriesProject).sort().forEach(d => {
      const rows = model.timeSeriesProject[d] || [];
      rows.forEach(r => {
        lines.push(csvLine([r.historyDate, r.key, r.value]));
      });
    });
    lines.push('');
  }

  // TIMESERIES_SCOPES
  if (model.timeSeriesScopes) {
    lines.push('#SECTION:TIMESERIES_SCOPES');
    lines.push('historyDate,scopeId,label,start,end,cost,perDay,actualPct,unitsToDate,totalUnits,unitsLabel,plannedtodate,sectionName,sectionID');
    Object.keys(model.timeSeriesScopes).sort().forEach(d => {
      const rows = model.timeSeriesScopes[d] || [];
      rows.forEach(s => {
        // snapshot dynamic fields at save time
        const pv = (s.progressValue ?? __computeProgressValue(s));
        s.progressValue = pv;
        // compute perDay if missing
        if(s.perDay==null || s.perDay===''){
          const totalCost = (model.scopes||[]).reduce((a,b)=>a+(Number(b.cost)||0),0);
          s.perDay = __computePerDay(s, totalCost);
        }
        lines.push(csvLine([
          d,
          s.scopeId || '',
          s.label || '',
          s.start || '',
          s.end || '',
          s.cost ?? '',
          (isFinite(s.perDay)
            ? Math.round(s.perDay * 1000) / 1000
            : ''),
          __fmt2(s.actualPct ?? ''),
          __fmt2(s.totalUnits ? (s.unitsToDate ?? '') : ''),
          __fmt2(s.totalUnits ?? ''),
          s.unitsLabel || '',
          __fmt2(s.plannedtodate ?? ''),
          s.sectionName || '',
          s.sectionID || ''
        ]));
      });
    });
    lines.push('');
  }

  // TIMESERIES_SECTIONS
  if (model.timeSeriesSections) {
    lines.push('#SECTION:TIMESERIES_SECTIONS');
    lines.push('historyDate,sectionID,sectionTitle,sectionWeight,sectionPct,sectionPlannedPct');
    Object.keys(model.timeSeriesSections).sort().forEach(d => {
      const rows = model.timeSeriesSections[d] || [];
      rows.forEach(r => {
        lines.push(csvLine([
          d,
          r.sectionID || '',
          r.sectionTitle || '',
          __fmt2(r.sectionWeight ?? ''),
          __fmt2(r.sectionPct ?? ''),
          __fmt2(r.sectionPlannedPct ?? '')
        ]));
      });
    });
    lines.push('');
  }

  return lines.join('\n') + '\n';
}



export async function saveAll(){
  const d = requireDeps();
  const model = getModel();
  try{
    const csv = buildAllCSV();
    if(!window._autoSaving && window.showSaveFilePicker){
      const handle = await window.showSaveFilePicker({ suggestedName: (model.project.name? model.project.name.replace(/\s+/g,'_')+'_': '') + 'progress_all.prgs', types:[{ description:'CSV', accept:{ 'text/plain':['.prgs'] } }] });
      const writable = await handle.createWritable(); await writable.write(new Blob([csv], {type:'text/plain'})); await writable.close();
      if (window.sessionStorage) sessionStorage.setItem(d.COOKIE_KEY, JSON.stringify(model));
    } else {
      // Fallback download
      const blob = new Blob([csv], {type:'text/plain'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = (model.project.name? model.project.name.replace(/\s+/g,'_')+'_': '') + 'progress_all.prgs'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      if (window.sessionStorage) sessionStorage.setItem(d.COOKIE_KEY, JSON.stringify(model));
    }
  }catch(e){ alert('Save failed: ' + e.message); }
}

function parseCSV(text){
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const rows=[]; let cur=[]; let inQuote=false; let field='';
  function pushField(){ cur.push(field); field=''; }
  function pushRow(){ rows.push(cur); cur=[]; }
  for(const line of lines){
    let i=0; inQuote=false; field=''; cur=[];
    while(i<line.length){
      const ch = line[i];
      if(inQuote){
        if(ch==='"' && line[i+1]==='"'){ field+='"'; i+=2; continue; }
        if(ch==='"'){ inQuote=false; i++; continue; }
        field+=ch; i++; continue;
      } else {
        if(ch==='"'){ inQuote=true; i++; continue; }
        if(ch===','){ pushField(); i++; continue; }
        field+=ch; i++; continue;
      }
    }
    pushField(); pushRow();
  }
  return rows;
}

function resetModelForLoad(){
  const d = requireDeps();
  // Clear saved data when opening a file/preset
  if (window.sessionStorage) window.sessionStorage.removeItem(d.COOKIE_KEY);
  const fresh = { project:{name:'', startup:'', markerLabel:'Baseline Complete'}, scopes:[], history:[], dailyActuals:{}, baseline:null, daysRelativeToPlan:null };
  setModel(fresh);
  return fresh;
}

export function uploadCSVAndLoad(){
  const d = requireDeps();
  resetModelForLoad();
  const inp = document.createElement('input');
  inp.type='file';
  inp.accept='.csv,text/csv,application/xml,.xml,.prgs,application/octet-stream';
  inp.onchange = () => {
    const file = inp.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        const text = e.target.result;
        const isXml = file && file.name && file.name.toLowerCase().endsWith('.xml');
        if(isXml || /^\s*</.test(text)){
          try{
            loadFromXml(text);
            return;
          }catch(err){
            alert('Failed to parse XML: ' + err.message);
            return;
          }
        }
        // Legacy simple CSV (Date,Planned_Cumulative,Actual_Cumulative)
        if(/^Date,Planned_Cumulative,Actual_Cumulative/m.test(text)){
          const model = getModel();
          const lines = text.trim().split(/\r?\n/);
          lines.shift();
          model.dailyActuals = {};
          for(const line of lines){
            const parts = line.split(',');
            const dd = parts[0];
            const a = parts[2];
            if(dd && a!=='' && !isNaN(parseFloat(a))) model.dailyActuals[dd] = d.clamp(parseFloat(a),0,100);
          }
          d.computeAndRender();
          if (window.sessionStorage) sessionStorage.setItem(d.COOKIE_KEY, JSON.stringify(model));
          return;
        }

                // PRGS (CSV-with-sections) load path
        loadFromPrgsText(text);
        return;

setModel(fresh);

        // Rehydrate UI fields
        document.getElementById('projectName').value = fresh.project.name||'';
        document.getElementById('projectStartup').value = fresh.project.startup||'';
        document.getElementById('startupLabelInput').value = fresh.project.markerLabel || 'Baseline Complete';

        // Apply loaded project toggle states (PRGS)
        (function(){
          const proj = fresh.project || {};
          const labelToggleEl = document.getElementById('labelToggle');
          if (labelToggleEl && typeof proj.labelToggle !== 'undefined') {
            labelToggleEl.checked = !!proj.labelToggle;
          }
          const patch = {};
          if (typeof proj.legendBaselineCheckbox !== 'undefined') patch.baselineVisible = !!proj.legendBaselineCheckbox;
          if (typeof proj.legendPlannedCheckbox !== 'undefined') patch.plannedVisible = !!proj.legendPlannedCheckbox;
          if (typeof proj.legendActualCheckbox !== 'undefined') patch.actualVisible = !!proj.legendActualCheckbox;
          if (typeof proj.legendForecastCheckbox !== 'undefined') patch.forecastVisible = !!proj.legendForecastCheckbox;
          setLegendState(patch);
        })();

        if(window.Sections && typeof window.Sections.ensureSectionNameField === 'function'){ window.Sections.ensureSectionNameField(fresh); }
        d.syncScopeRowsToModel();
        d.computeAndRender();
        if (window.sessionStorage) sessionStorage.setItem(d.COOKIE_KEY, JSON.stringify(fresh));
      }catch(err){
        alert('Failed to parse CSV: '+err.message);
      }
    };
    reader.readAsText(file);
  };
  inp.click();
}

export function loadFromXml(xmlText){
  const d = requireDeps();

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror');
  if (perr && perr.length) { throw new Error('Invalid XML'); }

  const projEl = doc.getElementsByTagName('Project')[0];
  if (!projEl) { throw new Error('No <Project> element found'); }

  // Project name
  const nameEl = projEl.getElementsByTagName('Name')[0];
  const projectName = nameEl ? nameEl.textContent : '';

  // Build a FieldID -> Alias/FieldName map from global definitions
  const fieldAliasById = {};
  const extDefRoots = projEl.getElementsByTagName('ExtendedAttributes');
  let extDefRoot = null;
  for (let i = 0; i < extDefRoots.length; i++) {
    if (extDefRoots[i].parentNode === projEl) { extDefRoot = extDefRoots[i]; break; }
  }
  if (extDefRoot) {
    const defs = extDefRoot.getElementsByTagName('ExtendedAttribute');
    for (let i = 0; i < defs.length; i++) {
      const ea = defs[i];
      if (ea.parentNode !== extDefRoot) continue;
      const fidEl = ea.getElementsByTagName('FieldID')[0];
      const aliasEl = ea.getElementsByTagName('Alias')[0];
      const fnameEl = ea.getElementsByTagName('FieldName')[0];
      if (!fidEl) continue;
      const fid = (fidEl.textContent || '').trim();
      const alias = (aliasEl ? aliasEl.textContent : '') || (fnameEl ? fnameEl.textContent : '');
      if (fid) fieldAliasById[fid] = (alias || '').trim();
    }
  }

  function readTaskExtendedAttributes(taskEl){
    const out = {};
    const eas = taskEl.getElementsByTagName('ExtendedAttribute');
    for (let i = 0; i < eas.length; i++) {
      const ea = eas[i];
      if (ea.parentNode !== taskEl) continue; // only direct children
      const fidEl = ea.getElementsByTagName('FieldID')[0];
      const valEl = ea.getElementsByTagName('Value')[0];
      if (!fidEl) continue;
      const fid = (fidEl.textContent || '').trim();
      const alias = fieldAliasById[fid] || fid;
      const val = valEl ? (valEl.textContent || '') : '';
      out[alias] = val;
    }
    return out;
  }

  // Defaults
  let startupVal = '';
  let markerLabelVal = '';
  let labelToggleFlag;
  let legendBaselineFlag;
  let legendPlannedFlag;
  let legendActualFlag;
  let legendForecastFlag;
  let baselineHistoryStr = '';
  let actualHistoryStr = '';
  let dailyActualsStr = '';

  const newModel = {
    project: {
      name: projectName || '',
      startup: '',
      markerLabel: 'Baseline Complete'
    },
    scopes: [],
    history: [],
    dailyActuals: {},
    baseline: null,
    daysRelativeToPlan: null
  };

  // Tasks → scopes + project-level values from UID 0
  const taskEls = projEl.getElementsByTagName('Task');
  for (let i = 0; i < taskEls.length; i++) {
    const t = taskEls[i];
    const uidEl = t.getElementsByTagName('UID')[0];
    const uid = uidEl ? (uidEl.textContent || '').trim() : '';

    const attrs = readTaskExtendedAttributes(t);

    if (uid === '0') {
      // Summary task holds project-level custom values
      if (typeof attrs.Startup !== 'undefined') startupVal = (attrs.Startup || '').trim();
      if (typeof attrs.MarkerLabel !== 'undefined') markerLabelVal = (attrs.MarkerLabel || '').trim();
      if (typeof attrs.LabelToggle !== 'undefined') labelToggleFlag = (String(attrs.LabelToggle).trim() === 'true');
      if (typeof attrs.LegendBaselineCheckbox !== 'undefined') legendBaselineFlag = (String(attrs.LegendBaselineCheckbox).trim() === 'true');
      if (typeof attrs.LegendPlannedCheckbox !== 'undefined') legendPlannedFlag = (String(attrs.LegendPlannedCheckbox).trim() === 'true');
      if (typeof attrs.LegendActualCheckbox !== 'undefined') legendActualFlag = (String(attrs.LegendActualCheckbox).trim() === 'true');
      if (typeof attrs.LegendForecastCheckbox !== 'undefined') legendForecastFlag = (String(attrs.LegendForecastCheckbox).trim() === 'true');
      if (typeof attrs.BaselineHistory !== 'undefined') baselineHistoryStr = attrs.BaselineHistory || '';
      if (typeof attrs.ActualHistory !== 'undefined') actualHistoryStr = attrs.ActualHistory || '';
      if (typeof attrs.DailyActuals !== 'undefined') dailyActualsStr = attrs.DailyActuals || '';
      continue;
    }

    // Normal scope tasks
    const nmEl = t.getElementsByTagName('Name')[0];
    const startEl = t.getElementsByTagName('Start')[0];
    const finEl = t.getElementsByTagName('Finish')[0];
    const pctEl = t.getElementsByTagName('PercentComplete')[0];
    const costEl = t.getElementsByTagName('Cost')[0];

    const label = nmEl ? nmEl.textContent : ('Task ' + (i + 1));
    const startRaw = startEl ? (startEl.textContent || '') : '';
    const finishRaw = finEl ? (finEl.textContent || '') : '';
    const pctRaw = pctEl ? (pctEl.textContent || '0') : '0';

    const cost = costEl ? (parseFloat(costEl.textContent || '0') || 0) : 0;

        const start = startRaw && startRaw.length >= 10 ? startRaw.slice(0, 10) : '';
    // Prefer the preserved true finish (TrueFinish) if present; otherwise fall back to <Finish>.
    const trueFinishRaw = (attrs.TrueFinish != null ? String(attrs.TrueFinish).trim() : '');
    const end = trueFinishRaw
      ? trueFinishRaw.slice(0, 10)
      : (finishRaw && finishRaw.length >= 10 ? finishRaw.slice(0, 10) : '');

    const pct = d.clamp(parseFloat(pctRaw) || 0, 0, 100);

    const unitsToDateStr = (attrs.UnitsToDate != null ? String(attrs.UnitsToDate).trim() : '');
    const totalUnitsStr = (attrs.TotalUnits != null ? String(attrs.TotalUnits).trim() : '');
    const unitsLabel = (attrs.UnitsLabel != null ? String(attrs.UnitsLabel).trim() : '');
    const sectionName = (attrs.SectionName != null ? String(attrs.SectionName).trim() : '');

    let totalUnitsNum = null;
    if (totalUnitsStr !== '') {
      const tuNum = parseFloat(totalUnitsStr);
      if (!isNaN(tuNum)) totalUnitsNum = tuNum;
    }

    let unitsToDateNum = 0;
    if (unitsToDateStr !== '') {
      const utdNum = parseFloat(unitsToDateStr);
      if (!isNaN(utdNum)) unitsToDateNum = utdNum;
    }

    const resolvedUnitsLabel = unitsLabel || ((totalUnitsNum && totalUnitsNum > 0) ? 'Feet' : '%');

    const scope = {
      label,
      start,
      end,
      cost,
      unitsToDate: unitsToDateNum,
      totalUnits: (totalUnitsNum == null ? '' : totalUnitsNum),
      unitsLabel: resolvedUnitsLabel,
      sectionName: sectionName || '',
      actualPct: 0
    };

    // Keep current behavior: if TotalUnits is present, compute % from units; otherwise use PercentComplete.
    scope.actualPct = scope.totalUnits
      ? (scope.unitsToDate && scope.totalUnits ? (scope.unitsToDate / scope.totalUnits * 100) : 0)
      : pct;

    newModel.scopes.push(scope);
  }

  // Apply project-level fields
  newModel.project.startup = startupVal || '';
  newModel.project.markerLabel = markerLabelVal || 'Baseline Complete';

  if (typeof labelToggleFlag !== 'undefined') newModel.project.labelToggle = labelToggleFlag;
  if (typeof legendBaselineFlag !== 'undefined') newModel.project.legendBaselineCheckbox = legendBaselineFlag;
  if (typeof legendPlannedFlag !== 'undefined') newModel.project.legendPlannedCheckbox = legendPlannedFlag;
  if (typeof legendActualFlag !== 'undefined') newModel.project.legendActualCheckbox = legendActualFlag;
  if (typeof legendForecastFlag !== 'undefined') newModel.project.legendForecastCheckbox = legendForecastFlag;

  // BaselineHistory CSV → baseline
  if (baselineHistoryStr) {
    const lines = baselineHistoryStr.split(/\r?\n/);
    const rows = [];
    for (let line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      if (!parts[0]) continue;
      const dd = parts[0].trim();
      const vStr = (parts[1] || '').trim();
      let val = null;
      if (vStr !== '' && vStr.toLowerCase() !== 'null') {
        const num = parseFloat(vStr);
        if (!isNaN(num)) val = d.clamp(num, 0, 100);
      }
      rows.push({ date: dd, val: val });
    }
    if (rows.length) {
      newModel.baseline = {
        days: rows.map(r => r.date),
        planned: rows.map(r => (r.val == null ? null : d.clamp(r.val, 0, 100)))
      };
    }
  }

  // ActualHistory CSV → history
  if (actualHistoryStr) {
    const lines = actualHistoryStr.split(/\r?\n/);
    const hist = [];
    for (let line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      if (!parts[0]) continue;
      const dd = parts[0].trim();
      const vStr = (parts[1] || '').trim();
      const num = parseFloat(vStr);
      if (!isNaN(num)) hist.push({ date: dd, actualPct: d.clamp(num, 0, 100) });
    }
    if (hist.length) newModel.history = hist;
  }

  // DailyActuals CSV → dailyActuals
  if (dailyActualsStr) {
    const lines = dailyActualsStr.split(/\r?\n/);
    const da = {};
    for (let line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      if (!parts[0]) continue;
      const dd = parts[0].trim();
      const vStr = (parts[1] || '').trim();
      if (vStr === '') continue;
      const num = parseFloat(vStr);
      if (!isNaN(num)) da[dd] = num;
    }
    newModel.dailyActuals = da;
  }

  setModel(newModel);

  // Commit into UI
  const nameInput = document.getElementById('projectName');
  const startupInput = document.getElementById('projectStartup');
  const markerInput = document.getElementById('startupLabelInput');

  if (nameInput) nameInput.value = newModel.project.name || '';
  if (startupInput) startupInput.value = newModel.project.startup || '';
  if (markerInput) markerInput.value = newModel.project.markerLabel || 'Baseline Complete';

  (function(){
    const proj = newModel.project || {};
    const labelToggleEl = document.getElementById('labelToggle');
    const baselineCb = document.getElementById('legendBaselineCheckbox');
    const plannedCb = document.getElementById('legendPlannedCheckbox');
    const actualCb = document.getElementById('legendActualCheckbox');
    const forecastCb = document.getElementById('legendForecastCheckbox');

    if (labelToggleEl && typeof proj.labelToggle !== 'undefined') labelToggleEl.checked = !!proj.labelToggle;

    const patch = {};
    if (typeof proj.legendBaselineCheckbox !== 'undefined') { patch.baselineVisible = !!proj.legendBaselineCheckbox; if (baselineCb) baselineCb.checked = patch.baselineVisible; }
    if (typeof proj.legendPlannedCheckbox !== 'undefined') { patch.plannedVisible = !!proj.legendPlannedCheckbox; if (plannedCb) plannedCb.checked = patch.plannedVisible; }
    if (typeof proj.legendActualCheckbox !== 'undefined') { patch.actualVisible = !!proj.legendActualCheckbox; if (actualCb) actualCb.checked = patch.actualVisible; }
    if (typeof proj.legendForecastCheckbox !== 'undefined') { patch.forecastVisible = !!proj.legendForecastCheckbox; if (forecastCb) forecastCb.checked = patch.forecastVisible; }
    setLegendState(patch);
  })();

  if(window.Sections && typeof window.Sections.ensureSectionNameField === 'function'){ window.Sections.ensureSectionNameField(newModel); }
  d.syncScopeRowsToModel();
  d.computeAndRender();
  if (window.sessionStorage) sessionStorage.setItem(d.COOKIE_KEY, JSON.stringify(newModel));
}

// === Embedded CSV loader for presets ===

export function loadFromPrgsText(text){
  const d = requireDeps();
  resetModelForLoad();

  // Temporary guard to prevent ID generation during PRGS hydration
  try{
    const m = getModel();
    if(m) m.__hydratingFromPrgs = true;
  }catch(e){}

  // Parse PRGS (CSV-with-sections) exactly like file uploads / preset loads.
  const rows = parseCSV(text);
  let section = '';
  const fresh = { project:{name:'',startup:'', markerLabel:'Baseline Complete'}, scopes:[], history:[], dailyActuals:{}, baseline:null, daysRelativeToPlan:null, __hydratingFromPrgs:true };

  let scopeHeaders = [];
  let baselineRows = [];

  // v2 TIMESERIES section helpers
  let timeSeriesHeaders = [];
  let tsProjectHeaders = [];
  let tsScopesHeaders = [];
  let tsSectionsHeaders = [];

  for (let r of rows){
    if(r.length===1 && r[0].startsWith('#SECTION:')){ section = r[0].slice('#SECTION:'.length).trim(); continue; }
    if(r.length===0 || (r.length===1 && r[0]==='')) continue;

    if(section==='PROJECT'){
      if(r[0]==='key') { continue; }
      if(r[0]==='name') fresh.project.name = r[1]||'';
      if(r[0]==='startup') fresh.project.startup = r[1]||'';
      if(r[0]==='markerLabel') fresh.project.markerLabel = r[1]||'Baseline Complete';
      if(r[0]==='labelToggle') fresh.project.labelToggle = (r[1]==='true');
      if(r[0]==='legendBaselineCheckbox') fresh.project.legendBaselineCheckbox = (r[1]==='true');
      if(r[0]==='legendPlannedCheckbox') fresh.project.legendPlannedCheckbox = (r[1]==='true');
      if(r[0]==='legendActualCheckbox') fresh.project.legendActualCheckbox = (r[1]==='true');
      if(r[0]==='legendForecastCheckbox') fresh.project.legendForecastCheckbox = (r[1]==='true');
    } else if(section==='SCOPES'){
      if(!scopeHeaders.length){ scopeHeaders = r; continue; }
      const idx = (name)=> scopeHeaders.indexOf(name);
      const s = {
        scopeId: (idx('scopeId')>=0 ? (r[idx('scopeId')]||'') : ''),
        label: r[idx('label')]||'',
        start: r[idx('start')]||'',
        end: r[idx('end')]||'',
        cost: parseFloat(r[idx('cost')]||'0')||0,
        unitsToDate: parseFloat(r[idx('progressValue')]||'0')||0,
        totalUnits: (r[idx('totalUnits')]===undefined||r[idx('totalUnits')]==='')? '' : (parseFloat(r[idx('totalUnits')])||0),
        unitsLabel: r[idx('unitsLabel')]||'%',
        sectionName: (idx('sectionName')>=0 ? (r[idx('sectionName')]||'') : ''),
        actualPct: 0,
        sectionID: (idx('sectionID')>=0 ? (r[idx('sectionID')]||'') : '')
      
      };
      s.actualPct = s.totalUnits? (s.unitsToDate && s.totalUnits? (s.unitsToDate/s.totalUnits*100) : 0) : (s.unitsToDate||0);
      fresh.scopes.push(s);
    } else if(section==='DAILY_ACTUALS'){
      if(r[0]==='date') continue;
      const dd = r[0]; const a = r[1];
      if(dd){ fresh.dailyActuals[dd] = a===''? undefined : d.clamp(parseFloat(a)||0,0,100); }
    } else if(section==='HISTORY'){
      if(r[0]==='date') continue;
      if(r[0]) fresh.history.push({date:r[0], actualPct: parseFloat(r[1]||'0')||0});
    } else if(section==='BASELINE'){
      if(r[0]==='date') continue;
      baselineRows.push({date:r[0], val: (r[1]===''? null : parseFloat(r[1]||'0'))});
    } else if(section==='FORMAT'){
      // v2 marker (key,value). Currently used to signal versioning.
      // Keep parsing tolerant; unknown keys are ignored.
      // Example: version,2
      // (No-op here; presence of sections below is what drives rehydration.)
    } else if(section==='TIMESERIES'){
      // v2 consolidated curve storage.
      if(!timeSeriesHeaders.length){ timeSeriesHeaders = r; continue; }
      const idx = (name)=> timeSeriesHeaders.indexOf(name);
      const date = r[idx('date')] || r[0] || '';
      if(!date) continue;

      // Rehydrate baseline/history/dailyActuals from consolidated rows.
      const bStr = (idx('baselinePct')>=0 ? (r[idx('baselinePct')]||'') : '');
      const aStr = (idx('actualPct')>=0 ? (r[idx('actualPct')]||'') : '');
      const daStr = (idx('dailyActual')>=0 ? (r[idx('dailyActual')]||'') : '');

      if (bStr !== '') {
        const bNum = parseFloat(bStr);
        if (!isNaN(bNum)) baselineRows.push({ date, val: d.clamp(bNum, 0, 100) });
      }
      if (aStr !== '') {
        const aNum = parseFloat(aStr);
        if (!isNaN(aNum)) fresh.history.push({ date, actualPct: d.clamp(aNum, 0, 100) });
      }
      if (daStr !== '') {
        const daNum = parseFloat(daStr);
        if (!isNaN(daNum)) fresh.dailyActuals[date] = daNum;
      }
    } else if(section==='TIMESERIES_PROJECT'){
      if(!fresh.timeSeriesProject) fresh.timeSeriesProject = {};
      if(!tsProjectHeaders.length){ tsProjectHeaders = r; continue; }
      const idx = (name)=> tsProjectHeaders.indexOf(name);
      const historyDate = r[idx('historyDate')] || r[0] || '';
      if(!historyDate) continue;
      const row = {
        historyDate,
        key: r[idx('key')] || '',
        value: r[idx('value')] || ''
      };
      if(!fresh.timeSeriesProject[historyDate]) fresh.timeSeriesProject[historyDate] = [];
      fresh.timeSeriesProject[historyDate].push(row);
    } else if(section==='TIMESERIES_SCOPES'){
      if(!fresh.timeSeriesScopes) fresh.timeSeriesScopes = {};
      if(!tsScopesHeaders.length){ tsScopesHeaders = r; continue; }
      const idx = (name)=> tsScopesHeaders.indexOf(name);
      const historyDate = r[idx('historyDate')] || r[0] || '';
      if(!historyDate) continue;

      const numOrBlank = (v)=>{
        if (v === undefined || v === null || v === '') return '';
        const n = parseFloat(v);
        return isNaN(n) ? '' : n;
      };

      const snap = {
        scopeId: r[idx('scopeId')] || '',
        label: r[idx('label')] || '',
        start: r[idx('start')] || '',
        end: r[idx('end')] || '',
        cost: numOrBlank(r[idx('cost')]),
        perDay: numOrBlank(r[idx('perDay')]),
        progressValue: numOrBlank(r[idx('progressValue')]),
        unitsToDate: numOrBlank(r[idx('unitsToDate')]),
        totalUnits: (r[idx('totalUnits')]===undefined||r[idx('totalUnits')]==='') ? '' : (parseFloat(r[idx('totalUnits')])||0),
        unitsLabel: r[idx('unitsLabel')] || '',
        plannedtodate: numOrBlank((idx('plannedtodate')>=0) ? r[idx('plannedtodate')] : ''),
        sectionName: r[idx('sectionName')] || '',
        sectionID: r[idx('sectionID')] || ''
      };

      if(!fresh.timeSeriesScopes[historyDate]) fresh.timeSeriesScopes[historyDate] = [];
      fresh.timeSeriesScopes[historyDate].push(snap);
    } else if(section==='TIMESERIES_SECTIONS'){
      if(!fresh.timeSeriesSections) fresh.timeSeriesSections = {};
      if(!tsSectionsHeaders.length){ tsSectionsHeaders = r; continue; }
      const idx = (name)=> tsSectionsHeaders.indexOf(name);
      const historyDate = r[idx('historyDate')] || r[0] || '';
      if(!historyDate) continue;
      const numOrBlank = (v)=>{
        if (v === undefined || v === null || v === '') return '';
        const n = parseFloat(v);
        return isNaN(n) ? '' : n;
      };
      const row = {
        sectionID: r[idx('sectionID')] || '',
        sectionTitle: r[idx('sectionTitle')] || '',
        sectionWeight: numOrBlank(r[idx('sectionWeight')]),
        sectionPct: numOrBlank(r[idx('sectionPct')]),
        sectionPlannedPct: numOrBlank(r[idx('sectionPlannedPct')])
      };
      if(!fresh.timeSeriesSections[historyDate]) fresh.timeSeriesSections[historyDate] = [];
      fresh.timeSeriesSections[historyDate].push(row);
    }
  }
  // ---- Hydrate missing identity (scopeId / sectionID) with v2 fallback rules ----
  (function hydrateIds(){
    const scopes = Array.isArray(fresh.scopes) ? fresh.scopes : [];
    const anyMissing = scopes.some(s => !s || !s.scopeId || !String(s.sectionID||'').trim());
    if (!anyMissing) return;

    const ts = fresh.timeSeriesScopes;
    if (!ts || typeof ts !== 'object') return;
    const dates = Object.keys(ts).filter(Boolean).sort();
    if (!dates.length) return;

    const latestDate = dates[dates.length - 1];
    const latestRows = Array.isArray(ts[latestDate]) ? ts[latestDate] : [];
    if (!latestRows.length) return;

    const byScopeId = new Map();
    const bySignature = new Map(); // label|start|end -> row
    latestRows.forEach(r => {
      if (!r) return;
      if (r.scopeId) byScopeId.set(String(r.scopeId), r);
      const sig = String(r.label||'') + '|' + String(r.start||'') + '|' + String(r.end||'');
      if (!bySignature.has(sig)) bySignature.set(sig, r);
    });

    scopes.forEach(s => {
      if (!s) return;

      // If scopeId is missing, attempt restore by matching signature against latest snapshot
      if (!s.scopeId) {
        const sig = String(s.label||'') + '|' + String(s.start||'') + '|' + String(s.end||'');
        const r = bySignature.get(sig);
        if (r && r.scopeId) {
          s.scopeId = String(r.scopeId);
          if (!String(s.sectionID||'').trim() && r.sectionID) s.sectionID = String(r.sectionID);
        }
      }

      // If sectionID is missing but scopeId exists, fill from scopeId map
      if (s.scopeId && !String(s.sectionID||'').trim()) {
        const r = byScopeId.get(String(s.scopeId));
        if (r && r.sectionID) s.sectionID = String(r.sectionID);
      }
    });

    // De-duplicate scopeIds (later duplicates only)
    const seen = new Set();
    scopes.forEach(s => {
      if (!s || !s.scopeId) return;
      const id = String(s.scopeId);
      if (!seen.has(id)) { seen.add(id); return; }
      // Later duplicate → generate a new unique id
      let newId = generateScopeId();
      while (seen.has(newId)) newId = generateScopeId();
      s.scopeId = newId;
      seen.add(newId);
    });
  })();



  if(baselineRows.length){
    fresh.baseline = { days: baselineRows.map(r=>r.date), planned: baselineRows.map(r=> (r.val==null? null : d.clamp(r.val,0,100))) };
  }

  setModel(fresh);

  // Clear hydration guard before any UI sync/render
  try{ fresh.__hydratingFromPrgs = false; }catch(e){}
  try{ const m2 = getModel(); if(m2) m2.__hydratingFromPrgs = false; }catch(e){}

  // Rehydrate UI fields
  const nameEl = document.getElementById('projectName');
  const startupEl = document.getElementById('projectStartup');
  const labelEl = document.getElementById('startupLabelInput');
  if(nameEl) nameEl.value = fresh.project.name||'';
  if(startupEl) startupEl.value = fresh.project.startup||'';
  if(labelEl) labelEl.value = fresh.project.markerLabel || 'Baseline Complete';

  // Apply loaded project toggle states (PRGS)
  (function(){
    const proj = fresh.project || {};
    const labelToggleEl = document.getElementById('labelToggle');
    if (labelToggleEl && typeof proj.labelToggle !== 'undefined') {
      labelToggleEl.checked = !!proj.labelToggle;
    }
    const patch = {};
    if (typeof proj.legendBaselineCheckbox !== 'undefined') patch.baselineVisible = !!proj.legendBaselineCheckbox;
    if (typeof proj.legendPlannedCheckbox !== 'undefined') patch.plannedVisible = !!proj.legendPlannedCheckbox;
    if (typeof proj.legendActualCheckbox !== 'undefined') patch.actualVisible = !!proj.legendActualCheckbox;
    if (typeof proj.legendForecastCheckbox !== 'undefined') patch.forecastVisible = !!proj.legendForecastCheckbox;
    setLegendState(patch);
  })();

  if(window.Sections && typeof window.Sections.ensureSectionNameField === 'function'){ window.Sections.ensureSectionNameField(fresh); }
  d.syncScopeRowsToModel();
  d.computeAndRender();
  if (window.sessionStorage) sessionStorage.setItem(d.COOKIE_KEY, JSON.stringify(fresh));
  return true;
}

export function loadFromPresetCsv(text){
  // Preset data uses the same PRGS section format.
  return loadFromPrgsText(text);
}


/*****************
 * UI wiring
 *****************/
function initSaveDropdown(){
  const btn     = document.getElementById('toolbarSave');
  const dd      = document.getElementById('saveDropdown');
  const btnCSV  = document.getElementById('saveCSV');
  const btnXML = document.getElementById('saveXML');
  if (!btn || !dd || !btnCSV || !btnXML) return;

  function openDropdown() {
    const rect = btn.getBoundingClientRect();
    dd.style.left   = (rect.left + window.scrollX) + 'px';
    dd.style.top    = (rect.bottom + window.scrollY + 4) + 'px';
    dd.style.display = 'block';
    void dd.offsetWidth;
    dd.classList.add('show');
  }
  function closeDropdown() {
    dd.classList.remove('show');
    setTimeout(() => {
      if (!dd.classList.contains('show')) dd.style.display = 'none';
    }, 200);
  }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (dd.style.display === 'block' && dd.classList.contains('show')) closeDropdown();
    else openDropdown();
  });

  btnCSV.addEventListener('click', function (e) {
    e.stopPropagation();
    closeDropdown();
    if (typeof window.requireAuthForSaveAll === 'function') window.requireAuthForSaveAll();
    else if (typeof saveAll === 'function') saveAll();
    else if (typeof window.saveCsv === 'function') window.saveCsv();
  });

  btnXML.addEventListener('click', function (e) {
    e.stopPropagation();
    closeDropdown();
    if (typeof window.requireAuthForSaveXml === 'function') window.requireAuthForSaveXml();
    else if (typeof saveXml === 'function') saveXml();
  });

  document.addEventListener('click', function (e) {
    if (!dd.contains(e.target) && e.target !== btn) closeDropdown();
  }, true);
}

function initLoadDropdown(){
  const btn = document.getElementById('toolbarLoad');
  const dd = document.getElementById('loadDropdown');
  if (!btn || !dd) return;

  function closeDropdown() { dd.style.display = 'none'; }
  function toggleDropdown() { dd.style.display = (dd.style.display === 'block') ? 'none' : 'block'; }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleDropdown();
  });

  dd.querySelectorAll('div[data-act]').forEach(function (item) {
    item.addEventListener('click', function (e) {
      const act = item.dataset.act;

      if (act === 'open') {
        // Manual file loads should NOT refresh.
        uploadCSVAndLoad();
      } else {
        // Dropdown presets: force a clean reload BEFORE loading any preset data (prevents lingering session state).
        refreshWithPreset(act);
      }

      closeDropdown();
      e.stopPropagation();
    });
  });

  document.addEventListener('click', function (e) {
    if (!dd.contains(e.target) && e.target !== btn) closeDropdown();
  });
}

function initAutoLoadDefault(){
  const d = requireDeps();
  if (__saveLoadAutoBound) return;
  __saveLoadAutoBound = true;
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // URL-based PRGS load takes absolute precedence. Wait for it (if present) to avoid races.
      try { if (window.__RP_URL_LOAD_PROMISE) await window.__RP_URL_LOAD_PROMISE; } catch(e){}
      if (window.__RP_URL_HYDRATED) return;

      const url = new URL(window.location.href);
      const wasRedirected = url.searchParams.get('redirected') === '1';
      const preset = (url.searchParams.get('preset') || '').trim();

      let hydrated = false;

      // If a preset was requested via URL (Load dropdown redirect), it MUST win over any session restore.
      // Otherwise, a prior Open File (stored in session) will override the preset after refresh.
      if (!preset) {
        hydrated = (typeof d.hydrateFromSession === 'function') ? d.hydrateFromSession() : false;
      }

      // If a dropdown preset was selected, load it on this fresh page (no partial render before reload).
      if (!hydrated && preset) {
        let file = '';
        if (preset === 'default') file = 'Project_Files/default_progress_all.prgs';
        if (preset === 'pipeline') file = 'Project_Files/Pipeline_progress_all.prgs';
        if (preset === 'mech') file = 'Project_Files/Mech_Facility_progress_all.prgs';
        if (preset === 'ie') file = 'Project_Files/I&E_Facility_progress_all.prgs';

        if (file) {
          fetch(file)
            .then(r => r.text())
            .then(t => loadFromPresetCsv(t))
            .catch(err => console.error('Failed to auto-load preset CSV:', err));
        }
      } else if (!hydrated && !wasRedirected) {
        // Default auto-load (first visit / no session restore / no forced preset).
        fetch('Project_Files/default_progress_all.prgs')
          .then(r => r.text())
          .then(t => loadFromPresetCsv(t))
          .catch(err => console.error('Failed to auto-load default CSV:', err));
      }

      if (wasRedirected || preset) {
        url.searchParams.delete('redirected');
        url.searchParams.delete('preset');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (e) {
      console.error('Auto-load default CSV failed:', e);
    }
  });
}

export function initSaveLoad(d){
  if (__saveLoadInitialized) return;
  __saveLoadInitialized = true;
  deps = d;

  // Globals for compatibility (clear.js, auth wrappers, etc.)
  window.saveAll = saveAll;
  window.saveXml = saveXml;
  window.loadFromPresetCsv = loadFromPresetCsv;

  if (!__saveLoadDomBound) {
    __saveLoadDomBound = true;
    document.addEventListener('DOMContentLoaded', () => {
      initSaveDropdown();
      initLoadDropdown();
    });
  }

  initAutoLoadDefault();
}


// Added: apply toggle states from XML ExtendedAttributes by Alias
function applyToggleStatesFromExtendedAttributes(extAttrs) {
  if (!Array.isArray(extAttrs)) return;
  extAttrs.forEach(ea => {
    if (!ea || !ea.Alias) return;
    if (ea.Value === undefined || ea.Value === null || ea.Value === '') return;
    if (typeof project !== 'undefined' && project.toggles && ea.Alias in project.toggles) {
      project.toggles[ea.Alias] = (ea.Value === '1' || ea.Value === 1 || ea.Value === true || ea.Value === 'true');
    }
  });
}

// Added: compute Duration from Start/Finish for Smartsheet compatibility
function computeDurationFromDates(startISO, finishISO) {
  try {
    if (!startISO || !finishISO) return 'PT0H0M0S';

    // Weekday-only math ignoring time of day:
    // Use UTC midnight for date portions (YYYY-MM-DD).
    const sd = String(startISO).slice(0, 10);
    const fd = String(finishISO).slice(0, 10);
    if (sd.length < 10 || fd.length < 10) return 'PT0H0M0S';

    const sParts = sd.split('-').map(n => parseInt(n, 10));
    const fParts = fd.split('-').map(n => parseInt(n, 10));
    if (sParts.length !== 3 || fParts.length !== 3) return 'PT0H0M0S';
    if (sParts.some(n => !isFinite(n)) || fParts.some(n => !isFinite(n))) return 'PT0H0M0S';

    const sUTC = Date.UTC(sParts[0], sParts[1] - 1, sParts[2]);
    const fUTC = Date.UTC(fParts[0], fParts[1] - 1, fParts[2]);
    if (!isFinite(sUTC) || !isFinite(fUTC) || fUTC <= sUTC) return 'PT0H0M0S';

    const msPerDay = 24 * 60 * 60 * 1000;

    // Count weekdays (Mon–Fri) from Start through Finish (inclusive of Finish if it is a weekday).
    // Do not normalize or shift weekend dates.
    let workingDays = 0;
    for (let t = sUTC; t <= fUTC; t += msPerDay) {
      const dow = new Date(t).getUTCDay(); // 0=Sun ... 6=Sat
      if (dow >= 1 && dow <= 5) workingDays++;
    }

    if (!isFinite(workingDays) || workingDays <= 0) return 'PT0H0M0S';

    const hours = workingDays * 8;
    return `PT${hours}H0M0S`;
  } catch (e) {
    return 'PT0H0M0S';
  }
}
