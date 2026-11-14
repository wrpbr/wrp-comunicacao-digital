const TZ = 'America/Sao_Paulo';

export type ZonedParts = {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
  second: number;
  isoWeekday: number;
};

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(date = new Date(), timeZone = TZ): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  return {
    year: bag.year ?? '1970',
    month: bag.month ?? '01',
    day: bag.day ?? '01',
    hour: Number(bag.hour ?? '0'),
    minute: Number(bag.minute ?? '0'),
    second: Number(bag.second ?? '0'),
    isoWeekday: WEEKDAY[bag.weekday ?? 'Mon'] ?? 1,
  };
}

export function saoPauloOffset(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-03:00';
  const match = tz.match(/GMT([+-]\d{2}:\d{2})/);
  return match?.[1] ?? '-03:00';
}

export function formatSaoPaulo(date = new Date()): string {
  const z = zonedParts(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${z.year}-${z.month}-${z.day}T${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)}${saoPauloOffset(date)}`;
}

export function currentMonthKey(date = new Date()): string {
  const z = zonedParts(date);
  return `${z.year}-${z.month}`;
}

export function currentDateKey(date = new Date()): string {
  const z = zonedParts(date);
  return `${z.year}-${z.month}-${z.day}`;
}

export function isBirthdayOn(birthDate: string, now = new Date()): boolean {
  const [, month, day] = birthDate.split('-');
  const z = zonedParts(now);
  return month === z.month && day === z.day;
}

export function shiftDateKey(days: number, now = new Date()): { year: string; month: string; day: string } {
  const z = zonedParts(now);
  const utc = Date.UTC(Number(z.year), Number(z.month) - 1, Number(z.day) + days);
  const d = new Date(utc);
  return {
    year: String(d.getUTCFullYear()),
    month: String(d.getUTCMonth() + 1).padStart(2, '0'),
    day: String(d.getUTCDate()).padStart(2, '0'),
  };
}

export function within24h(lastInboundAt: string | undefined, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  const then = new Date(lastInboundAt).getTime();
  if (Number.isNaN(then)) return false;
  return now.getTime() - then < 24 * 60 * 60 * 1000 && now.getTime() >= then;
}
