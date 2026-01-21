
/*
© 2025 Rising Progress LLC. All rights reserved.
*/

// issues.js
// Clipboard-safe bullet formatting for email clients

(function(){
  let lastIssuesText = [];

  function ensureOverlay(){
    let overlay = document.getElementById('issuesOverlay');
    if(!overlay) return null;
    if (!overlay.dataset.bound) {
      overlay.querySelector('#issuesCopyBtn')
        ?.addEventListener('click', copyIssuesToClipboard);
      overlay.dataset.bound = '1';
    }
    return overlay;
  }

  function copyIssuesToClipboard(){
    const overlay = ensureOverlay();
    if (!overlay) return;

    const listEl = overlay.querySelector('#issuesList');
    const title = overlay.querySelector('#issuesTitle')?.textContent || 'Issues';

    // Capture rendered issues text
    lastIssuesText = [];
    listEl.querySelectorAll('li').forEach(li => {
      lastIssuesText.push({
        text: li.textContent.trim(),
        bold: li.style.fontWeight === '700' || li.tagName === 'STRONG'
      });
    });

    // HTML (semantic list)
    let html = `<div><div style="font-weight:700;margin-bottom:6px;">${title}</div>`;
    html += `<ul style="margin-left:20px; padding-left:20px;">`;
    lastIssuesText.forEach(i => {
      html += i.bold
        ? `<li><strong>${i.text}</strong></li>`
        : `<li>${i.text}</li>`;
    });
    html += `</ul></div>`;

    // Plain text fallback
    const plain = lastIssuesText
      .map(i => `• ${i.text}`)
      .join('\n');

    navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type:'text/html' }),
        'text/plain': new Blob([plain], { type:'text/plain' })
      })
    ]);
  }

  window.copyIssuesToClipboard = copyIssuesToClipboard;
})();
