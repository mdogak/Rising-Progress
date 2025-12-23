/*
© 2025 Rising Progress LLC. All rights reserved.
*/

import { initToolbarClear } from './clear.js';
import { getBaselineSeries, takeBaseline, renderDailyTable, initHistory } from './history.js';

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

// Session-only flag: once the user confirms the cost weighting warning,
// we stop showing the dialog until the page is reloaded.
window._costWeightingWarningAcknowledged = false;


const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
function getLocalToday() { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
const today = getLocalToday();

function getEffectiveToday(){
  const hd = document.getElementById('historyDate');
  if (hd && hd.value) {
    const d = parseDate(hd.value);
    if (d && !isNaN(d.getTime())) return d;
  }
  return today;
}

function parseDate(val){ return val ? new Date(val + 'T00:00:00') : null }
function fmtDate(d){ return d ? d.toISOString().slice(0,10) : '' }
function fmtLongDateStr(dStr){ const d=parseDate(dStr); return d? d.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}) : dStr }
function fmtLongToday(){ return new Date().toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}) }
function daysBetween(a,b){ const ms = (parseDate(fmtDate(b)) - parseDate(fmtDate(a))); return Math.floor(ms/86400000)+1; }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)) }



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
window.model = model;

function defaultScope(i){
  if(i===0){ const startDate = new Date(today); startDate.setDate(startDate.getDate()-1); const endDate = new Date(startDate); endDate.setDate(endDate.getDate()+7); const start = fmtDate(startDate); const end = fmtDate(endDate); return { label:`Scope #${i+1}`, start, end, cost:100, actualPct:0, unitsToDate:0, totalUnits:'', unitsLabel:'%', sectionName:'' }; }
  return { label:`Scope #${i+1}`, start:'', end:'', cost:0, actualPct:0, unitsToDate:0, totalUnits:'', unitsLabel:'%', sectionName:'' };
}

function ensureRows(n){ const cont = $('#scopeRows'); const cur = cont.children.length; for(let i=cur;i<n;i++) cont.appendChild(renderScopeRow(i)); }
function syncScopeRowsToModel(){
  const cont = $('#scopeRows');
  if(window.Sections && typeof window.Sections.render === 'function'){
    window.Sections.render(cont, model, renderScopeRow, { calcScopeWeightings, calcScopePlannedPctToDate, parseDate });
    if(typeof window.Sections.attachContainerHandlers === 'function'){
      window.Sections.attachContainerHandlers(cont, model, ()=>{
        syncScopeRowsToModel();
        computeAndRender();
        sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
      });
    }
    return;
  }
  cont.innerHTML = '';
  for(let i=0;i<model.scopes.length;i++) cont.appendChild(renderScopeRow(i));
}

function renderScopeRow(i){
  const row = document.createElement('div'); row.className = 'row'; row.dataset.index = i; const s = model.scopes[i] || defaultScope(i); if(!model.scopes[i]) model.scopes[i] = s;
  row.innerHTML = `
    <div class="scope-cell"><span class="drag-handle" title="Drag row" draggable="true">⋮⋮</span><input data-k="label" placeholder="Scope #${i+1}" value="${s.label}"></div>
    <input data-k="start" type="date" value="${s.start}">
    <input data-k="end" type="date" value="${s.end}">
    <input data-k="cost" type="number" step="0.01" min="0" value="${s.cost}">
    <input data-k="totalUnits" type="number" step="0.01" min="0" placeholder="Total Units" value="${s.totalUnits===0? '': s.totalUnits}">
    <div>
      <input data-k="progress" type="number" step="0.01" min="0" placeholder="% or Units to Date" value="${s.totalUnits? s.unitsToDate : s.actualPct}">
    </div>
    <input data-k="unitsLabel" list="unitsList" value="${s.unitsLabel || '%'}" placeholder="%">
    <div class="small" data-k="planned"></div>
    <div class="actions">
      <button class="iconbtn menu" title="Row actions" aria-haspopup="true" aria-expanded="false">☰</button>
      <div class="row-menu" hidden>
        <button type="button" class="row-menu-item" data-action="del">Remove this row</button>
        <button type="button" class="row-menu-item" data-action="add">Add row below</button>
        <button type="button" class="row-menu-item" data-action="addSection">Add section</button>
      </div>
    </div>
  `;
  row.addEventListener('change', onScopeChange);
  const unitsEl=row.querySelector('[data-k="unitsLabel"]');
  if(unitsEl){
    // Clear default % on focus so the datalist opens immediately on click.
    unitsEl.addEventListener('focus', () => {
      if (unitsEl.value === '%') unitsEl.value = '';
    });

    // Restore % only after all events settle (datalist click can fire blur before input lands).
    unitsEl.addEventListener('blur', () => {
      setTimeout(() => {
        if (!unitsEl.value.trim()) {
          unitsEl.value = '%';
          // Trigger change so model syncs if your logic depends on it.
          unitsEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 200);
    });
  }
  return row;
}


function onScopeChange(e){
  const realRow = e.currentTarget.classList.contains('row') ? e.currentTarget : e.currentTarget.closest('.row');
  if(!realRow) return;
  const i = Number(realRow.dataset.index);
  const s = model.scopes[i];

  // Only warn when the user edits the Cost ($)/weighting field in the main Scopes table.
  const isCostChange = e && e.target && e.target.matches && e.target.matches('[data-k="cost"]');
  if (isCostChange && !window._costWeightingWarningAcknowledged && hasHistoryActualsAboveThreshold()) {
    const proceed = window.confirm(
      "Caution: Changing the weighting during a project changes how the actuals and plan are calculated. This is not advised. Are you sure you want to proceed?"
    );
    if (!proceed) {
      // Revert the cost input back to the previous value stored in the model.
      const costInput = realRow.querySelector('[data-k="cost"]');
      if (costInput) {
        const prevCost = (s && typeof s.cost === 'number' && isFinite(s.cost)) ? s.cost : 0;
        costInput.value = prevCost || '';
      }
      return;
    }
    window._costWeightingWarningAcknowledged = true;
  }

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
  s.start = inputs.start;
  s.end = inputs.end;
  s.cost = isFinite(inputs.cost) ? inputs.cost : 0;
  const tu = inputs.totalUnitsRaw === '' ? '' : clamp(parseFloat(inputs.totalUnitsRaw)||0,0,1e12);
  s.totalUnits = tu;
  if(tu!=='' && tu>0){
    s.unitsLabel = (inputs.unitsLabel || 'Feet');
  } else {
    s.unitsLabel = (inputs.unitsLabel || '%');
  }
  if(tu!=='' && tu>0){
    s.unitsToDate = clamp(inputs.progressVal,0,1e12);
    s.actualPct = tu>0 ? (s.unitsToDate/tu*100) : 0;
  } else {
    s.unitsToDate = 0;
    s.actualPct = clamp(inputs.progressVal,0,100);
  }
  updatePlannedCell(realRow, s);
  computeAndRender();
  sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
  // SECOND PASS ensure post-load compute
  try {
    syncScopeRowsToModel();
    computeAndRender();
  } catch(e) {
    try { console.error(e); } catch(_) {}
  }
}

/*****************
 * Row +/- actions
 *****************/
/*****************
 * Row actions + Section remove
 *****************/
(function(){
  const scopeCont = $('#scopeRows');
  if(!scopeCont) return;

  // Close any open row menus when clicking elsewhere
  if(!window._rowMenuGlobalHandlerAttached){
    window._rowMenuGlobalHandlerAttached = true;
    document.addEventListener('click', (e)=>{
      const open = document.querySelector('.row-menu:not([hidden])');
      if(!open) return;
      const within = e.target.closest('.actions');
      if(within && within.contains(open)) return;
      open.hidden = true;
      const btn = open.parentElement ? open.parentElement.querySelector('button.menu') : null;
      if(btn) btn.setAttribute('aria-expanded','false');
    });
  }

  scopeCont.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;

    // Section header remove
    const header = e.target.closest('.section-row');
    if(header && btn.classList.contains('section-remove')){
      const startIndex = Number(header.dataset.startIndex);
      if(window.Sections && typeof window.Sections.removeSection === 'function'){
        window.Sections.removeSection(model, startIndex);
      }
      syncScopeRowsToModel();
      computeAndRender();
      sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
      return;
    }

    // Row actions menu toggle
    if(btn.classList.contains('menu')){
      const actions = btn.closest('.actions');
      const menu = actions ? actions.querySelector('.row-menu') : null;
      if(!menu) return;

      // Close other menus
      document.querySelectorAll('.row-menu:not([hidden])').forEach(m=>{
        if(m!==menu) m.hidden = true;
      });
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      menu.hidden = expanded ? true : false;
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      return;
    }

    // Row menu item actions
    const item = btn.classList.contains('row-menu-item') ? btn : null;
    if(item){
      const action = item.getAttribute('data-action') || '';
      const row = e.target.closest('.row');
      if(!row) return;
      const i = Number(row.dataset.index);

      // Close menu after click
      const menu = item.closest('.row-menu');
      if(menu) menu.hidden = true;
      const menuBtn = row.querySelector('button.menu');
      if(menuBtn) menuBtn.setAttribute('aria-expanded','false');

      if(action === 'del'){
        model.scopes.splice(i,1);
        syncScopeRowsToModel();
        computeAndRender();
        sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
        return;
      }

      if(action === 'add'){
        const newScope = defaultScope(i+1);
        // New row inherits section of row above (if any) so it remains in the same section.
        const inheritName = (model.scopes[i] && model.scopes[i].sectionName) ? model.scopes[i].sectionName : '';
        newScope.sectionName = inheritName;
        model.scopes.splice(i+1,0,newScope);
        model.scopes = model.scopes.map((s,idx)=> ({...s, label: (s.label && s.label.startsWith('Scope #')? `Scope #${idx+1}` : s.label)}));
        syncScopeRowsToModel();
        computeAndRender();
        sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
        return;
      }

      if(action === 'addSection'){
        if(window.Sections && typeof window.Sections.addSection === 'function'){
          window.Sections.addSection(model, i);
        }
        syncScopeRowsToModel();
        computeAndRender();
        sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
        return;
      }
    }
  });
})();
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
  const t = getEffectiveToday();
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
function updatePlannedCell(row, s){
  const plannedPct = calcScopePlannedPctToDate(s);
  const cell = row.querySelector('[data-k="planned"]');
  if (s.totalUnits !== '' && Number(s.totalUnits) > 0) {
    const plannedUnits = (plannedPct / 100) * Number(s.totalUnits);
    cell.textContent = plannedUnits.toFixed(1);
  } else {
    cell.textContent = plannedPct.toFixed(1) + '%';
  }

  const startEl = row.querySelector('[data-k="start"]');
  const endEl   = row.querySelector('[data-k="end"]');

  // Clear previous flags
  if (startEl) startEl.classList.remove('flag-start');
  if (endEl)   endEl.classList.remove('flag-end');
  if (cell)    cell.classList.remove('flag-planned');

  const actualPctForCompare = s.actualPct || 0;

  // Flag planned shortfall
  if (actualPctForCompare < plannedPct && cell) {
    cell.classList.add('flag-planned');
  }

  // Flag late start (past start date, still 0%)
  if (s.start && startEl) {
    if (parseDate(s.start) < getEffectiveToday() && (actualPctForCompare === 0)) {
      startEl.classList.add('flag-start');
    }
  }

  // Flag late finish (past end date, still <100%)
  if (s.end && endEl) {
    if (parseDate(s.end) < getEffectiveToday() && (Math.round(actualPctForCompare) < 100)) {
      endEl.classList.add('flag-end');
    }
  }

  if (typeof updateIssuesButtonState === 'function') {
    updateIssuesButtonState();
  }
}
function calcScopeWeightings(){ const total = model.scopes.reduce((a,b)=>a+(b.cost||0),0) || 0; return model.scopes.map(s=> total>0 ? (s.cost/total) : 0); }

