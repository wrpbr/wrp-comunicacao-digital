const WIN: Record<string, number> = {
  á: 0xe1,
  à: 0xe0,
  â: 0xe2,
  ã: 0xe3,
  é: 0xe9,
  ê: 0xea,
  í: 0xed,
  ó: 0xf3,
  ô: 0xf4,
  õ: 0xf5,
  ú: 0xfa,
  ç: 0xe7,
  Á: 0xc1,
  À: 0xc0,
  Â: 0xc2,
  Ã: 0xc3,
  É: 0xc9,
  Ê: 0xca,
  Í: 0xcd,
  Ó: 0xd3,
  Ô: 0xd4,
  Õ: 0xd5,
  Ú: 0xda,
  Ç: 0xc7,
  º: 0xba,
  ª: 0xaa,
  '—': 0x2d,
  '–': 0x2d,
  '“': 0x22,
  '”': 0x22,
  '’': 0x27,
  '•': 0x2a,
};

function escapePdfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const mapped = WIN[ch];
    const byte = mapped ?? (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 0x3f);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32) out += ' ';
    else out += String.fromCharCode(byte);
  }
  return out;
}

/** Largura da linha em caracteres: Helvetica 10 pt entre as margens da página A4. */
const LINE_MAX = 100;

/** Quebra a linha nas palavras, em pedaços de até `max` caracteres. Texto longo não é cortado. */
function wrapLine(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    let rest = word;
    // Palavra maior que a linha (um identificador longo): parte no limite.
    while (rest.length > max) {
      if (current) out.push(current);
      current = '';
      out.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    if (!current) current = rest;
    else if (current.length + 1 + rest.length <= max) current += ` ${rest}`;
    else {
      out.push(current);
      current = rest;
    }
  }
  if (current) out.push(current);
  return out;
}

export function buildPdf(sourceLines: string[], title = 'WRP Comunicação Digital'): Buffer {
  const lines = sourceLines.flatMap((line) => wrapLine(line, LINE_MAX));
  const pageSize = 46;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += pageSize) pages.push(lines.slice(i, i + pageSize));
  if (pages.length === 0) pages.push(['(vazio)']);

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  let next = 4;

  const contentNumbers: number[] = [];
  for (const page of pages) {
    const commands = ['BT', '/F1 10 Tf', '48 800 Td', '13 TL'];
    page.forEach((line, index) => {
      // T* não recebe operando: ele só desce uma linha. Quem mostra o texto é o Tj
      // (ISO 32000-1, tabelas 108 e 109). Com "(texto) T*" o leitor descarta o texto.
      if (index > 0) commands.push('T*');
      commands.push(`(${escapePdfText(line)}) Tj`);
    });
    commands.push('ET');
    const stream = commands.join('\n');
    contentNumbers.push(next);
    objects.push(`${next} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`);
    next += 1;
    pageObjectNumbers.push(next);
    objects.push(
      `${next} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${next - 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
    );
    next += 1;
  }

  const kids = pageObjectNumbers.map((n) => `${n} 0 R`).join(' ');
  const catalog = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const pageTree = `2 0 obj\n<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${kids}] >>\nendobj\n`;
  const font = `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  const info = `${next} 0 obj\n<< /Title (${escapePdfText(title)}) /Producer (${escapePdfText('WRP Comunicação Digital')}) >>\nendobj\n`;

  const all = [catalog, pageTree, font, ...objects, info];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of all) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += obj;
  }
  const xrefAt = Buffer.byteLength(body, 'latin1');
  const size = all.length + 1;
  let xref = `xref\n0 ${size}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i < size; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R /Info ${next} 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body + xref + trailer, 'latin1');
}
