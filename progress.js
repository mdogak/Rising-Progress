// Ensure legend text renders after files are loaded without needing a toggle
document.querySelectorAll('input[type="file"]').forEach(el=>{
  el.addEventListener('change', ()=>{
    // Give parsing a tick, then recompute and render legend
    setTimeout(()=>{ try{ refreshLegendNow(); }catch(e){} }, 30);
  });
});

/*****************
 * Utilities
 *****************/
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function getLocalToday() { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
const today = getLocalToday();
function parseDate(val){ return val ? new Date(val + 'T00:00:00') : null }
function fmtDate(d){ return d ? d.toISOString().slice(0,10) : '' }
function fmtLongDateStr(dStr){ const d=parseDate(dStr); return d? d.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}) : dStr }
function fmtLongToday(){ return new Date().toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}) }
function daysBetween(a,b){ const ms = (parseDate(fmtDate(b)) - parseDate(fmtDate(a))); return Math.floor(ms/86400000)+1; }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)) }

// Cookie helpers
function setCookie(name, value, days=365){ const d = new Date(); d.setTime(d.getTime() + (days*24*60*60*1000)); const v = encodeURIComponent(value); document.cookie = `${name}=${v};expires=${d.toUTCString()};path=/`; }
function getCookie(name){ const n = name + '='; const ca = document.cookie.split(';'); for(let c of ca){ while(c.charAt(0)==' ') c = c.substring(1); if(c.indexOf(n)==0) return decodeURIComponent(c.substring(n.length,c.length)); } return null; }
function delCookie(name){ document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;` }

/*****************
 * Data model
 *****************/
let model = {
  project:{ name:'', startup:'', markerLabel:'Baseline Complete' },
  scopes:[], // {label,start,end,cost,actualPct,unitsToDate,totalUnits,unitsLabel}
  history:[], // [{date, actualPct}]
  dailyActuals:{}, // { 'YYYY-MM-DD': number }
  baseline:null,   // { days:[], planned:[] } snapshot
  daysRelativeToPlan: null
};
try{ computeAndRender(); }catch(e){}

function defaultScope(i){
  if(i===0){ const startDate = new Date(today); startDate.setDate(startDate.getDate()-1); const endDate = new Date(startDate); endDate.setDate(endDate.getDate()+7); const start = fmtDate(startDate); const end = fmtDate(endDate); return { label:`Scope #${i+1}`, start, end, cost:100, actualPct:0, unitsToDate:0, totalUnits:'', unitsLabel:'%' }; }
  return { label:`Scope #${i+1}`, start:'', end:'', cost:0, actualPct:0, unitsToDate:0, totalUnits:'', unitsLabel:'%' };
}

function ensureRows(n){ const cont = $('#scopeRows'); const cur = cont.children.length; for(let i=cur;i<n;i++) cont.appendChild(renderScopeRow(i)); }
function syncScopeRowsToModel(){ const cont = $('#scopeRows'); cont.innerHTML = ''; for(let i=0;i<model.scopes.length;i++) cont.appendChild(renderScopeRow(i)); }

function renderScopeRow(i){
  const row = document.createElement('div'); row.className = 'row'; row.dataset.index = i; const s = model.scopes[i] || defaultScope(i); if(!model.scopes[i]) model.scopes[i] = s;
  row.innerHTML = `
    <input data-k="label" placeholder="Scope #${i+1}" value="${s.label}">
    <input data-k="start" type="date" value="${s.start}">
    <input data-k="end" type="date" value="${s.end}">
    <input data-k="cost" type="number" step="0.01" min="0" value="${s.cost}">
    <input data-k="totalUnits" type="number" step="0.01" min="0" placeholder="Total Units" value="${s.totalUnits===0? '': s.totalUnits}">
    <div>
      <input data-k="progress" type="number" step="0.01" min="0" placeholder="% or Units to Date" value="${s.totalUnits? s.unitsToDate : s.actualPct}">
    </div>
    <select data-k="unitsLabel"><option value="%">%</option><option value="Feet">Feet</option><option value="Inches">Inches</option><option value="Qty">Qty</option><option value="Meters">Meters</option><option value="Centimeters">Centimeters</option></select>
    <div class="small" data-k="planned"></div>
    <div class="actions">
      <button class="iconbtn del" title="Remove this row">−</button>
      <button class="iconbtn add" title="Add row below">+</button>
    </div>
  `;
  row.addEventListener('change', onScopeChange);
  const unitsEl=row.querySelector('[data-k="unitsLabel"]');
  if(unitsEl && unitsEl.tagName==='SELECT'){
    const desired=(s.totalUnits? (s.unitsLabel||'Feet') : (s.unitsLabel||'%'));
    unitsEl.value=desired;
  }
  return row;
}

function onScopeChange(e){
  const realRow = e.currentTarget.classList.contains('row') ? e.currentTarget : e.currentTarget.closest('.row');
  if(!realRow) return; const i = Number(realRow.dataset.index); const s = model.scopes[i];
  const inputs = {
    label: realRow.querySelector('[data-k="label"]').value.trim(),
    start: realRow.querySelector('[data-k="start"]').value,
    end: realRow.querySelector('[data-k="end"]').value,
    cost: parseFloat(realRow.querySelector('[data-k="cost"]').value||'0'),
    progressVal: parseFloat(realRow.querySelector('[data-k="progress"]').value||'0'),
    totalUnitsRaw: realRow.querySelector('[data-k="totalUnits"]').value,
    unitsLabel: realRow.querySelector('[data-k="unitsLabel"]').value.trim()
  };
  s.label = inputs.label || `Scope #${i+1}`;
  s.start = inputs.start; s.end = inputs.end; s.cost = isFinite(inputs.cost)?inputs.cost:0;
  const tu = inputs.totalUnitsRaw === '' ? '' : clamp(parseFloat(inputs.totalUnitsRaw)||0,0,1e12);
  s.totalUnits = tu;
  if(tu!=='' && tu>0){ s.unitsLabel = (inputs.unitsLabel || 'Feet'); } else { s.unitsLabel = (inputs.unitsLabel || '%'); }
  if(tu!=='' && tu>0){ s.unitsToDate = clamp(inputs.progressVal,0,1e12); s.actualPct = tu>0 ? (s.unitsToDate/tu*100) : 0 }
  else { s.unitsToDate = 0; s.actualPct = clamp(inputs.progressVal,0,100); }
  updatePlannedCell(realRow, s); computeAndRender();
}

/*****************
 * Row +/- actions
 *****************/
$('#scopeRows').addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return; const row = e.target.closest('.row'); if(!row) return; const i = Number(row.dataset.index);
  if(btn.classList.contains('del')){ model.scopes.splice(i,1); syncScopeRowsToModel(); computeAndRender(); }
  else if(btn.classList.contains('add')){ const newScope = defaultScope(i+1); model.scopes.splice(i+1,0,newScope); model.scopes = model.scopes.map((s,idx)=> ({...s, label: (s.label.startsWith('Scope #')? `Scope #${idx+1}` : s.label)})); syncScopeRowsToModel(); computeAndRender(); }
});

/*****************
 * Calculations
 *****************/