function hasAnyScopeIssues(){
  const rows = $$('#scopeRows .row');
  return rows.some(row => {
    const startEl = row.querySelector('[data-k="start"]');
    const endEl   = row.querySelector('[data-k="end"]');
    const planned = row.querySelector('[data-k="planned"]');
    return (startEl && startEl.classList.contains('flag-start')) ||
           (endEl && endEl.classList.contains('flag-end')) ||
           (planned && planned.classList.contains('flag-planned'));
  });
}

function updateIssuesButtonState(){
  if (typeof syncActualFromDOM === 'function') {
    syncActualFromDOM();
  }
  const btn = document.getElementById('toolbarIssues');
  if (!btn) return;
  const hasFlags = hasAnyScopeIssues();
  if (hasFlags) {
    btn.classList.add('issues-has-flags');
  } else {
    btn.classList.remove('issues-has-flags');
  }
}

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

function calcForecastSeriesByDay(days, planned, actual){
  const n = days.length || 0;
  if (!n || !Array.isArray(planned) || !Array.isArray(actual)) return { forecast: [], extraDays: 0 };
  const forecast = new Array(n).fill(null);
  let extraDays = 0;


  // Find last actual point (most recent non-null)
  let aIdx = -1;
  for (let i = actual.length - 1; i >= 0; i--) {
    if (actual[i] != null) {
      aIdx = i;
      break;
    }
  }
  if (aIdx < 0) return { forecast, extraDays: 0 };

  const aPct = actual[aIdx];
  if (aPct == null || isNaN(aPct)) return { forecast, extraDays: 0 };

  // If we have no planned values at all, just hold flat from the last actual
  const hasPlanned = planned.some(v => v != null);
  if (!hasPlanned) {
    for (let i = aIdx; i < n; i++) {
      forecast[i] = aPct;
    }
    return { forecast, extraDays: 0 };
  }

  const lastPlanIdx = planned.length - 1;

  // Find the segment on the plan where aPct would land and compute a fractional index pStar
  let j = -1;
  for (let i = 0; i < planned.length; i++) {
    const v = planned[i];
    if (v != null && v >= aPct) {
      j = i;
      break;
    }
  }

  let pStar;
  if (j <= 0) {
    // aPct is at/below the first defined plan point, or we never found a v>=aPct but have plan values
    // If j < 0, treat it as being at the last defined point (actual beyond plan end).
    const idx = (j < 0 ? lastPlanIdx : 0);
    pStar = idx;
  } else {
    const p0 = planned[j - 1] ?? 0;
    const p1 = planned[j] ?? p0;
    let t = 0;
    if (Math.abs(p1 - p0) > 1e-9) {
      t = (aPct - p0) / (p1 - p0);
      if (!isFinite(t)) t = 0;
      t = Math.max(0, Math.min(1, t));
    }
    pStar = (j - 1) + t;
  }

  // If even the max plan value is below aPct, just hold flat from last actual
  if (j < 0 && (Math.max(...planned.filter(v => v != null)) || 0) < aPct) {
    for (let i = aIdx; i < n; i++) {
      forecast[i] = aPct;
    }
    return { forecast, extraDays: 0 };
  }

  const daysRel = pStar - aIdx; // >0 => plan point is to the RIGHT (later) of actual; <0 => plan is LEFT (earlier)
  const startSrcIdx = Math.max(0, Math.min(lastPlanIdx, Math.floor(pStar)));

  // Helper to sample the remaining plan curve (preserve shape)
  function samplePlanSegment(tNorm) {
    // tNorm in [0,1] over [startSrcIdx .. lastPlanIdx]
    const len = lastPlanIdx - startSrcIdx + 1;
    if (len <= 1) {
      const v = planned[startSrcIdx];
      return v == null ? aPct : v;
    }
    const pos = startSrcIdx + tNorm * (len - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(lastPlanIdx, i0 + 1);
    const frac = pos - i0;

    const v0 = planned[i0];
    const v1 = planned[i1];

    if (v0 == null && v1 == null) return aPct;
    if (v0 == null) return v1;
    if (v1 == null) return v0;
    return v0 + (v1 - v0) * frac;
  }

  if (daysRel <= 0) {
    // CASE 1: Plan point is to the LEFT or same day (plan date <= actual date):
    // Copy the FUTURE of the plan curve 1:1 but SHIFT it so it starts at the last actual date.
    // This uses the plan from startSrcIdx onward, but aligned so that startSrcIdx maps to aIdx.
    let dst = aIdx;
    for (let src = startSrcIdx; src <= lastPlanIdx; src++, dst++) {
      let v = planned[src];
      if (v == null) v = aPct;
      forecast[dst] = v;
    }
  } else {
    // CASE 2: Plan point is to the RIGHT (plan date > actual date, so we're ahead of plan):
    // Stretch the remaining plan curve [startSrcIdx..lastPlanIdx] to fit into
    // [aIdx..lastPlanIdx], so we NEVER forecast finishing earlier than the plan.
    const startForecastIdx = aIdx;
    const endForecastIdx = lastPlanIdx;
    const forecastLen = endForecastIdx - startForecastIdx + 1;

    if (forecastLen <= 0) {
      forecast[aIdx] = aPct;
      return { forecast, extraDays: Math.max(0, forecast.length - n) };
    }

    for (let k = 0; k < forecastLen; k++) {
      const tNorm = (forecastLen === 1) ? 0 : (k / (forecastLen - 1));
      const v = samplePlanSegment(tNorm);
      forecast[startForecastIdx + k] = v;
    }
  }

  // Ensure the forecast starts exactly at the last actual percentage on that date
  forecast[aIdx] = aPct;

  // Clamp and clean
  const cleaned = forecast.map(v => v == null ? null : clamp(Number(v) || 0, 0, 100));
  const extra = Math.max(0, cleaned.length - n);
  return { forecast: cleaned, extraDays: extra };
}


function computeDaysRelativeToPlan(days, planned, actual){ if(!days.length) return null; let aIdx = -1; let aPct = 0; for(let i=actual.length-1;i>=0;i--){ if(actual[i]!=null){ aIdx=i; aPct=actual[i]; break; } } if(aIdx<0) return null; let j = planned.findIndex(v => v!=null && v >= aPct); if(j <= 0){ const pStar = j < 0 ? planned.length - 1 : 0; const daysRelEdge = pStar - aIdx; return { actualDate: days[aIdx], actualPct: aPct, plannedDateForActualPct: days[Math.max(0, Math.min(days.length-1, Math.round(pStar)))], daysRelative: daysRelEdge }; }
  const p0 = planned[j-1] ?? 0; const p1 = planned[j] ?? p0; let t = 0; if(Math.abs(p1 - p0) > 1e-9){ t = (aPct - p0) / (p1 - p0); } const pStar = (j-1) + t; const daysRel = pStar - aIdx; return { actualDate: days[aIdx], actualPct: aPct, plannedDateForActualPct: days[Math.max(0, Math.min(days.length-1, Math.round(pStar)))], daysRelative: daysRel }; }

/*****************
 * Baseline helpers
 *****************/
// (baseline-specific helpers are implemented in history.js via getBaselineSeries/takeBaseline)

/*****************
 * Rendering & Chart
 *****************/
let chart;
let baselineVisible = true;
let legendStats = {baselinePct:null, plannedPct:null, actualPct:null, daysRelText:''};
let plannedVisible = true;
let actualVisible = true;
let forecastVisible = true;

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

function syncActualFromDOM(){
  const rows = document.querySelectorAll('#scopeRows .row');
  rows.forEach(row=>{
    const idx = Number(row.dataset.index);
    const scope = model.scopes[idx];
    if(!scope) return;

    const progressEl = row.querySelector('[data-k="progress"]');
    const totalUnitsEl = row.querySelector('[data-k="totalUnits"]');
    const unitsLabelEl = row.querySelector('[data-k="unitsLabel"]');

    let progressVal = parseFloat(progressEl?.value || '0') || 0;
    let totalUnits = parseFloat(totalUnitsEl?.value || '0') || 0;
    let unitsLabel = unitsLabelEl?.value || '%';

    if(totalUnits > 0){
      scope.unitsToDate = progressVal;
      scope.actualPct = (progressVal / totalUnits) * 100;
      scope.unitsLabel = unitsLabel;
    } else {
      scope.actualPct = progressVal;
      scope.unitsToDate = 0;
      scope.unitsLabel = unitsLabel;
    }
  });

  if (typeof window !== 'undefined') {
    window.syncActualFromDOM = syncActualFromDOM;
  }
}

let lastTotalActualForHistory = null;
function updateHistoryDate(totalActual){
  const hd = document.getElementById('historyDate');
  if (!hd) return;

  // Manual override for this session wins completely
  if (hd.dataset.manual === 'true') {
    if (typeof totalActual === 'number') {
      lastTotalActualForHistory = totalActual;
    }
    return;
  }

  // Prefer the latest history date whenever history exists
  const modelRef = (typeof window !== 'undefined' && window.model) ? window.model : model;
  const hist = Array.isArray(modelRef && modelRef.history) ? modelRef.history : [];

  let lastDate = null;
  for (const h of hist) {
    if (h && h.date) {
      if (!lastDate || h.date > lastDate) {
        lastDate = h.date;
      }
    }
  }

  if (lastDate) {
    // Always let history drive the default when available
    if (hd.value !== lastDate) {
      hd.value = lastDate;
    }
    if (typeof totalActual === 'number') {
      lastTotalActualForHistory = totalActual;
    }
    return;
  }

  // No history yet: fall back to "today" behavior based on changes in totalActual
  const prev = (typeof lastTotalActualForHistory === 'number') ? lastTotalActualForHistory : null;
  const curr = (typeof totalActual === 'number') ? totalActual : prev;

  let changed = false;
  if (prev !== null && curr !== null && typeof curr === 'number') {
    changed = Math.abs(curr - prev) > 1e-6;
  }

  if (!hd.value && changed) {
    // Brand new project with no history and first actual entry
    try {
      if (typeof fmtDate === 'function' && typeof today !== 'undefined') {
        hd.value = fmtDate(today);
      }
    } catch (e) { /* noop */ }
  } else if (hd.value && changed) {
    // Existing date (from a prior no-history session) and totalActual changed
    try {
      if (typeof fmtDate === 'function' && typeof today !== 'undefined') {
        hd.value = fmtDate(today);
      }
    } catch (e) { /* noop */ }
  }

  if (curr !== null && typeof curr === 'number') {
    lastTotalActualForHistory = curr;
  }
}

function computeAndRender(){
  // Moved baseline/planned percentages into the legend; leave this area empty.
  model.project.name = $('#projectName').value.trim();
  model.project.startup = $('#projectStartup').value;
  model.project.markerLabel = ($('#startupLabelInput').value || 'Baseline Complete').trim();
  $$('#scopeRows .row').forEach((row)=>{ const i = Number(row.dataset.index); updatePlannedCell(row, model.scopes[i]);
    const s = model.scopes[i];
    if (s && s.actualPct >= 100) {
        row.classList.add('scope-complete');
    } else {
        row.classList.remove('scope-complete');
    }
 });
  const totalActual = calcTotalActualProgress(); $('#totalActual').textContent = totalActual.toFixed(1)+'%'; updateHistoryDate(totalActual);
  const plan = calcPlannedSeriesByDay(); const days = plan.days || []; const plannedCum = plan.plannedCum || plan.planned || []; const actualCum = calcActualSeriesByDay(days); const baselineCum = getBaselineSeries(days, plannedCum);
  renderDailyTable(days, baselineCum, plannedCum, actualCum, { computeAndRender });
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
  sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
}


function renderLegend(chart){
  const cont = $('#customLegend');
  if(!cont) return;
  cont.innerHTML = '';

  const mk = (id, text, cls, checked, onChange, subText) => {
    const wrap = document.createElement('div');
    wrap.className = 'legend-item ' + cls;

    const row = document.createElement('div');
    row.className = 'legend-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = !!checked;
    cb.addEventListener('change', onChange);

    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.textContent = text;

    row.appendChild(cb);
    row.appendChild(lbl);
    wrap.appendChild(row);

    if(subText){
      const sub = document.createElement('div');
      let subCls = 'legend-sub ';
      if(cls.indexOf('baseline') >= 0) subCls += 'baseline';
      else if(cls.indexOf('planned') >= 0) subCls += 'planned';
      else if(cls.indexOf('forecast') >= 0) subCls += 'forecast legend-daysrel';
      else subCls += 'actual';
      sub.className = subCls;
      sub.textContent = subText;
      wrap.appendChild(sub);
    }

    cont.appendChild(wrap);
  };

  const baselinePctText = legendStats.baselinePct!=null ? (legendStats.baselinePct + '%') : null;
  const plannedPctText  = legendStats.plannedPct!=null  ? (legendStats.plannedPct + '%')  : null;
  const actualPctText   = legendStats.actualPct!=null   ? (legendStats.actualPct + '%')   : null;
  const daysRelText     = legendStats.daysRelText || '';

  // Baseline
  mk('legendBaselineCheckbox', 'Original Plan', 'legend-baseline', baselineVisible, (e)=>{
    baselineVisible = e.target.checked;
    const meta = chart.getDatasetMeta(0);
    meta.hidden = !baselineVisible;
    computeAndRender();
    if(window.sessionStorage) sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
  }, baselinePctText);

  // Planned
  mk('legendPlannedCheckbox', 'Current Plan', 'legend-planned', plannedVisible, (e)=>{
    plannedVisible = e.target.checked;
    const meta = chart.getDatasetMeta(1);
    meta.hidden = !plannedVisible;
    computeAndRender();
    if(window.sessionStorage) sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
  }, plannedPctText);

  // Actual
  mk('legendActualCheckbox', 'Actual Progress', 'legend-actual', actualVisible, (e)=>{
    actualVisible = e.target.checked;
    const meta = chart.getDatasetMeta(2);
    meta.hidden = !actualVisible;
    computeAndRender();
    if(window.sessionStorage) sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
  }, actualPctText);

  // Forecast
  mk('legendForecastCheckbox', 'Forecast Plan', 'legend-forecast', forecastVisible, (e)=>{
    forecastVisible = e.target.checked;
    const meta = chart.getDatasetMeta(3);
    meta.hidden = !forecastVisible;
    computeAndRender();
    if(window.sessionStorage) sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
  }, daysRelText || null);
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
  let labels = (days && days.length) ? days.map(d => d) : [fmtDate(today)];
  let dataBaseline = (baseline && baseline.length) ? baseline : [0];
  let dataPlanned = (planned && planned.length) ? planned : [0];
  let dataActual = (actual && actual.length) ? actual : [0];
  let dataForecast = [];
  let extraDays = 0;

  if (planned && planned.length && actual && actual.length) {
    const forecastResult = calcForecastSeriesByDay(labels, dataPlanned, dataActual);
    if (forecastResult && Array.isArray(forecastResult.forecast)) {
      dataForecast = forecastResult.forecast;
      extraDays = Number(forecastResult.extraDays) || 0;
    } else {
      dataForecast = (labels || []).map(() => null);
      extraDays = 0;
    }
  } else {
    dataForecast = (labels || []).map(() => null);
    extraDays = 0;
  }

  // If the forecast extends beyond the original plan horizon,
  // append additional future dates to the labels array.
  if (extraDays > 0) {
    const lastLabelStr = labels[labels.length - 1];
    let lastDate = null;
    if (typeof parseDate === 'function') {
      lastDate = parseDate(lastLabelStr);
    }
    if (!(lastDate instanceof Date) || isNaN(lastDate.getTime())) {
      lastDate = new Date(lastLabelStr);
    }
    if (lastDate instanceof Date && !isNaN(lastDate.getTime())) {
      for (let i = 1; i <= extraDays; i++) {
        const d = new Date(lastDate);
        d.setDate(d.getDate() + i);
        if (typeof fmtDate === 'function') {
          labels.push(fmtDate(d));
        } else {
          labels.push(d.toISOString().slice(0, 10));
        }
      }
    }
  }

  // Pad non-forecast datasets so they align with the extended label range.
  if (labels.length > dataPlanned.length) {
    while (dataPlanned.length < labels.length) dataPlanned.push(null);
  }
  if (labels.length > dataBaseline.length) {
    while (dataBaseline.length < labels.length) dataBaseline.push(null);
  }
  if (labels.length > dataActual.length) {
    while (dataActual.length < labels.length) dataActual.push(null);
  }

  // Ensure the forecast array also matches the label length.
  if (dataForecast.length < labels.length) {
    while (dataForecast.length < labels.length) dataForecast.push(null);
  } else if (dataForecast.length > labels.length) {
    dataForecast = dataForecast.slice(0, labels.length);
  }

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
  color: 'rgba(37,99,235,1)',
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
      {label:'Baseline', order:100, hidden:(!baselineVisible), data:dataBaseline, borderColor:'rgba(107,114,128,1)', backgroundColor:'rgba(107,114,128,.10)', tension:.15, borderWidth:2, pointRadius:0},
      {label:'Planned', order:0, hidden:(!plannedVisible), data:dataPlanned, borderColor:'rgba(37,99,235,1)', backgroundColor:'rgba(37,99,235,.12)', tension:.15, borderWidth:2, pointRadius:0},
      {label:'Actual', order:-100, hidden:(!actualVisible), data:dataActual, spanGaps:false, borderColor:'rgba(234,88,12,1)', backgroundColor:'rgba(234,88,12,.12)', tension:.15, borderWidth:2, pointRadius:0}
    ,
      {label:'Forecast Plan', order:-50, hidden:(!forecastVisible), data:dataForecast, borderColor:'rgba(22,163,74,0.8)', backgroundColor:'rgba(22,163,74,0.08)', borderDash:[6,4], tension:.15, borderWidth:2, pointRadius:0, spanGaps:false}
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, title:{display:true, text:titleText, color:'#0f172a', font:{size:25, weight:'bold'}}, annotation: { annotations: (function(){
          // Add orange end label annotation for latest Actual value
          const ann = Object.assign({ yLabelAt50: yAxisLabelAnnotation }, startupAnnotations);
          let lastIdx = -1; for(let i=dataActual.length-1;i>=0;i--){ if(dataActual[i]!=null){ lastIdx = i; break; } }
          if(lastIdx>=0 && actualVisible){ ann.actualEndLabel = { type:'label', xValue: labels[lastIdx], yValue: dataActual[lastIdx], content:[(Number(dataActual[lastIdx]).toFixed(1)+'%')], backgroundColor:'rgba(0,0,0,0)', color:'rgba(234,88,12,1)', font:{weight:'bold', size:16}, xAdjust: 12, yAdjust: 10 } }
          return ann; })() } },
      scales: {
          x: {
              min: labels[0],
              max: labels[labels.length - 1],
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
  const proj = model.project || {};
  let xml = '';
  xml += '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<Project xmlns="http://schemas.microsoft.com/project">\n';

  // Project name
  xml += '  <Name>' + escapeXml(proj.name || '') + '</Name>\n';

  // Project-level ExtendedAttributes (Microsoft Project schema)
  xml += '  <ExtendedAttributes>\n';

  function addProjAttr(fieldID, name, value) {
    xml += '    <ExtendedAttribute>\n';
    xml += '      <FieldID>' + fieldID + '</FieldID>\n';
    xml += '      <Name>' + name + '</Name>\n';
    xml += '      <Value><![CDATA[' + (value || '') + ']]></Value>\n';
    xml += '    </ExtendedAttribute>\n';
  }

  // Core project fields
  addProjAttr('Text1', 'Startup', proj.startup || '');
  addProjAttr('Text2', 'MarkerLabel', proj.markerLabel || 'Baseline Complete');

  // Legend / label flags - always use current UI checkbox state when available
  const labelToggleEl = document.getElementById('labelToggle');
  const baselineCb = document.getElementById('legendBaselineCheckbox');
  const plannedCb = document.getElementById('legendPlannedCheckbox');
  const actualCb = document.getElementById('legendActualCheckbox');
  const forecastCb = document.getElementById('legendForecastCheckbox');

  const labelToggleFlag = !!(labelToggleEl && typeof labelToggleEl.checked === 'boolean' ? labelToggleEl.checked : (proj.labelToggle || false));
  const legendBaselineFlag = !!(baselineCb && typeof baselineCb.checked === 'boolean' ? baselineCb.checked : (typeof proj.legendBaselineCheckbox !== 'undefined' ? proj.legendBaselineCheckbox : true));
  const legendPlannedFlag = !!(plannedCb && typeof plannedCb.checked === 'boolean' ? plannedCb.checked : (typeof proj.legendPlannedCheckbox !== 'undefined' ? proj.legendPlannedCheckbox : true));
  const legendActualFlag = !!(actualCb && typeof actualCb.checked === 'boolean' ? actualCb.checked : (typeof proj.legendActualCheckbox !== 'undefined' ? proj.legendActualCheckbox : true));
  const legendForecastFlag = !!(forecastCb && typeof forecastCb.checked === 'boolean' ? forecastCb.checked : (typeof proj.legendForecastCheckbox !== 'undefined' ? proj.legendForecastCheckbox : true));

  addProjAttr('Text3', 'LabelToggle', labelToggleFlag ? 'true' : 'false');
  addProjAttr('Text4', 'LegendBaselineCheckbox', legendBaselineFlag ? 'true' : 'false');
  addProjAttr('Text5', 'LegendPlannedCheckbox', legendPlannedFlag ? 'true' : 'false');
  addProjAttr('Text6', 'LegendActualCheckbox', legendActualFlag ? 'true' : 'false');
  addProjAttr('Text7', 'LegendForecastCheckbox', legendForecastFlag ? 'true' : 'false');

  // Baseline snapshot as CSV (date,baselinePct)
  let baselineCSV = '';
  if (model.baseline && Array.isArray(model.baseline.days) && Array.isArray(model.baseline.planned)) {
    for (let i = 0; i < model.baseline.days.length; i++) {
      const d = model.baseline.days[i];
      const v = model.baseline.planned[i];
      if (!d) continue;
      baselineCSV += d + ',' + (v == null ? '' : v) + '\n';
    }
  }
  addProjAttr('Text8', 'BaselineHistory', baselineCSV);

  // History as CSV (date,actualPct)
  let actualCSV = '';
  if (Array.isArray(model.history)) {
    model.history.forEach(h => {
      if (!h || !h.date) return;
      const v = (h.actualPct != null ? h.actualPct : 0);
      actualCSV += h.date + ',' + v + '\n';
    });
  }
  addProjAttr('Text9', 'ActualHistory', actualCSV);

  // DailyActuals as CSV (date,value)
  let dailyCSV = '';
  if (model.dailyActuals && typeof model.dailyActuals === 'object') {
    Object.keys(model.dailyActuals).sort().forEach(d => {
      const v = model.dailyActuals[d];
      if (!d) return;
      dailyCSV += d + ',' + (v == null ? '' : v) + '\n';
    });
  }
  addProjAttr('Text10', 'DailyActuals', dailyCSV);

  xml += '  </ExtendedAttributes>\n';

  // Tasks: one per scope
  xml += '  <Tasks>\n';

  function addTaskAttr(fieldID, name, value) {
    xml += '        <ExtendedAttribute>\n';
    xml += '          <FieldID>' + fieldID + '</FieldID>\n';
    xml += '          <Name>' + name + '</Name>\n';
    xml += '          <Value><![CDATA[' + (value || '') + ']]></Value>\n';
    xml += '        </ExtendedAttribute>\n';
  }

  (model.scopes || []).forEach((s, idx) => {
    const label = s.label || ('Scope #' + (idx + 1));
    const start = s.start || '';
    const end = s.end || '';
    const pct = clamp(isFinite(s.actualPct) ? Number(s.actualPct) || 0 : 0, 0, 100);
    const cost = isFinite(s.cost) ? s.cost : 0;

    xml += '    <Task>\n';
    xml += '      <UID>' + (idx + 1) + '</UID>\n';
    xml += '      <ID>' + (idx + 1) + '</ID>\n';
    xml += '      <Name>' + escapeXml(label) + '</Name>\n';

    if (start) {
      xml += '      <Start>' + start + 'T08:00:00</Start>\n';
    }
    if (end) {
      xml += '      <Finish>' + end + 'T17:00:00</Finish>\n';
    }

    xml += '      <PercentComplete>' + pct + '</PercentComplete>\n';
    xml += '      <Cost>' + cost + '</Cost>\n';

    // Task-level ExtendedAttributes for remaining PRGS scope fields
    xml += '      <ExtendedAttributes>\n';
    const unitsToDate = (s.unitsToDate != null ? String(s.unitsToDate) : '');
    const totalUnits = (s.totalUnits != null ? String(s.totalUnits) : '');
    const unitsLabel = s.unitsLabel || '';

    addTaskAttr('Text11', 'UnitsToDate', unitsToDate);
    addTaskAttr('Text12', 'TotalUnits', totalUnits);
    addTaskAttr('Text13', 'UnitsLabel', unitsLabel);
    // Section grouping
    addTaskAttr('Text14', 'SectionName', (s.sectionName || ''));
    xml += '      </ExtendedAttributes>\n';

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

function buildAllCSV(){
  const {days, plannedCum} = calcPlannedSeriesByDay();
  const actualCum = calcActualSeriesByDay(days);
  const baselineCum = getBaselineSeries(days, plannedCum);
  let out = '';

  // PROJECT section
  out += '#SECTION:PROJECT\n';
  out += 'key,value\n';

  const proj = model.project || {};
  const labelToggleEl = document.getElementById('labelToggle');
  const baselineCb = document.getElementById('legendBaselineCheckbox');
  const plannedCb = document.getElementById('legendPlannedCheckbox');
  const actualCb = document.getElementById('legendActualCheckbox');
  const forecastCb = document.getElementById('legendForecastCheckbox');

  const labelToggleVal = (labelToggleEl && typeof labelToggleEl.checked === 'boolean')
    ? !!labelToggleEl.checked
    : !!proj.labelToggle;

  const legendBaselineVal = (baselineCb && typeof baselineCb.checked === 'boolean')
    ? !!baselineCb.checked
    : (typeof proj.legendBaselineCheckbox !== 'undefined' ? !!proj.legendBaselineCheckbox : true);

  const legendPlannedVal = (plannedCb && typeof plannedCb.checked === 'boolean')
    ? !!plannedCb.checked
    : (typeof proj.legendPlannedCheckbox !== 'undefined' ? !!proj.legendPlannedCheckbox : true);

  const legendActualVal = (actualCb && typeof actualCb.checked === 'boolean')
    ? !!actualCb.checked
    : (typeof proj.legendActualCheckbox !== 'undefined' ? !!proj.legendActualCheckbox : true);

  const legendForecastVal = (forecastCb && typeof forecastCb.checked === 'boolean')
    ? !!forecastCb.checked
    : (typeof proj.legendForecastCheckbox !== 'undefined' ? !!proj.legendForecastCheckbox : true);

  out += csvLine(['name', model.project.name || '']);
  out += csvLine(['startup', model.project.startup || '']);
  out += csvLine(['markerLabel', model.project.markerLabel || 'Baseline Complete']);
  out += csvLine(['labelToggle', labelToggleVal ? 'true' : 'false']);
  out += csvLine(['legendBaselineCheckbox', legendBaselineVal ? 'true' : 'false']);
  out += csvLine(['legendPlannedCheckbox', legendPlannedVal ? 'true' : 'false']);
  out += csvLine(['legendActualCheckbox', legendActualVal ? 'true' : 'false']);
  out += csvLine(['legendForecastCheckbox', legendForecastVal ? 'true' : 'false']);
  out += '\n';

  // SCOPES section
  out += '#SECTION:SCOPES\n';
  out += 'label,start,end,cost,progressValue,totalUnits,unitsLabel,sectionName\n';
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
      unitsLabel,
      (s.sectionName || '')
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
    if(!window._autoSaving && window.showSaveFilePicker){
      const handle = await window.showSaveFilePicker({ suggestedName: (model.project.name? model.project.name.replace(/\s+/g,'_')+'_': '') + 'progress_all.prgs', types:[{ description:'CSV', accept:{ 'text/plain':['.prgs'] } }] });
      const writable = await handle.createWritable(); await writable.write(new Blob([csv], {type:'text/plain'})); await writable.close();
      sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model)); 
    } else {
      // Fallback download
      const blob = new Blob([csv], {type:'text/plain'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = (model.project.name? model.project.name.replace(/\s+/g,'_')+'_': '') + 'progress_all.prgs'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model)); 
    }
  }catch(e){ alert('Save failed: ' + e.message); }
}

function parseCSV(text){ const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n'); const rows=[]; let cur=[]; let inQuote=false; let field=''; function pushField(){ cur.push(field); field=''; } function pushRow(){ rows.push(cur); cur=[]; }
  for(const line of lines){ let i=0; inQuote=false; field=''; cur=[]; while(i<line.length){ const ch = line[i]; if(inQuote){ if(ch==='"' && line[i+1]==='"'){ field+='"'; i+=2; continue; } if(ch==='"'){ inQuote=false; i++; continue; } field+=ch; i++; continue; } else { if(ch==='"'){ inQuote=true; i++; continue; } if(ch===','){ pushField(); i++; continue; } field+=ch; i++; continue; } } pushField(); pushRow(); }
  return rows; }

function uploadCSVAndLoad(){
  // Clear saved data when opening a file
  if (window.sessionStorage) window.sessionStorage.removeItem(COOKIE_KEY);
  model = { project:{name:'', startup:'', markerLabel:'Baseline Complete'}, scopes:[], history:[], dailyActuals:{}, baseline:null, daysRelativeToPlan:null };
  window.model = model; const inp = document.createElement('input'); inp.type='file'; inp.accept='.csv,text/csv,application/xml,.xml,.prgs,application/octet-stream'; inp.onchange = () => { const file = inp.files[0]; if(!file) return; const reader = new FileReader(); reader.onload = (e)=>{ try{ const text = e.target.result;
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
        if(/^Date,Planned_Cumulative,Actual_Cumulative/m.test(text)){ const lines = text.trim().split(/\r?\n/); lines.shift(); model.dailyActuals = {}; for(const line of lines){ const parts = line.split(','); const d = parts[0]; const a = parts[2]; if(d && a!=='' && !isNaN(parseFloat(a))) model.dailyActuals[d] = clamp(parseFloat(a),0,100); } computeAndRender(); sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));  return; }
        const rows = parseCSV(text); let section = ''; model = { project:{name:'',startup:'', markerLabel:'Baseline Complete'}, scopes:[], history:[], dailyActuals:{}, baseline:null, daysRelativeToPlan:null }; window.model = model; window.model = model;
        let scopeHeaders = []; let baselineRows = [];
        for(let r of rows){ if(r.length===1 && r[0].startsWith('#SECTION:')){ section = r[0].slice('#SECTION:'.length).trim(); continue; } if(r.length===0 || (r.length===1 && r[0]==='')) continue;
          if(section==='PROJECT'){ if(r[0]==='key') { continue; } if(r[0]==='name') model.project.name = r[1]||''; if(r[0]==='startup') model.project.startup = r[1]||''; if(r[0]==='markerLabel') model.project.markerLabel = r[1]||'Baseline Complete';
            if(r[0]==='labelToggle') model.project.labelToggle = (r[1]==='true');
            if(r[0]==='legendBaselineCheckbox') model.project.legendBaselineCheckbox = (r[1]==='true');
            if(r[0]==='legendPlannedCheckbox') model.project.legendPlannedCheckbox = (r[1]==='true');
            if(r[0]==='legendActualCheckbox') model.project.legendActualCheckbox = (r[1]==='true');
            if(r[0]==='legendForecastCheckbox') model.project.legendForecastCheckbox = (r[1]==='true');
 }
          else if(section==='SCOPES'){ if(!scopeHeaders.length){ scopeHeaders = r; continue; } const idx = (name)=> scopeHeaders.indexOf(name); const s = { label: r[idx('label')]||'', start: r[idx('start')]||'', end: r[idx('end')]||'', cost: parseFloat(r[idx('cost')]||'0')||0, unitsToDate: parseFloat(r[idx('progressValue')]||'0')||0, totalUnits: (r[idx('totalUnits')]===undefined||r[idx('totalUnits')]==='')? '' : (parseFloat(r[idx('totalUnits')])||0), unitsLabel: r[idx('unitsLabel')]||'%', sectionName: (idx('sectionName')>=0 ? (r[idx('sectionName')]||'') : ''), actualPct: 0 }; s.actualPct = s.totalUnits? (s.unitsToDate && s.totalUnits? (s.unitsToDate/s.totalUnits*100) : 0) : (s.unitsToDate||0); model.scopes.push(s); }
          else if(section==='DAILY_ACTUALS'){ if(r[0]==='date') continue; const d = r[0]; const a = r[1]; if(d){ model.dailyActuals[d] = a===''? undefined : clamp(parseFloat(a)||0,0,100); } }
          else if(section==='HISTORY'){ if(r[0]==='date') continue; if(r[0]) model.history.push({date:r[0], actualPct: parseFloat(r[1]||'0')||0}); }
          else if(section==='BASELINE'){ if(r[0]==='date') continue; baselineRows.push({date:r[0], val: (r[1]===''? null : parseFloat(r[1]||'0'))}); }
        }
        if(baselineRows.length){ model.baseline = { days: baselineRows.map(r=>r.date), planned: baselineRows.map(r=> (r.val==null? null : clamp(r.val,0,100))) }; }
        $('#projectName').value = model.project.name||''; $('#projectStartup').value = model.project.startup||''; $('#startupLabelInput').value = model.project.markerLabel || 'Baseline Complete';
        
        // Apply loaded project toggle states (PRGS)
        (function(){
          const proj = model.project || {};
          const labelToggleEl = document.getElementById('labelToggle');
          if (labelToggleEl && typeof proj.labelToggle !== 'undefined') {
            labelToggleEl.checked = !!proj.labelToggle;
          }
          if (typeof proj.legendBaselineCheckbox !== 'undefined') baselineVisible = !!proj.legendBaselineCheckbox;
          if (typeof proj.legendPlannedCheckbox !== 'undefined') plannedVisible = !!proj.legendPlannedCheckbox;
          if (typeof proj.legendActualCheckbox !== 'undefined') actualVisible = !!proj.legendActualCheckbox;
          if (typeof proj.legendForecastCheckbox !== 'undefined') forecastVisible = !!proj.legendForecastCheckbox;
        })();
        if(window.Sections && typeof window.Sections.ensureSectionNameField === 'function'){ window.Sections.ensureSectionNameField(model); }
        syncScopeRowsToModel(); computeAndRender(); sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model)); 
// alert('Full CSV loaded.');
      }catch(err){ alert('Failed to parse CSV: '+err.message); } };
    reader.readAsText(file);
  };
  inp.click(); }


