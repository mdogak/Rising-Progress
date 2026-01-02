/*
  sections.js — explicit section headers (no indent/unindent)

  Rules implemented:
  - Sections are defined by explicit header boundaries (rendered, not stored in model.scopes).
  - "+>" on a scope row adds a section header directly above that row unless one already exists there.
  - All rows below a section header belong to that section until the next section header.
  - Rows above the first section have blank sectionName (no section).
  - Removing a section merges its rows upward into the section above; if none, rows become unsectioned (blank sectionName).
  - Section headers are draggable; dragging moves the whole section block (header + its rows).
*/

(function(){
  'use strict';

  const SECTION_BG = '#dbeafe'; // light blue aligned with site palette
  const DEFAULT_PREFIX = 'Section #';

  function clamp(n, a, b){ n = Number(n)||0; return Math.max(a, Math.min(b, n)); }

  function escapeHtml(str){
    return String(str ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function fmtMMDDYYYY(dateObj){
    if(!dateObj || isNaN(dateObj.getTime())) return '';
    const mm = String(dateObj.getMonth()+1).padStart(2,'0');
    const dd = String(dateObj.getDate()).padStart(2,'0');
    const yy = String(dateObj.getFullYear());
    return `${mm}/${dd}/${yy}`;
  }

  function ensureSectionNameField(model){
    model.project = (model.project && typeof model.project === 'object') ? model.project : {};
    model.scopes = (model.scopes || []).map(s => {
      if(!s || typeof s !== 'object') return s;
      let out = s;
      if(!('sectionName' in out)) out = { ...out, sectionName: '' };
      // sectionID is internal-only, persisted on scopes, used to keep section identity stable across renames.
      if(!('sectionID' in out)) out = { ...out, sectionID: '' };
      return out;
    });

    // After load (never during parsing), backfill missing sectionIDs once per unique sectionName.
    // This is idempotent and safe to call on every render.
    ensureSectionIds(model);
  }

  function __rpGetSectionIdRegistry(model){
    model.project = (model.project && typeof model.project === 'object') ? model.project : {};
    if(!model.project.__sectionIdRegistry || typeof model.project.__sectionIdRegistry !== 'object'){
      model.project.__sectionIdRegistry = { used:{} };
    }
    if(!model.project.__sectionIdRegistry.used || typeof model.project.__sectionIdRegistry.used !== 'object'){
      model.project.__sectionIdRegistry.used = {};
    }
    return model.project.__sectionIdRegistry;
  }

  function __rpRandomHex(byteLen){
    try{
      const buf = new Uint8Array(byteLen);
      (crypto && crypto.getRandomValues) ? crypto.getRandomValues(buf) : buf.fill(0);
      return Array.from(buf).map(b=>b.toString(16).padStart(2,'0')).join('');
    }catch(_){
      // Fallback: timestamp + Math.random; still de-duped via registry.
      return (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(0, byteLen*2).padEnd(byteLen*2,'0');
    }
  }

  function __rpMakeSectionId(model){
    const reg = __rpGetSectionIdRegistry(model);
    // Short, internal ID: sec_<6 hex>
    // Guarantee uniqueness within the project via registry; never reuse.
    for(let tries=0; tries<50; tries++){
      const id = 'sec_' + __rpRandomHex(3); // 6 hex chars
      if(!reg.used[id]){
        reg.used[id] = true;
        return id;
      }
    }
    // Extremely unlikely fallback; widen entropy
    const id = 'sec_' + __rpRandomHex(6);
    reg.used[id] = true;
    return id;
  }

  function ensureSectionIds(model){
    // Ensure all existing IDs are registered, then backfill missing IDs by sectionName.
    if(!model || !Array.isArray(model.scopes)) return;
    model.project = (model.project && typeof model.project === 'object') ? model.project : {};
    const reg = __rpGetSectionIdRegistry(model);

    const nameToId = Object.create(null);

    // First pass: register any existing IDs and choose the canonical ID per sectionName
    for(const s of model.scopes){
      if(!s || typeof s !== 'object') continue;
      const name = String(s.sectionName || '');
      const sid = String(s.sectionID || '');
      if(sid){
        reg.used[sid] = true;
        if(name && !nameToId[name]) nameToId[name] = sid;
      }
    }

    // Second pass: assign missing IDs and normalize any mismatches within a sectionName
    for(const s of model.scopes){
      if(!s || typeof s !== 'object') continue;
      const name = String(s.sectionName || '');
      if(!name){
        // Unsectioned rows must not carry a stale sectionID.
        if(s.sectionID) s.sectionID = '';
        continue;
      }
      const canonical = nameToId[name] || (nameToId[name] = __rpMakeSectionId(model));
      if(String(s.sectionID || '') !== canonical){
        s.sectionID = canonical;
      }
    }
  }


  // Build contiguous nonblank section segments from model.scopes[].sectionName
  // Blank sectionName means "no section" (only expected before first section, but supported anywhere).
  function buildSections(model){
    ensureSectionNameField(model);
    const secs = [];
    let i = 0;
    while(i < model.scopes.length){
      const name = String(model.scopes[i]?.sectionName || '');
      if(!name){ i++; continue; }
      const start = i;
      let end = i;
      while(end+1 < model.scopes.length){
        const n2 = String(model.scopes[end+1]?.sectionName || '');
        if(n2 !== name) break;
        end++;
      }
      const sectionID = String(model.scopes[start]?.sectionID || '');
      secs.push({ name, sectionID, start, end });
      i = end + 1;
    }
    return secs;
  }

  function hasHeaderAtIndex(model, index){
    // A header is rendered above the first row of each contiguous nonblank segment.
    const s = model.scopes[index];
    if(!s) return false;
    const name = String(s.sectionName || '');
    if(!name) return false;
    if(index === 0) return true;
    const prev = String(model.scopes[index-1]?.sectionName || '');
    return prev !== name;
  }

  function nextSectionNumber(model){
    const secs = buildSections(model);
    let maxN = 0;
    secs.forEach(g => {
      const m = String(g.name).match(/^Section\s+#(\d+)\s*$/i);
      if(m){
        const n = parseInt(m[1], 10);
        if(n > maxN) maxN = n;
      }
    });
    return maxN + 1;
  }

  function getSegmentAt(model, index){
    ensureSectionNameField(model);
    if(index < 0 || index >= model.scopes.length) return null;
    const name = String(model.scopes[index]?.sectionName || '');
    // If blank, find blank run
    let start = index, end = index;
    while(start-1 >= 0 && String(model.scopes[start-1]?.sectionName || '') === name) start--;
    while(end+1 < model.scopes.length && String(model.scopes[end+1]?.sectionName || '') === name) end++;
    return { name, start, end };
  }

  function addSection(model, index){
    ensureSectionNameField(model);
    if(index < 0 || index >= model.scopes.length) return false;
    if(hasHeaderAtIndex(model, index)) return false; // do nothing per requirement

    const seg = getSegmentAt(model, index);
    const newName = `${DEFAULT_PREFIX}${nextSectionNumber(model)}`;

    // Assign from index to seg.end (splits any existing section or blank segment)
    const newId = __rpMakeSectionId(model);
    for(let i=index;i<=seg.end;i++){
      model.scopes[i].sectionName = newName;
      model.scopes[i].sectionID = newId;
    }
    return true;
  }

  function removeSection(model, sectionStartIndex){
    ensureSectionNameField(model);
    const seg = getSegmentAt(model, sectionStartIndex);
    if(!seg || !seg.name) return false;

    // Find previous nonblank section above this segment
    let prevName = '';
    let prevId = '';
    for(let i=seg.start-1;i>=0;i--){
      const n = String(model.scopes[i]?.sectionName || '');
      if(n){
        prevName = n;
        prevId = String(model.scopes[i]?.sectionID || '');
        break;
      }
    }
    for(let i=seg.start;i<=seg.end;i++){
      model.scopes[i].sectionName = prevName; // '' if none
      model.scopes[i].sectionID = prevName ? (prevId || __rpMakeSectionId(model)) : '';
    }
    return true;
  }

  function moveRow(model, index, dir){
    ensureSectionNameField(model);
    const n = model.scopes.length;
    const newIndex = index + dir;
    if(newIndex < 0 || newIndex >= n) return false;

    const row = model.scopes.splice(index, 1)[0];
    model.scopes.splice(newIndex, 0, row);

    // Adopt destination section membership (join destination section; leave original)
    const above = newIndex-1 >= 0 ? String(model.scopes[newIndex-1]?.sectionName || '') : '';
    const below = newIndex+1 < model.scopes.length ? String(model.scopes[newIndex+1]?.sectionName || '') : '';
    const aboveId = newIndex-1 >= 0 ? String(model.scopes[newIndex-1]?.sectionID || '') : '';
    const belowId = newIndex+1 < model.scopes.length ? String(model.scopes[newIndex+1]?.sectionID || '') : '';
    row.sectionName = above || below || '';
    row.sectionID = row.sectionName ? (aboveId || belowId || __rpMakeSectionId(model)) : '';

    return true;
  }

  function calcSectionDateRange(model, startIndex, endIndex, parseDate){
    let minS = null;
    let maxE = null;
    for(let i=startIndex;i<=endIndex;i++){
      const s = model.scopes[i] || {};
      if(s.start){
        const d = parseDate(s.start);
        if(d && !isNaN(d.getTime())){ if(!minS || d < minS) minS = d; }
      }
      if(s.end){
        const d = parseDate(s.end);
        if(d && !isNaN(d.getTime())){ if(!maxE || d > maxE) maxE = d; }
      }
    }
    return { start:minS, end:maxE };
  }

  function calcSectionWeightSum(startIndex, endIndex, calcScopeWeightings){
    const w = (typeof calcScopeWeightings === 'function') ? calcScopeWeightings() : [];
    let wSum = 0;
    for(let i=startIndex;i<=endIndex;i++) wSum += (Number(w[i]) || 0);
    return wSum;
  }

  function calcSectionActualPct(model, startIndex, endIndex, calcScopeWeightings){
    const w = (typeof calcScopeWeightings === 'function') ? calcScopeWeightings() : [];
    let wSum = 0, acc = 0;
    for(let i=startIndex;i<=endIndex;i++){
      const wi = Number(w[i]) || 0;
      wSum += wi;
      const pct = Number(model.scopes[i]?.actualPct || 0) || 0;
      acc += wi * pct;
    }
    if(wSum <= 0) return 0;
    return clamp(acc / wSum, 0, 100);
  }

  function calcSectionPlannedPct(model, startIndex, endIndex, calcScopeWeightings, calcScopePlannedPctToDate){
    const w = (typeof calcScopeWeightings === 'function') ? calcScopeWeightings() : [];
    const plannedFn = (typeof calcScopePlannedPctToDate === 'function') ? calcScopePlannedPctToDate : (()=>0);
    let wSum = 0, acc = 0;
    for(let i=startIndex;i<=endIndex;i++){
      const wi = Number(w[i]) || 0;
      wSum += wi;
      const planned = Number(plannedFn(model.scopes[i] || {})) || 0;
      acc += planned * wi;
    }
    if(wSum <= 0) return 0;
    return clamp(acc / wSum, 0, 100);
  }

  function buildHeaderEl(section, ctx){
    const { model, calcScopeWeightings, calcScopePlannedPctToDate, parseDate } = ctx;
    const el = document.createElement('div');
    el.className = 'section-row';
    el.style.background = SECTION_BG;
    el.dataset.startIndex = String(section.start);
    el.dataset.endIndex = String(section.end);
    el.dataset.name = section.name;
    el.dataset.sectionId = String(section.sectionID || '');
    el.draggable = false;

    const dr = calcSectionDateRange(model, section.start, section.end, parseDate);
    const startStr = fmtMMDDYYYY(dr.start);
    const endStr = fmtMMDDYYYY(dr.end);

    const wSum = calcSectionWeightSum(section.start, section.end, calcScopeWeightings);
    const actualPct = calcSectionActualPct(model, section.start, section.end, calcScopeWeightings);
    const plannedPct = calcSectionPlannedPct(model, section.start, section.end, calcScopeWeightings, calcScopePlannedPctToDate);

    const weightPct = wSum * 100; // weightings are fractions; display as percent points

    // Match the exact 9-cell grid used by scope rows
    el.innerHTML = `
      <div class="section-scope">
        <span class="section-handle" title="Drag section" draggable="true">⋮⋮</span>
        <input class="section-title" value="${escapeHtml(section.name)}" />
      </div>
      <div class="section-date">${escapeHtml(startStr)}</div>
      <div class="section-date">${escapeHtml(endStr)}</div>
      <div class="section-weight">${weightPct.toFixed(1)}%</div>
      <div></div>
      <div class="section-pct">${actualPct.toFixed(1)}%</div>
      <div></div>
      <div class="section-planned">${plannedPct.toFixed(1)}%</div>
      <div class="actions">
        <button class="iconbtn section-remove" title="Remove section">x</button>
      </div>
    `;
    return el;
  }

  function render(container, model, renderScopeRow, ctx){
    ensureSectionNameField(model);

    const sections = buildSections(model);
    const secByStart = new Map(sections.map(s => [s.start, s]));
    container.innerHTML = '';

    for(let i=0;i<model.scopes.length;i++){
      const sec = secByStart.get(i);
      if(sec){
        const header = buildHeaderEl(sec, { ...ctx, model });
        container.appendChild(header);
      }
      const rowEl = renderScopeRow(i);
      rowEl.classList.add('scope-row');
      container.appendChild(rowEl);
    }
  }

  
// Drag/drop logic:
// - Scope rows: freely draggable; moved row adopts nearest header above after drop.
// - Section headers: draggable boundaries only; moving a header does NOT move its rows.
//   After drop, ALL rows re-associate based on the nearest header above.
function attachContainerHandlers(container, model, rerender){
  // Always keep latest references so handlers work after loading a new project
  container._sectionsModel = model;
  container._sectionsRerender = rerender;
  if(container._sectionsHandlersAttached) return;
  container._sectionsHandlersAttached = true;

  const getModel = ()=> container._sectionsModel;
  const getRerender = ()=> container._sectionsRerender;

  let dragState = null; // { type:'row'|'header', fromIndex:number, name?:string, fromStart?:number }

  function clearDragOver(){
    container.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
  }

  function getDropIndexFromEventTarget(target){
    const row = target.closest('.row');
    if(row) return Number(row.dataset.index);
    const header = target.closest('.section-row');
    if(header) return Number(header.dataset.startIndex);
    return getModel().scopes.length; // drop at end
  }

  function nearestHeaderInfoAboveIndex(scopes, idx, model){
    for(let i=idx-1;i>=0;i--){
      const n = String(scopes[i]?.sectionName || '');
      if(n){
        const sid = String(scopes[i]?.sectionID || '');
        return { name:n, sectionID: sid || (model ? __rpMakeSectionId(model) : '') };
      }
    }
    return { name:'', sectionID:'' };
  }

  function buildHeaderBoundariesFromModel(model){
    // boundaries derived from contiguous runs of nonblank sectionName
    const secs = buildSections(model);
    return secs.map(s => ({ name:s.name, sectionID: String(s.sectionID || ''), start:s.start }));
  }

  function reassignAllRowsFromBoundaries(boundaries){
    ensureSectionNameField(model);
    const n = getModel().scopes.length;
    const b = (boundaries || [])
      .map(x => ({
        name: String(x.name || ''),
        sectionID: String(x.sectionID || ''),
        start: Number(x.start)
      }))
      .filter(x => x.name && !isNaN(x.start))
      .sort((a,b)=>a.start-b.start);

    // Drop empty/invalid boundaries and ensure strictly increasing starts
    const cleaned = [];
    for(let i=0;i<b.length;i++){
      const cur = b[i];
      if(cur.start < 0) cur.start = 0;
      if(cur.start >= n) continue; // would have zero rows -> remove immediately
      if(cleaned.length && cur.start === cleaned[cleaned.length-1].start){
        // adjacent headers -> keep the later one (deterministic)
        cleaned[cleaned.length-1] = cur;
        continue;
      }
      cleaned.push(cur);
    }

    // Assign rows (sectionName + sectionID)
    let bi = 0;
    let activeName = '';
    let activeId = '';
    for(let i=0;i<n;i++){
      if(bi < cleaned.length && cleaned[bi].start === i){
        activeName = cleaned[bi].name;
        activeId = cleaned[bi].sectionID || __rpMakeSectionId(getModel());
        cleaned[bi].sectionID = activeId;
        bi++;
      }
      getModel().scopes[i].sectionName = activeName || '';
      getModel().scopes[i].sectionID = activeName ? activeId : '';
    }
  }


  // Section title persistence:
  // - Section headers are derived from model.scopes[].sectionName.
  // - Inline edits must write back to the model (all rows in the segment) so names survive re-renders, moves, and refresh.
  function commitSectionTitle(inputEl){
    try{
      const header = inputEl && inputEl.closest ? inputEl.closest('.section-row') : null;
      if(!header) return;

      const m = getModel();
      if(!m || !Array.isArray(m.scopes)) return;
      ensureSectionNameField(m);

      const start = Number(header.dataset.startIndex);
      const end = Number(header.dataset.endIndex);
      if(isNaN(start) || isNaN(end) || start < 0 || end < start || end >= m.scopes.length) return;

      const oldName = String(header.dataset.name || '');
      const prevName = String(header.dataset.prevName || oldName || '').trim();

      let newName = String(inputEl.value ?? '').trim();

      // If cleared, revert to the previous name (do not allow blank section titles).
      if(!newName) newName = prevName || oldName;

      // Normalize displayed value
      inputEl.value = newName;

      // If no change, just update prevName and exit
      if(newName === oldName){
        header.dataset.prevName = newName;
        return;
      }

      // Persist to model: all rows in this contiguous segment adopt the new name
      // IMPORTANT: preserve existing sectionID (renames must not change identity)
      const keepId = String(header.dataset.sectionId || (m.scopes[start] ? m.scopes[start].sectionID : '') || '');
      const finalId = keepId || __rpMakeSectionId(m);
      header.dataset.sectionId = finalId;
      for(let i=start;i<=end;i++){
        if(m.scopes[i] && typeof m.scopes[i] === 'object'){
          m.scopes[i].sectionName = newName;
          m.scopes[i].sectionID = finalId;
        }
      }

      // Keep header metadata consistent so drag operations use the renamed title
      header.dataset.name = newName;
      header.dataset.prevName = newName;

      const rr = getRerender();
      if(typeof rr === 'function') rr();
    } catch(_){
      // fail silently; no-op
    }
  }

  // Capture previous value on focus so "clear to revert" works
  container.addEventListener('focusin', (e)=>{
    const input = e.target && e.target.closest ? e.target.closest('.section-title') : null;
    if(!input) return;
    const header = input.closest('.section-row');
    if(!header) return;
    header.dataset.prevName = String(header.dataset.name || input.value || '').trim();
  });

  // Commit on blur
  container.addEventListener('focusout', (e)=>{
    const input = e.target && e.target.closest ? e.target.closest('.section-title') : null;
    if(!input) return;
    commitSectionTitle(input);
  });

  // Commit on Enter (blur)
  container.addEventListener('keydown', (e)=>{
    const input = e.target && e.target.closest ? e.target.closest('.section-title') : null;
    if(!input) return;
    if(e.key === 'Enter'){
      e.preventDefault();
      input.blur();
    }
  });


  container.addEventListener('dragstart', (e)=>{
    const rowHandle = e.target.closest('.drag-handle');
    const headerHandle = e.target.closest('.section-handle');

    if(rowHandle){
      const row = rowHandle.closest('.row');
      if(!row) return;
      dragState = { type:'row', fromIndex: Number(row.dataset.index) };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', JSON.stringify(dragState)); } catch(_) {}
      return;
    }

    if(headerHandle){
      const header = headerHandle.closest('.section-row');
      if(!header) return;
      dragState = {
        type:'header',
        name: String(header.dataset.name || ''),
        fromStart: Number(header.dataset.startIndex),
        sectionID: String(header.dataset.sectionId || '')
      };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', JSON.stringify(dragState)); } catch(_) {}
    }
  });

  container.addEventListener('dragover', (e)=>{
    if(!dragState) return;
    const dropTarget = e.target.closest('.row, .section-row');
    if(!dropTarget) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDragOver();
    dropTarget.classList.add('drag-over');
  });

  container.addEventListener('dragleave', (e)=>{
    const el = e.target.closest('.row, .section-row');
    if(el) el.classList.remove('drag-over');
  });

  container.addEventListener('drop', (e)=>{
    if(!dragState) return;
    e.preventDefault();
    clearDragOver();

    const targetIndexRaw = getDropIndexFromEventTarget(e.target);

    if(dragState.type === 'row'){
      const from = Number(dragState.fromIndex);
      if(isNaN(from) || from < 0 || from >= getModel().scopes.length){ dragState = null; return; }

      // Clamp target to current length (after removal we insert before this index)
      let target = Number(targetIndexRaw);
      if(isNaN(target)) target = getModel().scopes.length;

      const moved = getModel().scopes.splice(from, 1)[0];

      // If removing from above the target, target shifts down by 1
      if(from < target) target = target - 1;

      target = Math.max(0, Math.min(target, getModel().scopes.length));
      getModel().scopes.splice(target, 0, moved);

      // Adopt section of nearest header above destination
      const info = nearestHeaderInfoAboveIndex(getModel().scopes, target, getModel());
      moved.sectionName = info.name;
      moved.sectionID = info.name ? info.sectionID : '';

      dragState = null;
      const rr = getRerender(); if(typeof rr === 'function') rr();
      return;
    }

    if(dragState.type === 'header'){
      const name = String(dragState.name || '');
      if(!name){ dragState = null; return; }

      const boundaries = buildHeaderBoundariesFromModel(model);

      // Remove the moving header boundary (by name + fromStart for determinism)
      const fromStart = Number(dragState.fromStart);
      let removed = false;
      const kept = [];
      for(const b of boundaries){
        if(!removed && b.name === name && Number(b.start) === fromStart){
          removed = true;
          continue;
        }
        kept.push(b);
      }

      // Insert at new location (above targetIndexRaw)
      let newStart = Number(targetIndexRaw);
      if(isNaN(newStart)) newStart = getModel().scopes.length;
      newStart = Math.max(0, Math.min(newStart, getModel().scopes.length));

      kept.push({ name, sectionID: String(dragState.sectionID || '' ), start:newStart });

      // Reassign ALL rows by nearest header above
      reassignAllRowsFromBoundaries(kept);

      dragState = null;
      const rr = getRerender(); if(typeof rr === 'function') rr();
    }
  });

  // If drag ends outside drop zone, clean state
  container.addEventListener('dragend', ()=>{
    dragState = null;
    clearDragOver();
  });
}

// Public API
  // Public API
  window.Sections = {
    ensureSectionNameField,
    buildSections,
    hasHeaderAtIndex,
    addSection,
    removeSection,
    moveRow,
    render,
    attachContainerHandlers
  };
})();
