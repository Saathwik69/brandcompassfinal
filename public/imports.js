async function readZipEntries(bytes, targetPattern) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This file is not a supported DOCX archive.');
  let p = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  const results = {};

  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('Invalid DOCX directory.');
    const compression = view.getUint16(p + 10, true),
      size = view.getUint32(p + 20, true),
      plainSize = view.getUint32(p + 24, true),
      nameLen = view.getUint16(p + 28, true),
      extraLen = view.getUint16(p + 30, true),
      commentLen = view.getUint16(p + 32, true),
      offset = view.getUint32(p + 42, true);
    const entry = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen));
    if (targetPattern.test(entry)) {
      if (plainSize > 2 * 1024 * 1024 || offset + 30 > bytes.length) throw new Error('DOCX content exceeds the supported size.');
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      if (start + size > bytes.length) throw new Error('Truncated DOCX.');
      const payload = bytes.slice(start, start + size);
      let xml = '';
      if (compression === 0) {
        xml = new TextDecoder().decode(payload);
      } else if (compression === 8) {
        const reader = new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        let length = 0;
        const chunks = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('DOCX expands beyond the supported size.');
          }
          chunks.push(value);
        }
        xml = await new Blob(chunks).text();
      } else {
        throw new Error('Unsupported DOCX compression.');
      }
      results[entry] = xml;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return results;
}

function parseWordXmlWithLayout(xml) {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('Invalid document XML.');
  const body = dom.getElementsByTagNameNS('*', 'body')[0] || dom.documentElement;
  const blocks = [];

  for (const node of body.children || []) {
    const local = node.localName;
    if (local === 'tbl') {
      const rows = [...node.getElementsByTagNameNS('*', 'tr')].map(tr =>
        [...tr.getElementsByTagNameNS('*', 'tc')]
          .map(tc =>
            [...tc.getElementsByTagNameNS('*', 't')]
              .map(t => t.textContent)
              .join('')
              .trim()
          )
          .join(' | ')
      );
      if (rows.length) blocks.push(rows.join('\n'));
    } else if (local === 'p') {
      const line = [...node.getElementsByTagNameNS('*', 't')].map(t => t.textContent).join('').trim();
      if (line) blocks.push(line);
    }
  }
  if (!blocks.length) {
    return [...dom.getElementsByTagNameNS('*', 'p')]
      .map(p => [...p.getElementsByTagNameNS('*', 't')].map(t => t.textContent).join(''))
      .filter(Boolean)
      .join('\n');
  }
  return blocks.join('\n');
}

async function requestServerOcr(dataUrl, hintText = '') {
  try {
    const res = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BC-Request': '1' },
      body: JSON.stringify({ data_url: dataUrl, hint_text: hintText })
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data.text || '').trim();
  } catch {
    return '';
  }
}

