const intervals={M1:60,M5:300,M15:900,M30:1800,H1:3600,H4:14400,D1:86400};

export class CandleService {
  constructor(limit=300){this.limit=limit;this.data=new Map();}
  seedCandles(symbol,interval,candles){
    if(!intervals[interval]||!Array.isArray(candles))return 0;
    const key=`${symbol}:${interval}`;const existing=this.data.get(key)||[];const byTime=new Map();
    for(const candle of existing)if(Number.isFinite(candle?.time))byTime.set(candle.time,{...candle});
    for(const source of candles){
      const rawTime=source?.time??source?.timestamp??source?.openTime;
      const parsed=typeof rawTime==='number'?(rawTime<10_000_000_000?rawTime*1000:rawTime):Date.parse(rawTime);
      const time=Math.floor(parsed/1000/intervals[interval])*intervals[interval];
      const open=Number(source?.open),high=Number(source?.high),low=Number(source?.low),close=Number(source?.close);
      if(![time,open,high,low,close].every(Number.isFinite)||high<Math.max(open,close)||low>Math.min(open,close)||high<low)continue;
      // Historical data is accepted only as an explicitly final candle.
      if(source?.closed!==true&&source?.isClosed!==true&&source?.complete!==true&&source?.final!==true)continue;
      byTime.set(time,{time,open,high,low,close,volume:Number(source?.volume)||0,closed:true});
    }
    const rows=[...byTime.values()].sort((left,right)=>left.time-right.time).slice(-this.limit);
    this.data.set(key,rows);return rows.length;
  }
  onTick(tick){
    const closed=[];
    for(const [interval,seconds] of Object.entries(intervals)){
      const bucket=Math.floor(new Date(tick.timestamp).getTime()/1000/seconds)*seconds;
      const key=`${tick.symbol}:${interval}`;const rows=this.data.get(key)||[];let candle=rows.at(-1);
      if(!candle||candle.time!==bucket){if(candle){candle.closed=true;closed.push({interval,candle:{...candle}});}candle={time:bucket,open:tick.mid,high:tick.mid,low:tick.mid,close:tick.mid,volume:1,closed:false};rows.push(candle);if(rows.length>this.limit)rows.shift();this.data.set(key,rows);}
      else{candle.high=Math.max(candle.high,tick.mid);candle.low=Math.min(candle.low,tick.mid);candle.close=tick.mid;candle.volume+=1;}
    }
    return closed;
  }
  getCandles(symbol,interval='M15',limit=200){return (this.data.get(`${symbol}:${interval}`)||[]).slice(-Math.min(limit,this.limit));}
}