function calcEarliestStart(){
  let start = null;
  model.scopes.forEach(s => {
    if (s.start) {
      const d = parseDate(s.start);
      // Ignore invalid dates
      if (!d || isNaN(d.getTime())) return;
      if (!start || d < start) start = d;
    }
  });
  return start;
}
function calcScopePlannedPctToDate(s){
  if (!s.start || !s.end) return 0;
  const dStart = parseDate(s.start);
  const dEnd   = parseDate(s.end);
  if (!dStart || !dEnd || isNaN(dStart.getTime()) || isNaN(dEnd.getTime())) return 0;
  const t = parseDate(fmtDate(today));
  if (!t || isNaN(t.getTime())) return 0;
  if (t < dStart) return 0;
  if (t > dEnd) return 100;
  if (t.getTime() === dStart.getTime()) return 0;
  const den = daysBetween(dStart, dEnd);
  const num = daysBetween(dStart, t);
  if (den <= 0) return 100;
  const pct = (num / den) * 100;
  return clamp(pct, 0, 100);
}
function updatePlannedCell(row, s){ const plannedPct = calcScopePlannedPctToDate(s); const cell = row.querySelector('[data-k="planned"]'); if(s.totalUnits!=='' && Number(s.totalUnits)>0){ const plannedUnits = (plannedPct/100) * Number(s.totalUnits); cell.textContent = plannedUnits.toFixed(1); } else { cell.textContent = plannedPct.toFixed(1)+'%'; }
  const startEl = row.querySelector('[data-k="start"]'); const endEl = row.querySelector('[data-k="end"]'); startEl.classList.remove('red-border'); endEl.classList.remove('red-border'); cell.classList.remove('danger'); const actualPctForCompare = s.actualPct || 0; if(actualPctForCompare < plannedPct) cell.classList.add('danger'); if(s.start){ if(parseDate(s.start) < parseDate(fmtDate(today)) && (actualPctForCompare===0)) startEl.classList.add('red-border'); } if(s.end){ if(parseDate(s.end) < parseDate(fmtDate(today)) && (Math.round(actualPctForCompare) < 100)) endEl.classList.add('red-border'); } }
function calcScopeWeightings(){ const total = model.scopes.reduce((a,b)=>a+(b.cost||0),0) || 0; return model.scopes.map(s=> total>0 ? (s.cost/total) : 0); }
function calcPlannedDailyOverall(){
  const weightings = calcScopeWeightings();
  return model.scopes.map((s, i) => {
    if (!s.start || !s.end) {
      return { weight: 0, perDay: 0, start: null, end: null };
    }
    const dStart = parseDate(s.start);
    const dEnd   = parseDate(s.end);
    if (!dStart || !dEnd || isNaN(dStart.getTime()) || isNaN(dEnd.getTime())) {
      return { weight: 0, perDay: 0, start: null, end: null };
    }
    const w = weightings[i] || 0;
    const days = daysBetween(dStart, dEnd);
    return {
      weight: w,
      perDay: days > 0 ? (w / days) * 100 : 0,
      start: dStart,
      end: dEnd
    };
  });
}
function calcTotalActualProgress(){ const weightings = calcScopeWeightings(); const total = model.scopes.reduce((sum, s, i)=> sum + (weightings[i]||0) * (isFinite(s.actualPct)?s.actualPct:0), 0); return clamp(total,0,100); }
function buildDateRange(){
  const ps = calcEarliestStart();
  let end = null;

  model.scopes.forEach(s => {
    if (s.end) {
      const d = parseDate(s.end);
      if (!d || isNaN(d.getTime())) return;
      if (!end || d > end) end = d;
    }
  });

  model.history.forEach(h => {
    if (!h.date) return;
    const d = parseDate(h.date);
    if (!d || isNaN(d.getTime())) return;
    if (!end || d > end) end = d;
  });

  if (!ps) return [];
  if (!end) end = ps;

  // Cap the total range to avoid huge day arrays that can freeze the chart.
  const startDate = parseDate(fmtDate(ps));
  const endDate   = parseDate(fmtDate(end));
  if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return [];
  }

  const oneDayMs = 86400000;
  const spanDays = Math.floor((endDate - startDate) / oneDayMs) + 1;
  const MAX_SPAN_DAYS = 365 * 15; // cap at ~15 years of daily points

  let effStart = new Date(startDate);
  let effEnd   = new Date(endDate);

  if (spanDays > MAX_SPAN_DAYS) {
    // Keep the end date and slide the start date forward
    effEnd = new Date(endDate);
    effStart = new Date(effEnd.getTime() - (MAX_SPAN_DAYS - 1) * oneDayMs);
  }

  const start = new Date(effStart);
  start.setDate(start.getDate() - 1); // one day before earliest so chart starts smoothly

  const arr = [];
  let d = new Date(start);
  while (d <= effEnd) {
    arr.push(fmtDate(d));
    d.setDate(d.getDate() + 1);
  }
  return arr;
}
function buildFallbackRange(){ const d = fmtDate(today); return {days:[d], planned:[0], actual:[0]}; }
function lastActualDate(){ let last=null; for(const k of Object.keys(model.dailyActuals)){ if(model.dailyActuals[k]!=null){ const d=parseDate(k); if(!last||d>last) last=d; } } model.history.forEach(h=>{ const d=parseDate(h.date); if(!last||d>last) last=d; }); const ps = calcEarliestStart(); if(!last && ps) last = ps; return last; }
function calcPlannedSeriesByDay(){ const days = buildDateRange(); if(days.length===0){ const f=buildFallbackRange(); return {days:f.days, plannedCum:f.planned}; } const per = calcPlannedDailyOverall(); const plannedCum=[]; let cum=0; for(const ds of days){ const d=parseDate(ds); let add=0; per.forEach(p=>{ if(p.start && p.end && d>=p.start && d<=p.end) add += p.perDay; }); cum += add; plannedCum.push(clamp(cum,0,100)); } return {days, plannedCum}; }
function calcActualSeriesByDay(days){ if(!days || days.length===0){ const f=buildFallbackRange(); return f.actual; } const known = new Map(); const ps = calcEarliestStart(); if(ps){ const pre = new Date(ps); pre.setDate(pre.getDate()-1); known.set(fmtDate(pre), 0); } for(const [d,v] of Object.entries(model.dailyActuals)){ if(v!=null) known.set(d, clamp(Number(v)||0,0,100)); } model.history.forEach(h=> known.set(h.date, clamp(Number(h.actualPct)||0,0,100)));
  const actual = new Array(days.length).fill(null); const inRangeKeys = days.filter(d=> known.has(d)); inRangeKeys.sort(); if(inRangeKeys.length && days.length){ actual[days.indexOf(inRangeKeys[0])] = known.get(inRangeKeys[0]); }
  for(let i=0;i<inRangeKeys.length-1;i++){ const d1 = inRangeKeys[i]; const d2 = inRangeKeys[i+1]; const v1 = known.get(d1); const v2 = known.get(d2); const idx1 = days.indexOf(d1); const idx2 = days.indexOf(d2); const span = idx2-idx1; if(idx1>=0) actual[idx1]=v1; for(let k=1;k<span;k++){ const t = k/span; actual[idx1+k] = v1 + (v2 - v1) * t; } if(idx2>=0) actual[idx2]=v2; }
  const last = lastActualDate(); if(last){ for(let i=0;i<days.length;i++){ if(parseDate(days[i])>last) actual[i]=null; } }
  return actual.map(v=> v==null? v : clamp(Number(v)||0,0,100)); }
function computeDaysRelativeToPlan(days, planned, actual){ if(!days.length) return null; let aIdx = -1; let aPct = 0; for(let i=actual.length-1;i>=0;i--){ if(actual[i]!=null){ aIdx=i; aPct=actual[i]; break; } } if(aIdx<0) return null; let j = planned.findIndex(v => v!=null && v >= aPct); if(j <= 0){ const pStar = j < 0 ? planned.length - 1 : 0; const daysRelEdge = pStar - aIdx; return { actualDate: days[aIdx], actualPct: aPct, plannedDateForActualPct: days[Math.max(0, Math.min(days.length-1, Math.round(pStar)))], daysRelative: daysRelEdge }; }
  const p0 = planned[j-1] ?? 0; const p1 = planned[j] ?? p0; let t = 0; if(Math.abs(p1 - p0) > 1e-9){ t = (aPct - p0) / (p1 - p0); } const pStar = (j-1) + t; const daysRel = pStar - aIdx; return { actualDate: days[aIdx], actualPct: aPct, plannedDateForActualPct: days[Math.max(0, Math.min(days.length-1, Math.round(pStar)))], daysRelative: daysRel }; }

/*****************
 * Baseline helpers
 *****************/
