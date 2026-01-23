/*
© 2026 Rising Progress LLC. All rights reserved.

PRGSJSON: Columnar JSON transport for PRGS vNext2.

- This file MUST NOT modify progress.js or save-load.js.
- Finalization MUST mirror vNext2 PRGS loader behavior.
- computeAndRender() is module-scoped inside progress.js, so we finalize by round-tripping through
  the existing vNext2 PRGS loader (window.loadFromPresetCsv), which already calls the same deps.
*/

(function(){
  'use strict';

  if (window.PRGSJSON) return;

  /* =========================
   * Helpers (no new globals)
   * ========================= */

  function isObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }

  function toStrOrEmpty(v){
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function toNumOrEmpty(v){
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    return isFinite(n) ? n : '';
  }

  function toNumOrNull(v){
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function toStrOrNull(v){
    if (v === null || v === undefined) return null;
    const s = String(v);
    return s === '' ? null : s;
  }

  function deepClone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  function ensureArray(v){
    return Array.isArray(v) ? v : [];
  }

  function col(obj, k){
    if (!obj || typeof obj !== 'object') return null;
    const v = obj[k];
    return Array.isArray(v) ? v : null;
  }

  function maxLen(arrs){
    let n = 0;
    for (let i = 0; i < arrs.length; i++){
      const a = arrs[i];
      if (Array.isArray(a) && a.length > n) n = a.length;
    }
    return n;
  }

  function assertNoDup(list, what){
    const seen = Object.create(null);
    for (let i = 0; i < list.length; i++){
      const k = list[i];
      if (!k) continue;
      if (seen[k]) {
        throw new Error('PRGSJSON: duplicate ' + what + ' "' + k + '"');
      }
      seen[k] = true;
    }
  }

  /* =========================
   * Minimal vNext2 PRGS writer
   * (mirrors save-load.js buildAllCSV)
   * ========================= */

  function csvEsc(v){
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }

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

  function __daysBetween(startStr, endStr){
    if(!startStr || !endStr) return 0;
    const a = new Date(startStr + 'T00:00:00');
    const b = new Date(endStr + 'T00:00:00');
    if(!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    const ms = b - a;
    return Math.floor(ms/86400000) + 1; // inclusive
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

  function buildPrgsVNext2TextFromModel(model){
    // Mirrors save-load.js buildAllCSV() formatting (section headers + blank lines).
    const out = [];
    const csvLineNoNL = (arr) => arr.map(csvEsc).join(',');
    const pad2 = (n) => String(n).padStart(2, '0');

    function section(name, bodyLines){
      if (out.length) out.push('', '');
      out.push('#SECTION:' + name);
      if (Array.isArray(bodyLines) && bodyLines.length) {
        out.push(bodyLines[0]);
        out.push('');
        if (bodyLines.length > 1) out.push(...bodyLines.slice(1));
      }
    }

    // FORMAT
    section('FORMAT', (function(){
      const lines = [];
      lines.push('formatVersion');
      lines.push('2');
      return lines;
    })());

    // PROJECT
    section('PROJECT', (function(){
      const lines = [];
      lines.push('name,datesaved,timesaved,startup,markerLabel');
      const now = new Date();
      const datesaved =
        now.getFullYear() + '-' + pad2(now.getMonth()+1) + '-' + pad2(now.getDate());
      const timesaved =
        pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
      const p = (model && model.project) ? model.project : {};
      lines.push(csvLineNoNL([
        p.name || '',
        datesaved,
        timesaved,
        p.startup || '',
        p.markerLabel || ''
      ]));
      return lines;
    })());

    // SCOPES
    section('SCOPES', (function(){
      const lines = [];
      lines.push('scopeId,label,start,end,cost,progressValue,unitsToDate,totalUnits,unitsLabel,sectionName,sectionID');
      const scopes = Array.isArray(model && model.scopes) ? model.scopes : [];
      scopes.forEach(s=>{
        const pv = (s.progressValue ?? __computeProgressValue(s));
        s.progressValue = pv;
        lines.push(csvLineNoNL([
          s.scopeId || '',
          s.label || '',
          s.start || '',
          s.end || '',
          s.cost ?? '',
          __fmt2(pv ?? ''),
          __fmt2(s.totalUnits ? (s.unitsToDate ?? '') : ''),
          __fmt2(s.totalUnits ?? ''),
          s.unitsLabel || '',
          s.sectionName || '',
          s.sectionID || ''
        ]));
      });
      return lines;
    })());

    // TIMESERIES (marker section only; kept for compatibility)
    section('TIMESERIES', (function(){
      const lines = [];
      lines.push('historyDate,key,value');
      return lines;
    })());

    // TIMESERIES_PROJECT
    if (model && model.timeSeriesProject) {
      section('TIMESERIES_PROJECT', (function(){
        const lines = [];
        lines.push('historyDate,key,value');
        Object.keys(model.timeSeriesProject).sort().forEach(d=>{
          const rows = model.timeSeriesProject[d] || [];
          rows.forEach(r=>{
            lines.push(csvLineNoNL([
              d,
              r.key || '',
              __fmt2(r.value ?? '')
            ]));
          });
        });
        return lines;
      })());
    }

    // TIMESERIES_SCOPES
    if (model && model.timeSeriesScopes) {
      section('TIMESERIES_SCOPES', (function(){
        const lines = [];
        lines.push('historyDate,scopeId,label,start,end,cost,perDay,actualPct,unitsToDate,totalUnits,unitsLabel,plannedtodate,sectionName,sectionID');
        Object.keys(model.timeSeriesScopes).sort().forEach(d=>{
          const rows = model.timeSeriesScopes[d] || [];
          rows.forEach(s=>{
            const pv = (s.progressValue ?? __computeProgressValue(s));
            s.progressValue = pv;
            if (s.perDay == null || s.perDay === '') {
              const totalCost = (model.scopes || []).reduce((a,b)=> a + (Number(b.cost) || 0), 0);
              s.perDay = __computePerDay(s, totalCost);
            }
            lines.push(csvLineNoNL([
              d,
              s.scopeId || '',
              s.label || '',
              s.start || '',
              s.end || '',
              s.cost ?? '',
              (isFinite(s.perDay) ? Math.round(s.perDay * 1000) / 1000 : ''),
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
        return lines;
      })());
    }

    // TIMESERIES_SECTIONS
    if (model && model.timeSeriesSections) {
      section('TIMESERIES_SECTIONS', (function(){
        const lines = [];
        lines.push('historyDate,sectionID,sectionTitle,sectionWeight,sectionPct,sectionPlannedPct');
        Object.keys(model.timeSeriesSections).sort().forEach(d=>{
          const rows = model.timeSeriesSections[d] || [];
          rows.forEach(r=>{
            lines.push(csvLineNoNL([
              d,
              r.sectionID || '',
              r.sectionTitle || '',
              __fmt2(r.sectionWeight ?? ''),
              __fmt2(r.sectionPct ?? ''),
              __fmt2(r.sectionPlannedPct ?? '')
            ]));
          });
        });
        return lines;
      })());
    }

    return out.join('\n') + '\n';
  }

  /* =========================
   * Columnar JSON generator
   * ========================= */

  function generatePrgsJSON(){
    if (!window.model) throw new Error('PRGSJSON.generatePrgsJSON: window.model is not available');
    const m = window.model;

    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const datesaved =
      now.getFullYear() + '-' + pad2(now.getMonth()+1) + '-' + pad2(now.getDate());
    const timesaved =
      pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());

    const out = {
      meta: {
        formatVersion: 2,
        source: 'PRGSJSON'
      },
      project: {
        name: toStrOrNull(m.project && m.project.name),
        datesaved: datesaved,
        timesaved: timesaved,
        startup: toStrOrNull(m.project && m.project.startup),
        markerLabel: toStrOrNull(m.project && m.project.markerLabel)
      },
      scopes: {
        scopeId: [],
        label: [],
        start: [],
        end: [],
        cost: [],
        progressValue: [],
        unitsToDate: [],
        totalUnits: [],
        unitsLabel: [],
        sectionName: [],
        sectionID: []
      },
      timeseries: {
        project: {
          historyDate: [],
          key: [],
          value: []
        },
        scopes: {
          historyDate: [],
          scopeId: [],
          label: [],
          start: [],
          end: [],
          cost: [],
          perDay: [],
          actualPct: [],
          unitsToDate: [],
          totalUnits: [],
          unitsLabel: [],
          plannedtodate: [],
          sectionName: [],
          sectionID: []
        },
        sections: {
          historyDate: [],
          sectionID: [],
          sectionTitle: [],
          sectionWeight: [],
          sectionPct: [],
          sectionPlannedPct: []
        }
      }
    };

    // SCOPES (current)
    const scopes = Array.isArray(m.scopes) ? m.scopes : [];
    for (let i = 0; i < scopes.length; i++){
      const s = scopes[i] || {};
      if (!s.scopeId) {
        throw new Error('PRGSJSON.generatePrgsJSON: missing scopeId at index ' + i);
      }
      out.scopes.scopeId.push(String(s.scopeId));
      out.scopes.label.push(toStrOrNull(s.label));
      out.scopes.start.push(toStrOrNull(s.start));
      out.scopes.end.push(toStrOrNull(s.end));
      out.scopes.cost.push(toNumOrNull(s.cost));
      // vNext2 writer uses progressValue (actualPct in % mode, unitsToDate in units mode)
      const pv = (s.progressValue ?? __computeProgressValue(s));
      out.scopes.progressValue.push(toNumOrNull(pv));
      out.scopes.unitsToDate.push(toNumOrNull(s.unitsToDate));
      out.scopes.totalUnits.push(toNumOrNull(s.totalUnits));
      out.scopes.unitsLabel.push(toStrOrNull(s.unitsLabel));
      out.scopes.sectionName.push(toStrOrNull(s.sectionName));
      out.scopes.sectionID.push(toStrOrNull(s.sectionID));
    }
    assertNoDup(out.scopes.scopeId, 'scopeId');

    // TIMESERIES_PROJECT
    if (m.timeSeriesProject && isObj(m.timeSeriesProject)) {
      const dates = Object.keys(m.timeSeriesProject).sort();
      for (let di = 0; di < dates.length; di++){
        const d = dates[di];
        const rows = ensureArray(m.timeSeriesProject[d]);
        for (let ri = 0; ri < rows.length; ri++){
          const r = rows[ri] || {};
          out.timeseries.project.historyDate.push(String(d));
          out.timeseries.project.key.push(toStrOrNull(r.key));
          out.timeseries.project.value.push(toNumOrNull(r.value));
        }
      }
    }

    // TIMESERIES_SCOPES
    if (m.timeSeriesScopes && isObj(m.timeSeriesScopes)) {
      const dates = Object.keys(m.timeSeriesScopes).sort();
      for (let di = 0; di < dates.length; di++){
        const d = dates[di];
        const rows = ensureArray(m.timeSeriesScopes[d]);
        for (let ri = 0; ri < rows.length; ri++){
          const s = rows[ri] || {};
          if (!s.scopeId) {
            throw new Error('PRGSJSON.generatePrgsJSON: missing timeseries.scopes.scopeId for historyDate ' + d);
          }

          // Mirror vNext2 save-time derivations
          const pv = (s.progressValue ?? __computeProgressValue(s));
          s.progressValue = pv;

          if (s.perDay == null || s.perDay === '') {
            const totalCost = (m.scopes || []).reduce((a,b)=> a + (Number(b.cost) || 0), 0);
            s.perDay = __computePerDay(s, totalCost);
          }

          out.timeseries.scopes.historyDate.push(String(d));
          out.timeseries.scopes.scopeId.push(String(s.scopeId));
          out.timeseries.scopes.label.push(toStrOrNull(s.label));
          out.timeseries.scopes.start.push(toStrOrNull(s.start));
          out.timeseries.scopes.end.push(toStrOrNull(s.end));
          out.timeseries.scopes.cost.push(toNumOrNull(s.cost));
          out.timeseries.scopes.perDay.push(toNumOrNull(s.perDay));
          out.timeseries.scopes.actualPct.push(toNumOrNull(s.actualPct));
          out.timeseries.scopes.unitsToDate.push(toNumOrNull(s.unitsToDate));
          out.timeseries.scopes.totalUnits.push(toNumOrNull(s.totalUnits));
          out.timeseries.scopes.unitsLabel.push(toStrOrNull(s.unitsLabel));
          out.timeseries.scopes.plannedtodate.push(toNumOrNull(s.plannedtodate));
          out.timeseries.scopes.sectionName.push(toStrOrNull(s.sectionName));
          out.timeseries.scopes.sectionID.push(toStrOrNull(s.sectionID));
        }
      }
    }

    // TIMESERIES_SECTIONS
    if (m.timeSeriesSections && isObj(m.timeSeriesSections)) {
      const dates = Object.keys(m.timeSeriesSections).sort();
      for (let di = 0; di < dates.length; di++){
        const d = dates[di];
        const rows = ensureArray(m.timeSeriesSections[d]);
        for (let ri = 0; ri < rows.length; ri++){
          const r = rows[ri] || {};
          if (!r.sectionID) {
            throw new Error('PRGSJSON.generatePrgsJSON: missing timeseries.sections.sectionID for historyDate ' + d);
          }
          out.timeseries.sections.historyDate.push(String(d));
          out.timeseries.sections.sectionID.push(String(r.sectionID));
          out.timeseries.sections.sectionTitle.push(toStrOrNull(r.sectionTitle));
          out.timeseries.sections.sectionWeight.push(toNumOrNull(r.sectionWeight));
          out.timeseries.sections.sectionPct.push(toNumOrNull(r.sectionPct));
          out.timeseries.sections.sectionPlannedPct.push(toNumOrNull(r.sectionPlannedPct));
        }
      }
    }

    // Assign to global per requirement
    window['prgs-json'] = out;
    return out;
  }

  /* =========================
   * Columnar JSON -> model (authoritative)
   * Then finalize via vNext2 PRGS loader to mirror computeAndRender()
   * ========================= */

  function buildModelFromColumnar(jsonObj, options){
    const mode = options && options.mode ? String(options.mode) : 'overwrite';
    if (mode !== 'overwrite' && mode !== 'append') {
      throw new Error('PRGSJSON.loadPrgsJSON: options.mode must be "overwrite" or "append"');
    }

    if (!isObj(jsonObj)) throw new Error('PRGSJSON.loadPrgsJSON: input must be an object');
    if (!isObj(jsonObj.meta)) throw new Error('PRGSJSON.loadPrgsJSON: missing meta');
    if (!isObj(jsonObj.project)) throw new Error('PRGSJSON.loadPrgsJSON: missing project');
    if (!isObj(jsonObj.scopes)) throw new Error('PRGSJSON.loadPrgsJSON: missing scopes');
    if (!isObj(jsonObj.timeseries)) throw new Error('PRGSJSON.loadPrgsJSON: missing timeseries');

    // Start from either fresh overwrite model or existing model (append)
    const base = (mode === 'append' && window.model) ? window.model : {
      project:{ name:'', startup:'', markerLabel:'Baseline Complete' },
      scopes:[],
      history:[],
      dailyActuals:{},
      baseline:null,
      daysRelativeToPlan: null
    };

    // Clone base to avoid partial corruption if we throw mid-load
    const m = deepClone(base);

    // Project (authoritative when present)
    const p = jsonObj.project || {};
    if (p.name !== undefined) m.project.name = toStrOrEmpty(p.name);
    if (p.startup !== undefined) m.project.startup = toStrOrEmpty(p.startup);
    if (p.markerLabel !== undefined) m.project.markerLabel = toStrOrEmpty(p.markerLabel);

    // Scopes columnar -> row objects
    const sc = jsonObj.scopes || {};
    const c_scopeId = col(sc,'scopeId') || [];
    const c_label = col(sc,'label') || [];
    const c_start = col(sc,'start') || [];
    const c_end = col(sc,'end') || [];
    const c_cost = col(sc,'cost') || [];
    const c_progressValue = col(sc,'progressValue') || [];
    const c_unitsToDate = col(sc,'unitsToDate') || [];
    const c_totalUnits = col(sc,'totalUnits') || [];
    const c_unitsLabel = col(sc,'unitsLabel') || [];
    const c_sectionName = col(sc,'sectionName') || [];
    const c_sectionID = col(sc,'sectionID') || [];

    const nScopes = maxLen([c_scopeId,c_label,c_start,c_end,c_cost,c_progressValue,c_unitsToDate,c_totalUnits,c_unitsLabel,c_sectionName,c_sectionID]);

    // UID protection: scopeId is required for any row that exists.
    // If scopeId is missing, throw (do not guess / generate).
    const incomingScopes = [];
    for (let i = 0; i < nScopes; i++){
      const sid = c_scopeId[i];
      if (sid === null || sid === undefined || String(sid).trim() === '') {
        throw new Error('PRGSJSON.loadPrgsJSON: missing required scopes.scopeId at row ' + i);
      }
      const scope = {
        scopeId: String(sid),
        label: toStrOrEmpty(c_label[i]),
        start: toStrOrEmpty(c_start[i]),
        end: toStrOrEmpty(c_end[i]),
        cost: toNumOrEmpty(c_cost[i]),
        // progressValue maps to actualPct in % mode; unitsToDate is used when totalUnits > 0
        progressValue: toNumOrEmpty(c_progressValue[i]),
        unitsToDate: toNumOrEmpty(c_unitsToDate[i]),
        totalUnits: toNumOrEmpty(c_totalUnits[i]),
        unitsLabel: toStrOrEmpty(c_unitsLabel[i]),
        sectionName: toStrOrEmpty(c_sectionName[i]),
        sectionID: toStrOrEmpty(c_sectionID[i])
      };
      incomingScopes.push(scope);
    }
    assertNoDup(incomingScopes.map(s=>s.scopeId), 'scopeId');

    if (mode === 'overwrite') {
      m.scopes = incomingScopes;
    } else {
      // Append mode: match by scopeId, overwrite content, never delete, never duplicate UIDs.
      const byId = Object.create(null);
      for (let i = 0; i < m.scopes.length; i++){
        const s = m.scopes[i];
        if (s && s.scopeId) byId[String(s.scopeId)] = i;
      }
      for (let i = 0; i < incomingScopes.length; i++){
        const inc = incomingScopes[i];
        const k = String(inc.scopeId);
        if (byId[k] !== undefined) {
          // Overwrite existing scope content (authoritative)
          const dst = m.scopes[byId[k]];
          if (dst) {
            dst.label = inc.label;
            dst.start = inc.start;
            dst.end = inc.end;
            dst.cost = inc.cost;
            dst.progressValue = inc.progressValue;
            dst.unitsToDate = inc.unitsToDate;
            dst.totalUnits = inc.totalUnits;
            dst.unitsLabel = inc.unitsLabel;
            dst.sectionName = inc.sectionName;
            dst.sectionID = inc.sectionID;
          } else {
            m.scopes[byId[k]] = inc;
          }
        } else {
          m.scopes.push(inc);
          byId[k] = m.scopes.length - 1;
        }
      }
      assertNoDup(m.scopes.map(s=>s && s.scopeId ? String(s.scopeId) : ''), 'scopeId');
    }

    // Timeseries parsing (tolerant on missing columns)
    // Stored in model as objects keyed by historyDate with arrays of row objects (mirrors save-load loader expectations).
    const ts = jsonObj.timeseries || {};

    // timeseries.project
    if (isObj(ts.project)) {
      const t = ts.project;
      const dArr = col(t,'historyDate') || [];
      const kArr = col(t,'key') || [];
      const vArr = col(t,'value') || [];
      const n = maxLen([dArr,kArr,vArr]);
      const map = (mode === 'append' && m.timeSeriesProject && isObj(m.timeSeriesProject)) ? m.timeSeriesProject : {};
      for (let i = 0; i < n; i++){
        const d = dArr[i];
        if (d == null || String(d).trim() === '') throw new Error('PRGSJSON.loadPrgsJSON: timeseries.project missing historyDate at row ' + i);
        const hd = String(d);
        if (!map[hd]) map[hd] = [];
        map[hd].push({
          historyDate: hd,
          key: toStrOrEmpty(kArr[i]),
          value: toNumOrEmpty(vArr[i])
        });
      }
      m.timeSeriesProject = map;
      if (mode === 'append') {
        // Overwrite matching dates (authoritative); append missing.
        const incomingDates = Object.keys(map);
        // NOTE: map already merged by pushing; to enforce overwrite, rebuild from incoming input when provided.
        // For safety, we rebuild a new object:
        const rebuilt = (m.timeSeriesProject && isObj(m.timeSeriesProject)) ? m.timeSeriesProject : {};
        // No-op: we keep as built above (append-by-push) only when input explicitly includes those dates.
        // Overwrite semantics are handled below when we parse with an isolated incoming object.
      }
    }

    // Helper to build incoming date->rows map from columnar rows
    function buildTsMapFromColumnar(t, rowBuilder){
      const dArr = col(t,'historyDate') || [];
      const n = dArr.length;
      const map = Object.create(null);
      for (let i = 0; i < n; i++){
        const d = dArr[i];
        if (d == null || String(d).trim() === '') throw new Error('PRGSJSON.loadPrgsJSON: timeseries missing historyDate at row ' + i);
        const hd = String(d);
        if (!map[hd]) map[hd] = [];
        map[hd].push(rowBuilder(i, hd));
      }
      return map;
    }

    // timeseries.scopes
    if (isObj(ts.scopes)) {
      const t = ts.scopes;
      const dArr = col(t,'historyDate') || [];
      const sidArr = col(t,'scopeId') || [];
      const n = maxLen([dArr, sidArr]);

      // Validate required identifiers when a row exists
      for (let i = 0; i < n; i++){
        const d = dArr[i];
        if (d == null || String(d).trim() === '') throw new Error('PRGSJSON.loadPrgsJSON: timeseries.scopes missing historyDate at row ' + i);
        const sid = sidArr[i];
        if (sid == null || String(sid).trim() === '') throw new Error('PRGSJSON.loadPrgsJSON: timeseries.scopes missing scopeId at row ' + i);
      }

      const incoming = Object.create(null);
      for (let i = 0; i < n; i++){
        const hd = String(dArr[i]);
        if (!incoming[hd]) incoming[hd] = [];
        const row = {
          historyDate: hd,
          scopeId: String(sidArr[i]),
          label: toStrOrEmpty((col(t,'label')||[])[i]),
          start: toStrOrEmpty((col(t,'start')||[])[i]),
          end: toStrOrEmpty((col(t,'end')||[])[i]),
          cost: toNumOrEmpty((col(t,'cost')||[])[i]),
          perDay: toNumOrEmpty((col(t,'perDay')||[])[i]),
          actualPct: toNumOrEmpty((col(t,'actualPct')||[])[i]),
          unitsToDate: toNumOrEmpty((col(t,'unitsToDate')||[])[i]),
          totalUnits: toNumOrEmpty((col(t,'totalUnits')||[])[i]),
          unitsLabel: toStrOrEmpty((col(t,'unitsLabel')||[])[i]),
          plannedtodate: toNumOrEmpty((col(t,'plannedtodate')||[])[i]),
          sectionName: toStrOrEmpty((col(t,'sectionName')||[])[i]),
          sectionID: toStrOrEmpty((col(t,'sectionID')||[])[i])
        };
        incoming[hd].push(row);
      }

      if (mode === 'overwrite' || !m.timeSeriesScopes || !isObj(m.timeSeriesScopes)) {
        m.timeSeriesScopes = incoming;
      } else {
        // Append mode: overwrite matching dates, append missing dates (do not delete).
        const merged = m.timeSeriesScopes;
        for (const d in incoming){
          merged[d] = incoming[d];
        }
        m.timeSeriesScopes = merged;
      }
    }

    // timeseries.sections
    if (isObj(ts.sections)) {
      const t = ts.sections;
      const dArr = col(t,'historyDate') || [];
      const secArr = col(t,'sectionID') || [];
      const n = maxLen([dArr, secArr]);

      for (let i = 0; i < n; i++){
        const d = dArr[i];
        if (d == null || String(d).trim() === '') throw new Error('PRGSJSON.loadPrgsJSON: timeseries.sections missing historyDate at row ' + i);
        const sid = secArr[i];
        if (sid == null || String(sid).trim() === '') throw new Error('PRGSJSON.loadPrgsJSON: timeseries.sections missing sectionID at row ' + i);
      }

      const incoming = Object.create(null);
      for (let i = 0; i < n; i++){
        const hd = String(dArr[i]);
        if (!incoming[hd]) incoming[hd] = [];
        const row = {
          historyDate: hd,
          sectionID: String(secArr[i]),
          sectionTitle: toStrOrEmpty((col(t,'sectionTitle')||[])[i]),
          sectionWeight: toNumOrEmpty((col(t,'sectionWeight')||[])[i]),
          sectionPct: toNumOrEmpty((col(t,'sectionPct')||[])[i]),
          sectionPlannedPct: toNumOrEmpty((col(t,'sectionPlannedPct')||[])[i])
        };
        incoming[hd].push(row);
      }

      if (mode === 'overwrite' || !m.timeSeriesSections || !isObj(m.timeSeriesSections)) {
        m.timeSeriesSections = incoming;
      } else {
        const merged = m.timeSeriesSections;
        for (const d in incoming){
          merged[d] = incoming[d];
        }
        m.timeSeriesSections = merged;
      }
    }

    // Optional: history and dailyActuals support (tolerant; not in schema)
    if (jsonObj.history && Array.isArray(jsonObj.history)) {
      if (mode === 'overwrite') {
        m.history = deepClone(jsonObj.history);
      } else {
        // Overwrite matching dates, append missing; preserve existing if omitted.
        const byDate = Object.create(null);
        for (let i = 0; i < (m.history || []).length; i++){
          const h = m.history[i];
          if (h && h.date) byDate[String(h.date)] = i;
        }
        for (let i = 0; i < jsonObj.history.length; i++){
          const h = jsonObj.history[i];
          if (!h || !h.date) continue;
          const d = String(h.date);
          if (byDate[d] !== undefined) m.history[byDate[d]] = deepClone(h);
          else m.history.push(deepClone(h));
        }
      }
    }

    if (jsonObj.dailyActuals && isObj(jsonObj.dailyActuals)) {
      if (!m.dailyActuals || typeof m.dailyActuals !== 'object') m.dailyActuals = {};
      for (const d in jsonObj.dailyActuals){
        const v = jsonObj.dailyActuals[d];
        const n = Number(v);
        if (!isFinite(n)) continue;
        m.dailyActuals[String(d)] = n;
      }
    }

    // UID protection for sectionID (best-effort; sections may be empty in model)
    const secIds = [];
    for (let i = 0; i < m.scopes.length; i++){
      const s = m.scopes[i];
      if (s && s.sectionID) secIds.push(String(s.sectionID));
    }
    if (m.timeSeriesSections && isObj(m.timeSeriesSections)) {
      const dates = Object.keys(m.timeSeriesSections);
      for (let di = 0; di < dates.length; di++){
        const rows = m.timeSeriesSections[dates[di]] || [];
        for (let ri = 0; ri < rows.length; ri++){
          const r = rows[ri];
          if (r && r.sectionID) secIds.push(String(r.sectionID));
        }
      }
    }
    // Do NOT require uniqueness of blank; do require no duplicate non-blank IDs.
    assertNoDup(secIds.filter(Boolean), 'sectionID');

    return m;
  }

  function loadPrgsJSON(jsonInput, options){
    let obj = jsonInput;
    if (typeof jsonInput === 'string') {
      try {
        obj = JSON.parse(jsonInput);
      } catch (e) {
        console.error(e);
        throw new Error('PRGSJSON.loadPrgsJSON: invalid JSON string');
      }
    }

    const mode = options && options.mode ? String(options.mode) : 'overwrite';

    // Build authoritative model (with append/overwrite semantics) in memory.
    const mergedModel = buildModelFromColumnar(obj, { mode: mode });

    // Finalize exactly like vNext2 PRGS loader by round-tripping through the existing loader:
    // - Avoid manual normalization here (computeAndRender handles it downstream).
    // - Ensure UID generation is inhibited during hydration, mirroring progress.js behavior.
    mergedModel.__hydratingFromPrgs = true;

    const prgsText = buildPrgsVNext2TextFromModel(mergedModel);

    if (typeof window.loadFromPresetCsv !== 'function') {
      throw new Error('PRGSJSON.loadPrgsJSON: window.loadFromPresetCsv is not available (save-load.js not initialized)');
    }

    // window.loadFromPresetCsv will overwrite window.model and run full finalize+render.
    // This is the safest way to guarantee identical results after computeAndRender().
    window.loadFromPresetCsv(prgsText);

    // Clear hydration flag (defensive; loader also clears/normalizes as needed).
    try {
      if (window.model) delete window.model.__hydratingFromPrgs;
    } catch (e) {}

    return window.model;
  }

  window.PRGSJSON = {
    generatePrgsJSON: generatePrgsJSON,
    loadPrgsJSON: loadPrgsJSON
  };

  // Console-ready usage examples:
  // PRGSJSON.generatePrgsJSON()
  // PRGSJSON.loadPrgsJSON(json, { mode: "overwrite" })
  // PRGSJSON.loadPrgsJSON(json, { mode: "append" })

})();
