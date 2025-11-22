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


function saveXml(){
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