function loadFromXml(xmlText){
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror');
  if (perr && perr.length) { throw new Error('Invalid XML'); }

  const projEl = doc.getElementsByTagName('Project')[0];
  if (!projEl) { throw new Error('No <Project> element found'); }

  // Project name
  const nameEl = projEl.getElementsByTagName('Name')[0];
  const projectName = nameEl ? nameEl.textContent : '';

  // Project-level ExtendedAttributes (those whose parent is the Project element)
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

  const projExtRoots = projEl.getElementsByTagName('ExtendedAttributes');
  let projExtRoot = null;
  for (let i = 0; i < projExtRoots.length; i++) {
    if (projExtRoots[i].parentNode === projEl) {
      projExtRoot = projExtRoots[i];
      break;
    }
  }
  if (projExtRoot) {
    const projExts = projExtRoot.getElementsByTagName('ExtendedAttribute');
    for (let i = 0; i < projExts.length; i++) {
      const ea = projExts[i];
      const nEl = ea.getElementsByTagName('Name')[0];
      const vEl = ea.getElementsByTagName('Value')[0];
      if (!nEl || !vEl) continue;
      const nm = nEl.textContent;
      const val = vEl.textContent || '';
      const trimmed = val.trim();
      const boolVal = (trimmed === 'true');

      if (nm === 'Startup') startupVal = trimmed;
      if (nm === 'MarkerLabel') markerLabelVal = trimmed;
      if (nm === 'LabelToggle') labelToggleFlag = boolVal;
      if (nm === 'LegendBaselineCheckbox') legendBaselineFlag = boolVal;
      if (nm === 'LegendPlannedCheckbox') legendPlannedFlag = boolVal;
      if (nm === 'LegendActualCheckbox') legendActualFlag = boolVal;
      if (nm === 'LegendForecastCheckbox') legendForecastFlag = boolVal;
      if (nm === 'BaselineHistory') baselineHistoryStr = val;
      if (nm === 'ActualHistory') actualHistoryStr = val;
      if (nm === 'DailyActuals') dailyActualsStr = val;
    }
  }

  const newModel = {
    project: {
      name: projectName || '',
      startup: startupVal || '',
      markerLabel: markerLabelVal || 'Baseline Complete'
    },
    scopes: [],
    history: [],
    dailyActuals: {},
    baseline: null,
    daysRelativeToPlan: null
  };

  // Apply legend + label flags
  if (typeof labelToggleFlag !== 'undefined') {
    newModel.project.labelToggle = labelToggleFlag;
  }
  if (typeof legendBaselineFlag !== 'undefined') {
    newModel.project.legendBaselineCheckbox = legendBaselineFlag;
  }
  if (typeof legendPlannedFlag !== 'undefined') {
    newModel.project.legendPlannedCheckbox = legendPlannedFlag;
  }
  if (typeof legendActualFlag !== 'undefined') {
    newModel.project.legendActualCheckbox = legendActualFlag;
  }
  if (typeof legendForecastFlag !== 'undefined') {
    newModel.project.legendForecastCheckbox = legendForecastFlag;
  }

  // Baseline from CSV
  if (baselineHistoryStr) {
    const lines = baselineHistoryStr.split(/\r?\n/);
    const rows = [];
    for (let line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      if (!parts[0]) continue;
      const d = parts[0].trim();
      const vStr = (parts[1] || '').trim();
      let val = null;
      if (vStr !== '' && vStr.toLowerCase() !== 'null') {
        const num = parseFloat(vStr);
        if (!isNaN(num)) val = clamp(num, 0, 100);
      }
      rows.push({ date: d, val: val });
    }
    if (rows.length) {
      newModel.baseline = {
        days: rows.map(r => r.date),
        planned: rows.map(r => (r.val == null ? null : clamp(r.val, 0, 100)))
      };
    }
  }

  // History from CSV
  if (actualHistoryStr) {
    const lines = actualHistoryStr.split(/\r?\n/);
    const hist = [];
    for (let line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      if (!parts[0]) continue;
      const d = parts[0].trim();
      const vStr = (parts[1] || '').trim();
      const num = parseFloat(vStr);
      if (!isNaN(num)) {
        hist.push({ date: d, actualPct: clamp(num, 0, 100) });
      }
    }
    if (hist.length) {
      newModel.history = hist;
    }
  }

  // DailyActuals from CSV
  if (dailyActualsStr) {
    const lines = dailyActualsStr.split(/\r?\n/);
    const da = {};
    for (let line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      if (!parts[0]) continue;
      const d = parts[0].trim();
      const vStr = (parts[1] || '').trim();
      if (vStr === '') continue;
      const num = parseFloat(vStr);
      if (!isNaN(num)) {
        da[d] = num;
      }
    }
    newModel.dailyActuals = da;
  }

  // Tasks → scopes
  const taskEls = projEl.getElementsByTagName('Task');
  for (let i = 0; i < taskEls.length; i++) {
    const t = taskEls[i];
    const uidEl = t.getElementsByTagName('UID')[0];
    if (uidEl && uidEl.textContent === '0') {
      // Skip summary task if present
      continue;
    }

    const nmEl = t.getElementsByTagName('Name')[0];
    const startEl = t.getElementsByTagName('Start')[0];
    const finEl = t.getElementsByTagName('Finish')[0];
    const pctEl = t.getElementsByTagName('PercentComplete')[0];
    const costEl = t.getElementsByTagName('Cost')[0];

    const label = nmEl ? nmEl.textContent : ('Task ' + (i + 1));
    const startRaw = startEl ? startEl.textContent : '';
    const finishRaw = finEl ? finEl.textContent : '';
    const pctRaw = pctEl ? pctEl.textContent : '0';

    const cost = costEl ? (parseFloat(costEl.textContent || '0') || 0) : 0;

    // Convert ISO datetime to YYYY-MM-DD
    const start = startRaw && startRaw.length >= 10 ? startRaw.slice(0, 10) : '';
    const end = finishRaw && finishRaw.length >= 10 ? finishRaw.slice(0, 10) : '';

    const pct = clamp(parseFloat(pctRaw) || 0, 0, 100);

    // Task ExtendedAttributes: UnitsToDate, TotalUnits, UnitsLabel
    let unitsToDate = '';
    let totalUnits = '';
    let unitsLabel = '';
    let sectionName = '';

    // Find ExtendedAttributes element whose parent is this Task
    let tExtRoot = null;
    const tExtRoots = t.getElementsByTagName('ExtendedAttributes');
    for (let j = 0; j < tExtRoots.length; j++) {
      if (tExtRoots[j].parentNode === t) {
        tExtRoot = tExtRoots[j];
        break;
      }
    }
    if (tExtRoot) {
      const tExts = tExtRoot.getElementsByTagName('ExtendedAttribute');
      for (let j = 0; j < tExts.length; j++) {
        const ea = tExts[j];
        const nEl = ea.getElementsByTagName('Name')[0];
        const vEl = ea.getElementsByTagName('Value')[0];
        if (!nEl || !vEl) continue;
        const nm = nEl.textContent;
        const val = vEl.textContent || '';
        if (nm === 'UnitsToDate') unitsToDate = val.trim();
        if (nm === 'TotalUnits') totalUnits = val.trim();
        if (nm === 'UnitsLabel') unitsLabel = val.trim();
        if (nm === 'SectionName') sectionName = val.trim();
      }
    }

    let totalUnitsNum = null;
    if (totalUnits !== '') {
      const tuNum = parseFloat(totalUnits);
      if (!isNaN(tuNum)) totalUnitsNum = tuNum;
    }

    let unitsToDateNum = 0;
    if (unitsToDate !== '') {
      const utdNum = parseFloat(unitsToDate);
      if (!isNaN(utdNum)) unitsToDateNum = utdNum;
    }

    // Normalize unitsLabel
    if (!unitsLabel) {
      unitsLabel = (totalUnitsNum && totalUnitsNum > 0) ? 'Feet' : '%';
    }

    const scope = {
      label: label,
      start: start,
      end: end,
      cost: cost,
      unitsToDate: unitsToDateNum,
      totalUnits: (totalUnitsNum == null ? '' : totalUnitsNum),
      unitsLabel: unitsLabel,
      sectionName: sectionName || '',
      actualPct: pct
    };

    newModel.scopes.push(scope);
  }

  // Commit into global model and UI
  model = newModel;
  window.model = model;

  const nameInput = document.getElementById('projectName');
  const startupInput = document.getElementById('projectStartup');
  const markerInput = document.getElementById('startupLabelInput');

  if (nameInput) nameInput.value = model.project.name || '';
  if (startupInput) startupInput.value = model.project.startup || '';
  if (markerInput) markerInput.value = model.project.markerLabel || 'Baseline Complete';

  (function(){
    const proj = model.project || {};
    const labelToggleEl = document.getElementById('labelToggle');
    const baselineCb = document.getElementById('legendBaselineCheckbox');
    const plannedCb = document.getElementById('legendPlannedCheckbox');
    const actualCb = document.getElementById('legendActualCheckbox');
    const forecastCb = document.getElementById('legendForecastCheckbox');

    if (labelToggleEl && typeof proj.labelToggle !== 'undefined') {
      labelToggleEl.checked = !!proj.labelToggle;
    }

    if (typeof proj.legendBaselineCheckbox !== 'undefined') {
      baselineVisible = !!proj.legendBaselineCheckbox;
      if (baselineCb) baselineCb.checked = baselineVisible;
    }
    if (typeof proj.legendPlannedCheckbox !== 'undefined') {
      plannedVisible = !!proj.legendPlannedCheckbox;
      if (plannedCb) plannedCb.checked = plannedVisible;
    }
    if (typeof proj.legendActualCheckbox !== 'undefined') {
      actualVisible = !!proj.legendActualCheckbox;
      if (actualCb) actualCb.checked = actualVisible;
    }
    if (typeof proj.legendForecastCheckbox !== 'undefined') {
      forecastVisible = !!proj.legendForecastCheckbox;
      if (forecastCb) forecastCb.checked = forecastVisible;
    }
  })();

  if(window.Sections && typeof window.Sections.ensureSectionNameField === 'function'){ window.Sections.ensureSectionNameField(model); }
  syncScopeRowsToModel();
  computeAndRender();
  sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
}