function getBaselineSeries(days, plannedCum){
  if(model.baseline && Array.isArray(model.baseline.days) && Array.isArray(model.baseline.planned)){
    // map baseline snapshot to current days
    const map = new Map(); model.baseline.days.forEach((d,idx)=> map.set(d, model.baseline.planned[idx]));
    return days.map(d=> map.has(d) ? map.get(d) : null);
  }
  // no baseline yet -> mirrors planned
  return plannedCum.slice();
}
function takeBaseline(days, plannedCum){ model.baseline = { days: days.slice(), planned: plannedCum.slice(), ts: Date.now() }; setCookie(COOKIE_KEY, JSON.stringify(model), 3650); }

/*****************
 * Rendering & Chart
 *****************/
let chart;
let baselineVisible = true;
let legendStats = {baselinePct:null, plannedPct:null, actualPct:null, daysRelText:''};
let plannedVisible = true;
let actualVisible = true;

function updateBelowChartStats(days, baselineCum, plannedCum, actualCum){
  const el = document.getElementById('bpStats');
  if(!el){ return; }
  const last = lastActualDate();
  if(!last){ el.innerHTML = ''; return; }
  const ds = fmtDate(last);
  const idx = days.indexOf(ds);
  if(idx < 0){ el.innerHTML = ''; return; }
  const b = baselineCum[idx];
  const p = plannedCum[idx];
  const bStr = (b==null ? '' : Number(b).toFixed(1) + '%');
  const pStr = (p==null ? '' : Number(p).toFixed(1) + '%');
  // Moved baseline/planned percentages into the legend; leave this area empty.
  el.innerHTML = ``;
}
function computeAndRender(){
  // Moved baseline/planned percentages into the legend; leave this area empty.
  model.project.name = $('#projectName').value.trim();
  model.project.startup = $('#projectStartup').value;
  model.project.markerLabel = ($('#startupLabelInput').value || 'Baseline Complete').trim();
  const hdEl=document.getElementById('historyDate'); if(hdEl && !hdEl.value){ hdEl.value = fmtDate(new Date()); }
  $$('#scopeRows .row').forEach((row)=>{ const i = Number(row.dataset.index); updatePlannedCell(row, model.scopes[i]); });
  const totalActual = calcTotalActualProgress(); $('#totalActual').textContent = totalActual.toFixed(1)+'%'; const hd = document.getElementById('historyDate'); if(hd && !hd.value){ hd.value = fmtDate(new Date()); }
  const plan = calcPlannedSeriesByDay(); const days = plan.days || []; const plannedCum = plan.plannedCum || plan.planned || []; const actualCum = calcActualSeriesByDay(days); const baselineCum = getBaselineSeries(days, plannedCum);
  renderDailyTable(days, baselineCum, plannedCum, actualCum);
  drawChart(days, baselineCum, plannedCum, actualCum);
  updateBelowChartStats(days, baselineCum, plannedCum, actualCum);
  requestAnimationFrame(()=>{ refreshLegendNow(); });
(function(){
    function lastIdxOf(arr){ for(let i=arr.length-1;i>=0;i--){ if(arr[i]!=null){ return i; } } return -1; }
    const liA = lastIdxOf(actualCum);
    const liP = lastIdxOf(plannedCum);
    const liB = lastIdxOf(baselineCum);
    if(typeof legendStats==='undefined'){ window.legendStats = {}; }
    legendStats.actualPct = (liA>=0 && actualCum[liA]!=null) ? Number(actualCum[liA]).toFixed(1) : null;
    legendStats.plannedPct = (liP>=0 && plannedCum[liP]!=null) ? Number(plannedCum[liP]).toFixed(1) : null;
    legendStats.baselinePct = (liB>=0 && baselineCum[liB]!=null) ? Number(baselineCum[liB]).toFixed(1) : null;
    // days ahead/behind formatting (0 days behind when on plan)
    const rel = computeDaysRelativeToPlan(days, plannedCum, actualCum);
    if(rel && typeof rel.daysRelative==='number'){
      const d = Number(rel.daysRelative);
      legendStats.daysRelText = (d===0) ? '0 days behind' : (Math.abs(d).toFixed(1)+' '+(d>0?'days ahead of plan':'days behind plan'));
    } else if(typeof model!=='undefined' && model && model.daysRelativeToPlan!=null){
      const d = Number(model.daysRelativeToPlan);
      legendStats.daysRelText = (d===0) ? '0 days behind' : (Math.abs(d).toFixed(1)+' '+(d>0?'days ahead of plan':'days behind plan'));
    } else {
      legendStats.daysRelText = '';
    }
  })();
  if(typeof renderLegend==='function'){ renderLegend(chart); }
(function(){
    function lastIdxOf(arr){ for(let i=arr.length-1;i>=0;i--){ if(arr[i]!=null){ return i; } } return -1; }
    const liA = lastIdxOf(actualCum);
    const liP = lastIdxOf(plannedCum);
    const liB = lastIdxOf(baselineCum);
    legendStats.actualPct = (liA>=0 && actualCum[liA]!=null) ? Number(actualCum[liA]).toFixed(1) : null;
    legendStats.plannedPct = (liP>=0 && plannedCum[liP]!=null) ? Number(plannedCum[liP]).toFixed(1) : null;
    legendStats.baselinePct = (liB>=0 && baselineCum[liB]!=null) ? Number(baselineCum[liB]).toFixed(1) : null;
    if(model && model.daysRelativeToPlan!=null){
      const d = Number(model.daysRelativeToPlan);
      legendStats.daysRelText = (d===0) ? '0 days behind' : (Math.abs(d).toFixed(1)+' '+(d>0?'days ahead of plan':'days behind plan'));
    } else { legendStats.daysRelText = ''; }
  })();

  // Re-align legend percentages so Baseline/Planned match the date of the last Actual point
  (function(){
    if(!Array.isArray(days) || !Array.isArray(actualCum)) return;
    let idxA = -1;
    for(let i = actualCum.length - 1; i >= 0; i--){
      if(actualCum[i] != null){
        idxA = i;
        break;
      }
    }
    if(idxA < 0) return;
    const a = actualCum[idxA];
    const p = (Array.isArray(plannedCum) && plannedCum[idxA] != null) ? plannedCum[idxA] : null;
    const b = (Array.isArray(baselineCum) && baselineCum[idxA] != null) ? baselineCum[idxA] : null;
    if(typeof legendStats === 'undefined'){ window.legendStats = {}; }
    legendStats.actualPct = (a != null) ? Number(a).toFixed(1) : null;
    legendStats.plannedPct = (p != null) ? Number(p).toFixed(1) : null;
    legendStats.baselinePct = (b != null) ? Number(b).toFixed(1) : null;
  })();

  renderLegend(chart);
const rel = computeDaysRelativeToPlan(days, plannedCum, actualCum);
  if(rel){ model.daysRelativeToPlan = rel.daysRelative; const absDaysStr = Math.abs(rel.daysRelative).toFixed(1); const idx = days.indexOf(rel.actualDate); const plannedAtActual = idx>=0 ? plannedCum[idx] : null; const baselineAtActual = idx>=0 ? (baselineCum[idx]==null? null : baselineCum[idx]) : null; const plannedLine = plannedAtActual!=null ? `<div>Planned Progress: <strong>${plannedAtActual.toFixed(1)}%</strong></div>` : '';
    const baselineLine = baselineAtActual!=null ? `<div>Baseline Progress: <strong>${baselineAtActual.toFixed(1)}%</strong></div>` : '';
    if(rel.daysRelative===0){ $('#planDelta').innerHTML = `<div>Current Progress: <strong>${rel.actualPct.toFixed(1)}%</strong></div>${plannedLine}${baselineLine}<div>Actual Relative to Plan: on plan</div>`; }
    else { const words = rel.daysRelative>0 ? 'days ahead of plan' : 'days behind plan'; $('#planDelta').innerHTML = `<div>Current Progress: <strong>${rel.actualPct.toFixed(1)}%</strong></div>${plannedLine}${baselineLine}<div>Actual Relative to Plan: <strong>${absDaysStr}</strong> ${words}</div>`; }
  } else { model.daysRelativeToPlan = null; $('#planDelta').textContent = ''; }
  setCookie(COOKIE_KEY, JSON.stringify(model), 3650);
}

