/*
© 2025 Rising Progress LLC. All rights reserved.
*/

// History Date Prompt module
// - Creates a small modal prompting for the historyDate context
// - Only triggers when "armed" by an explicit Progress-column edit AND totalActual changes
// - Suppresses repeat prompts per-session/per-day/per-project only after a date is selected
// - Does NOT write history entries and does not modify existing history logic

let _inited = false;
let _armed = false;
let _lastTotalActual = null;

let _getHistoryDateInput = () => document.getElementById('historyDate');
let _getProjectKey = () => '';

let _modal = null;
let _overlay = null;
let _currentProjectKey = '';

const LS_LAST_SELECTED_DATE = 'rp_historyDate_lastSelected';
const LS_LAST_SELECTED_DAY  = 'rp_historyDate_lastSelectedDay';
const LS_LAST_PROJECT_KEY   = 'rp_historyDate_lastProjectKey';
const LS_ACTIVE_PROJECT_KEY = 'rp_historyDate_activeProjectKey';
const LS_LAST_PROMPT_TS      = 'rp_historyDate_lastPromptTs';
const SS_SELECTED_THIS_SESSION = 'rp_historyDate_selectedThisSession';

function _fmtMMDDYYYY(d){
  try {
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const yy = String(d.getFullYear());
    return `${mm}/${dd}/${yy}`;
  } catch (e) {
    return '';
  }
}

function _fmtISO(d){
  try { return d.toISOString().slice(0,10); } catch(e){ return ''; }
}


function _isEightHoursPassed(){
  const ts = _safeLocalStorageGet(LS_LAST_PROMPT_TS);
  if(!ts) return true;
  const diff = Date.now() - Number(ts);
  return diff >= (8 * 60 * 60 * 1000);
}

function _deriveProjectKey(model){
  // Primary: injected getter
  let k = '';
  try {
    k = (typeof _getProjectKey === 'function') ? (_getProjectKey(model) || '') : '';
  } catch(e){ k = ''; }

  // Fallbacks: common model fields (no refactor; defensive only)
  if (!k && model) {
    try { k = model.projectKey || k; } catch(e){}
    try { k = model.projectName || k; } catch(e){}
    try { k = model.name || k; } catch(e){}
    try { k = model.title || k; } catch(e){}
  }

  // Normalize unnamed projects to a stable sentinel to allow suppression
  if (!k) k = '__NO_PROJECT__';
  return String(k);
}

function _todayISO(){
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return _fmtISO(d);
}

function _yesterdayISO(){
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - 1);
  return _fmtISO(d);
}

function _safeLocalStorageGet(k){
  try { return window.localStorage ? localStorage.getItem(k) : null; } catch(e){ return null; }
}
function _safeLocalStorageSet(k,v){
  try { if(window.localStorage) localStorage.setItem(k, v); } catch(e){}
}
function _safeSessionStorageGet(k){
  try { return window.sessionStorage ? sessionStorage.getItem(k) : null; } catch(e){ return null; }
}
function _safeSessionStorageSet(k,v){
  try { if(window.sessionStorage) sessionStorage.setItem(k, v); } catch(e){}
}

function initHistoryDatePrompt({ getHistoryDateInput, getProjectKey } = {}){
  if (_inited) return;
  _inited = true;

  if (typeof getHistoryDateInput === 'function') _getHistoryDateInput = getHistoryDateInput;
  if (typeof getProjectKey === 'function') _getProjectKey = getProjectKey;

  // If a modal is open, ESC closes it
  document.addEventListener('keydown', (e)=>{
    if(!_modal) return;
    if(e.key === 'Escape'){
      e.preventDefault();
      _closeModal({ setDate: false });
    }
  }, true);
}

function armHistoryDatePrompt(){
  _armed = true;

  // Prime baseline so first non-zero user edit can trigger
  if (_lastTotalActual === null) {
    _lastTotalActual = 0;
  }
}

/**
 * Called after totalActual has been computed/rendered.
 * Triggers only if armed and totalActual changed, and suppression rules allow it.
 */
