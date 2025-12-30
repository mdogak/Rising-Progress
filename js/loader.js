// © 2025 Rising Progress LLC
export function openProjectLoader(){
  if(document.querySelector('.rp-loader-overlay')) return;

  fetch('loader.html').then(r=>r.text()).then(html=>{
    const wrap=document.createElement('div');
    wrap.innerHTML=html;
    document.body.appendChild(wrap);

    const overlay=document.createElement('div');
    overlay.className='rp-loader-overlay';

    const modal=document.createElement('div');
    modal.className='rp-loader-modal';

    const close=document.createElement('div');
    close.className='rp-close';
    close.textContent='×';
    close.onclick=cleanup;

    modal.appendChild(close);

    const header=document.createElement('div');
    header.className='rp-loader-header';
    header.innerHTML='<img src="risingprogress.png"><span>Rising Progress</span>';
    modal.appendChild(header);

    let grid=document.createElement('div');
    grid.className='rp-loader-grid';

    (window.RP_LOADER_TILES||[]).forEach(t=>{
      if(t.section){
        modal.appendChild(grid);
        const sec=document.createElement('div');
        sec.className='rp-section';
        sec.innerHTML='<h3>TEMPLATES</h3><small>(draft examples to get started)</small>';
        modal.appendChild(sec);
        grid=document.createElement('div');
        grid.className='rp-loader-grid';
        return;
      }

      const tile=document.createElement('div');
      tile.className='rp-tile';
      tile.innerHTML=`<div class="rp-tile-box"><img src="${t.image}"></div><div class="rp-tile-title">${t.title}</div>`;
      tile.onclick=()=>{
        console.log('Tile clicked',t.id);
        if(t.action==='openFile'){
          const el=document.querySelector('[data-act="open"]');
          if(el){
            el.dispatchEvent(new MouseEvent('click',{bubbles:true}));
          }
        }else if(t.url){
          window.location.href=t.url;
        }
      };
      grid.appendChild(tile);
    });

    modal.appendChild(grid);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.onclick=e=>{ if(e.target===overlay) cleanup(); };
    document.addEventListener('keydown',esc);

    function esc(e){ if(e.key==='Escape') cleanup(); }
    function cleanup(){
      document.removeEventListener('keydown',esc);
      overlay.remove();
      wrap.remove();
    }
  });
}