function renderLegend(chart){
  const cont = $('#customLegend');
  if(!cont) return;
  cont.innerHTML = '';

  const mk = (id, text, cls, checked, onChange, subText, extraRightEl) => {
    const wrap = document.createElement('div');
    wrap.className = 'legend-item ' + cls;

    const row = document.createElement('div');
    row.className = 'legend-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = !!checked;
    cb.addEventListener('change', onChange);
    const span = document.createElement('span');
    span.textContent = text;
    row.appendChild(cb);
    row.appendChild(span);
    if(extraRightEl){ row.appendChild(extraRightEl); }
    wrap.appendChild(row);

    if(subText){
      const sub = document.createElement('div');
      sub.className = 'legend-sub ' + (cls.includes('baseline')?'baseline': cls.includes('planned')?'planned':'actual');
      sub.textContent = subText;
      wrap.appendChild(sub);
    }
    cont.appendChild(wrap);
  };

  const daysRel = legendStats.daysRelText ? (function(){ const s=document.createElement('span'); s.className='legend-daysrel'; s.textContent = legendStats.daysRelText; return s; })() : null;

  // Baseline
  mk('legendBaselineCheckbox', 'Baseline', 'legend-baseline', baselineVisible, (e)=>{    baselineVisible = e.target.checked; const meta = chart.getDatasetMeta(0); meta.hidden = !baselineVisible; computeAndRender();  }, legendStats.baselinePct!=null ? (legendStats.baselinePct + '%') : null, null);

  // Planned
  mk('legendPlannedCheckbox', 'Plan', 'legend-planned', plannedVisible, (e)=>{    plannedVisible = e.target.checked; const meta = chart.getDatasetMeta(1); meta.hidden = !plannedVisible; computeAndRender();  }, legendStats.plannedPct!=null ? (legendStats.plannedPct + '%') : null, null);

  // Actual + daysRel to the right
  mk('legendActualCheckbox', 'Actual', 'legend-actual', actualVisible, (e)=>{
    actualVisible = e.target.checked; const meta = chart.getDatasetMeta(2); meta.hidden = !actualVisible; computeAndRender();
  }, legendStats.actualPct!=null ? (legendStats.actualPct + '%') : null, daysRel);
}

function refreshLegendNow(){
  try{
    // Recompute series from current model so legend stats are fresh
    const plan = calcPlannedSeriesByDay();
    const days = plan.days || [];
    const plannedCum = plan.plannedCum || plan.cum || plan.planned || [];
    const actualCum = calcActualSeriesByDay(days);
    const baselineCum = getBaselineSeries(days, plannedCum);

    // Align legend stats to the last Actual point instead of the end of each curve
    (function(){
      if(!Array.isArray(days) || !Array.isArray(actualCum)) return;
      let idxA = -1;
      for(let i = actualCum.length - 1; i >= 0; i--){
        if(actualCum[i] != null){
          idxA = i;
          break;
        }
      }
      if(idxA < 0){
        if(typeof legendStats === 'undefined'){ window.legendStats = {}; }
        legendStats.actualPct = null;
        legendStats.plannedPct = null;
        legendStats.baselinePct = null;
        return;
      }
      const a = actualCum[idxA];
      const p = (Array.isArray(plannedCum) && plannedCum[idxA] != null) ? plannedCum[idxA] : null;
      const b = (Array.isArray(baselineCum) && baselineCum[idxA] != null) ? baselineCum[idxA] : null;
      if(typeof legendStats === 'undefined'){ window.legendStats = {}; }
      legendStats.actualPct = (a != null) ? Number(a).toFixed(1) : null;
      legendStats.plannedPct = (p != null) ? Number(p).toFixed(1) : null;
      legendStats.baselinePct = (b != null) ? Number(b).toFixed(1) : null;
    })();

    // Compute days-ahead/behind text (0 days behind when on plan)
    const rel = computeDaysRelativeToPlan(days, plannedCum, actualCum);
    if(rel && typeof rel.daysRelative==='number'){
      const d = Number(rel.daysRelative);
      legendStats.daysRelText = (d===0) ? '0 days behind' : (Math.abs(d).toFixed(1)+' '+(d>0?'days ahead of plan':'days behind plan'));
    } else if(typeof model!=='undefined' && model && model.daysRelativeToPlan!=null){
      const d = Number(model.daysRelativeToPlan);
      legendStats.daysRelText = (d===0) ? '0 days behind' : (Math.abs(d).toFixed(1)+' '+(d>0?'days ahead of plan':'days behind plan'));
    } else {
      legendStats.daysRelText = '';
    }

    if(typeof renderLegend==='function'){ renderLegend(chart); }
  }catch(e){ /* noop */ }
}

function drawChart(days, baseline, planned, actual){
  const labels = (days && days.length)? days.map(d=>d) : [fmtDate(today)];
  const dataBaseline = (baseline && baseline.length)? baseline : [0];
  const dataPlanned = (planned && planned.length)? planned : [0];
  const dataActual = (actual && actual.length)? actual : [0];

  const yAxisLabelAnnotation = { type:'label', xValue: labels[0], yValue: 50, content:['% Progress'], backgroundColor:'rgba(0,0,0,0)', color:'#0f172a', rotation:-90, xAdjust:-55, font:{weight:'bold', size:16} };

  let startupAnnotations = {};
  if(model.project.startup && document.getElementById('labelToggle').checked){
    const idx = labels.indexOf(model.project.startup);
    if(idx>=0){
      const y = dataPlanned[idx] ?? 0;
      const greenText = (model.project.markerLabel || 'Baseline Complete') + ' >';
      // Single green label placed just BELOW the blue line so it does not cross
      startupAnnotations.startupLabel = {
  type: 'label',
  xValue: labels[idx],
  // Compute a y-value that is exactly 55px below the Planned line at this x
  yValue: (ctx)=>{
    const chart = ctx.chart;
    const yScale = chart.scales.y;
    const labelsArr = chart.data.labels || [];
    const xVal = ctx.annotation && ctx.annotation.xValue !== undefined ? ctx.annotation.xValue : labels[idx];
    const i = labelsArr.indexOf(xVal);
    const baselineDs = (chart.data.datasets || []).find(d => (d.label||'').toLowerCase()==='baseline');
    const baselineVal = baselineDs && Array.isArray(baselineDs.data) ? (baselineDs.data[i] ?? 0) : 0;
    const px = yScale.getPixelForValue(baselineVal);
    return yScale.getValueForPixel(px + 80);
  },
  content: [greenText],
  backgroundColor: 'rgba(0,0,0,0)',
  color: 'rgba(107,114,128,1)',
  rotation: -90,
  yAdjust: 0,
  font: { weight: 'bold', size: 16 }
};
    }
  }

  const titleText = (model.project.name ? (model.project.name + ' Progress') : 'Progress');
  const weeks = Math.floor(labels.length/7);
  const xGridColor = (ctx)=>{ const i = ctx.index; const isWeekly = (i % 7) === 0; if(weeks > 16){ return isWeekly ? 'rgba(100,116,139,.45)' : 'rgba(0,0,0,0)'; } return 'rgba(100,116,139,.45)'; };

  const cfg = {
    type:'line',
    data:{ labels, datasets:[
      {label:'Baseline', order:100, hidden:(!baselineVisible), hidden:(!baselineVisible), data:dataBaseline, borderColor:'rgba(107,114,128,1)', backgroundColor:'rgba(107,114,128,.10)', tension:.15, borderWidth:2, pointRadius:0},
      {label:'Planned', order:0, hidden:(!plannedVisible), hidden:(!plannedVisible), data:dataPlanned, borderColor:'rgba(37,99,235,1)', backgroundColor:'rgba(37,99,235,.12)', tension:.15, borderWidth:2, pointRadius:0},
      {label:'Actual', order:-100, hidden:(!actualVisible), hidden:(!actualVisible), data:dataActual, spanGaps:false, borderColor:'rgba(234,88,12,1)', backgroundColor:'rgba(234,88,12,.12)', tension:.15, borderWidth:2, pointRadius:0}
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, title:{display:true, text:titleText, color:'#0f172a', font:{size:25, weight:'bold'}}, annotation: { annotations: (function(){
          // Add orange end label annotation for latest Actual value
          const ann = Object.assign({ yLabelAt50: yAxisLabelAnnotation }, startupAnnotations);
          let lastIdx = -1; for(let i=dataActual.length-1;i>=0;i--){ if(dataActual[i]!=null){ lastIdx = i; break; } }
          if(lastIdx>=0 && actualVisible){ ann.actualEndLabel = { type:'label', xValue: labels[lastIdx], yValue: dataActual[lastIdx], content:[(Number(dataActual[lastIdx]).toFixed(1)+'%')], backgroundColor:'rgba(0,0,0,0)', color:'rgba(234,88,12,1)', font:{weight:'bold', size:16}, xAdjust: 12, yAdjust: -8 } }
          return ann; })() } },
      scales: {
          x: {
              ticks: {
                  font: { size: 16 }
              }
          },
          y: {
            min: 0,
            max: 100,  
            ticks: {
                  font: { size: 16 },
                  callback: function (value) {
                      return value + '%';
                  }
              }
          }
      }
    }
  };
  if(chart){ chart.destroy(); }
  const ctx = document.getElementById('progressChart').getContext('2d');
  chart = new Chart(ctx, cfg);
}

