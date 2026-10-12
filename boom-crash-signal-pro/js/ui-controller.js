const n=value=>Number(value).toLocaleString('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2});

// Los dos instrumentos están declarados en index.html: aquí solo se actualizan.
export function cards(data,active,pick){
  const container=document.querySelector('#cards');
  for(const [key,value] of Object.entries(data)){
    const card=container.querySelector(`[data-k="${key}"]`);
    if(!card)continue;
    card.classList.toggle('active',key===active);
    card.setAttribute('aria-pressed',String(key===active));
    card.querySelector('[data-price]').textContent=value.price?n(value.price):'—';
    card.querySelector('[data-status]').textContent=value.signal?.state||'Cargando historial';
    card.onclick=()=>pick(key);
  }
}

export function signal(value,explanation){
  const state=document.querySelector('#signalState');
  state.textContent=value.state;
  state.className=value.state==='COMPRA'?'buy':value.state==='VENTA'?'sell':'wait';
  document.querySelector('#levels').innerHTML=value.levels?Object.entries(value.levels).map(([label,price])=>`<span>${label}<b>${n(price)}</b></span>`).join(''):'';
  document.querySelector('#explanation').textContent=explanation||value.reason||'';
}

export function spikes(rows){
  document.querySelector('#spikes').innerHTML=rows.slice(0,20).map(row=>`<tr><td>${new Date(row.time*1000).toLocaleTimeString()}</td><td>${row.name==='BOOM'?'Boom 1000':'Crash 1000'}</td><td class="${row.direction==='up'?'up':'down'}">${row.direction==='up'?'Alcista':'Bajista'}</td><td>${n(row.amplitude||0)}</td><td>${row.ticks||'—'}</td></tr>`).join('')||'<tr><td colspan="5">Aún no se han detectado spikes.</td></tr>';
}
