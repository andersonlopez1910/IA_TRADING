export class EconomicCalendarService {
  async upcoming() { return { events: [], updatedAt: null, source: null, isLive: false }; }
  blocksSignal(events, now = Date.now()) { return events.some(event => event.impact === 'Alto' && Math.abs(new Date(event.time).getTime() - now) <= 30 * 60_000); }
}