function renderDailyTable(days, baseline, planned, actual){
  const tb = $('#dailyTable tbody'); tb.innerHTML = '';
  days.forEach((d, idx)=>{ const tr = document.createElement('tr'); const b = baseline[idx]; const p = planned[idx]; const a = actual[idx]; tr.innerHTML = `
      <td>${d}</td>
      <td class="right">${(b==null? '' : (Number(b)||0).toFixed(1)+'%')}</td>
      <td class="right">${(p==null? '' : (Number(p)||0).toFixed(1)+'%')}</td>
      <td class="right"><input class="right-input" data-day="${d}" type="number" step="0.1" min="0" max="100" value="${a==null? '' : a.toFixed(1)}" style="width:50px"></td>
    `; tb.appendChild(tr); });
  $$('#dailyTable input[type=number]').forEach(inp=>{ const handler = ()=>{ const day = inp.dataset.day; const raw = inp.value; const v = raw===''? undefined : clamp(parseFloat(raw)||0,0,100); model.dailyActuals[day] = v; computeAndRender(); }; inp.addEventListener('change', handler); inp.addEventListener('blur', handler); });
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
  let xml = '';
  xml += '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<Project xmlns="http://schemas.microsoft.com/project">\n';

  xml += '  <Name>' + (model.project?.name || '') + '</Name>\n';

  xml += '  <ExtendedAttributes>\n';

  function addAttr(fieldID, name, value) {
    xml += '    <ExtendedAttribute>\n';
    xml += '      <FieldID>' + fieldID + '</FieldID>\n';
    xml += '      <Name>' + name + '</Name>\n';
    xml += '      <Value><![CDATA[' + (value || '') + ']]></Value>\n';
    xml += '    </ExtendedAttribute>\n';
  }

  addAttr('Text1', 'Startup', model.project?.startup || '');
  addAttr('Text2', 'MarkerLabel', model.project?.markerLabel || 'Baseline Complete');

  addAttr('Text3', 'LegendBaselineCheckbox', 
          document.getElementById("legend-baseline")?.checked ? 'true' : 'false');
  addAttr('Text4', 'LegendPlannedCheckbox', 
          document.getElementById("legend-planned")?.checked ? 'true' : 'false');
  addAttr('Text5', 'LegendActualCheckbox', 
          document.getElementById("legend-actual")?.checked ? 'true' : 'false');

  // BaselineHistory lines
  let baselineCSV = '';
  if (model.baseline && model.baseline.days && model.baseline.planned) {
      for (let i = 0; i < model.baseline.days.length; i++) {
          baselineCSV += model.baseline.days[i] + ',' + model.baseline.planned[i] + '\\n';
      }
  }
  addAttr('Text6', 'BaselineHistory', baselineCSV);

  // ActualHistory lines
  let actualCSV = '';
  if (model.history) {
      model.history.forEach(h => { actualCSV += h.date + ',' + h.actualPct + '\\n'; });
  }
  addAttr('Text7', 'ActualHistory', actualCSV);

  // DailyActuals lines
  let dailyCSV = '';
  if (model.dailyActuals) {
      Object.keys(model.dailyActuals).forEach(d => {
        dailyCSV += d + ',' + model.dailyActuals[d] + '\\n';
      });
  }
  addAttr('Text8', 'DailyActuals', dailyCSV);

  xml += '  </ExtendedAttributes>\n';

  xml += '  <Tasks>\n';
  model.scopes.forEach((s, idx) => {
      xml += '    <Task>\n';
      xml += '      <UID>' + (idx + 1) + '</UID>\n';
      xml += '      <ID>' + (idx + 1) + '</ID>\n';
      xml += '      <Name>' + s.label + '</Name>\n';
      xml += '      <Start>' + s.start + 'T08:00:00</Start>\n';
      xml += '      <Finish>' + s.end + 'T17:00:00</Finish>\n';
      xml += '      <PercentComplete>' + (s.actualPct || 0) + '</PercentComplete>\n';
      xml += '      <Cost>' + (s.cost || 0) + '</Cost>\n';
      xml += '      <ProgressValue>' + (s.unitsToDate || 0) + '</ProgressValue>\n';
      xml += '      <TotalUnits>' + (s.totalUnits || '') + '</TotalUnits>\n';
      xml += '      <UnitsLabel>' + (s.unitsLabel || '') + '</UnitsLabel>\n';
      xml += '    </Task>\n';
  });
  xml += '  </Tasks>\n';

  xml += '</Project>';
  return xml;
}
async function saveXml(){
  try{
    const xml = buildMSPXML();
    const suggested = (model.project.name ? model.project.name.replace(/\s+/g,'_') + '_' : '') + 'progress_all.xml';
    if(window.showSaveFilePicker){
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
      alert('XML saved.');
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
      alert('XML saved (downloaded).');
    }
  }catch(e){
    alert('XML save failed: ' + e.message);
  }
}

