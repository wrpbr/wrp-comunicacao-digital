import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

type Ticket = { id: string; number: string; displayName: string; service: string; desk?: string };
type Slide = { id: string; type: 'image' | 'youtube' | 'text'; title: string; durationSec: number; imageUrl?: string; youtubeId?: string; text?: string; subtitle?: string };
type Snapshot = {
  unit: { slug: string; name: string; serviceLabel: string; displayMode: 'media' | 'tickets' | 'split'; desk: string };
  playlist: Slide[];
  waiting: Ticket[];
  recentCalls: Ticket[];
  currentCall: Ticket | null;
  serverTime: string;
};

const DB = 'wrp-tv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persist(slug: string, snapshot: Snapshot) {
  localStorage.setItem(`wrp-tv:${slug}`, JSON.stringify(snapshot));
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(snapshot, slug);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function restore(slug: string): Promise<Snapshot | null> {
  try {
    const db = await openDb();
    const stored = await new Promise<Snapshot | undefined>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readonly');
      const request = tx.objectStore('snapshots').get(slug);
      request.onsuccess = () => resolve(request.result as Snapshot | undefined);
      request.onerror = () => reject(request.error);
    });
    if (stored) return stored;
  } catch {
    /* IndexedDB indisponível */
  }
  const raw = localStorage.getItem(`wrp-tv:${slug}`);
  return raw ? (JSON.parse(raw) as Snapshot) : null;
}

function chime() {
  const context = new AudioContext();
  const now = context.currentTime;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.0001, now + index * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.18 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.4);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + index * 0.18);
    oscillator.stop(now + index * 0.18 + 0.42);
  });
}

