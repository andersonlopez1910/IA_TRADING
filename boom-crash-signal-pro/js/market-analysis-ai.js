/** Explicador determinista basado solo en las métricas recibidas; no inventa hechos. */
export class MarketAnalysisAI {
  explain(analysis, projection, signal) {
    if (!analysis || analysis.state) return 'Estado actual: datos insuficientes.\nAcción recomendada: No operar.';
    return `Estado actual: ${analysis.last.direction}.\nTendencia: precio ${analysis.last.close >= analysis.e20 ? 'sobre' : 'bajo'} EMA 20.\nVolatilidad: ${analysis.volatility}.\nÚltima vela: ${analysis.pattern}.\nSoporte importante: ${analysis.support.toFixed(2)}.\nResistencia importante: ${analysis.resistance.toFixed(2)}.\nEscenario probable: ${projection.label}.\nProbabilidad: alcista ${projection.probabilities.alcista}%, bajista ${projection.probabilities.bajista}%, lateral ${projection.probabilities.lateral}%.\nRiesgo principal: ${projection.spikeRisk}.\nAcción recomendada: ${signal.state.includes('VÁLIDA') ? signal.state : 'No operar / esperar confirmación'}.\nCondición de invalidación: ${signal.invalid || projection.invalidation.toFixed(2)}.`;
  }
}