function maybePromptForHistoryDate({ totalActual, model } = {}){
  if(!_inited) initHistoryDatePrompt();
  if(!_armed) return;

  if (typeof totalActual !== 'number' || !isFinite(totalActual)) return;

  const prev = (typeof _lastTotalActual === 'number') ? _lastTotalActual : 0;

  // Must be a real aggregate change
  if (Math.abs(totalActual - prev) <= 1e-6) {
    _armed = false;
    return;
  }

  // Only prompt on first change that produces NON-ZERO aggregate
  if (prev <= 0 && totalActual <= 0) {
    _lastTotalActual = totalActual;
    _armed = false;
    return;
  }

  // consume arm after confirming real, non-zero change
  _armed = false;
  _lastTotalActual = totalActual;

  // Avoid duplicate instances
  if (_modal) return;

    const projectKey = _deriveProjectKey(model);
  const todayISO = _todayISO();

  // Detect new project identity via stable project key (latched)
  const activeProjectKey = _safeLocalStorageGet(LS_ACTIVE_PROJECT_KEY);
  const isNewProjectIdentity = projectKey !== activeProjectKey;

  if (isNewProjectIdentity) {
    // New project identity detected (including unnamed -> named)
    try { sessionStorage.removeItem(SS_SELECTED_THIS_SESSION); } catch(e){}
    try { localStorage.removeItem(LS_LAST_SELECTED_DAY); } catch(e){}
    try { localStorage.removeItem(LS_LAST_PROMPT_TS); } catch(e){}
    _safeLocalStorageSet(LS_ACTIVE_PROJECT_KEY, projectKey);
  }

  const lastDay = _safeLocalStorageGet(LS_LAST_SELECTED_DAY);
  const lastProject = _safeLocalStorageGet(LS_LAST_PROJECT_KEY);
  const selectedThisSession = _safeSessionStorageGet(SS_SELECTED_THIS_SESSION);

  const isNewDay = !lastDay || lastDay !== todayISO;
  const isNewSession = !selectedThisSession; // key is written only after selection
  const isNewProject = (projectKey && lastProject && projectKey !== lastProject) || (!!projectKey && !lastProject);
  const eightHoursPassed = _isEightHoursPassed();

  // If project changed, clear session-level suppression
  if (isNewProject) {
    try { sessionStorage.removeItem(SS_SELECTED_THIS_SESSION); } catch(e){}
  }

  // Show only when change occurred AND (new day OR new session OR new project OR 8h elapsed)
  if (!(isNewDay || isNewSession || isNewProject || eightHoursPassed)) return;

  _openModal({ model, projectKey, todayISO });
}

function _ensureStyles(){
  if (document.getElementById('rpHistoryDateStyles')) return;

  const style = document.createElement('style');
  style.id = 'rpHistoryDateStyles';
  style.textContent = `
/* HistoryDate modal (clean + minimal, matches site palette) */
.rp-hd-overlay{
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.50); /* 50% dim */
  z-index: 9998;
}
.rp-hd-modal{
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(520px, calc(100vw - 32px));
  background: #ffffff;
  color: #0f172a;
  border: 1px solid rgba(100,116,139,0.35);
  border-radius: 14px;
  z-index: 9999;
  box-shadow: 0 10px 30px rgba(2,6,23,0.18); /* light, not aggressive */
  font-family: inherit;
}
.rp-hd-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  padding: 14px 16px 6px 16px;
}
.rp-hd-title{
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}
.rp-hd-x{
  appearance: none;
  border: none;
  background: transparent;
  color: rgba(15,23,42,0.75);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 8px;
}
.rp-hd-x:hover{
  background: rgba(100,116,139,0.10);
}
.rp-hd-body{
  padding: 0 16px 14px 16px;
}
.rp-hd-instructions{
  font-size: 14px;
  margin: 6px 0 12px 0;
}
.rp-hd-options{
  display:flex;
  flex-direction:column;
  gap: 10px;
  margin: 6px 0 14px 0;
}
.rp-hd-option{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap: 10px;
}
.rp-hd-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap: 8px;
  min-width: 130px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(37,99,235,0.35);
  background: rgba(37,99,235,0.06);
  color: #0f172a;
  font-weight: 700;
  cursor: pointer;
}
.rp-hd-btn:hover{
  background: rgba(37,99,235,0.10);
}
.rp-hd-right{
  flex: 1;
  display:flex;
  align-items:center;
  justify-content:flex-start;
  gap: 10px;
  font-size: 14px;
  color: rgba(15,23,42,0.8);
}
.rp-hd-pill{
  display:inline-flex;
  align-items:center;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(100,116,139,0.35);
  background: rgba(100,116,139,0.06);
}
.rp-hd-date{
  font-variant-numeric: tabular-nums;
}
.rp-hd-date-input{
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(100,116,139,0.35);
  background: #fff;
  color: #0f172a;
  font-size: 14px;
}
.rp-hd-foot{
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(100,116,139,0.25);
  font-size: 13px;
  color: rgba(15,23,42,0.78);
}
`;
  document.head.appendChild(style);
}

