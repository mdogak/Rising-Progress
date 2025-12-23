/*
© 2025 Rising Progress LLC. All rights reserved.
Save/Load/Export module extracted from progress.js
*/

let deps = null;
let __saveLoadInitialized = false;
let __saveLoadDomBound = false;
let __saveLoadAutoBound = false;

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
      const dd = model.baseline.days[i];
      const v = model.baseline.planned[i];
      if (!dd) continue;
      baselineCSV += dd + ',' + (v == null ? '' : v) + '\n';
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
    Object.keys(model.dailyActuals).sort().forEach(dd => {
      const v = model.dailyActuals[dd];
      if (!dd) return;
      dailyCSV += dd + ',' + (v == null ? '' : v) + '\n';
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
    const pct = d.clamp(isFinite(s.actualPct) ? Number(s.actualPct) || 0 : 0, 0, 100);
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

function buildAllCSV(){
  const d = requireDeps();
  const model = getModel();

  const plan = d.calcPlannedSeriesByDay();
  const days = plan.days || [];
  const plannedCum = plan.plannedCum || plan.planned || [];
  const actualCum = d.calcActualSeriesByDay(days);
  const baselineCum = d.getBaselineSeries(days, plannedCum);

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
  Object.keys(daily).sort().forEach(dd => {
    const v = daily[dd];
    out += csvLine([dd, (v == null || v === '') ? '' : Number(v)]);
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
    model.baseline.days.forEach((dd, idx) => {
      const v = model.baseline.planned[idx];
      out += csvLine([dd, v == null ? '' : v]);
    });
  }
  out += '\n';

  return out;
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

        const rows = parseCSV(text);
        let section = '';
        const fresh = { project:{name:'',startup:'', markerLabel:'Baseline Complete'}, scopes:[], history:[], dailyActuals:{}, baseline:null, daysRelativeToPlan:null };
        let scopeHeaders = [];
        let baselineRows = [];

        for(let r of rows){
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
          }
        }
        if(baselineRows.length){
          fresh.baseline = { days: baselineRows.map(r=>r.date), planned: baselineRows.map(r=> (r.val==null? null : d.clamp(r.val,0,100))) };
        }

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

  // Project-level ExtendedAttributes
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
  if (typeof labelToggleFlag !== 'undefined') newModel.project.labelToggle = labelToggleFlag;
  if (typeof legendBaselineFlag !== 'undefined') newModel.project.legendBaselineCheckbox = legendBaselineFlag;
  if (typeof legendPlannedFlag !== 'undefined') newModel.project.legendPlannedCheckbox = legendPlannedFlag;
  if (typeof legendActualFlag !== 'undefined') newModel.project.legendActualCheckbox = legendActualFlag;
  if (typeof legendForecastFlag !== 'undefined') newModel.project.legendForecastCheckbox = legendForecastFlag;

  // Baseline from CSV
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
      newModel.baseline = { days: rows.map(r => r.date), planned: rows.map(r => (r.val == null ? null : d.clamp(r.val, 0, 100))) };
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
      const dd = parts[0].trim();
      const vStr = (parts[1] || '').trim();
      const num = parseFloat(vStr);
      if (!isNaN(num)) hist.push({ date: dd, actualPct: d.clamp(num, 0, 100) });
    }
    if (hist.length) newModel.history = hist;
  }

  // DailyActuals from CSV
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

  // Tasks → scopes
  const taskEls = projEl.getElementsByTagName('Task');
  for (let i = 0; i < taskEls.length; i++) {
    const t = taskEls[i];
    const uidEl = t.getElementsByTagName('UID')[0];
    if (uidEl && uidEl.textContent === '0') continue;

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

    const start = startRaw && startRaw.length >= 10 ? startRaw.slice(0, 10) : '';
    const end = finishRaw && finishRaw.length >= 10 ? finishRaw.slice(0, 10) : '';

    const pct = d.clamp(parseFloat(pctRaw) || 0, 0, 100);

    // Task ExtendedAttributes
    let unitsToDate = '';
    let totalUnits = '';
    let unitsLabel = '';
    let sectionName = '';

    let tExtRoot = null;
    const tExtRoots = t.getElementsByTagName('ExtendedAttributes');
    for (let j = 0; j < tExtRoots.length; j++) {
      if (tExtRoots[j].parentNode === t) { tExtRoot = tExtRoots[j]; break; }
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

    if (!unitsLabel) unitsLabel = (totalUnitsNum && totalUnitsNum > 0) ? 'Feet' : '%';

    const scope = {
      label, start, end, cost,
      unitsToDate: unitsToDateNum,
      totalUnits: (totalUnitsNum == null ? '' : totalUnitsNum),
      unitsLabel,
      sectionName: sectionName || '',
      actualPct: pct
    };

    newModel.scopes.push(scope);
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
export function loadFromPresetCsv(text){
  const d = requireDeps();
  resetModelForLoad();

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
      const dd = r[0]; const a = r[1];
      if(dd){ localModel.dailyActuals[dd] = a===''? undefined : d.clamp(parseFloat(a)||0,0,100); }
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
      planned: baselineRows.map(r=> (r.val==null? null : d.clamp(r.val,0,100)))
    };
  }

  setModel(localModel);

  document.getElementById('projectName').value = localModel.project.name||'';
  document.getElementById('projectStartup').value = localModel.project.startup||'';
  document.getElementById('startupLabelInput').value = localModel.project.markerLabel || 'Baseline Complete';

  // Apply loaded project toggle states (PRGS preset)
  (function(){
    const proj = localModel.project || {};
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

  if(window.Sections && typeof window.Sections.ensureSectionNameField === 'function'){ window.Sections.ensureSectionNameField(localModel); }
  d.syncScopeRowsToModel();
  d.computeAndRender();
  if (window.sessionStorage) sessionStorage.setItem(d.COOKIE_KEY, JSON.stringify(localModel));
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
            .then(t => loadFromPresetCsv(t))
            .catch(err => alert('Failed to load preset CSV: ' + err.message));
        }
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
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const url = new URL(window.location.href);
      const wasRedirected = url.searchParams.get('redirected') === '1';

      const hydrated = (typeof d.hydrateFromSession === 'function') ? d.hydrateFromSession() : false;

      if (!hydrated && !wasRedirected) {
        fetch('Project_Files/default_progress_all.prgs')
          .then(r => r.text())
          .then(t => loadFromPresetCsv(t))
          .catch(err => console.error('Failed to auto-load default CSV:', err));
      }

      if (wasRedirected) {
        url.searchParams.delete('redirected');
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
