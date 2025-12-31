/*
  Project Loader modal injector + event wiring.
  FINAL FIX:
  - Modal is CLOSED synchronously before opening file dialog
  - File dialog is triggered by clicking the real <input type="file">
  - Beta badge disabled while loader is open
*/

let _open = false;

export function openProjectLoader(){
  if (_open) return;
  _open = true;

  fetch('loader.html', { cache:'no-store' })
    .then(r => r.text())
    .then(html => {
      const host = document.createElement('div');
      host.id = 'rp-loader-host';
      host.innerHTML = html;
      document.body.appendChild(host);
      document.body.classList.add('rp-loader-open');

      const tiles = JSON.parse(
        host.querySelector('#rp-loader-tiles')?.textContent || '[]'
      );

      const overlay = document.createElement('div');
      overlay.className = 'rp-loader-overlay';

      const modal = document.createElement('div');
      modal.className = 'rp-loader-modal';

      const close = document.createElement('div');
      close.className = 'rp-close';
      close.textContent = '×';

      const header = document.createElement('div');
      header.className = 'rp-loader-header';
      header.innerHTML = '<div class="rp-loader-brand"><img src="risingprogress.png" alt="Rising Progress"></div>';

      modal.append(close, header);

      const primaryGrid = document.createElement('div');
      primaryGrid.className = 'rp-grid rp-grid-primary';
      tiles.slice(0,2).forEach(t => primaryGrid.appendChild(buildTile(t)));
      modal.appendChild(primaryGrid);

      const sec = document.createElement('div');
      sec.className = 'rp-section';
      sec.innerHTML =
        '<h3><img src="icon.png" class="rp-title-icon">TEMPLATES<img src="icon.png" class="rp-title-icon"></h3>' +
        '<small>(draft examples to get started)</small>';
      modal.appendChild(sec);

      const templateGrid = document.createElement('div');
      templateGrid.className = 'rp-grid';
      tiles.slice(2).forEach(t => templateGrid.appendChild(buildTile(t)));
      modal.appendChild(templateGrid);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      function cleanup(){
        overlay.remove();
        host.remove();
        document.body.classList.remove('rp-loader-open');
        _open = false;
      }

      close.onclick = cleanup;
      overlay.onclick = e => { if (e.target === overlay) cleanup(); };
      document.addEventListener('keydown', e => e.key === 'Escape' && cleanup(), { once:true });

      function buildTile(tile){
        const el = document.createElement('div');
        el.className = 'rp-tile';
        el.innerHTML = `
          <div class="rp-tile-box"><img src="${tile.imagePath}"></div>
          <div class="rp-tile-title">${tile.title}</div>
        `;

        el.onclick = () => {
          if (tile.action === 'openFile') {
            // CLOSE FIRST
            cleanup();

            // Click the real file input directly
            const input = document.querySelector('input[type="file"]');
            if (input) {
              input.click();
            }
            return;
          }

          if (tile.url) {
            window.location.href = tile.url;
          }
        };

        return el;
      }
    })
    .catch(() => { _open = false; });
}