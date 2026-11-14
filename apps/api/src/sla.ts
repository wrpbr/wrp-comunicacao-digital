export type Availability = {
  expectedHours: number;
  onlineHours: number;
  ratio: number;
  gaps: { hour: string }[];
};

export function businessHourSlots(from: Date, to: Date, timeZone = 'America/Sao_Paulo'): string[] {
  const slots: string[] = [];
  const cursor = new Date(from.getTime());
  cursor.setUTCMinutes(0, 0, 0);
  while (cursor <= to) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const bag: Record<string, string> = {};
    for (const part of fmt.formatToParts(cursor)) {
      if (part.type !== 'literal') bag[part.type] = part.value;
    }
    const weekday = bag.weekday ?? '';
    const hour = Number(bag.hour ?? '0');
    const openDay = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
    if (openDay && hour >= 8 && hour <= 16) {
      slots.push(`${bag.year}-${bag.month}-${bag.day}T${String(hour).padStart(2, '0')}`);
    }
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return slots;
}

export function computeAvailability(heartbeats: { at: string }[], from: Date, to: Date): Availability {
  const slots = businessHourSlots(from, to);
  const online = new Set<string>();
  for (const beat of heartbeats) {
    const date = new Date(beat.at);
    if (Number.isNaN(date.getTime()) || date < from || date > to) continue;
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const bag: Record<string, string> = {};
    for (const part of fmt.formatToParts(date)) {
      if (part.type !== 'literal') bag[part.type] = part.value;
    }
    online.add(`${bag.year}-${bag.month}-${bag.day}T${String(Number(bag.hour)).padStart(2, '0')}`);
  }
  const gaps = slots.filter((slot) => !online.has(slot)).map((hour) => ({ hour }));
  const onlineHours = slots.length - gaps.length;
  return {
    expectedHours: slots.length,
    onlineHours,
    ratio: slots.length === 0 ? 1 : onlineHours / slots.length,
    gaps,
  };
}