function csvEsc(v){ if(v==null) return ''; const s = String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
function csvLine(arr){ return arr.map(csvEsc).join(',') + '\n'; }

function buildAllCSV(){
  const {days, plannedCum} = calcPlannedSeriesByDay();
  const actualCum = calcActualSeriesByDay(days);
  const baselineCum = getBaselineSeries(days, plannedCum);
  let out = '';

  // PROJECT section
  out += '#SECTION:PROJECT\n';
  out += 'key,value\n';
  out += csvLine(['name', model.project.name || '']);
  out += csvLine(['startup', model.project.startup || '']);
  out += csvLine(['markerLabel', model.project.markerLabel || 'Baseline Complete']);
  out += '\n';

  // SCOPES section
  out += '#SECTION:SCOPES\n';
  out += 'label,start,end,cost,progressValue,totalUnits,unitsLabel\n';
  (model.scopes || []).forEach(s => {
    const label = s.label || '';
    const start = s.start || '';
    const end = s.end || '';
    const cost = s.cost != null ? s.cost : 0;

    const hasUnits = s.totalUnits !== '' && s.totalUnits != null && !isNaN(parseFloat(s.totalUnits));
    const totalUnits = hasUnits ? parseFloat(s.totalUnits) : '';
    const progressValue = hasUnits ? (s.unitsToDate || 0) : (s.actualPct || 0);
    const unitsLabel = s.unitsLabel || (hasUnits ? 'Feet' : '%');

    out += csvLine([
      label,
      start,
      end,
      cost,
      progressValue,
      totalUnits === '' ? '' : totalUnits,
      unitsLabel
    ]);
  });
  out += '\n';

  // DAILY_ACTUALS section
  out += '#SECTION:DAILY_ACTUALS\n';
  out += 'date,value\n';
  const daily = model.dailyActuals || {};
  Object.keys(daily).sort().forEach(d => {
    const v = daily[d];
    out += csvLine([d, (v == null || v === '') ? '' : Number(v)]);
  });
  out += '\n';

  // HISTORY section
  out += '#SECTION:HISTORY\n';
  out += 'date,actualPct\n';
  (model.history || []).forEach(h => {
    if(!h.date) return;
    const val = h.actualPct != null ? h.actualPct : 0;
    out += csvLine([h.date, val]);
  });
  out += '\n';

  // BASELINE section
  out += '#SECTION:BASELINE\n';
  out += 'date,baselinePct\n';
  if(model.baseline && Array.isArray(model.baseline.days) && Array.isArray(model.baseline.planned)){
    model.baseline.days.forEach((d, idx) => {
      const v = model.baseline.planned[idx];
      out += csvLine([d, v == null ? '' : v]);
    });
  }
  out += '\n';

  return out;
}

async function saveAll(){
  try{
    const csv = buildAllCSV();
    if(window.showSaveFilePicker){
      const handle = await window.showSaveFilePicker({ suggestedName: (model.project.name? model.project.name.replace(/\s+/g,'_')+'_': '') + 'progress_all.csv', types:[{ description:'CSV', accept:{ 'text/csv':['.csv'] } }] });
      const writable = await handle.createWritable(); await writable.write(new Blob([csv], {type:'text/csv'})); await writable.close();
      setCookie(COOKIE_KEY, JSON.stringify(model), 3650); alert('Saved.');
    } else {
      // Fallback download
      const blob = new Blob([csv], {type:'text/csv'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = (model.project.name? model.project.name.replace(/\s+/g,'_')+'_': '') + 'progress_all.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); setCookie(COOKIE_KEY, JSON.stringify(model), 3650); alert('Saved (downloaded).');
    }
  }catch(e){ alert('Save failed: ' + e.message); }
}

function parseCSV(text){ const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n'); const rows=[]; let cur=[]; let inQuote=false; let field=''; function pushField(){ cur.push(field); field=''; } function pushRow(){ rows.push(cur); cur=[]; }
  for(const line of lines){ let i=0; inQuote=false; field=''; cur=[]; while(i<line.length){ const ch = line[i]; if(inQuote){ if(ch==='"' && line[i+1]==='"'){ field+='"'; i+=2; continue; } if(ch==='"'){ inQuote=false; i++; continue; } field+=ch; i++; continue; } else { if(ch==='"'){ inQuote=true; i++; continue; } if(ch===','){ pushField(); i++; continue; } field+=ch; i++; continue; } } pushField(); pushRow(); }
  return rows; }

function uploadCSVAndLoad(){ const inp = document.createElement('input'); inp.type='file'; inp.accept='.csv,text/csv,application/xml,.xml'; inp.onchange = () => { const file = inp.files[0]; if(!file) return; const reader = new FileReader(); reader.onload = (e)=>{ try{ const text = e.target.result;
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
        if(/^Date,Planned_Cumulative,Actual_Cumulative/m.test(text)){ const lines = text.trim().split(/\r?\n/); lines.shift(); model.dailyActuals = {}; for(const line of lines){ const parts = line.split(','); const d = parts[0]; const a = parts[2]; if(d && a!=='' && !isNaN(parseFloat(a))) model.dailyActuals[d] = clamp(parseFloat(a),0,100); } computeAndRender(); alert('Legacy daily CSV loaded.'); return; }
        const rows = parseCSV(text); let section = ''; model = { project:{name:'',startup:'', markerLabel:'Baseline Complete'}, scopes:[], history:[], dailyActuals:{}, baseline:null, daysRelativeToPlan:null };
try{ computeAndRender(); }catch(e){}
        let scopeHeaders = []; let baselineRows = [];
        for(let r of rows){ if(r.length===1 && r[0].startsWith('#SECTION:')){ section = r[0].slice('#SECTION:'.length).trim(); continue; } if(r.length===0 || (r.length===1 && r[0]==='')) continue;
          if(section==='PROJECT'){ if(r[0]==='key') { continue; } if(r[0]==='name') model.project.name = r[1]||''; if(r[0]==='startup') model.project.startup = r[1]||''; if(r[0]==='markerLabel') model.project.markerLabel = r[1]||'Baseline Complete'; }
          else if(section==='SCOPES'){ if(!scopeHeaders.length){ scopeHeaders = r; continue; } const idx = (name)=> scopeHeaders.indexOf(name); const s = { label: r[idx('label')]||'', start: r[idx('start')]||'', end: r[idx('end')]||'', cost: parseFloat(r[idx('cost')]||'0')||0, unitsToDate: parseFloat(r[idx('progressValue')]||'0')||0, totalUnits: (r[idx('totalUnits')]===undefined||r[idx('totalUnits')]==='')? '' : (parseFloat(r[idx('totalUnits')])||0), unitsLabel: r[idx('unitsLabel')]||'%', actualPct: 0 }; s.actualPct = s.totalUnits? (s.unitsToDate && s.totalUnits? (s.unitsToDate/s.totalUnits*100) : 0) : (s.unitsToDate||0); model.scopes.push(s); }
          else if(section==='DAILY_ACTUALS'){ if(r[0]==='date') continue; const d = r[0]; const a = r[1]; if(d){ model.dailyActuals[d] = a===''? undefined : clamp(parseFloat(a)||0,0,100); } }
          else if(section==='HISTORY'){ if(r[0]==='date') continue; if(r[0]) model.history.push({date:r[0], actualPct: parseFloat(r[1]||'0')||0}); }
          else if(section==='BASELINE'){ if(r[0]==='date') continue; baselineRows.push({date:r[0], val: (r[1]===''? null : parseFloat(r[1]||'0'))}); }
        }
        if(baselineRows.length){ model.baseline = { days: baselineRows.map(r=>r.date), planned: baselineRows.map(r=> (r.val==null? null : clamp(r.val,0,100))) }; }
        $('#projectName').value = model.project.name||''; $('#projectStartup').value = model.project.startup||''; $('#startupLabelInput').value = model.project.markerLabel || 'Baseline Complete';
        syncScopeRowsToModel(); computeAndRender(); setCookie(COOKIE_KEY, JSON.stringify(model), 3650); 
// alert('Full CSV loaded.');
      }catch(err){ alert('Failed to parse CSV: '+err.message); } };
    reader.readAsText(file);
  };
  inp.click(); }


function loadFromXml(xmlText){
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror');
  if(perr && perr.length){ throw new Error('Invalid XML'); }

  // MS Project uses default namespace; we can use getElementsByTagName since we know element names
  const projEl = doc.getElementsByTagName('Project')[0];
  if(!projEl){ throw new Error('No <Project> element found'); }

  const nameEl = projEl.getElementsByTagName('Name')[0];
  const projectName = nameEl ? nameEl.textContent : '';

  const taskEls = projEl.getElementsByTagName('Task');

  const newModel = {
    project:{ name: projectName || '', startup:'', markerLabel: model.project.markerLabel || 'Baseline Complete' },
    scopes:[],
    history:[],
    dailyActuals:{},
    baseline:null,
    daysRelativeToPlan:null
  };

  for(let i=0;i<taskEls.length;i++){
    const t = taskEls[i];
    const uidEl = t.getElementsByTagName('UID')[0];
    if(uidEl && uidEl.textContent === '0'){ continue; } // skip summary task if present

    const nmEl = t.getElementsByTagName('Name')[0];
    const startEl = t.getElementsByTagName('Start')[0];
    const finEl = t.getElementsByTagName('Finish')[0];
    const pctEl = t.getElementsByTagName('PercentComplete')[0];

    const label = nmEl ? nmEl.textContent : ('Task ' + (i+1));
    const startRaw = startEl ? startEl.textContent : '';
    const finishRaw = finEl ? finEl.textContent : '';
    const pctRaw = pctEl ? pctEl.textContent : '0';
    const costEl = t.getElementsByTagName('Cost')[0];
    const progEl = t.getElementsByTagName('ProgressValue')[0];
    const tuEl = t.getElementsByTagName('TotalUnits')[0];
    const ulEl = t.getElementsByTagName('UnitsLabel')[0];
    const cost = costEl ? (parseFloat(costEl.textContent||'0')||0) : 0;
    const progressValue = progEl ? (parseFloat(progEl.textContent||'0')||0) : 0;
    const totalUnits = tuEl ? (tuEl.textContent||'') : '';
    const unitsLabel = ulEl ? (ulEl.textContent||'%') : '%';

    // Convert ISO date-time (YYYY-MM-DDTHH:MM:SS) to YYYY-MM-DD
    const start = startRaw && startRaw.length >= 10 ? startRaw.slice(0,10) : '';
    const end = finishRaw && finishRaw.length >= 10 ? finishRaw.slice(0,10) : '';

    const pct = Math.max(0, Math.min(100, parseFloat(pctRaw)||0));

    const scope = {
      label: label,
      start: start,
      end: end,
      cost: cost,
      unitsToDate: progressValue,
      totalUnits: totalUnits,
      unitsLabel: unitsLabel,
      actualPct: pct
    };
    newModel.scopes.push(scope);
  }

  model = newModel;
  document.getElementById('projectName').value = model.project.name || '';
  document.getElementById('projectStartup').value = model.project.startup || '';
  document.getElementById('startupLabelInput').value = model.project.markerLabel || 'Baseline Complete';
  syncScopeRowsToModel();
  computeAndRender();
  setCookie(COOKIE_KEY, JSON.stringify(model), 3650);
}

/*****************
 * Persistence and Controls
 *****************/
const COOKIE_KEY='progress_tracker_v3b';
function defaultAll(){
  delCookie(COOKIE_KEY);
  model = {
    project:{name:'', startup:'', markerLabel:'Baseline Complete'},
    scopes:[],
    history:[],
    dailyActuals:{},
    baseline:null,
    daysRelativeToPlan:null
  };
  $('#projectName').value = '';
  $('#projectStartup').value = '';
  $('#startupLabelInput').value = 'Baseline Complete';
  const scopeContainer = document.getElementById('scopeRows');
  if(scopeContainer){ scopeContainer.innerHTML = ''; }
  computeAndRender();
}

/*****************
 * Events
 *****************/
$('#projectName').addEventListener('input', computeAndRender);
$('#projectStartup').addEventListener('change', computeAndRender);
$('#startupLabelInput').addEventListener('input', computeAndRender);
$('#labelToggle').addEventListener('change', computeAndRender);

$('#snapshot').addEventListener('click', ()=>{ const chosen=document.getElementById('historyDate'); const d = (chosen && chosen.value)? chosen.value : fmtDate(today); const pct = calcTotalActualProgress(); const idx = model.history.findIndex(h=>h.date===d); if(idx>=0) model.history[idx].actualPct = pct; else model.history.push({date:d, actualPct:pct}); model.dailyActuals[d] = pct; computeAndRender(); setCookie(COOKIE_KEY, JSON.stringify(model), 3650); });

// Toolbar Save/Load/Clear with confirmations
$('#toolbarClear').addEventListener('click', ()=>{ if(!confirm('Clear scope fields and history?')) return; const ps = calcEarliestStart(); model.scopes = model.scopes.map(s=> ({...s, start:'', end:'', cost:0, unitsToDate:0, totalUnits:'', actualPct:0 })); if(ps){ const psStr = fmtDate(ps); Object.keys(model.dailyActuals).forEach(k=>{ if(k>=psStr) delete model.dailyActuals[k]; }); model.history = model.history.filter(h=> h.date < psStr); } syncScopeRowsToModel(); computeAndRender(); setCookie(COOKIE_KEY, JSON.stringify(model), 3650); });


// Baseline button behavior
$('#baselineBtn').addEventListener('click', ()=>{
  const {days, plannedCum} = calcPlannedSeriesByDay();

  // Always ask before saving baseline
  if(!confirm('Are you sure you want to establish a new baseline for the project?')) return;

  takeBaseline(days, plannedCum);
  computeAndRender();
  // alert('Baseline captured.'); // (optional)
});

/*****************
 * Lightweight self-tests (console)
 *****************/
(function runSelfTests(){
  try{

    const plan = calcPlannedSeriesByDay();
    console.assert(Array.isArray(plan.days), 'plan.days should be an array');
    console.assert(plan.days.length>=1, 'plan.days should not be empty');
    const actual = calcActualSeriesByDay(plan.days);
    console.assert(Array.isArray(actual), 'actual should be an array');
    console.assert(typeof calcTotalActualProgress()==='number', 'total actual should be number');
  }catch(err){ console.error('Self-tests failed:', err); }
})();

/*****************
 * Init
 *****************/

computeAndRender();
computeAndRender();


// Ensure legend text renders after files are loaded without needing a toggle
document.querySelectorAll('input[type="file"]').forEach(el=>{
  el.addEventListener('change', ()=>{
    // Give parsing a tick, then recompute and render legend
    setTimeout(()=>{ try{ refreshLegendNow(); }catch(e){} }, 30);
  });
});

// === Embedded CSV loader for "Pipeline" preset (default) ===
function parseAndLoadFullCSV(text){
  const rows = parseCSV(text);
  let section = '';
  let localModel = { project:{name:'',startup:'', markerLabel:'Baseline Complete'}, scopes:[], history:[], dailyActuals:{}, baseline:null, daysRelativeToPlan:null };

  let scopeHeaders = [];
  let baselineRows = [];

  for (let r of rows){
    if(r.length===1 && r[0].startsWith('#SECTION:')){ section = r[0].slice('#SECTION:'.length).trim(); continue; }
    if(r.length===0 || (r.length===1 && r[0]==='')) continue;

    if(section==='PROJECT'){
      if(r[0]==='key') { continue; }
      if(r[0]==='name') localModel.project.name = r[1]||'';
      if(r[0]==='startup') localModel.project.startup = r[1]||'';
      if(r[0]==='markerLabel') localModel.project.markerLabel = r[1]||'Baseline Complete';
    } else if(section==='SCOPES'){
      if(!scopeHeaders.length){ scopeHeaders = r; continue; }
      const idx = (name)=> scopeHeaders.indexOf(name);
      const s = {
        label: r[idx('label')]||'',
        start: r[idx('start')]||'',
        end: r[idx('end')]||'',
        cost: parseFloat(r[idx('cost')]||'0')||0,
        unitsToDate: parseFloat(r[idx('progressValue')]||'0')||0,
        totalUnits: (r[idx('totalUnits')]===undefined||r[idx('totalUnits')]==='')? '' : (parseFloat(r[idx('totalUnits')])||0),
        unitsLabel: r[idx('unitsLabel')]||'%',
        actualPct: 0
      };
      s.actualPct = s.totalUnits? (s.unitsToDate && s.totalUnits? (s.unitsToDate/s.totalUnits*100) : 0) : (s.unitsToDate||0);
      localModel.scopes.push(s);
    } else if(section==='DAILY_ACTUALS'){
      if(r[0]==='date') continue;
      const d = r[0]; const a = r[1];
      if(d){ localModel.dailyActuals[d] = a===''? undefined : Math.max(0, Math.min(100, parseFloat(a)||0)); }
    } else if(section==='HISTORY'){
      if(r[0]==='date') continue;
      if(r[0]) localModel.history.push({date:r[0], actualPct: parseFloat(r[1]||'0')||0});
    } else if(section==='BASELINE'){
      if(r[0]==='date') continue;
      baselineRows.push({date:r[0], val: (r[1]===''? null : parseFloat(r[1]||'0'))});
    }
  }
  if(baselineRows.length){
    localModel.baseline = {
      days: baselineRows.map(r=>r.date),
      planned: baselineRows.map(r=> (r.val==null? null : Math.max(0, Math.min(100, r.val))))
    };
  }

  // Commit into global model + UI
  model = localModel;
  document.getElementById('projectName').value = model.project.name||'';
  document.getElementById('projectStartup').value = model.project.startup||'';
  document.getElementById('startupLabelInput').value = model.project.markerLabel || 'Baseline Complete';
  syncScopeRowsToModel();
  computeAndRender();
  setCookie(COOKIE_KEY, JSON.stringify(model), 3650);
}

document.addEventListener('DOMContentLoaded', function () {
  const btn     = document.getElementById('toolbarSave');
  const dd      = document.getElementById('saveDropdown');
  const btnCSV  = document.getElementById('saveCSV');
  const btnXML  = document.getElementById('saveXML');

  if (!btn || !dd || !btnCSV || !btnXML) return;

  function openDropdown() {
    const rect = btn.getBoundingClientRect();
    dd.style.left   = (rect.left + window.scrollX) + 'px';
    dd.style.top    = (rect.bottom + window.scrollY + 4) + 'px';
    dd.style.display = 'block';

    // trigger reflow so the animation plays
    void dd.offsetWidth;
    dd.classList.add('show');
  }

  function closeDropdown() {
    dd.classList.remove('show');
    setTimeout(() => {
      if (!dd.classList.contains('show')) {
        dd.style.display = 'none';
      }
    }, 200);
  }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (dd.style.display === 'block' && dd.classList.contains('show')) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  btnCSV.addEventListener('click', function (e) {
    e.stopPropagation();
    closeDropdown();

    // Use existing CSV save helper if present
    if (typeof saveAll === 'function') {
      saveAll();
    } else if (typeof saveCsv === 'function') {
      saveCsv();
    }
  });

  btnXML.addEventListener('click', function (e) {
    e.stopPropagation();
    closeDropdown();

    if (typeof saveXml === 'function') {
      saveXml();
    }
  });

  // Click outside closes dropdown
  document.addEventListener('click', function (e) {
    if (!dd.contains(e.target) && e.target !== btn) {
      closeDropdown();
    }
  }, true);
});



document.addEventListener('DOMContentLoaded', function () {
  const btn = document.getElementById('toolbarLoad');
  const dd = document.getElementById('loadDropdown');
  if (!btn || !dd) return;

  function closeDropdown() {
    dd.style.display = 'none';
  }

  function toggleDropdown() {
    if (dd.style.display === 'block') {
      dd.style.display = 'none';
    } else {
      dd.style.display = 'block';
    }
  }

  // Only toggle dropdown on Load Project click (no file dialog here)
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleDropdown();
  });

  // Handle dropdown actions
  dd.querySelectorAll('div[data-act]').forEach(function (item) {
    item.addEventListener('click', function (e) {
      const act = item.dataset.act;
      if (act === 'open') {
        // reuse existing file loader
        uploadCSVAndLoad();
      } else if (act === 'default') {
        if (btnReset) btnReset.click();
      } else if (act === 'pipeline') {
        if (btnPipe) btnPipe.click();
      } else if (act === 'mech') {
        if (btnMech) btnMech.click();
      } else if (act === 'ie') {
        if (btnIE) btnIE.click();
      }
      closeDropdown();
      e.stopPropagation();
    });
  });

  // Click outside closes dropdown
  document.addEventListener('click', function (e) {
    if (!dd.contains(e.target) && e.target !== btn) {
      closeDropdown();
    }
  });
});

function loadFromCsvText(text){
  try{
    const rows = parseCSV(text); let section = ''; model = { project:{name:'',startup:'', markerLabel:'Baseline Complete'}, scopes:[], history:[], dailyActuals:{}, baseline:null, daysRelativeToPlan:null };
    try{ computeAndRender(); }catch(e){}
            let scopeHeaders = []; let baselineRows = [];
            for(let r of rows){ if(r.length===1 && r[0].startsWith('#SECTION:')){ section = r[0].slice('#SECTION:'.length).trim(); continue; } if(r.length===0 || (r.length===1 && r[0]==='')) continue;
              if(section==='PROJECT'){ if(r[0]==='key') { continue; } if(r[0]==='name') model.project.name = r[1]||''; if(r[0]==='startup') model.project.startup = r[1]||''; if(r[0]==='markerLabel') model.project.markerLabel = r[1]||'Baseline Complete'; }
              else if(section==='SCOPES'){ if(!scopeHeaders.length){ scopeHeaders = r; continue; } const idx = (name)=> scopeHeaders.indexOf(name); const s = { label: r[idx('label')]||'', start: r[idx('start')]||'', end: r[idx('end')]||'', cost: parseFloat(r[idx('cost')]||'0')||0, unitsToDate: parseFloat(r[idx('progressValue')]||'0')||0, totalUnits: (r[idx('totalUnits')]===undefined||r[idx('totalUnits')]==='')? '' : (parseFloat(r[idx('totalUnits')])||0), unitsLabel: r[idx('unitsLabel')]||'%', actualPct: 0 }; s.actualPct = s.totalUnits? (s.unitsToDate && s.totalUnits? (s.unitsToDate/s.totalUnits*100) : 0) : (s.unitsToDate||0); model.scopes.push(s); }
              else if(section==='DAILY_ACTUALS'){ if(r[0]==='date') continue; const d = r[0]; const a = r[1]; if(d){ model.dailyActuals[d] = a===''? undefined : clamp(parseFloat(a)||0,0,100); } }
              else if(section==='HISTORY'){ if(r[0]==='date') continue; if(r[0]) model.history.push({date:r[0], actualPct: parseFloat(r[1]||'0')||0}); }
              else if(section==='BASELINE'){ if(r[0]==='date') continue; baselineRows.push({date:r[0], val: (r[1]===''? null : parseFloat(r[1]||'0'))}); }
            }
            if(baselineRows.length){ model.baseline = { days: baselineRows.map(r=>r.date), planned: baselineRows.map(r=> (r.val==null? null : clamp(r.val,0,100))) }; }
            $('#projectName').value = model.project.name||''; $('#projectStartup').value = model.project.startup||''; $('#startupLabelInput').value = model.project.markerLabel || 'Baseline Complete';
            syncScopeRowsToModel(); computeAndRender(); setCookie(COOKIE_KEY, JSON.stringify(model), 3650);
  }catch(err){
    alert('Failed to parse CSV: '+err.message);
  }
}

// override load project
document.querySelectorAll('#loadDropdown div').forEach(it=>{
  it.onclick = () => {
    const act = it.dataset.act;
    if(act === 'open'){
      // Use the same file uploader used by the toolbar
      // uploadCSVAndLoad();  // ❌ Disable this to stop double dialog
      return;
    }
    let file = '';
    if(act === 'default') file = 'Project_Files/default_progress_all.csv';
    if(act === 'pipeline') file = 'Project_Files/Pipeline_progress_all.csv';
    if(act === 'mech') file = 'Project_Files/Mech_Facility_progress_all.csv';
    if(act === 'ie') file = 'Project_Files/I&E_Facility_progress_all.csv';
    if(file){
      fetch(file)
        .then(r => r.text())
        .then(t => {
          loadFromCsvText(t);
        })
        .catch(err => {
          alert('Failed to load preset CSV: ' + err.message);
        });
    }
    closeDropdown();   // <-- closes after any preset is selected
  };
});

// default load
fetch('Project_Files/default_progress_all.csv')
  .then(r => r.text())
  .then(t => loadFromCsvText(t))
  .catch(err => {
    console.error('Failed to auto-load default CSV:', err);
  });
