/* (c) 2026 Rising Progress LLC. All rights reserved.
 * Full Project JSON (PRGS-equivalent) generator.
 * Mirrors save-load.js vNext2 writer behavior for columnar JSON.
 */
(function(){
  'use strict';

  function pad2(n){ return String(n).padStart(2,'0'); }

  function fmt2(v){
    if (v === undefined || v === null || v === '') return '';
    var n = parseFloat(v);
    if (!isFinite(n)) return '';
    return Math.round(n * 100) / 100;
  }

  function round3(v){
    if (v === undefined || v === null || v === '') return '';
    var n = parseFloat(v);
    if (!isFinite(n)) return '';
    return Math.round(n * 1000) / 1000;
  }

  function parseDate(d){ return d ? new Date(String(d).slice(0,10) + 'T00:00:00') : null; }
  function daysBetween(a,b){
    var da = parseDate(a), db = parseDate(b);
    if (!da || !db || isNaN(da) || isNaN(db)) return 0;
    return Math.floor((db - da)/86400000) + 1;
  }

  function computePerDay(scope, totalCost){
    if (!scope || !scope.start || !scope.end) return '';
    var days = daysBetween(scope.start, scope.end);
    if (days <= 0) return '';
    var w = (totalCost > 0) ? ((Number(scope.cost || 0) / totalCost) * 100) : 0;
    return w / days;
  }

  function computeProgressValue(scope){
    if (!scope) return '';
    if (scope.totalUnits && Number(scope.totalUnits) > 0){
      return (scope.unitsToDate !== undefined && scope.unitsToDate !== null) ? scope.unitsToDate : '';
    }
    return (scope.actualPct !== undefined && scope.actualPct !== null) ? scope.actualPct : '';
  }

  function generateScopeId(){
    return 'sc_' + Math.random().toString(36).slice(2,8);
  }

  function getModelOrThrow(){
    if (!window || !window.model) throw new Error('PRGSJSON_FULL.generate(): window.model is not available.');
    return window.model;
  }

  function getResolvedDailyActual(days){
    try{
      if (window && typeof window.getResolvedDailyActualSeries === 'function'){
        var res = window.getResolvedDailyActualSeries(days);
        if (res && Array.isArray(res.actual) && res.actual.length === days.length) return res.actual;
      }
      if (window && typeof window.calcActualSeriesByDay === 'function'){
        var arr = window.calcActualSeriesByDay(days);
        if (Array.isArray(arr) && arr.length === days.length) return arr;
      }
    }catch(e){}
    return null;
  }

  function buildMeta(){
    return { formatVersion: 2, source: 'prgs-vnext2-columnar' };
  }

  function boolStr(v){ return v ? 'true' : 'false'; }

  function buildProject(model){
    var p = model.project || {};
    var now = new Date();
    var datesaved = now.getFullYear() + '-' + pad2(now.getMonth()+1) + '-' + pad2(now.getDate());
    var timesaved = pad2(now.getHours()) + ':' + pad2(now.getMinutes());

    var labelToggleEl = document.getElementById('labelToggle');
    var baselineCb = document.getElementById('legendBaselineCheckbox');
    var plannedCb = document.getElementById('legendPlannedCheckbox');
    var actualCb = document.getElementById('legendActualCheckbox');
    var forecastCb = document.getElementById('legendForecastCheckbox');

    var labelToggleVal = (labelToggleEl && typeof labelToggleEl.checked === 'boolean') ? !!labelToggleEl.checked : false;

    // Legend state fallback (if exposed).
    var legendState = null;
    try{
      if (window && typeof window.getLegendState === 'function') legendState = window.getLegendState();
    }catch(e){ legendState = null; }

    var legendBaselineVal = (baselineCb && typeof baselineCb.checked === 'boolean')
      ? !!baselineCb.checked
      : (legendState && typeof legendState.baselineVisible === 'boolean' ? !!legendState.baselineVisible : true);

    var legendPlannedVal = (plannedCb && typeof plannedCb.checked === 'boolean')
      ? !!plannedCb.checked
      : (legendState && typeof legendState.plannedVisible === 'boolean' ? !!legendState.plannedVisible : true);

    var legendActualVal = (actualCb && typeof actualCb.checked === 'boolean')
      ? !!actualCb.checked
      : (legendState && typeof legendState.actualVisible === 'boolean' ? !!legendState.actualVisible : true);

    var legendForecastVal = (forecastCb && typeof forecastCb.checked === 'boolean')
      ? !!forecastCb.checked
      : (legendState && typeof legendState.forecastVisible === 'boolean' ? !!legendState.forecastVisible : true);

    return {
      datesaved: datesaved,
      timesaved: timesaved,
      name: p.name || '',
      startup: p.startup || '',
      markerLabel: p.markerLabel || '',
      labelToggle: boolStr(labelToggleVal),
      legendBaselineCheckbox: boolStr(legendBaselineVal),
      legendPlannedCheckbox: boolStr(legendPlannedVal),
      legendActualCheckbox: boolStr(legendActualVal),
      legendForecastCheckbox: boolStr(legendForecastVal)
    };
  }

  function buildScopes(model){
    var out = {
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
    };

    var scopes = Array.isArray(model.scopes) ? model.scopes : [];
    for (var i=0;i<scopes.length;i++){
      var s = scopes[i] || {};
      if (!s.scopeId) s.scopeId = generateScopeId();

      out.scopeId.push(s.scopeId || '');
      out.label.push(s.label || '');
      out.start.push(s.start || '');
      out.end.push(s.end || '');
      out.cost.push((s.cost === undefined || s.cost === null) ? '' : s.cost);
      out.progressValue.push((s.actualPct === undefined || s.actualPct === null) ? '' : s.actualPct);

      var hasTotal = (s.totalUnits !== undefined && s.totalUnits !== null && s.totalUnits !== '' && Number(s.totalUnits) > 0);
      out.unitsToDate.push(hasTotal ? ((s.unitsToDate === undefined || s.unitsToDate === null) ? '' : s.unitsToDate) : '');
      out.totalUnits.push((s.totalUnits === undefined || s.totalUnits === null) ? '' : s.totalUnits);
      out.unitsLabel.push(s.unitsLabel || '');
      out.sectionName.push(s.sectionName || '');
      out.sectionID.push(s.sectionID || '');
    }
    return out;
  }

  function buildTimeseriesProject(model){
    var daily = model.dailyActuals || {};
    var hist = Array.isArray(model.history) ? model.history : [];
    var histMap = {};
    for (var i=0;i<hist.length;i++){
      var h = hist[i];
      if (h && h.date) histMap[h.date] = h.actualPct;
    }

    var days = (model.baseline && Array.isArray(model.baseline.days)) ? model.baseline.days : [];
    var baselineCum = (model.baseline && Array.isArray(model.baseline.planned)) ? model.baseline.planned : [];

    var resolvedDaily = getResolvedDailyActual(days);

    // Rebuild planned cumulative (derivable; not stored in model), mirroring save-load.js.
    var plannedCum = [];
    var cum = 0;
    var scopes = Array.isArray(model.scopes) ? model.scopes : [];
    var totalCost = 0;
    for (var j=0;j<scopes.length;j++) totalCost += (Number(scopes[j] && scopes[j].cost) || 0);

    for (var k=0;k<days.length;k++){
      var dday = days[k];
      var add = 0;
      for (var sIdx=0;sIdx<scopes.length;sIdx++){
        var s = scopes[sIdx];
        if (!s || !s.start || !s.end) continue;
        if (dday >= s.start && dday <= s.end){
          var pd = computePerDay(s, totalCost);
          if (isFinite(pd)) add += pd;
        }
      }
      cum += add;
      plannedCum.push(Math.min(100, cum));
    }

    var out = { date: [], baselinePct: [], plannedPct: [], dailyActual: [], actualPct: [] };
    for (var x=0;x<days.length;x++){
      var dd = days[x];
      var b = (baselineCum[x] !== undefined && baselineCum[x] !== null) ? baselineCum[x] : '';
      var p2 = (plannedCum[x] !== undefined && plannedCum[x] !== null) ? plannedCum[x] : '';
      var da = (resolvedDaily && resolvedDaily.length === days.length) ? resolvedDaily[x]
        : ((daily && Object.prototype.hasOwnProperty.call(daily, dd) && daily[dd] !== null) ? daily[dd] : '');
      var a = (Object.prototype.hasOwnProperty.call(histMap, dd) && histMap[dd] !== null) ? histMap[dd] : '';

      out.date.push(dd);
      out.baselinePct.push(fmt2(b));
      out.plannedPct.push(fmt2(p2));
      out.dailyActual.push(fmt2(da));
      out.actualPct.push(fmt2(a));
    }
    return out;
  }

  // Project-level historical metadata ledger (mirrors PRGS #SECTION:TIMESERIES_PROJECT).
  // Output is columnar arrays: historyDate[], key[], value[]
  function buildTimeseriesProjectMeta(model){
    var ts = model && model.timeSeriesProject ? model.timeSeriesProject : null;
    var out = { historyDate: [], key: [], value: [] };
    if (!ts) return out;

    var dates = Object.keys(ts).sort();
    for (var i=0;i<dates.length;i++){
      var d = dates[i];
      var rows = ts[d] || [];
      for (var r=0;r<rows.length;r++){
        var row = rows[r] || {};
        var hd = (row.historyDate !== undefined && row.historyDate !== null && row.historyDate !== '') ? String(row.historyDate) : String(d || '');
        if (!hd) continue;

        out.historyDate.push(hd);
        out.key.push((row.key === undefined || row.key === null) ? '' : String(row.key));
        out.value.push((row.value === undefined || row.value === null) ? '' : String(row.value));
      }
    }
    return out;
  }



  function buildTimeseriesScopes(model){
    var ts = model.timeSeriesScopes || null;
    var out = {
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
    };
    if (!ts) return out;

    var scopes = Array.isArray(model.scopes) ? model.scopes : [];
    var totalCost = 0;
    for (var j=0;j<scopes.length;j++) totalCost += (Number(scopes[j] && scopes[j].cost) || 0);

    var dates = Object.keys(ts).sort();
    for (var i=0;i<dates.length;i++){
      var d = dates[i];
      var rows = ts[d] || [];
      for (var r=0;r<rows.length;r++){
        var s = rows[r] || {};

        // snapshot dynamic fields at save time (mirror save-load.js)
        var pv = (s.progressValue !== undefined && s.progressValue !== null) ? s.progressValue : computeProgressValue(s);
        s.progressValue = pv;

        if (s.perDay === undefined || s.perDay === null || s.perDay === ''){
          s.perDay = computePerDay(s, totalCost);
        }

        out.historyDate.push(d);
        out.scopeId.push(s.scopeId || '');
        out.label.push(s.label || '');
        out.start.push(s.start || '');
        out.end.push(s.end || '');
        out.cost.push((s.cost === undefined || s.cost === null) ? '' : s.cost);
        out.perDay.push(isFinite(s.perDay) ? round3(s.perDay) : '');
        out.actualPct.push(fmt2((s.actualPct === undefined || s.actualPct === null) ? '' : s.actualPct));

        var tu = (s.totalUnits === undefined || s.totalUnits === null) ? '' : s.totalUnits;
        out.unitsToDate.push(fmt2(tu ? ((s.unitsToDate === undefined || s.unitsToDate === null) ? '' : s.unitsToDate) : ''));
        out.totalUnits.push(fmt2(tu));
        out.unitsLabel.push(s.unitsLabel || '');
        out.plannedtodate.push(fmt2((s.plannedtodate === undefined || s.plannedtodate === null) ? '' : s.plannedtodate));
        out.sectionName.push(s.sectionName || '');
        out.sectionID.push(s.sectionID || '');
      }
    }
    return out;
  }

  function buildTimeseriesSections(model){
    var ts = model.timeSeriesSections || null;
    var out = {
      historyDate: [],
      sectionID: [],
      sectionTitle: [],
      sectionWeight: [],
      sectionPct: [],
      sectionPlannedPct: []
    };
    if (!ts) return out;

    var dates = Object.keys(ts).sort();
    for (var i=0;i<dates.length;i++){
      var d = dates[i];
      var rows = ts[d] || [];
      for (var r=0;r<rows.length;r++){
        var row = rows[r] || {};
        out.historyDate.push(d);
        out.sectionID.push(row.sectionID || '');
        out.sectionTitle.push(row.sectionTitle || '');
        out.sectionWeight.push(fmt2((row.sectionWeight === undefined || row.sectionWeight === null) ? '' : row.sectionWeight));
        out.sectionPct.push(fmt2((row.sectionPct === undefined || row.sectionPct === null) ? '' : row.sectionPct));
        out.sectionPlannedPct.push(fmt2((row.sectionPlannedPct === undefined || row.sectionPlannedPct === null) ? '' : row.sectionPlannedPct));
      }
    }
    return out;
  }

  function buildTimeseries(model){
    return {
      project: buildTimeseriesProject(model),
      
      projectMeta: buildTimeseriesProjectMeta(model),
      scopes: buildTimeseriesScopes(model),
      sections: buildTimeseriesSections(model)
    };
  }

  window.PRGSJSON_FULL = {
    generate: function(){
      var model = getModelOrThrow();
      return {
        meta: buildMeta(),
        project: buildProject(model),
        scopes: buildScopes(model),
        timeseries: buildTimeseries(model)
      };
    }
  };

  /* Console examples:
   * PRGSJSON_FULL.generate();
   */
})();