/*****************
 * Persistence and Controls
 *****************/
const COOKIE_KEY='progress_tracker_v3b';
window.COOKIE_KEY = COOKIE_KEY;


// Initialize Clear toolbar behavior (delegated to clear.js)
document.addEventListener('DOMContentLoaded', () => {
  try {
    initToolbarClear({
      calcEarliestStart,
      fmtDate,
      syncScopeRowsToModel,
      computeAndRender,
      COOKIE_KEY
      loadFromPresetCsv
    });
  } catch (e) {
    console.error('Failed to initialize clear module', e);
  }
});

function hydrateFromSession(){
  try{
    if(!window.sessionStorage) return false;
    const raw = sessionStorage.getItem(COOKIE_KEY);
    if(!raw) return false;
    const stored = JSON.parse(raw);
    if(!stored || typeof stored!=='object') return false;

    model = stored;
    window.model = model;

    const nameEl = document.getElementById('projectName');
    const startupEl = document.getElementById('projectStartup');
    const labelEl = document.getElementById('startupLabelInput');

    if(nameEl) nameEl.value = (model.project && model.project.name) || '';
    if(startupEl) startupEl.value = (model.project && model.project.startup) || '';
    if(labelEl) labelEl.value = (model.project && model.project.markerLabel) || 'Baseline Complete';

    syncScopeRowsToModel();
    computeAndRender();
    return true;
  }catch(e){
    console.error('Failed to hydrate model from sessionStorage', e);
    return false;
  }
}
function defaultAll(){
  sessionStorage.removeItem(COOKIE_KEY);
  model = {
    project:{name:'', startup:'', markerLabel:'Baseline Complete'},
    scopes:[],
    history:[],
    dailyActuals:{},
    baseline:null,
    daysRelativeToPlan:null
  };
  window.model = model;
  $('#projectName').value = '';
  $('#projectStartup').value = '';
  $('#startupLabelInput').value = 'Baseline Complete';
  const scopeContainer = document.getElementById('scopeRows');
  if(scopeContainer){ scopeContainer.innerHTML = ''; }
  computeAndRender(); sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model)); sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model)); sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
}

