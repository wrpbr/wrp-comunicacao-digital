import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { tagLabel } from '@/lib/labels';

// Peça da semente traz `url`; peça enviada pelo painel traz o próprio arquivo em `dataUrl`.
type Asset = { id: string; title: string; kind: string; url?: string; dataUrl?: string; tags: string[] };

export function MediaPage() {
  const [rows, setRows] = useState<Asset[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const data = await api<{ media: Asset[] }>('/api/v1/media');
    setRows(data.media);
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Falha ao abrir o repositório.'));
  }, []);

  async function onFile(file: File) {
    const dataUrl = await file.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      return `data:${file.type};base64,${btoa(binary)}`;
    });
    await api('/api/v1/media', {
      method: 'POST',
      body: JSON.stringify({ title: title || file.name, kind: 'image', dataUrl, tags: ['upload'] }),
    });
    setTitle('');
    await load();
  }

  return (
    <div className="space-y-4">
      <h1 className="display text-3xl">Repositório institucional</h1>
      <p className="text-sm text-muted-foreground">Peças originais do POC. Troque pelas artes oficiais da prefeitura antes da operação.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {rows.length === 0 && !error && <p className="text-sm">Nenhuma peça carregada.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((asset) => (
          <article key={asset.id} className="overflow-hidden rounded-lg border border-border bg-card">
            {(asset.url ?? asset.dataUrl) && (
              <img src={asset.url ?? asset.dataUrl} alt={asset.title} className="aspect-video w-full bg-[#102033] object-contain" />
            )}
            <div className="p-3 text-sm">
              <strong>{asset.title}</strong>
              <div className="text-xs text-muted-foreground">{asset.tags.map(tagLabel).join(', ')}</div>
            </div>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Título da peça" value={title} onChange={(event) => setTitle(event.target.value)} className="max-w-xs" />
        <input
          type="file"
          accept="image/svg+xml,image/png,image/jpeg"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Upload falhou'));
          }}
        />
        <Button type="button" variant="outline" onClick={() => void load()}>Atualizar</Button>
      </div>
    </div>
  );
}
