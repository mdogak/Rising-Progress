/* (c) 2026 Rising Progress LLC. All rights reserved.
 * Unified JSON Loader for Full Project JSON + AI-Safe JSON.
 * Mode: overwrite | append
 * Mirrors save-load.js vNext2 semantics and finalization sequence as closely as possible.
 */
(function(){
  'use strict';

  function isObj(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }

  function numOrBlank(v){
    if (v === undefined || v === null || v === '') return '';
    var n = parseFloat(v);
    return isNaN(n) ? '' : n;
  }

  function getModel(){
    return (window && window.model) ? window.model : null;
  }

  function setModel(m){
    if (window && typeof window.setModel === 'function'){
      window.setModel(m);
    } else if (window){
      window.model = m;
    }
  }

  function ensureArray(v){
    return Array.isArray(v) ? v : [];
  }

  function validateColumnar(sectionName, obj){
    if (!isObj(obj)) throw new Error('PRGSJSON_LOADER.load(): ' + sectionName + ' must be an object.');
    var keys = Object.keys(obj);
    var n = null;
    for (var i=0;i<keys.length;i++){
      var k = keys[i];
      var arr = obj[k];
      if (!Array.isArray(arr)) throw new Error('PRGSJSON_LOADER.load(): ' + sectionName + '.' + k + ' must be an array.');
      if (n === null) n = arr.length;
      if (arr.length !== n) throw new Error('PRGSJSON_LOADER.load(): ' + sectionName + ' arrays must be index-aligned.');
    }
    return n || 0;
  }

  function readScopesColumnar(scopesObj){
    var n = validateColumnar('scopes', scopesObj);
    var out = [];
    for (var i=0;i<n;i++){
      var scopeId = (scopesObj.scopeId && scopesObj.scopeId[i] != null) ? String(scopesObj.scopeId[i]) : '';
      if (!scopeId) throw new Error('PRGSJSON_LOADER.load(): scopes.scopeId is required (row ' + i + ').');
      var s = {
        scopeId: scopeId,
        label: (scopesObj.label && scopesObj.label[i] != null) ? String(scopesObj.label[i]) : '',
        start: (scopesObj.start && scopesObj.start[i] != null) ? String(scopesObj.start[i]) : '',
        end: (scopesObj.end && scopesObj.end[i] != null) ? String(scopesObj.end[i]) : '',
        cost: (scopesObj.cost && scopesObj.cost[i] !== undefined && scopesObj.cost[i] !== null && scopesObj.cost[i] !== '') ? numOrBlank(scopesObj.cost[i]) : '',
        actualPct: (scopesObj.progressValue && scopesObj.progressValue[i] !== undefined && scopesObj.progressValue[i] !== null && scopesObj.progressValue[i] !== '') ? numOrBlank(scopesObj.progressValue[i]) : '',
        unitsToDate: (scopesObj.unitsToDate && scopesObj.unitsToDate[i] !== undefined && scopesObj.unitsToDate[i] !== null && scopesObj.unitsToDate[i] !== '') ? numOrBlank(scopesObj.unitsToDate[i]) : '',
        totalUnits: (scopesObj.totalUnits && scopesObj.totalUnits[i] !== undefined) ? (scopesObj.totalUnits[i] === '' ? '' : (parseFloat(scopesObj.totalUnits[i]) || 0)) : '',
        unitsLabel: (scopesObj.unitsLabel && scopesObj.unitsLabel[i] != null) ? String(scopesObj.unitsLabel[i]) : '',
        sectionName: (scopesObj.sectionName && scopesObj.sectionName[i] != null) ? String(scopesObj.sectionName[i]) : '',
        sectionID: (scopesObj.sectionID && scopesObj.sectionID[i] != null) ? String(scopesObj.sectionID[i]) : ''
      };
      out.push(s);
    }
    return out;
  }

  function applyTimeseriesProject(model, tsProj, mode){
    if (!isObj(tsProj)) return;
    validateColumnar('timeseries.project', tsProj);

    var dates = ensureArray(tsProj.date);
    var baselinePct = ensureArray(tsProj.baselinePct);
    var dailyActual = ensureArray(tsProj.dailyActual);
    var actualPct = ensureArray(tsProj.actualPct);

    if (dates.length){
      model.baseline = { days: [], planned: [] };
      for (var i=0;i<dates.length;i++){
        var dd = dates[i] ? String(dates[i]) : '';
        if (!dd) continue;
        model.baseline.days.push(dd);
        var b = (baselinePct[i] !== undefined) ? baselinePct[i] : '';
        model.baseline.planned.push((b === '' ? null : numOrBlank(b)));
      }
    }

    model.dailyActuals = model.dailyActuals || {};
    model.history = ensureArray(model.history);

    var existingHistMap = {};
    for (var h=0; h<model.history.length; h++){
      var row = model.history[h];
      if (row && row.date) existingHistMap[row.date] = row;
    }

    for (var j=0;j<dates.length;j++){
      var d = dates[j] ? String(dates[j]) : '';
      if (!d) continue;

      var da = (dailyActual[j] !== undefined) ? dailyActual[j] : '';
      if (da !== '' && da !== null && da !== undefined){
        var dan = numOrBlank(da);
        if (dan !== '') model.dailyActuals[d] = dan;
      } else if (mode === 'overwrite'){
        if (model.dailyActuals && Object.prototype.hasOwnProperty.call(model.dailyActuals, d)) delete model.dailyActuals[d];
      }

      var ap = (actualPct[j] !== undefined) ? actualPct[j] : '';
      if (ap !== '' && ap !== null && ap !== undefined){
        var apn = numOrBlank(ap);
        if (apn !== ''){
          if (existingHistMap[d]) existingHistMap[d].actualPct = apn;
          else model.history.push({ date: d, actualPct: apn });
        }
      }
    }
  }

  function applyTimeseriesScopes(model, tsScopes, mode){
    if (!isObj(tsScopes)) return;
    var n = validateColumnar('timeseries.scopes', tsScopes);

    var m = model.timeSeriesScopes || {};
    var hdates = ensureArray(tsScopes.historyDate);
    var scopeIds = ensureArray(tsScopes.scopeId);

    for (var i=0;i<n;i++){
      var hd = hdates[i] ? String(hdates[i]) : '';
      var sid = scopeIds[i] ? String(scopeIds[i]) : '';
      if (!hd) throw new Error('PRGSJSON_LOADER.load(): timeseries.scopes.historyDate is required (row ' + i + ').');
      if (!sid) throw new Error('PRGSJSON_LOADER.load(): timeseries.scopes.scopeId is required (row ' + i + ').');

      if (!m[hd]) m[hd] = [];
      var arr = m[hd];

      var idx = -1;
      for (var j=0;j<arr.length;j++){
        if (arr[j] && arr[j].scopeId === sid){ idx = j; break; }
      }

      var snap = {
        scopeId: sid,
        label: (tsScopes.label && tsScopes.label[i] != null) ? String(tsScopes.label[i]) : '',
        start: (tsScopes.start && tsScopes.start[i] != null) ? String(tsScopes.start[i]) : '',
        end: (tsScopes.end && tsScopes.end[i] != null) ? String(tsScopes.end[i]) : '',
        cost: numOrBlank(tsScopes.cost ? tsScopes.cost[i] : ''),
        perDay: numOrBlank(tsScopes.perDay ? tsScopes.perDay[i] : ''),
        actualPct: numOrBlank(tsScopes.actualPct ? tsScopes.actualPct[i] : ''),
        progressValue: '',
        unitsToDate: numOrBlank(tsScopes.unitsToDate ? tsScopes.unitsToDate[i] : ''),
        totalUnits: (tsScopes.totalUnits && tsScopes.totalUnits[i] !== undefined) ? (tsScopes.totalUnits[i] === '' ? '' : (parseFloat(tsScopes.totalUnits[i]) || 0)) : '',
        unitsLabel: (tsScopes.unitsLabel && tsScopes.unitsLabel[i] != null) ? String(tsScopes.unitsLabel[i]) : '',
        plannedtodate: numOrBlank(tsScopes.plannedtodate ? tsScopes.plannedtodate[i] : ''),
        sectionName: (tsScopes.sectionName && tsScopes.sectionName[i] != null) ? String(tsScopes.sectionName[i]) : '',
        sectionID: (tsScopes.sectionID && tsScopes.sectionID[i] != null) ? String(tsScopes.sectionID[i]) : ''
      };

      if (idx >= 0) arr[idx] = snap;
      else arr.push(snap);
    }

    model.timeSeriesScopes = m;
  }

  function applyTimeseriesSections(model, tsSections, mode){
    if (!isObj(tsSections)) return;
    var n = validateColumnar('timeseries.sections', tsSections);

    var m = model.timeSeriesSections || {};
    var hdates = ensureArray(tsSections.historyDate);
    var secIds = ensureArray(tsSections.sectionID);

    for (var i=0;i<n;i++){
      var hd = hdates[i] ? String(hdates[i]) : '';
      var sid = secIds[i] ? String(secIds[i]) : '';
      if (!hd) throw new Error('PRGSJSON_LOADER.load(): timeseries.sections.historyDate is required (row ' + i + ').');
      if (!sid) throw new Error('PRGSJSON_LOADER.load(): timeseries.sections.sectionID is required (row ' + i + ').');

      if (!m[hd]) m[hd] = [];
      var arr = m[hd];

      var idx = -1;
      for (var j=0;j<arr.length;j++){
        if (arr[j] && arr[j].sectionID === sid){ idx = j; break; }
      }

      var row = {
        sectionID: sid,
        sectionTitle: (tsSections.sectionTitle && tsSections.sectionTitle[i] != null) ? String(tsSections.sectionTitle[i]) : '',
        sectionWeight: numOrBlank(tsSections.sectionWeight ? tsSections.sectionWeight[i] : ''),
        sectionPct: numOrBlank(tsSections.sectionPct ? tsSections.sectionPct[i] : ''),
        sectionPlannedPct: numOrBlank(tsSections.sectionPlannedPct ? tsSections.sectionPlannedPct[i] : '')
      };

      if (idx >= 0) arr[idx] = row;
      else arr.push(row);
    }

    model.timeSeriesSections = m;
  }

  function finalizeToUI(model){
    setModel(model);

    // Clear hydration guard before any UI sync/render (mirror save-load.js)
    try{ model.__hydratingFromPrgs = false; }catch(e){}
    try{ var m2 = getModel(); if(m2) m2.__hydratingFromPrgs = false; }catch(e){}

    var nameInput = document.getElementById('projectName');
    var startupInput = document.getElementById('projectStartup');
    var markerInput = document.getElementById('startupLabelInput');

    if (nameInput) nameInput.value = (model.project && model.project.name) ? model.project.name : '';
    if (startupInput) startupInput.value = (model.project && model.project.startup) ? model.project.startup : '';
    if (markerInput) markerInput.value = (model.project && model.project.markerLabel) ? model.project.markerLabel : 'Baseline Complete';

    (function(){
      var proj = model.project || {};
      var labelToggleEl = document.getElementById('labelToggle');
      var baselineCb = document.getElementById('legendBaselineCheckbox');
      var plannedCb = document.getElementById('legendPlannedCheckbox');
      var actualCb = document.getElementById('legendActualCheckbox');
      var forecastCb = document.getElementById('legendForecastCheckbox');

      if (labelToggleEl && typeof proj.labelToggle !== 'undefined') labelToggleEl.checked = !!proj.labelToggle;

      var patch = {};
      if (typeof proj.legendBaselineCheckbox !== 'undefined') { patch.baselineVisible = !!proj.legendBaselineCheckbox; if (baselineCb) baselineCb.checked = patch.baselineVisible; }
      if (typeof proj.legendPlannedCheckbox !== 'undefined') { patch.plannedVisible = !!proj.legendPlannedCheckbox; if (plannedCb) plannedCb.checked = patch.plannedVisible; }
      if (typeof proj.legendActualCheckbox !== 'undefined') { patch.actualVisible = !!proj.legendActualCheckbox; if (actualCb) actualCb.checked = patch.actualVisible; }
      if (typeof proj.legendForecastCheckbox !== 'undefined') { patch.forecastVisible = !!proj.legendForecastCheckbox; if (forecastCb) forecastCb.checked = patch.forecastVisible; }

      try{
        if (window && typeof window.setLegendState === 'function') window.setLegendState(patch);
      }catch(e){}
    })();

    try{
      if (window.Sections && typeof window.Sections.ensureSectionNameField === 'function'){
        window.Sections.ensureSectionNameField(model);
      }
    }catch(e){}

    try{
      if (window && typeof window.syncScopeRowsToModel === 'function') window.syncScopeRowsToModel();
    }catch(e){}

    try{
      if (window && typeof window.computeAndRender === 'function') window.computeAndRender();
    }catch(e){}

    try{
      if (window.sessionStorage){
        var key = (window.COOKIE_KEY || window.RP_COOKIE_KEY || 'rp_progress_model');
        sessionStorage.setItem(key, JSON.stringify(model));
      }
    }catch(e){}
  }

  function buildFreshModel(){
    return {
      project: { name:'', startup:'', markerLabel:'Baseline Complete' },
      scopes: [],
      history: [],
      dailyActuals: {},
      baseline: null,
      daysRelativeToPlan: null,
      timeSeriesProject: {},
      timeSeriesScopes: {},
      timeSeriesSections: {},
      __hydratingFromPrgs: true
    };
  }

  function mergeScopesAppend(model, newScopes){
    var existing = ensureArray(model.scopes);
    var byId = {};
    for (var i=0;i<existing.length;i++){
      var s = existing[i];
      if (s && s.scopeId) byId[s.scopeId] = s;
    }
    for (var j=0;j<newScopes.length;j++){
      var ns = newScopes[j];
      if (!ns || !ns.scopeId) throw new Error('PRGSJSON_LOADER.load(): append requires scopes with scopeId.');
      if (byId[ns.scopeId]){
        var t = byId[ns.scopeId];
        t.label = ns.label;
        t.start = ns.start;
        t.end = ns.end;
        t.cost = ns.cost;
        t.actualPct = ns.actualPct;
        t.unitsToDate = ns.unitsToDate;
        t.totalUnits = ns.totalUnits;
        t.unitsLabel = ns.unitsLabel;
        t.sectionName = ns.sectionName;
        t.sectionID = ns.sectionID;
      } else {
        existing.push(ns);
      }
    }
    model.scopes = existing;
  }

  window.PRGSJSON_LOADER = {
    load: function(jsonInput, opts){
      opts = opts || {};
      var mode = opts.mode || 'overwrite';
      if (mode !== 'overwrite' && mode !== 'append'){
        throw new Error('PRGSJSON_LOADER.load(): mode must be "overwrite" or "append".');
      }

      var obj = jsonInput;
      if (typeof jsonInput === 'string'){
        try{
          obj = JSON.parse(jsonInput);
        }catch(e){
          throw new Error('PRGSJSON_LOADER.load(): Malformed JSON.');
        }
      }
      if (!isObj(obj)) throw new Error('PRGSJSON_LOADER.load(): jsonInput must be an object or JSON string.');

      var ts = obj.timeseries || null;
      if (ts && !isObj(ts)) throw new Error('PRGSJSON_LOADER.load(): timeseries must be an object.');

      var model = (mode === 'overwrite') ? buildFreshModel() : (getModel() || buildFreshModel());

      // Temporary guard to prevent ID generation / partial renders during JSON hydration
      try{ model.__hydratingFromPrgs = true; }catch(e){}
      try{ var m0 = getModel(); if(m0) m0.__hydratingFromPrgs = true; }catch(e){}

      if (obj.project && isObj(obj.project)){
        model.project = model.project || {};
        var p = obj.project;
        if (p.name !== undefined) model.project.name = String(p.name || '');
        if (p.startup !== undefined) model.project.startup = String(p.startup || '');
        if (p.markerLabel !== undefined) model.project.markerLabel = String(p.markerLabel || '');

        if (p.labelToggle !== undefined) model.project.labelToggle = (p.labelToggle === true || p.labelToggle === 'true');
        if (p.legendBaselineCheckbox !== undefined) model.project.legendBaselineCheckbox = (p.legendBaselineCheckbox === true || p.legendBaselineCheckbox === 'true');
        if (p.legendPlannedCheckbox !== undefined) model.project.legendPlannedCheckbox = (p.legendPlannedCheckbox === true || p.legendPlannedCheckbox === 'true');
        if (p.legendActualCheckbox !== undefined) model.project.legendActualCheckbox = (p.legendActualCheckbox === true || p.legendActualCheckbox === 'true');
        if (p.legendForecastCheckbox !== undefined) model.project.legendForecastCheckbox = (p.legendForecastCheckbox === true || p.legendForecastCheckbox === 'true');
      }

      if (obj.scopes && isObj(obj.scopes)){
        var newScopes = readScopesColumnar(obj.scopes);
        if (mode === 'overwrite') model.scopes = newScopes;
        else mergeScopesAppend(model, newScopes);
      } else if (mode === 'overwrite') {
        model.scopes = [];
      }

      if (ts){
        if (ts.project) applyTimeseriesProject(model, ts.project, mode);
        if (ts.scopes) applyTimeseriesScopes(model, ts.scopes, mode);
        if (ts.sections) applyTimeseriesSections(model, ts.sections, mode);
      }

      finalizeToUI(model);
      return model;
    }
  };

  /* Console examples:
   * PRGSJSON_LOADER.load(json, { mode: "overwrite" });
   * PRGSJSON_LOADER.load(json, { mode: "append" });
   */
})();
