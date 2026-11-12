const reportEscape = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderReport(r) {
  const e = reportEscape;
  const gdocInfo = r.gdoc
    ? `<p><strong>Google Docs integration:</strong> ${e(r.gdoc.doc_title || r.gdoc.doc_id)} · Document rev <code>${e(r.gdoc.doc_revision_id)}</code>${
        r.gdoc.approval_bound_revision
          ? ` · Approval bound to doc rev <code>${e(r.gdoc.approval_bound_revision.doc_revision_id)}</code> (${
              r.gdoc.approval_bound_revision.doc_revision_id === r.gdoc.doc_revision_id ? 'Current' : 'Stale — edited since approval'
            })`
          : ''
      }</p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BrandCompass — ${e(r.title)}</title><style>body{max-width:850px;margin:45px auto;padding:0 25px;font:14px/1.7 system-ui;color:#20382c}h1{font-size:30px}h2{border-top:1px solid #ddd;padding-top:20px}article{border:1px solid #ddd;border-radius:10px;padding:18px;margin:15px 0;break-inside:avoid}small{color:#697b69}pre{white-space:pre-wrap;font:inherit;background:#f5f7ef;padding:20px}.badge{background:#e6f1d8;padding:8px 12px;border-radius:8px}@media print{body{margin:0}}</style></head><body><h1>BrandCompass review</h1><p>${e(r.title)} · ${e(r.channel)} · Revision ${r.version}</p><p class="badge">${e(r.status.replaceAll('_', ' '))} · Check score ${r.analysis.score}/100 · Knowledge v${r.analysis.knowledge_version}</p><p>${r.approved_by ? 'Approved by ' + e(r.approved_by) + ' on ' + e(r.approved_at) : 'This content has not been approved.'}</p>${gdocInfo}<p><small>Native PDF export is available via <code>/api/reports/${e(r.id)}/pdf</code>, or use your browser’s Print → Save as PDF.</small></p><h2>Reviewed content</h2><pre>${e(r.text)}</pre>${r.image ? '<p>Image: ' + e(r.image.name) + (r.image.server_verified ? ' (Server verified)' : '') + '<br>Alt text: ' + e(r.alt || '(none)') + (r.image.ocr_text ? '<br>Extracted OCR text: ' + e(r.image.ocr_text) : '') + '</p>' : ''}<h2>Findings (${r.analysis.findings.length})</h2>${r.analysis.findings.map(f => `<article><strong>${e(f.title)} · ${e(f.severity)}</strong><p>${e(f.message)}</p><p>Quoted span: ${e(f.quote || 'Visual / document check')}${f.location ? ' · Location: ' + e(f.location) : ''}</p><p>Suggestion: ${e(f.suggestion || 'Manual review required')}</p><p>Source: ${e(f.source.title)} / ${e(f.source.source)} / v${f.source.version}<br>${e(f.source.excerpt)}</p><p>Decision: ${e(f.decision)} ${f.reason ? '— ' + e(f.reason) : ''}</p></article>`).join('')}<h2>Claim evidence</h2>${r.analysis.claims.map(c => `<article>${e(c.text)}<p><strong>${e(c.status)}${c.match_type ? ' (' + e(c.match_type) + ')' : ''}</strong> · ${e(c.reason)}</p>${c.source ? e(c.source.excerpt) : ''}</article>`).join('')}<h2>Review disclosure</h2><p>${e(r.analysis.disclosure)}</p><p>The rule-based score is not an accuracy estimate. Human review is required. Exported ${new Date().toISOString()}.</p><small>ByteRift · Poorvi S &amp; Saathwik P Shettigar</small></body></html>`;
}

export function renderCSV(r) {
  const cell = value => {
    let s = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [
    ['Category', 'Severity', 'Title', 'Quote', 'Location', 'Suggestion', 'Source', 'Decision', 'Reason'],
    ...r.analysis.findings.map(f => [
      f.category,
      f.severity,
      f.title,
      f.quote,
      f.location || '',
      f.suggestion,
      f.source.source,
      f.decision,
      f.reason
    ])
  ]
    .map(row => row.map(cell).join(','))
    .join('\r\n');
}

function pdfClean(str) {
  return String(str ?? '')
    .replace(/₹/g, 'INR ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/·/g, '|')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/([()\\])/g, '\\$1');
}

function wrapText(text, maxChars = 84) {
  const out = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const words = rawLine.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      if ((current + ' ' + words[i]).length <= maxChars) {
        current += ' ' + words[i];
      } else {
        out.push(current);
        current = words[i];
      }
    }
    out.push(current);
  }
  return out;
}

