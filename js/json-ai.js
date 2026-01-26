/* (c) 2026 Rising Progress LLC. All rights reserved.
 * AI-Safe / Sanitized JSON generator (timeseries-only).
 * Excludes: FORMAT, PROJECT, SCOPES current snapshot.
 * Normalizes weighting to percent of total cost (AI JSON ONLY).
 */
(function(){
  'use strict';

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

  function computeWeightPct(cost, totalCost){
    return (totalCost > 0) ? ((Number(cost || 0) / totalCost) * 100) : 0;
  }

  function computePerDayAICanonical(scopeSnap, totalCost){
    if (!scopeSnap || !scopeSnap.start || !scopeSnap.end) return 0;
    var days = daysBetween(scopeSnap.start, scopeSnap.end);
    if (days <= 0) return 0;
    var w = computeWeightPct(scopeSnap.cost, totalCost);
    return w / days;
  }

  function getModelOrThrow(){
    if (!window || !window.model) throw new Error('PRGSJSON_AI.generate(): window.model is not available.');
    return window.model;
  }

  function buildMeta(){
    return { formatVersion: 2, source: 'prgs-vnext2-columnar-ai' };
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

    var out = { date: [], baselinePct: [], plannedPct: [], dailyActual: [], actualPct: [] };
    for (var x=0;x<days.length;x++){
      var dd = days[x];
      var b = (baselineCum[x] !== undefined && baselineCum[x] !== null) ? baselineCum[x] : '';
      var da = (daily && Object.prototype.hasOwnProperty.call(daily, dd) && daily[dd] !== null) ? daily[dd] : '';
      var a = (Object.prototype.hasOwnProperty.call(histMap, dd) && histMap[dd] !== null) ? histMap[dd] : '';

      out.date.push(dd);
      out.baselinePct.push(fmt2(b));
      out.plannedPct.push('');
      out.dailyActual.push(fmt2(da));
      out.actualPct.push(fmt2(a));
    }
    return out;
  }

  function buildTimeseriesScopes(model, totalCost){
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

    var dates = Object.keys(ts).sort();
    for (var i=0;i<dates.length;i++){
      var d = dates[i];
      var rows = ts[d] || [];
      for (var r=0;r<rows.length;r++){
        var s = rows[r] || {};

        var wPct = computeWeightPct(s.cost, totalCost);
        var pd = computePerDayAICanonical(s, totalCost);

        out.historyDate.push(d);
        out.scopeId.push(s.scopeId || '');
        out.label.push(s.label || '');
        out.start.push(s.start || '');
        out.end.push(s.end || '');
        out.cost.push(round3(wPct));
        out.perDay.push(round3(pd));
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

  function filterColumns(sectionObj, keepCols){
    if (!keepCols) return sectionObj;
    var out = {};
    for (var i=0;i<keepCols.length;i++){
      var k = keepCols[i];
      if (Object.prototype.hasOwnProperty.call(sectionObj, k)){
        out[k] = sectionObj[k];
      }
    }
    return out;
  }

  function requireCols(sectionName, keepCols, requiredCols){
    if (!keepCols) return;
    for (var i=0;i<requiredCols.length;i++){
      if (keepCols.indexOf(requiredCols[i]) < 0){
        throw new Error('PRGSJSON_AI.generate(): columns.' + sectionName + ' must include "' + requiredCols[i] + '"');
      }
    }
  }

  window.PRGSJSON_AI = {
    generate: function(options){
      var model = getModelOrThrow();
      options = options || {};
      var include = options.include || {};
      var cols = options.columns || {};

      var scopes = Array.isArray(model.scopes) ? model.scopes : [];
      var totalCost = 0;
      for (var j=0;j<scopes.length;j++) totalCost += (Number(scopes[j] && scopes[j].cost) || 0);

      var ts = {};

      var includeProject = (include.timeseries !== false);
      var includeScopes = (include.timeseriesScopes !== false);
      var includeSections = (include.timeseriesSections !== false);

      if (includeProject){
        requireCols('TIMESERIES_PROJECT', cols.TIMESERIES_PROJECT, ['date']);
        ts.project = filterColumns(buildTimeseriesProject(model), cols.TIMESERIES_PROJECT);
      }

      if (includeScopes){
        requireCols('TIMESERIES_SCOPES', cols.TIMESERIES_SCOPES, ['historyDate','scopeId','sectionID']);
        ts.scopes = filterColumns(buildTimeseriesScopes(model, totalCost), cols.TIMESERIES_SCOPES);
      }

      if (includeSections){
        requireCols('TIMESERIES_SECTIONS', cols.TIMESERIES_SECTIONS, ['historyDate','sectionID']);
        ts.sections = filterColumns(buildTimeseriesSections(model), cols.TIMESERIES_SECTIONS);
      }

      return {
        meta: buildMeta(),
        timeseries: ts
      };
    }
  };

  /* Console examples:
   * PRGSJSON_AI.generate({ include: { timeseries: true } });
   */
})();