/*****************
 * Events
 *****************/
$('#projectName').addEventListener('input', computeAndRender);
$('#projectStartup').addEventListener('change', computeAndRender);
$('#startupLabelInput').addEventListener('input', computeAndRender);
$('#labelToggle').addEventListener('change', computeAndRender);

// Baseline button behavior
$('#baselineBtn').addEventListener('click', ()=>{
  const {days, plannedCum} = calcPlannedSeriesByDay();

  // Always ask before saving baseline
  if(!confirm('Are you sure you want to establish a new baseline for the project?')) return;

  // Delegate baseline capture to history.js helper
  takeBaseline(days, plannedCum, model);
  computeAndRender();
  // alert('Baseline captured.'); // (optional)
});
/*****************
 * Lightweight self-tests (console)
 *****************/

// Initialize history-related behavior (snapshot button, history table inputs)
document.addEventListener('DOMContentLoaded', () => {
  try {
    
const hd = document.getElementById('historyDate');
if (hd) {
  const markManual = () => { hd.dataset.manual = 'true';   if (typeof computeAndRender === 'function') computeAndRender();
};
  hd.addEventListener('input', markManual);
  hd.addEventListener('change', markManual);
}


    initHistory({ calcTotalActualProgress, fmtDate, today, computeAndRender });
  } catch (e) {
    console.error('Failed to initialize history module', e);
  }
});

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