// Native PDF 1.4 generator (dependency-free, works in Node and Cloudflare Workers)
export function renderPDF(r) {
  const lines = [];
  const push = (text, bold = false, size = 10, gap = 14) => {
    for (const w of wrapText(text, size > 12 ? 62 : 84)) {
      lines.push({ text: w, bold, size, gap });
    }
  };

  push('BrandCompass Governance Review Report', true, 16, 22);
  push(`${r.title || 'Untitled'} | Channel: ${r.channel || 'General'} | Revision ${r.version || 1}`, true, 11, 16);
  push(
    `Status: ${String(r.status || 'draft').replaceAll('_', ' ')} | Check Score: ${r.analysis?.score ?? 0}/100 | Knowledge v${r.analysis?.knowledge_version ?? 1}`,
    true,
    10,
    15
  );
  push(
    r.approved_by
      ? `Approved by ${r.approved_by} on ${r.approved_at}`
      : 'Approval status: Not yet approved (human sign-off required).',
    false,
    10,
    16
  );

  if (r.gdoc) {
    push(
      `Google Docs Link: ${r.gdoc.doc_title || r.gdoc.doc_id} (Doc rev: ${r.gdoc.doc_revision_id})${
        r.gdoc.approval_bound_revision
          ? ` | Bound approval rev: ${r.gdoc.approval_bound_revision.doc_revision_id}`
          : ''
      }`,
      false,
      9,
      14
    );
  }

  push('', false, 10, 8);
  push('1. Reviewed Content', true, 12, 18);
  push(r.text || '(No text)', false, 10, 14);
  if (r.image) {
    push(
      `Attached Image: ${r.image.name} (${r.image.kind}, ${r.image.width}x${r.image.height}${r.image.server_verified ? ', server-verified' : ''})`,
      false,
      9,
      13
    );
    if (r.image.ocr_text) push(`Extracted OCR Text: ${r.image.ocr_text}`, false, 9, 13);
  }

  push('', false, 10, 8);
  push(`2. Findings (${r.analysis?.findings?.length || 0})`, true, 12, 18);
  if (!r.analysis?.findings?.length) {
    push('No rule or claim violations flagged.', false, 10, 14);
  } else {
    for (const f of r.analysis.findings) {
      push(`[${String(f.severity).toUpperCase()}] ${f.title} (${f.category})`, true, 10, 14);
      push(`Message: ${f.message}`, false, 9, 13);
      if (f.quote) push(`Quoted span: "${f.quote}"`, false, 9, 13);
      if (f.location) push(`Location: ${f.location}`, false, 9, 13);
      if (f.suggestion) push(`Suggested correction: ${f.suggestion}`, false, 9, 13);
      push(`Source: ${f.source?.title} (${f.source?.source} v${f.source?.version}) | Decision: ${f.decision}${f.reason ? ' - ' + f.reason : ''}`, false, 9, 15);
    }
  }

  push('', false, 10, 8);
  push(`3. Claim Verification (${r.analysis?.claims?.length || 0})`, true, 12, 18);
  if (!r.analysis?.claims?.length) {
    push('No candidate factual or promotional claims detected.', false, 10, 14);
  } else {
    for (const c of r.analysis.claims) {
      push(
        `"${c.text}" -> ${c.status.toUpperCase()}${c.match_type ? ' (' + c.match_type + ')' : ''}: ${c.reason}`,
        false,
        9,
        14
      );
    }
  }

  push('', false, 10, 8);
  push('4. Governance & Method Disclosure', true, 12, 18);
  push(r.analysis?.disclosure || '', false, 9, 13);
  push(`Exported at ${new Date().toISOString()} | ByteRift BrandCompass`, false, 8, 12);

  // Paginate into 612x792 pages
  const pages = [];
  let currentOps = [];
  let y = 740;
  for (const item of lines) {
    if (y - item.gap < 54) {
      pages.push(currentOps.join('\n'));
      currentOps = [];
      y = 740;
    }
    if (item.text) {
      const font = item.bold ? '/F2' : '/F1';
      currentOps.push(`BT ${font} ${item.size} Tf 50 ${y} Td (${pdfClean(item.text)}) Tj ET`);
    }
    y -= item.gap;
  }
  if (currentOps.length || !pages.length) pages.push(currentOps.join('\n'));

  const objects = [];
  const addObj = body => {
    objects.push(body);
    return objects.length;
  };

  const fontRegularId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pagesObjId = addObj(''); // placeholder for /Pages

  const pageIds = [];
  for (const streamContent of pages) {
    const streamBytes = new TextEncoder().encode(streamContent);
    const contentId = addObj(`<< /Length ${streamBytes.length} >>\nstream\n${streamContent}\nendstream`);
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[pagesObjId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
