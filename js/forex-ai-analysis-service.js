/** No usa un LLM en el navegador ni inventa datos fundamentales. */
export class ForexAIAnalysisService {
  async analyse({ pair, technicalBias, confidence, news = [], events = [] }) {
    if (!news.length && !events.length) return { fundamentalBias: 'neutral', technicalBias, confidence: confidence >= 80 ? 'alta' : confidence >= 60 ? 'media' : 'baja', explanation: 'Información insuficiente para análisis fundamental. El contexto mostrado es exclusivamente técnico.', risks: ['Sin fuente fundamental conectada'], sources: [] };
    const riskEvents = events.filter(event => event.impact === 'Alto');
    return { fundamentalBias: 'neutral', technicalBias, confidence: confidence >= 80 ? 'alta' : 'media', explanation: `Contexto de ${pair} resumido con datos fechados del proveedor configurado.`, risks: riskEvents.map(event => event.title || event.event), sources: news.map(item => ({ title: item.title, url: item.url, publishedAt: item.publishedAt })) };
  }
}