function _getLastUsedDateISO(){
  // Prefer current input value, else stored last selected
  const hd = _getHistoryDateInput();
  if (hd && hd.value) return String(hd.value);
  const stored = _safeLocalStorageGet(LS_LAST_SELECTED_DATE);
  return stored ? String(stored) : '';
}

function _openModal({ model, projectKey, todayISO } = {}){
  _ensureStyles();
  _currentProjectKey = String(projectKey || '');

  // Overlay (click ignored)
  _overlay = document.createElement('div');
  _overlay.className = 'rp-hd-overlay';
  _overlay.addEventListener('click', (e)=>{
    // Ignore clicks outside modal
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // Modal
  _modal = document.createElement('div');
  _modal.className = 'rp-hd-modal';
  _modal.setAttribute('role', 'dialog');
  _modal.setAttribute('aria-modal', 'true');

  const titleText = 'On what date should the progress updates be stored?';

  const lastUsedISO = _getLastUsedDateISO();
  const defaultISO = lastUsedISO || todayISO;
  const defaultIsToday = defaultISO === todayISO;
  const defaultIsYest = defaultISO === _yesterdayISO();

  const todayD = new Date(todayISO + 'T00:00:00');
  const yestISO = _yesterdayISO();
  const yestD = new Date(yestISO + 'T00:00:00');

  _modal.innerHTML = `
    <div class="rp-hd-head">
      <div>
        <div class="rp-hd-title">${titleText}</div>
      </div>
      <button type="button" class="rp-hd-x" aria-label="Close">✕</button>
    </div>
    <div class="rp-hd-body">
      <div class="rp-hd-options">
        <div class="rp-hd-option">
          <button type="button" class="rp-hd-btn" data-opt="today">Today</button>
          <div class="rp-hd-right">
            <span class="rp-hd-date"><span class="rp-hd-date-val">${_fmtMMDDYYYY(todayD)}</span></span>
          </div>
        </div>
        <div class="rp-hd-option">
          <button type="button" class="rp-hd-btn" data-opt="yesterday">Yesterday</button>
          <div class="rp-hd-right">
            <span class="rp-hd-date"><span class="rp-hd-date-val">${_fmtMMDDYYYY(yestD)}</span></span>
          </div>
        </div>
        <div class="rp-hd-option">
          <button type="button" class="rp-hd-btn" data-opt="custom">Custom</button>
          <div class="rp-hd-right">
            
            <input class="rp-hd-date-input" type="date" id="rpHistoryDatePicker" value="${defaultISO}">
          </div>
        </div>
      </div>
      <div class="rp-hd-foot">Click the green button for <strong style="color:#16a34a;">Add to History</strong> once updates for this date are complete.</div>
    </div>
  `;

  // Close controls
  const xBtn = _modal.querySelector('.rp-hd-x');
  if (xBtn) xBtn.addEventListener('click', ()=>_closeModal({ setDate: false }));

  // Set default focus to the "correct" option based on last used date
  const btnToday = _modal.querySelector('[data-opt="today"]');
  const btnYest  = _modal.querySelector('[data-opt="yesterday"]');
  const btnCustom= _modal.querySelector('[data-opt="custom"]');
  const picker   = _modal.querySelector('#rpHistoryDatePicker');

  // Button actions
  if (btnToday) btnToday.addEventListener('click', ()=>_selectDate(_todayISO(), { projectKey, dayISO: todayISO }));
  if (btnYest)  btnYest.addEventListener('click', ()=>_selectDate(_yesterdayISO(), { projectKey, dayISO: todayISO }));
  if (btnCustom) btnCustom.addEventListener('click', ()=>{
    const v = (picker && picker.value) ? String(picker.value) : '';
    const iso = v || defaultISO || todayISO;
    _selectDate(iso, { projectKey, dayISO: todayISO });
  });

  // Highlight-ish default: focus the most relevant button
  try {
    if (defaultIsToday && btnToday) btnToday.focus();
    else if (defaultIsYest && btnYest) btnYest.focus();
    else if (btnCustom) btnCustom.focus();
  } catch(e){}

  _safeLocalStorageSet(LS_LAST_PROMPT_TS, String(Date.now()));

  document.body.appendChild(_overlay);
  document.body.appendChild(_modal);
}

function _selectDate(isoDate, { projectKey, dayISO } = {}){
  const hd = _getHistoryDateInput();
  if (hd) {
    try {
      hd.value = isoDate;
      // Let existing listeners mark manual + react if needed
      hd.dispatchEvent(new Event('input', { bubbles: true }));
      hd.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e){}
  }

  // Persist selection for default + suppression scopes
  const todayISO = dayISO || _todayISO();
  if (isoDate) _safeLocalStorageSet(LS_LAST_SELECTED_DATE, String(isoDate));
  _safeLocalStorageSet(LS_LAST_SELECTED_DAY, String(todayISO));
  if (projectKey != null) _safeLocalStorageSet(LS_LAST_PROJECT_KEY, String(projectKey || ''));

  _safeSessionStorageSet(SS_SELECTED_THIS_SESSION, '1');
  if (projectKey) _safeLocalStorageSet(LS_ACTIVE_PROJECT_KEY, String(projectKey));

  _closeModal({ setDate: true });
}

function _closeModal({ setDate } = {}){
  // Treat explicit dismissal (X / ESC) as a suppression for this session and 8-hour window.
  // Suppression is cleared when a new project identity is detected.
  if (setDate === false) {
    const todayISO = _todayISO();
    _safeSessionStorageSet(SS_SELECTED_THIS_SESSION, '1');
    _safeLocalStorageSet(LS_LAST_SELECTED_DAY, String(todayISO));
    _safeLocalStorageSet(LS_LAST_PROMPT_TS, String(Date.now()));

    // Latch dismissal to the current project identity so the next edit doesn't look "new"
    if (_currentProjectKey) {
      _safeLocalStorageSet(LS_LAST_PROJECT_KEY, String(_currentProjectKey));
      _safeLocalStorageSet(LS_ACTIVE_PROJECT_KEY, String(_currentProjectKey));
    }
  }

  try {
    if (_modal && _modal.parentNode) _modal.parentNode.removeChild(_modal);
  } catch(e){}
  try {
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
  } catch(e){}

  _modal = null;
  _overlay = null;
}


// Optional safe getter for current chosen history date
function getSelectedHistoryDate(){
  const hd = _getHistoryDateInput();
  if (hd && hd.value) return String(hd.value);
  const stored = _safeLocalStorageGet(LS_LAST_SELECTED_DATE);
  return stored ? String(stored) : '';
}

export {
  initHistoryDatePrompt,
  armHistoryDatePrompt,
  maybePromptForHistoryDate,
  getSelectedHistoryDate
};