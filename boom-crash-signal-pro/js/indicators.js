export const ema=(v,p)=>v.reduce((a,x,i)=>(a.push(i?x*2/(p+1)+a[i-1]*(1-2/(p+1)):x),a),[]);
export const rsi=(v,p=14)=>{if(v.length<=p)return 50;const d=v.slice(-p-1).slice(1).map((x,i)=>x-v.slice(-p-1)[i]),g=d.reduce((s,x)=>s+Math.max(x,0),0)/p,l=d.reduce((s,x)=>s+Math.max(-x,0),0)/p;return +(100-100/(1+g/(l||1e-9))).toFixed(1)};
export const atr=(c,p=14)=>c.slice(-p).reduce((s,x,i,a)=>s+(i?Math.max(x.high-x.low,Math.abs(x.high-a[i-1].close),Math.abs(x.low-a[i-1].close)):x.high-x.low),0)/Math.min(p,c.length);
