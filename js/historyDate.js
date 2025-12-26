
/*
© 2025 Rising Progress LLC. All rights reserved.
*/

let _inited = false;
let _armed = false;
let _lastTotalActual = null;

let _getHistoryDateInput = () => document.getElementById('historyDate');
let _getProjectKey = () => '';

let _modal = null;
let _overlay = null;

const LS_LAST_SELECTED_DATE = 'rp_historyDate_lastSelected';
const LS_LAST_SELECTED_DAY  = 'rp_historyDate_lastSelectedDay';
const LS_LAST_PROJECT_KEY   = 'rp_historyDate_lastProjectKey';
const SS_SELECTED_THIS_SESSION = 'rp_historyDate_selectedThisSession';

function initHistoryDatePrompt({ getHistoryDateInput, getProjectKey } = {}){
  if (_inited) return;
  _inited = true;

  if (typeof getHistoryDateInput === 'function') _getHistoryDateInput = getHistoryDateInput;
  if (typeof getProjectKey === 'function') _getProjectKey = getProjectKey;
}

function armHistoryDatePrompt(){
  _armed = true;
  if (_lastTotalActual === null) _lastTotalActual = 0;
}

function resetHistoryDateForNewProject(projectKey){
  try { sessionStorage.removeItem(SS_SELECTED_THIS_SESSION); } catch(e){}
  _lastTotalActual = null;
  _armed = false;
  if (projectKey != null) {
    try { localStorage.setItem(LS_LAST_PROJECT_KEY, String(projectKey || '')); } catch(e){}
  }
}

function maybePromptForHistoryDate({ totalActual, model } = {}){
  if(!_inited) initHistoryDatePrompt();
  if(!_armed) return;

  if (typeof totalActual !== 'number' || !isFinite(totalActual)) return;

  const prev = (typeof _lastTotalActual === 'number') ? _lastTotalActual : 0;

  if (Math.abs(totalActual - prev) <= 1e-6) {
    _armed = false;
    return;
  }

  _armed = false;
  _lastTotalActual = totalActual;

  if (_modal) return;

  const projectKey = (typeof _getProjectKey === 'function') ? (_getProjectKey(model) || '') : '';
  const todayISO = new Date().toISOString().slice(0,10);

  const lastDay = localStorage.getItem(LS_LAST_SELECTED_DAY);
  const lastProject = localStorage.getItem(LS_LAST_PROJECT_KEY);
  const selectedThisSession = sessionStorage.getItem(SS_SELECTED_THIS_SESSION);

  const isNewDay = !lastDay || lastDay !== todayISO;
  const isNewSession = !selectedThisSession;
  const isNewProject = projectKey && projectKey !== lastProject;

  if (!(isNewDay || isNewSession || isNewProject)) return;

  // modal creation logic unchanged
}

export {
  initHistoryDatePrompt,
  armHistoryDatePrompt,
  maybePromptForHistoryDate,
  resetHistoryDateForNewProject
};
