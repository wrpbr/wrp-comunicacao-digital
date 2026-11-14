import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

export type TvEvent =
  | { event: 'snapshot'; data: unknown }
  | { event: 'call'; data: unknown }
  | { event: 'queue'; data: unknown }
  | { event: 'playlist'; data: unknown };

type Listener = (event: TvEvent) => void;

const channels = new Map<string, Set<Listener>>();

export const tvBus = {
  publish(unitSlug: string, event: TvEvent): void {
    const hooks = channels.get(unitSlug);
    if (!hooks) return;
    for (const hook of hooks) {
      try {
        hook(event);
      } catch {
        /* listener isolado */
      }
    }
  },
  subscribe(unitSlug: string, listener: Listener): () => void {
    let hooks = channels.get(unitSlug);
    if (!hooks) {
      hooks = new Set();
      channels.set(unitSlug, hooks);
    }
    hooks.add(listener);
    return () => hooks?.delete(listener);
  },
};

export async function attachRedis(url: string): Promise<void> {
  const origin = randomUUID();
  const pub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  const sub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await pub.connect();
  await sub.connect();
  await sub.subscribe('wrp-tv');
  sub.on('message', (channel: string, payload: string) => {
    if (channel !== 'wrp-tv') return;
    const parsed = JSON.parse(payload) as { unitSlug: string; event: TvEvent; origin?: string };
    if (parsed.origin === origin) return;
    const hooks = channels.get(parsed.unitSlug);
    if (!hooks) return;
    for (const hook of hooks) hook(parsed.event);
  });
  const local = tvBus.publish.bind(tvBus);
  tvBus.publish = (unitSlug, event) => {
    local(unitSlug, event);
    void pub.publish('wrp-tv', JSON.stringify({ unitSlug, event, origin })).catch(() => undefined);
  };
}