export function TvPlayerPage() {
  const { unitSlug = '' } = useParams();
  const [params] = useSearchParams();
  const chave = params.get('chave') ?? '';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [sound, setSound] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [clock, setClock] = useState('');
  const lastCall = useRef('');
  // Falso até o primeiro estado chegar: a chamada que já estava na tela ao abrir o painel não toca o aviso.
  const seeded = useRef(false);
  const displayMode = useRef<string | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);

  const query = useMemo(() => (chave ? `?chave=${encodeURIComponent(chave)}` : ''), [chave]);

  useEffect(() => {
    const fit = () => {
      const node = stage.current;
      if (!node) return;
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      node.style.transform = `scale(${scale})`;
    };
    fit();
    window.addEventListener('resize', fit);
    const tick = setInterval(() => {
      setClock(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()));
    }, 1000);
    return () => {
      window.removeEventListener('resize', fit);
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    const apply = (next: Snapshot) => {
      if (closed) return;
      setSnapshot(next);
      setOffline(false);
      void persist(unitSlug, next);
      displayMode.current = next.unit.displayMode;
      const callId = next.currentCall?.id ?? '';
      if (callId !== lastCall.current) {
        if (seeded.current && callId && sound) chime();
        lastCall.current = callId;
      }
      seeded.current = true;
    };
    const beat = () =>
      fetch(`/api/v1/tv/${unitSlug}/heartbeat${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave, mode: displayMode.current, playerVersion: '1.0.0' }),
      }).then((response) => setOffline(!response.ok)).catch(() => setOffline(true));

    async function boot() {
      try {
        const response = await fetch(`/api/v1/tv/${unitSlug}/state${query}`);
        if (!response.ok) throw new Error('state');
        apply((await response.json()) as Snapshot);
        // O primeiro sinal sai ao abrir, para a unidade aparecer no ar sem esperar o intervalo.
        if (!closed) void beat();
      } catch {
        const cached = await restore(unitSlug);
        if (cached) setSnapshot(cached);
        setOffline(true);
      }
      source = new EventSource(`/api/v1/tv/${unitSlug}/stream${query}`);
      const onEvent = (event: MessageEvent) => {
        const data = JSON.parse(event.data) as Snapshot;
        apply(data);
      };
      source.addEventListener('snapshot', onEvent);
      source.addEventListener('call', onEvent);
      source.addEventListener('queue', onEvent);
      source.addEventListener('playlist', onEvent);
      source.onerror = () => setOffline(true);
    }
    void boot();
    const beats = setInterval(() => void beat(), 20000);
    const online = () => setOffline(false);
    const offlineNow = () => setOffline(true);
    window.addEventListener('offline', offlineNow);
    window.addEventListener('online', online);
    return () => {
      closed = true;
      source?.close();
      clearInterval(beats);
      window.removeEventListener('offline', offlineNow);
      window.removeEventListener('online', online);
    };
  }, [unitSlug, query, chave, sound]);

  useEffect(() => {
    const playlist = snapshot?.playlist ?? [];
    if (playlist.length === 0) return;
    const seconds = playlist[slideIndex % playlist.length]?.durationSec ?? 12;
    const timer = setTimeout(() => setSlideIndex((value) => value + 1), seconds * 1000);
    return () => clearTimeout(timer);
  }, [snapshot, slideIndex]);

  const mode = snapshot?.unit.displayMode ?? 'split';
  const slide = snapshot?.playlist.length ? snapshot.playlist[slideIndex % snapshot.playlist.length] : null;
  const showMedia = mode !== 'tickets';
  const showTickets = mode !== 'media';

  return (
    <div className="grid h-screen place-items-center overflow-hidden bg-black text-white">
      <div ref={stage} className="h-[1080px] w-[1920px] origin-center bg-[#0c1828]">
        <header className="flex items-center justify-between border-b border-white/10 px-10 py-6">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-[#c4a46a]">Prefeitura Municipal de Pompéu</p>
            <h1 className="display text-5xl">{snapshot?.unit.name ?? 'Painel institucional'}</h1>
          </div>
          <div className="text-right">
            <p className="display text-5xl tabular-nums">{clock}</p>
            <p className="text-lg text-white/70">{offline ? 'Sem rede · exibindo a última tela salva' : 'Ao vivo'}</p>
          </div>
        </header>
        {!snapshot && (
          <div className="grid h-[900px] place-items-center text-2xl">
            {chave ? 'Aguardando a unidade…' : 'Este painel precisa da chave da unidade.'}
          </div>
        )}
        {snapshot && (
          <div className={`grid h-[900px] ${showMedia && showTickets ? 'grid-cols-[1.15fr_0.85fr]' : 'grid-cols-1'}`}>
            {showMedia && (
              <section className="flex min-h-0 flex-col overflow-hidden border-r border-white/10">
                <div className="min-h-0 flex-1">
                  {slide?.type === 'text' && (
                    <div className="grid h-full content-center px-16">
                      <p className="text-sm uppercase tracking-[0.2em] text-[#c4a46a]">{slide.title}</p>
                      <p className="display mt-4 text-7xl leading-tight">{slide.text}</p>
                      <p className="mt-6 text-3xl text-white/70">{slide.subtitle}</p>
                    </div>
                  )}
                  {/* A peça aparece inteira: a área de mídia muda de proporção conforme o modo do painel. */}
                  {slide?.type === 'image' && slide.imageUrl && <img src={slide.imageUrl} alt={slide.title} className="h-full w-full object-contain" />}
                  {slide?.type === 'youtube' && slide.youtubeId && (
                    <iframe
                      title={slide.title}
                      className="h-full w-full"
                      src={`https://www.youtube-nocookie.com/embed/${slide.youtubeId}?autoplay=1&mute=1&controls=0&rel=0&loop=1&playlist=${slide.youtubeId}&hl=pt-BR&cc_lang_pref=pt`}
                      allow="autoplay; encrypted-media"
                    />
                  )}
                </div>
                <p className="flex items-center justify-between gap-6 border-t border-white/10 px-8 py-3 text-sm text-white/60">
                  <span>{slide?.type === 'youtube' ? [slide.title, slide.subtitle].filter(Boolean).join(' · ') : ''}</span>
                  <span>Peça de demonstração do player. Troque pelo material oficial do município.</span>
                </p>
              </section>
            )}
            {showTickets && (
              <section className="flex flex-col px-10 py-8">
                <p className="text-sm uppercase tracking-[0.22em] text-[#c4a46a]">Senha chamada</p>
                {snapshot.currentCall ? (
                  <>
                    <p className="display mt-3 text-8xl text-[#c4a46a]">{snapshot.currentCall.number}</p>
                    <p className="display mt-2 text-6xl leading-tight">{snapshot.currentCall.displayName}</p>
                    <p className="mt-4 text-3xl text-white/75">{snapshot.currentCall.service} · {snapshot.currentCall.desk}</p>
                  </>
                ) : (
                  <p className="display mt-8 text-5xl">Aguardando a próxima chamada.</p>
                )}
                <div className="mt-auto">
                  <p className="text-sm uppercase tracking-widest text-white/50">Aguardando</p>
                  <ul className="mt-3 space-y-2 text-2xl">
                    {snapshot.waiting.slice(0, 5).map((ticket) => (
                      <li key={ticket.id}>{ticket.number} · {ticket.displayName}</li>
                    ))}
                    {snapshot.waiting.length === 0 && <li className="text-white/50">Fila vazia nesta unidade.</li>}
                  </ul>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      {!sound && (
        <button
          type="button"
          className="absolute bottom-6 right-6 rounded-md bg-[#c4a46a] px-4 py-3 text-sm font-semibold text-[#1b1408]"
          onClick={() => {
            void new AudioContext().resume();
            setSound(true);
          }}
        >
          Iniciar painel e ativar som
        </button>
      )}
    </div>
  );
}
