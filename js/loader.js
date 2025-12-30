// © 2025 Rising Progress LLC. All rights reserved.
/*
  Project Loader modal injector + event wiring.
  - No duplicate load logic: "Open File" delegates to the existing [data-act="open"] handler.
  - Template tiles navigate using the existing URL loader (?prgs=...).
  - ESC / click-outside / close icon supported.
  - Analytics hooks are stubs only.
*/

function track(eventName, payload){
  try{ console.log('[analytics]', eventName, payload || {}); }catch(e){}
}

let _open = false;

export function openProjectLoader(){
  if (_open) return;
  _open = true;

  fetch('loader.html', { cache:'no-store' }).then(r=>r.text()).then(html=>{
    // Mount loader.html (for CSS + tile config)
    const host = document.createElement('div');
    host.id = 'rp-loader-host';
    host.innerHTML = html;
    document.body.appendChild(host);

    const tileJsonEl = host.querySelector('#rp-loader-tiles');
    let tiles = [];
    try{
      tiles = JSON.parse(tileJsonEl ? tileJsonEl.textContent : '[]') || [];
    }catch(e){
      tiles = [];
    }

    // Overlay + modal shell
    const overlay = document.createElement('div');
    overlay.className = 'rp-loader-overlay';

    const modal = document.createElement('div');
    modal.className = 'rp-loader-modal';

    const close = document.createElement('div');
    close.className = 'rp-close';
    close.textContent = '×';

    const header = document.createElement('div');
    header.className = 'rp-loader-header';
    header.innerHTML = '<div class="rp-loader-brand"><img src="risingprogress.png" alt="Rising Progress"><span>Rising Progress</span></div>';

    modal.appendChild(close);
    modal.appendChild(header);

    // Primary actions (first 2 tiles)
    const primaryGrid = document.createElement('div');
    primaryGrid.className = 'rp-grid';
    const primaryTiles = tiles.slice(0,2);
    primaryTiles.forEach(t => primaryGrid.appendChild(buildTile(t, { primary:true })) );
    modal.appendChild(primaryGrid);

    // Templates section
    const sec = document.createElement('div');
    sec.className = 'rp-section';
    sec.innerHTML = '<h3>TEMPLATES</h3><small>(draft examples to get started)</small>';
    modal.appendChild(sec);

    const templateGrid = document.createElement('div');
    templateGrid.className = 'rp-grid';
    tiles.slice(2).forEach(t => templateGrid.appendChild(buildTile(t, { primary:false })) );
    modal.appendChild(templateGrid);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Dismiss behaviors
    function cleanup(){
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      host.remove();
      _open = false;
    }

    function onKey(e){ if(e.key === 'Escape') cleanup(); }

    close.addEventListener('click', cleanup);
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) cleanup(); });
    document.addEventListener('keydown', onKey);

    function buildTile(tile){
      const wrap = document.createElement('div');
      wrap.className = 'rp-tile';
      wrap.innerHTML = `<div class="rp-tile-box"><img src="${tile.imagePath}" alt="${tile.title}"></div>
                        <div class="rp-tile-title">${tile.title}</div>`;

      wrap.addEventListener('click', ()=>{
        track('tile_clicked', { id: tile.id, title: tile.title, action: tile.action || 'url' });

        if(tile.action === 'openFile'){
          // Delegate to the existing Open Project handler (must be a true user click).
          const openItem = document.querySelector('#loadDropdown [data-act="open"]');
          if (openItem) {
            openItem.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window }));
          }

          // Auto-close only after a file is actually selected.
          const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
          const onChange = () => {
            // Only close if a file was selected
            const picked = fileInputs.some(inp => inp && inp.files && inp.files.length > 0);
            if (picked) cleanup();
            fileInputs.forEach(inp => { try{ inp.removeEventListener('change', onChange); }catch(e){} });
          };
          fileInputs.forEach(inp => { try{ inp.addEventListener('change', onChange, { once:false }); }catch(e){} });

          return;
        }

        // URL tile: navigate; existing URL loader handles the rest
        if (tile.url) {
          track('template_selected', { id: tile.id });
          window.location.href = tile.url;
        }
      });
      return wrap;
    }
  }).catch(()=>{ _open = false; });
}
