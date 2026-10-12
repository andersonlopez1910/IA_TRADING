/** Escenarios probabilísticos: nunca genera ni etiqueta velas futuras como datos reales. */
export class MarketProjectionEngine {
  project(analysis, candles) {
    if (!analysis || analysis.state || candles.length < 100) return { reliable:false, label:'Sin escenario confiable', reason:'Historial insuficiente para estimar escenarios.' };
    const last = analysis.last.close, bias = analysis.e20 > analysis.e50 ? 1 : analysis.e20 < analysis.e50 ? -1 : 0;
    const volatilityPenalty = analysis.volatility === 'alta' || analysis.spike ? .18 : 0;
    const base = Math.max(.34, .52 + bias * .12 - volatilityPenalty), opposite = Math.max(.18, .30 - bias * .10 + volatilityPenalty / 2), lateral = Math.max(.14, 1 - base - opposite);
    const range = analysis.atr * 3, invalidation = bias >= 0 ? analysis.support : analysis.resistance;
    const direction = bias > 0 ? 'alcista' : bias < 0 ? 'bajista' : 'lateral';
    return { reliable: volatilityPenalty < .15, label:`Escenario ${direction}`, direction, confidence: base >= .62 ? 'media' : 'baja', ranges:{'5m':range,'10m':range*1.35,'15m':range*1.7}, probabilities:{alcista:Math.round((bias>0?base:opposite)*100),bajista:Math.round((bias<0?base:opposite)*100),lateral:Math.round(lateral*100)}, upper:last+range, lower:last-range, invalidation, spikeRisk:analysis.lastSpike?'Elevado tras spike reciente':'Presente: los spikes no son predecibles' };
  }
}