export async function extractDocument(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose a document smaller than 5 MB.');
  const name = file.name.toLowerCase();
  if (/\.(txt|md)$/.test(name)) {
    const text = await file.text();
    if (text.length > 16000) throw new Error('Document exceeds 16,000 characters. Import a shorter excerpt.');
    return text;
  }
  if (name.endsWith('.pdf')) {
    const rawBytes = new Uint8Array(await file.arrayBuffer());
    const rawHeader = new TextDecoder('latin1').decode(rawBytes.slice(0, Math.min(rawBytes.length, 4096)));
    if (/\/Encrypt\b/.test(rawHeader)) {
      throw new Error('This PDF is password-encrypted. Remove encryption before importing.');
    }
    const pdfjs = await import('/vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: rawBytes, isEvalSupported: false, useSystemFonts: true }).promise;
    } catch (err) {
      if (err?.name === 'PasswordException' || /password/i.test(err?.message || '')) {
        throw new Error('This PDF is password-encrypted. Remove encryption before importing.');
      }
      throw err;
    }
    try {
      if (pdf.numPages > 25) throw new Error('Choose a PDF with 25 pages or fewer.');
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        // Sort items into layout lines by Y coordinate (top to bottom) and X coordinate (left to right)
        const lines = [];
        for (const item of content.items) {
          if (!item.str) continue;
          const x = item.transform ? Math.round(item.transform[4]) : 0;
          const y = item.transform ? Math.round(item.transform[5]) : 0;
          let line = lines.find(l => Math.abs(l.y - y) <= 4);
          if (!line) {
            line = { y, cells: [] };
            lines.push(line);
          }
          line.cells.push({ x, str: item.str });
        }
        lines.sort((a, b) => b.y - a.y);
        const pageText = lines
          .map(l => {
            l.cells.sort((a, b) => a.x - b.x);
            let out = '';
            let prevX = null;
            for (const c of l.cells) {
              if (prevX !== null && c.x - prevX > 45) out += ' | ';
              else if (out && !out.endsWith(' ')) out += ' ';
              out += c.str;
              prevX = c.x + c.str.length * 4;
            }
            return out.trim();
          })
          .filter(Boolean)
          .join('\n');

        if (pageText.trim()) {
          text += pageText + '\n\n';
        } else if (i <= 3 && typeof document !== 'undefined') {
          // Scanned PDF page without selectable text: render page to canvas and invoke server OCR
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          const ocrPageText = await requestServerOcr(canvas.toDataURL('image/png'));
          if (ocrPageText) text += ocrPageText + '\n\n';
        }
        if (text.length > 16000) throw new Error('Document exceeds 16,000 characters. Import a shorter excerpt.');
      }
      if (!text.trim()) throw new Error('No selectable or OCR text found in this PDF.');
      return text.trim();
    } finally {
      await pdf.destroy();
    }
  }
  if (name.endsWith('.docx')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = await readZipEntries(bytes, /^word\/(header\d*|document|footer\d*)\.xml$/);
    if (!entries['word/document.xml']) throw new Error('Document text could not be found.');
    const sections = [];
    for (const k of Object.keys(entries).sort()) {
      if (k.startsWith('word/header')) {
        const hText = parseWordXmlWithLayout(entries[k]).trim();
        if (hText) sections.push(hText);
      }
    }
    sections.push(parseWordXmlWithLayout(entries['word/document.xml']).trim());
    for (const k of Object.keys(entries).sort()) {
      if (k.startsWith('word/footer')) {
        const fText = parseWordXmlWithLayout(entries[k]).trim();
        if (fText) sections.push(fText);
      }
    }
    const text = sections.filter(Boolean).join('\n\n');
    if (text.length > 16000) throw new Error('Document exceeds 16,000 characters. Import a shorter excerpt.');
    if (!text.trim()) throw new Error('No document text found.');
    return text;
  }
  throw new Error('Upload TXT, MD, PDF or DOCX.');
}

function quantizeHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map(x => (Math.round(x / 32) * 32 > 255 ? 255 : Math.round(x / 32) * 32).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export async function inspectImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error('Use PNG, JPEG or WebP, up to 5 MB.');
  const bytes = await file.arrayBuffer(),
    hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 25000000) {
    bitmap.close();
    throw new Error('Choose an image under 25 megapixels.');
  }
  const canvas = document.createElement('canvas'),
    scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const w = canvas.width,
    h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const bins = new Map();
  const regionBins = {
    'top-left': new Map(),
    'top-right': new Map(),
    center: new Map(),
    'bottom-left': new Map(),
    'bottom-right': new Map()
  };

  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const idx = (y * w + x) * 4;
      const hex = quantizeHex(data[idx], data[idx + 1], data[idx + 2]);
      bins.set(hex, (bins.get(hex) || 0) + 1);
      const inCenter = x >= w * 0.25 && x <= w * 0.75 && y >= h * 0.25 && y <= h * 0.75;
      const reg = inCenter
        ? 'center'
        : y < h / 2
        ? x < w / 2
          ? 'top-left'
          : 'top-right'
        : x < w / 2
        ? 'bottom-left'
        : 'bottom-right';
      const rMap = regionBins[reg];
      rMap.set(hex, (rMap.get(hex) || 0) + 1);
    }
  }

  const colors = [...bins]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c]) => c);

  const regions = {};
  for (const [reg, rMap] of Object.entries(regionBins)) {
    regions[reg] = [...rMap]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c]) => c);
  }

  const pngDataUrl = canvas.toDataURL('image/png');
  const ocrText = await requestServerOcr(pngDataUrl);

  const result = {
    name: file.name,
    width: bitmap.width,
    height: bitmap.height,
    sha256: hash,
    colors,
    regions,
    ocr_text: ocrText,
    server_verified: true,
    thumbnail: canvas.toDataURL('image/jpeg', 0.65),
    kind: 'graphic',
    decorative: false
  };
  bitmap.close();
  return result;
}
