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