// Ensure legend text renders after files are loaded without needing a toggle
document.querySelectorAll('input[type="file"]').forEach(el=>{
  el.addEventListener('change', ()=>{
    // Give parsing a tick, then recompute and render legend
    setTimeout(()=>{ try{ refreshLegendNow(); }catch(e){} }, 30);
  });
});

// === Embedded CSV loader for "Pipeline" preset (default) ===
function loadFromPresetCsv(text){
  // Clear saved data when loading any preset
  if (window.sessionStorage) window.sessionStorage.removeItem(COOKIE_KEY);
  model = { project:{name:'', startup:'', markerLabel:'Baseline Complete'}, scopes:[], history:[], dailyActuals:{}, baseline:null, daysRelativeToPlan:null };
  window.model = model;
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
      if(r[0]==='labelToggle') localModel.project.labelToggle = (r[1]==='true');
      if(r[0]==='legendBaselineCheckbox') localModel.project.legendBaselineCheckbox = (r[1]==='true');
      if(r[0]==='legendPlannedCheckbox') localModel.project.legendPlannedCheckbox = (r[1]==='true');
      if(r[0]==='legendActualCheckbox') localModel.project.legendActualCheckbox = (r[1]==='true');
      if(r[0]==='legendForecastCheckbox') localModel.project.legendForecastCheckbox = (r[1]==='true');
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
        sectionName: (idx('sectionName')>=0 ? (r[idx('sectionName')]||'') : ''),
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
  window.model = model;
  document.getElementById('projectName').value = model.project.name||'';
  document.getElementById('projectStartup').value = model.project.startup||'';
  document.getElementById('startupLabelInput').value = model.project.markerLabel || 'Baseline Complete';
  
  // Apply loaded project toggle states (PRGS preset)
  (function(){
    const proj = model.project || {};
    const labelToggleEl = document.getElementById('labelToggle');
    if (labelToggleEl && typeof proj.labelToggle !== 'undefined') {
      labelToggleEl.checked = !!proj.labelToggle;
    }
    if (typeof proj.legendBaselineCheckbox !== 'undefined') baselineVisible = !!proj.legendBaselineCheckbox;
    if (typeof proj.legendPlannedCheckbox !== 'undefined') plannedVisible = !!proj.legendPlannedCheckbox;
    if (typeof proj.legendActualCheckbox !== 'undefined') actualVisible = !!proj.legendActualCheckbox;
    if (typeof proj.legendForecastCheckbox !== 'undefined') forecastVisible = !!proj.legendForecastCheckbox;
  })();
  if(window.Sections && typeof window.Sections.ensureSectionNameField === 'function'){ window.Sections.ensureSectionNameField(model); }
  syncScopeRowsToModel(); computeAndRender(); sessionStorage.setItem(COOKIE_KEY, JSON.stringify(model));
}

