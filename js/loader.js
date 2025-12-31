/*
  Project Loader modal injector + event wiring.
  Revised:
  - Modal closes BEFORE triggering Open File dialog (guaranteed cleanup)
  - Adds body class to disable Beta badge while modal is open
*/

function track(eventName, payload){
  try{ console.log('[analytics]', eventName, payload || {}); }catch(e){}
}

let _open = false;

export function openProjectLoader(){
  if (_open) return;
  _open = true;

  fetch('loader.html', { cache:'no-store' }).then(r=>r.text()).then(html=>{
    const host = document.createElement('div');
    host.id = 'rp-loader-host';
    host.innerHTML = html;
    document.body.appendChild(host);

    document.body.classList.add('rp-loader-open');

    const tileJsonEl = host.querySelector('#rp-loader-tiles');
    let tiles = [];
    try{
      tiles = JSON.parse(tileJsonEl ? tileJsonEl.textContent : '[]') || [];
    }catch(e){}

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

    modal.appendChild(close);
    modal.appendChild(header);

    const primaryGrid = document.createElement('div');
    primaryGrid.className = 'rp-grid rp-grid-primary';
    tiles.slice(0,2).forEach(t => primaryGrid.appendChild(buildTile(t)));
    modal.appendChild(primaryGrid);

    const sec = document.createElement('div');
    sec.className = 'rp-section';
    sec.innerHTML = '<h3 class="rp-templates-title"><img src="icon.png" class="rp-title-icon">TEMPLATES<img src="icon.png" class="rp-title-icon"></h3><small>(draft examples to get started)</small>';
    modal.appendChild(sec);

    const templateGrid = document.createElement('div');
    templateGrid.className = 'rp-grid';
    tiles.slice(2).forEach(t => templateGrid.appendChild(buildTile(t)));
    modal.appendChild(templateGrid);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function cleanup(){
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      host.remove();
      document.body.classList.remove('rp-loader-open');
      _open = false;
    }

    function onKey(e){ if(e.key === 'Escape') cleanup(); }

    close.addEventListener('click', cleanup);
    overlay.addEventListener('click', e => { if(e.target === overlay) cleanup(); });
    document.addEventListener('keydown', onKey);

    function buildTile(tile){
      const wrap = document.createElement('div');
      wrap.className = 'rp-tile';
      wrap.innerHTML = `<div class="rp-tile-box"><img src="${tile.imagePath}" alt="${tile.title}"></div>
                        <div class="rp-tile-title">${tile.title}</div>`;

      wrap.addEventListener('click', ()=>{
        track('tile_clicked', { id: tile.id });

        if(tile.action === 'openFile'){
          cleanup(); // close FIRST, then open dialog

          requestAnimationFrame(() => {
            const openItem = document.querySelector('#loadDropdown [data-act="open"]');
            if (openItem) {
              openItem.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window }));
            }
          });
          return;
        }

        if (tile.url) {
          window.location.href = tile.url;
        }
      });
      return wrap;
    }
  }).catch(()=>{ _open = false; });
}