document.addEventListener('DOMContentLoaded', function () {
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

    // Require auth before saving CSV
    if (typeof window.requireAuthForSaveAll === 'function') {
      window.requireAuthForSaveAll();
    } else if (typeof saveAll === 'function') {
      saveAll();
    } else if (typeof saveCsv === 'function') {
      saveCsv();
    }
  });

  btnXML.addEventListener('click', function (e) {
    e.stopPropagation();
    closeDropdown();

    // Require auth before saving XML
    if (typeof window.requireAuthForSaveXml === 'function') {
      window.requireAuthForSaveXml();
    } else if (typeof saveXml === 'function') {
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
      } else {
        let file = '';
        if (act === 'default') file = 'Project_Files/default_progress_all.prgs';
        if (act === 'pipeline') file = 'Project_Files/Pipeline_progress_all.prgs';
        if (act === 'mech') file = 'Project_Files/Mech_Facility_progress_all.prgs';
        if (act === 'ie') file = 'Project_Files/I&E_Facility_progress_all.prgs';

        if (file) {
          fetch(file)
            .then(r => r.text())
            .then(t => {
              loadFromPresetCsv(t);
            })
            .catch(err => {
              alert('Failed to load preset CSV: ' + err.message);
            });
        }
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

// Auto-load default CSV once on initial load (session-only persistence)
document.addEventListener('DOMContentLoaded', () => {
  try {
    const url = new URL(window.location.href);
    const wasRedirected = url.searchParams.get('redirected') === '1';

    // First try to restore any existing in-session project
    const hydrated = (typeof hydrateFromSession === 'function') ? hydrateFromSession() : false;

    // Only auto-load the default CSV if we did NOT hydrate from session
    // and this is not a post-login redirect
    if (!hydrated && !wasRedirected) {
      fetch('Project_Files/default_progress_all.prgs')
        .then(r => r.text())
        .then(t => loadFromPresetCsv(t))
        .catch(err => {
          console.error('Failed to auto-load default CSV:', err);
        });
    }

    // Clean up the redirected flag from the URL to keep things tidy
    if (wasRedirected) {
      url.searchParams.delete('redirected');
      window.history.replaceState({}, '', url.toString());
    }
  } catch (e) {
    console.error('Auto-load default CSV failed:', e);
  }
});


// Expose save helpers for auth wrapper
window.saveAll = saveAll;
window.saveXml = saveXml;



// Save Image & Copy Chart handlers
document.addEventListener('DOMContentLoaded', () => {
  const btnIMG = document.getElementById('saveIMG');
  if (btnIMG) {
    btnIMG.addEventListener('click', () => {
      if (window.saveChartImageJpg) {
        window.saveChartImageJpg();
      }
    });
  }

  const copyBtn = document.getElementById('toolbarCopy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (window.copyChartImageToClipboard) {
        await window.copyChartImageToClipboard();
      }
    });
  }
});


// Expose syncActualFromDOM so issues.js can call it before building issues.
if (typeof window !== 'undefined') {
  window.syncActualFromDOM = syncActualFromDOM;
}


// Returns true only if history contains actualPct > 0.5
function hasHistoryActualsAboveThreshold() {
  if (!Array.isArray(model.history)) return false;
  return model.history.some(h => {
    const v = Number(h?.actualPct);
    return isFinite(v) && v > 0.5;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const loadBtn = document.getElementById('toolbarLoad');
  if (loadBtn) loadBtn.textContent = "Open Project";
  const saveBtn = document.getElementById('saveCSV');
  if (saveBtn) saveBtn.textContent = "Save Project";
  const saveXmlBtn = document.getElementById('saveXML');
  if (saveXmlBtn) saveXmlBtn.textContent = "Export XML";
});

document.addEventListener('DOMContentLoaded', () => {
  const loadBtn = document.getElementById('toolbarLoad');
  if (loadBtn) loadBtn.innerHTML = "📂 Load Project ▾";
  const ddItem = document.querySelector('#loadDropdown [data-act="open"]');
  if (ddItem) ddItem.textContent = "Open Project";
});
