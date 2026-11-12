import { extractDocument, inspectImage } from './imports.js';
const $ = s => document.querySelector(s),
  esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  compass: 'M16 8l-3 5-5 3 3-5 5-3z M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  pen: 'm15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16z',
  check: 'm5 12 4 4L19 6',
  shield: 'm12 3 8 3v6c0 4-8 9-8 9s-8-5-8-9V6z M8 12l3 3 5-6',
  book: 'M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4z M12 6v15',
  chart: 'M4 4v16h17 M8 16v-4 M13 16V8 M18 16V5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-4',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M5 12h14 m-6-6 6 6-6 6',
  upload: 'M12 16V3 m-5 5 5-5 5 5 M4 15v5h16v-5',
  download: 'M12 3v13 m-5-5 5 5 5-5 M4 17v4h16v-4',
  close: 'm6 6 12 12 M6 18 18 6',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 9a3 3 0 1 1 5 2c-2 1-2 2 3 M12 17h.01',
  logout: 'M9 4H4v16h5 M8 12h13 m-5-5 5 5-5 5',
  file: 'M14 3H5v18h14V8z M14 3v5h5 M8 12h8 M8 16h6',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  image: 'M3 4h18v16H3z m0 12 5-5 5 5 3-3 5 5 M16 8h.01',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 m5 12 6 6',
  alert: 'm12 3 10 18H2z M12 9v5 M12 17h.01',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4'
};
const icon = (name, size = 17) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.file}"/></svg>`;
const date = (d, full = false) =>
  new Date(d).toLocaleString(undefined, full ? { dateStyle: 'medium', timeStyle: 'short' } : { month: 'short', day: 'numeric' });
const statusName = { draft: 'Draft', in_review: 'In review', approved: 'Approved', changes_requested: 'Changes requested' };
const statusBadge = s =>
  `<span class="pill ${s === 'approved' ? 'green' : s === 'in_review' ? 'amber' : s === 'changes_requested' ? 'red' : 'neutral'}"><span class="dot"></span>${statusName[s] || esc(s)}</span>`;
const empty = (title, description, action = '') =>
  `<div class="empty"><div class="empty-icon">${icon('compass', 24)}</div><h3>${title}</h3><p>${description}</p>${action}</div>`;
const btn = (text, action, cls = '', id = '', ico = '') =>
  `<button class="btn ${cls}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ''}>${ico ? icon(ico, 15) : ''}${text}</button>`;
const field = (label, name, value = '', type = 'text', extra = '') =>
  `<div class="field"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;

let S = null,
  view = 'overview',
  current = null,
  filter = 'all',
  knowledgeTab = 'rules',
  authMode = 'login',
  editorImage = null,
  editorGdoc = null,
  dirty = false,
  toastTimer,
  memberData = [],
  inviteData = [];

const blank = () => ({
  title: '',
  text: '',
  channel: 'Instagram',
  audience: 'Everyday explorers',
  alt: '',
  foreground: '#172B26',
  background: '#FFFFFF',
  largeText: false,
  image: null,
  gdoc: null,
  campaign: '',
  useAI: false,
  useLocalModel: false
});
let draftMemory = blank();
const currentReview = () => S?.state.reviews.find(r => r.id === current);
const editable = r => !r || ['admin', 'manager'].includes(S.user.role) || (S.user.role === 'creator' && r.created_by === S.user.id);

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 5000);
}
async function api(path, data) {
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-BC-Request': '1' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && S) {
      S = null;
      render();
    }
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}
async function load() {
  S = await api('/api/state');
  dirty = false;
  render();
}
function modal(title, content) {
  $('#modal').innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${content}<div id="modal-error" class="inline-error" role="alert"></div></div>`;
  if (!$('#modal').open) $('#modal').showModal();
}
function closeModal() {
  $('#modal').close();
}
function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  ($('#modal').open ? $('#modal') : document.body).append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function navigate(next, id = null) {
  if (dirty && !confirm('Discard unsaved changes to this draft?')) return;
  view = next;
  current = id;
  dirty = false;
  filter = 'all';
  render();
  window.scrollTo(0, 0);
}

const NAV = [
  ['overview', 'grid', 'Overview'],
  ['studio', 'pen', 'Review studio'],
  ['queue', 'shield', 'Approval queue'],
  ['knowledge', 'book', 'Knowledge base'],
  ['insights', 'chart', 'Insights'],
  ['audit', 'clock', 'Audit trail']
];

function render() {
  if (!S) {
    renderAuth();
    return;
  }
  const label = NAV.find(x => x[0] === view)?.[2] || 'Team & security',
    u = S.user,
    b = S.state.brand;
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar" aria-label="Workspace navigation"><a class="brand" href="#" data-action="nav" data-id="overview"><img src="/favicon.svg" alt=""><span>Brand<em>Compass</em></span></a><div class="workspace"><span class="workspace-symbol">${esc(b.name[0] || 'V')}</span><div><strong class="small">${esc(b.name)}</strong><small>${S.organisation.is_demo ? 'DEMO WORKSPACE' : 'BRAND WORKSPACE'}</small></div>${icon('compass', 16)}</div><div class="nav-label">YOUR WORKSPACE</div><nav class="nav">${NAV.map(([id, ico, name]) => `<button data-action="nav" data-id="${id}" class="${view === id ? 'active' : ''}" ${view === id ? 'aria-current="page"' : ''}>${icon(ico, 17)}${name}${id === 'queue' && S.insights.pending ? `<span class="count">${S.insights.pending}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="mode-note"><span class="dot"></span> ${S.ai_available ? 'Cloud + Local AI ready' : 'Semantic + Rules + Local AI'}<br><span style="font-size:10px">People make the final call.</span></div>${S.organisation.is_demo ? `<label class="small" for="demo-role" style="color:#b7cbbd;font-size:9px">DEMO ROLE</label><select id="demo-role" class="demo-select" aria-label="Switch demo role">${['creator', 'manager', 'reviewer', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select>` : ''}<div class="profile"><span class="avatar">${esc(u.name.split(' ').map(s => s[0]).join('').slice(0, 2))}</span><div><div class="profile-name">${esc(u.name)}</div><small>${esc(u.role)}${u.mfa_enabled ? ' · MFA' : ''}</small></div><button class="icon-btn push" data-action="logout" aria-label="Sign out">${icon('logout', 16)}</button></div><button class="btn full sm" data-action="nav" data-id="team">${icon('users', 14)}${u.role === 'admin' ? 'Team & security' : 'Account security'}</button></div></aside><div class="content"><header class="topbar"><button class="icon-btn mobile-toggle" data-action="menu" aria-label="Open navigation">${icon('menu')}</button><div class="breadcrumb">Workspace <span style="margin-left:10px;color:#bdc8b7">/</span><strong>${label}</strong></div><div class="top-actions"><span class="pill green" title="AES-256-GCM at-rest encryption & HMAC-signed audit">${icon('lock', 11)}Encrypted & signed</span><button class="btn sm" data-action="gdoc-hub">${icon('file', 13)}Google Docs (${(S.state.gdocs || []).length})</button><button class="icon-btn" data-action="guide" aria-label="Demo guide">${icon('help', 19)}</button><span class="avatar" style="width:29px;height:29px">${esc(u.name[0])}</span></div></header><main id="main" tabindex="-1">${view === 'overview' ? overview() : view === 'studio' ? studio() : view === 'queue' ? queue() : view === 'knowledge' ? knowledge() : view === 'insights' ? insightPage() : view === 'audit' ? auditPage() : teamPage()}<footer class="bottom-note"><span>BRANDCOMPASS v2.0 <strong> / Built by ByteRift</strong></span><span>${S.organisation.is_demo ? 'Fictional demo data ·' : ''} Semantic claims · Server OCR & visual checks · Google Docs sync.</span></footer></main></div></div>`;
}

function renderAuth() {
  $('#app').innerHTML = `<div class="auth-page"><section class="auth-story"><div class="brand"><img src="/favicon.svg" alt=""><span>Brand<em>Compass</em></span></div><div class="eyebrow">YOUR BRAND. A CLEARER DIRECTION.</div><h1>Every draft.<br><span>True to<br>your brand.</span></h1><p>Catch off-brand words, unverified claims, distorted logos and scanned document issues—directly in your browser or Google Docs workflow.</p><div class="auth-features"><div class="row">${icon('book')} Semantic claim extraction, unit conversion & paraphrase verification</div><div class="row">${icon('image')} Server-side OCR, regional palette & logo distortion checks</div><div class="row">${icon('shield')} Version-bound Google Docs approvals, MFA & signed audit chain</div></div><div class="auth-foot">A BYTE RIFT PROJECT &nbsp; / &nbsp; CODENEXUS INDIA<br>Poorvi S & Saathwik P Shettigar</div></section><section class="auth-side"><div class="auth-card"><div class="eyebrow">THE BRAND REVIEW STUDIO</div><h2>${authMode === 'login' ? 'Welcome to your workspace.' : 'Give your brand a home.'}</h2><p>${authMode === 'login' ? 'Bring your content, guidelines and reviewers into one thoughtful workflow.' : 'Create a workspace and add your team. Sample guidelines are included to help you get started.'}</p><form id="auth-form">${authMode === 'signup' ? field('Your name', 'name', '', 'text', 'required minlength="2" maxlength="80" autocomplete="name"') + field('Workspace name', 'organisation', '', 'text', 'required minlength="2" maxlength="100"') : ''}${field('Email address', 'email', '', 'email', 'required autocomplete="email" placeholder="you@yourteam.com"')}${field('Password', 'password', '', 'password', `required ${authMode === 'signup' ? 'minlength="10"' : ''} maxlength="200" autocomplete="${authMode === 'signup' ? 'new-password' : 'current-password'}" placeholder="${authMode === 'signup' ? 'At least 10 characters' : 'Enter your password'}"`)}<div id="auth-error" class="auth-error" role="alert"></div><button type="submit" class="btn primary full">${authMode === 'login' ? 'Sign in' : 'Create workspace'}${icon('arrow', 15)}</button></form><div class="auth-toggle">${authMode === 'login' ? 'New here?' : 'Already have an account?'} <button class="link-btn" data-action="auth-toggle">${authMode === 'login' ? 'Create a workspace' : 'Sign in'}</button> · <button class="link-btn" data-action="recover-modal">Recover password</button> · <button class="link-btn" data-action="accept-invite-modal">Accept invite</button></div><div class="divider">OR TAKE A LOOK AROUND</div><button class="btn full" data-action="demo">${icon('spark', 16)} Explore the live demo ${icon('arrow', 15)}</button><p class="legal">No account or API key needed for the demo.<br>A fresh, isolated workspace is created just for this session.</p></div></section></div>`;
}

function head(title, description, action = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
function metric(label, value, note, ico) {
  return `<div class="metric"><span class="label">${label}</span><span class="metric-icon">${icon(ico, 16)}</span><div class="value">${value ?? '—'}</div><div class="note">${note}</div></div>`;
}
function reviewTable(reviews) {
  if (!reviews.length)
    return empty('Your next great draft starts here.', 'Create a review to see cited findings, evidence and approval status.', btn('Start a review', 'new-review', 'primary', '', 'plus'));
  return `<div class="table-wrap"><table><thead><tr><th>Content</th><th>Status</th><th>Score</th><th>Updated</th></tr></thead><tbody>${reviews.map(r => `<tr><td><button class="table-title" data-action="open-review" data-id="${r.id}">${esc(r.title)}</button><div class="subtitle">${esc(r.channel)} · v${r.version}${r.gdoc ? ` · Google Doc (${esc(r.gdoc.doc_revision_id)})` : ''}</div></td><td>${statusBadge(r.status)}</td><td><strong style="color:${r.analysis.score < 50 ? 'var(--red)' : 'var(--teal)'}">${r.analysis.score}</strong><span class="muted"> / 100</span></td><td class="muted">${date(r.updated_at)}</td></tr>`).join('')}</tbody></table></div>`;
}

function overview() {
  const i = S.insights;
  return `${head('A little clarity. A better brand.', 'Here’s where your content stands today.', `<div class="row gap-sm">${btn('Google Docs review', 'gdoc-hub', '', '', 'file')}${btn('New review', 'new-review', 'primary', '', 'plus')}</div>`)}<section class="hero"><div class="hero-copy"><div class="eyebrow">FROM FIRST DRAFT TO FINAL CONFIDENCE</div><h2>Great content starts<br>with <span>a clear direction.</span></h2><p>Check your next idea against the voice, semantic facts, OCR text and visual rules that make your brand yours.</p><div class="row gap-sm">${btn('Review your content', 'new-review', 'lime', '', 'arrow')}${btn('Import from Google Docs', 'gdoc-hub', '', '', 'file')}</div></div><div class="hero-orbit" aria-hidden="true"><div class="orbit-core">${icon('compass', 70)}</div><div class="orbit-tag one">✓ &nbsp;Semantic claims</div><div class="orbit-tag two">◎ &nbsp;Server OCR & visual</div><div class="orbit-tag three">↗ &nbsp;Google Docs bound</div></div></section><div class="metrics">${metric('Content reviewed', i.reviews, 'Drafts in this workspace', 'file')}${metric('Awaiting approval', i.pending, 'Ready for a human review', 'clock')}${metric('Approved content', i.approved, 'Signed off by a reviewer', 'shield')}${metric('Average check score', i.average_score === null ? '—' : i.average_score + '<span style="font-size:13px;letter-spacing:0;color:#94a28c"> / 100</span>', 'Rule & semantic score', 'chart')}</div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Your review desk</h2><p>The latest drafts and their next steps.</p></div><button class="link-btn" data-action="nav" data-id="queue">View queue ${icon('arrow', 12)}</button></div>${reviewTable(S.state.reviews.slice(0, 5))}</section><section class="panel"><div class="panel-head"><div><h2>A more considered workflow</h2><p>Three upgrades built into your studio.</p></div>${icon('compass', 22)}</div><div class="guide-item"><span class="guide-number">01</span><div><h3>Semantic claims & paraphrases</h3><p>Recognises valid paraphrases and unit conversions (750 millilitres, 0.75 L, ₹999) while catching implicit comparisons like “twice as long”.</p></div></div><div class="guide-item"><span class="guide-number">02</span><div><h3>Server OCR & visual forensics</h3><p>Extracts text from scanned PDFs and artwork, verifies image headers on the server, and pinpoints logo distortion or regional palette issues.</p></div></div><div class="guide-item"><span class="guide-number">03</span><div><h3>Google Docs version binding</h3><p>Review Google Docs copy, apply accepted edits back to the doc, and bind approvals to the exact document revision.</p></div></div><div class="brand-bar">${S.state.brand.palette.slice(0, 5).map(c => `<span class="brand-swatch" style="background:${c}" title="${c}"></span>`).join('')}<span>${esc(S.state.brand.name)} palette</span></div></section></div>`;
}

function editorValues() {
  const f = $('#editor-form');
  if (!f) return null;
  const d = Object.fromEntries(new FormData(f));
  return {
    ...d,
    largeText: f.elements.largeText.checked,
    useAI: f.elements.useAI?.checked || false,
    useLocalModel: f.elements.useLocalModel?.checked || false,
    gdoc: editorGdoc ? structuredClone(editorGdoc) : null,
    image: editorImage
      ? {
          ...editorImage,
          kind: f.elements.imageKind?.value || 'graphic',
          ocr_text: f.elements.ocr_text?.value ?? editorImage.ocr_text ?? '',
          decorative: f.elements.decorative?.checked || false
        }
      : null
  };
}

function gdocBanner(r, d) {
  const g = r?.gdoc || d?.gdoc;
  if (!g) {
    return `<div class="banner info" style="justify-content:space-between"><span>${icon('file', 14)} <strong>Google Docs workflow:</strong> Connect a Google Doc to sync drafts, push accepted corrections back, and bind approvals to document revisions.</span>${btn('Connect Google Doc', 'gdoc-hub', 'sm', '', 'plus')}</div>`;
  }
  const bound = g.approval_bound_revision;
  const isBoundCurrent = r?.status === 'approved' && bound && bound.doc_revision_id === g.doc_revision_id;
  return `<div class="banner ${isBoundCurrent ? '' : 'info'}" style="justify-content:space-between;flex-wrap:wrap"><div><strong>Google Doc connected:</strong> ${esc(g.doc_title)} (<code>${esc(g.doc_id)}</code> · Document revision <code>${esc(g.doc_revision_id)}</code>)<br><small>${
    isBoundCurrent
      ? `Approval cryptographically bound to document revision ${esc(bound.doc_revision_id)} (hash ${esc(bound.content_sha256.slice(0, 12))}…). Later edits in Google Docs require a fresh review.`
      : 'Any edits in Google Docs create a new document revision and require re-approval.'
  }</small></div><div class="row gap-sm">${r ? btn('Sync / simulate Google Doc edit', 'gdoc-sync-modal', 'sm', r.id, 'clock') : ''}${r && r.analysis.findings.some(f => f.decision === 'open' && f.suggestion && Number.isInteger(f.start)) ? btn('Push all fixes to Google Doc', 'gdoc-apply-all', 'sm primary', r.id, 'check') : ''}</div></div>`;
}

function studio() {
  const r = currentReview(),
    d = r || draftMemory,
    canEdit = editable(r);
  editorImage = d.image ? structuredClone(d.image) : null;
  editorGdoc = d.gdoc ? structuredClone(d.gdoc) : null;
  return `${head(
    r ? esc(r.title) : 'Let’s find your direction.',
    r ? `${esc(r.channel)} · Revision ${r.version} · Created by ${esc(r.created_name)}` : 'Bring a draft or connect a Google Doc. Get a clear, evidence-backed review.',
    r ? `<div class="row gap-sm">${statusBadge(r.status)}${btn('Export / PDF / Publish', 'export-review', '', '', 'download')}</div>` : btn('All drafts', 'nav', '', 'queue', 'file')
  )}${r && r.analysis.knowledge_version !== S.state.knowledge_version ? '<div class="banner warn">' + icon('alert') + 'Guidelines changed after this review. Save and review again before approval.</div>' : ''}${gdocBanner(r, d)}<div id="dirty-banner" class="banner warn hidden">Unsaved changes. Save and review to refresh the findings and approval status.</div><div class="studio-grid"><section class="panel"><div class="panel-head"><h2>Your content</h2><span class="pill neutral">${canEdit ? 'Editable draft' : 'Read-only reviewer view'}</span></div><div class="panel-body"><form id="editor-form"><fieldset ${canEdit ? '' : 'disabled'} style="border:0;padding:0;margin:0;min-width:0">${field('Draft title', 'title', d.title, 'text', 'required maxlength="120" placeholder="Give this draft a name" class="draft-title"')}<div class="form-grid"><div class="field"><label for="channel">Channel</label><select name="channel" id="channel">${['Instagram', 'LinkedIn', 'Website', 'Email', 'Press release'].map(c => `<option ${d.channel === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>${field('Audience', 'audience', d.audience, 'text', 'maxlength="160"')}</div><div class="field" style="margin-bottom:0"><label for="draft-text">Draft text</label><textarea name="text" id="draft-text" class="draft-text" maxlength="16000" placeholder="Your next great idea goes here…">${esc(d.text)}</textarea></div><div class="editor-foot"><span id="word-count">${d.text.trim() ? d.text.trim().split(/\s+/).length : 0} words</span><div class="row gap-sm"><button type="button" class="link-btn" style="font-size:10px" data-action="gdoc-hub">${icon('file', 12)} Google Docs</button><label class="link-btn" style="font-size:10px;cursor:pointer">${icon('upload', 12)} Import TXT/PDF/DOCX (with OCR & tables)<input type="file" id="doc-file" accept=".txt,.md,.pdf,.docx" class="hidden"></label></div></div><details open><summary style="font-size:12px;color:var(--teal);cursor:pointer;margin-bottom:16px">Image, server OCR & visual governance checks</summary><div id="image-area">${imageArea(d)}</div><div class="field"><label for="alt">Image alt text</label><textarea name="alt" id="alt" rows="2" maxlength="700" placeholder="Describe the image’s purpose…">${esc(d.alt)}</textarea></div><div class="color-grid"><label class="color-field"><input type="color" name="foreground" value="${d.foreground || '#172B26'}">Text colour</label><label class="color-field"><input type="color" name="background" value="${d.background || '#FFFFFF'}">Background</label></div><label class="check"><input type="checkbox" name="largeText" ${d.largeText ? 'checked' : ''}>Large text: at least 24 px, or 18.67 px bold</label><p class="small" style="font-size:10px;margin-bottom:17px">Server verifies image dimensions/hashes, samples regional colours (top-left, center, etc.), detects logo aspect-ratio distortion or recolouring, and extracts OCR text from artwork.</p></details><label class="check"><input type="checkbox" name="useLocalModel" ${d.useLocalModel ? 'checked' : ''}>Use built-in self-hosted advisory model (runs locally offline with source validation)</label><label class="check"><input type="checkbox" name="useAI" ${S.ai_available ? '' : 'disabled'} ${d.useAI ? 'checked' : ''}>Use external cloud AI review ${S.ai_available ? '(sends draft text and retrieved sources to configured LLM)' : '— no external API key configured'}</label><button class="btn primary full" type="submit">${icon('spark', 16)} ${r ? 'Save & review again' : 'Run brand review'} ${icon('arrow', 15)}</button><p style="font-size:9px;text-align:center;margin-top:10px">Nothing is edited or approved automatically.</p></fieldset></form></div>${
    r
      ? `<div class="panel-body" style="border-top:1px solid var(--line)"><h3>Keep the work moving</h3><div class="footer-actions">${
          ['draft', 'changes_requested'].includes(r.status) && canEdit ? btn('Submit for approval', 'submit', 'primary', '', 'shield') : ''
        }${
          r.status === 'in_review' && ['admin', 'manager', 'reviewer'].includes(S.user.role)
            ? btn('Approve', 'approve', 'primary', '', 'check') + btn('Request changes', 'request-changes', '', '', 'pen')
            : ''
        }${btn('Revision history', 'history', '', '', 'clock')}${r.versions.length ? btn('Compare versions', 'compare', '', '', 'file') : ''}${btn('Comments (' + r.comments.length + ')', 'comments', '', '', 'users')}</div>${
          r.status === 'approved'
            ? `<div class="banner" style="margin-top:18px;margin-bottom:0">${icon('shield')}Approved by ${esc(r.approved_by)} · ${date(r.approved_at, true)}${
                r.gdoc?.approval_bound_revision ? ` · Bound to Google Doc ${esc(r.gdoc.approval_bound_revision.doc_revision_id)}` : ''
              }</div>`
            : ''
        }</div>`
      : ''
  }</section><div class="stack">${
    r
      ? findingsPanel(r)
      : `<section class="panel">${empty('A thoughtful second pair of eyes.', 'Run a review to see voice, semantic claims, terminology, OCR and visual findings. Every finding includes its source.')}<div class="disclosure">Default mode uses deterministic rules, structured semantic claim extraction and embedding retrieval. Self-hosted local advisory AI is available offline.</div></section><section class="panel"><div class="panel-head"><h2>Try a seeded example</h2></div><div class="panel-body"><p style="font-size:12px;line-height:1.8;margin-bottom:17px">A deliberately imperfect product caption makes a useful starting point. See what BrandCompass catches, then make it your own.</p><div class="row gap-sm">${btn('Load sample draft', 'sample', 'full', '', 'spark')}${btn('Load Google Doc brief', 'gdoc-hub', 'full', '', 'file')}</div></div></section>`
  }</div></div>`;
}

function imageArea(d) {
  if (!d.image) {
    return `<label class="upload">${icon('image', 18)}<span>Add campaign graphic, logo or scanned image</span><input type="file" id="image-file" accept="image/png,image/jpeg,image/webp"></label><p style="font-size:10px;margin:8px 0 14px">PNG, JPEG or WebP · Up to 5 MB · Automatic server verification, regional palette check & OCR</p>`;
  }
  const regionSummary = d.image.regions
    ? Object.entries(d.image.regions)
        .map(([k, cols]) => `${k}: ${(cols || []).slice(0, 2).join(', ')}`)
        .join(' · ')
    : '';
  return `<div class="image-preview"><img src="${esc(d.image.thumbnail)}" alt="Uploaded draft preview"><button type="button" class="icon-btn" data-action="remove-image" aria-label="Remove image">${icon('close')}</button><div class="row between small" style="font-size:10px;margin-top:8px"><span>${esc(d.image.name)} ${d.image.server_verified !== false ? '✓ Server verified' : '⚠ Unverified'}</span><span>${d.image.width} × ${d.image.height}</span></div><div class="swatches">${d.image.colors.map(c => `<span style="background:${c}" title="${c}"></span>`).join('')}</div>${regionSummary ? `<p class="small muted" style="font-size:9px;margin-top:6px">Regions: ${esc(regionSummary)}</p>` : ''}</div><div class="field"><label for="image-kind">Image type</label><select name="imageKind" id="image-kind">${['graphic', 'photo', 'logo'].map(k => `<option value="${k}" ${d.image.kind === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select></div><div class="field"><label for="ocr-text">Extracted image / artwork OCR text (reviewed for claims & terminology)</label><textarea name="ocr_text" id="ocr-text" rows="2" maxlength="8000" placeholder="Text detected inside the uploaded artwork appears here…">${esc(d.image.ocr_text || '')}</textarea></div><label class="check"><input type="checkbox" name="decorative" ${d.image.decorative ? 'checked' : ''}>This image is decorative and conveys no information.</label>`;
}

function findingsPanel(r) {
  const a = r.analysis,
    list = a.findings.filter(f => (filter === 'all' || filter === 'resolved' ? filter === 'all' || f.decision !== 'open' : f.severity === filter && f.decision === 'open'));
  return `<section class="panel"><div class="score-box"><div class="score-ring" style="--score:${a.score}"><strong>${a.score}</strong></div><div><div class="eyebrow">BRAND CHECK SCORE</div><h2>${a.score >= 90 ? 'Looking considered.' : a.score >= 50 ? 'A few things to refine.' : 'Let’s give this a little care.'}</h2><p>${a.findings.filter(f => f.decision === 'open').length} open findings · Knowledge v${a.knowledge_version} · Engine v${esc(a.engine || '2.0.0')}</p></div></div><div class="filterbar">${[['all', 'All findings'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['resolved', 'Resolved']].map(([id, text]) => `<button data-action="filter" data-id="${id}" class="${filter === id ? 'active' : ''}">${text}</button>`).join('')}</div>${list.length ? list.map(f => findingCard(f, r)).join('') : empty('Nothing in this view.', a.findings.length ? 'Try another severity filter.' : 'No configured rule violations were found. Human review is still required.')}<div class="disclosure">${esc(a.disclosure)}<br>Check score = 100 − weighted findings (high: 18, medium: 8, low: 3), floored at 0. Overrides do not improve the score.</div></section>${
    a.claims.length
      ? `<section class="panel"><div class="panel-head"><h2>Semantic claim extraction & evidence</h2><span class="pill neutral">${a.claims.length} detected</span></div><div class="panel-body">${a.claims
          .map(
            c =>
              `<div class="claim-item"><p>“${esc(c.text)}”</p><div class="row wrap gap-sm"><span class="pill ${c.status === 'supported' ? 'green' : 'amber'}">${
                c.status === 'supported'
                  ? c.match_type === 'semantic_paraphrase'
                    ? 'Verified semantic paraphrase'
                    : 'Exact approved match'
                  : c.status === 'expired'
                  ? 'Expired evidence'
                  : 'Cannot verify'
              }</span>${c.structured?.domain ? `<span class="pill neutral">Domain: ${esc(c.structured.domain)}</span>` : ''}${
                c.structured?.quantities?.length
                  ? `<span class="pill neutral">Quantities: ${esc(c.structured.quantities.map(q => `${q.canonicalValue}${q.maxValue ? '-' + q.maxValue : ''} ${q.canonicalUnit}`).join(', '))}</span>`
                  : ''
              }${c.location ? `<span class="pill blue">${esc(c.location)}</span>` : ''}</div><small>${esc(c.reason)}</small>${
                c.source ? `<small>${esc(c.source.source)} · v${c.source.version}<br>${esc(c.source.excerpt)}</small>` : ''
              }</div>`
          )
          .join('')}</div></section>`
      : ''
  }`;
}

function findingCard(f, r) {
  return `<article class="finding"><div class="finding-title"><span class="severity-dot ${f.severity}"></span><span class="eyebrow" style="font-size:8px;letter-spacing:1px;color:var(--muted)">${esc(f.category)} · ${f.severity}${f.location ? ' · ' + esc(f.location) : ''}</span></div><h3>${esc(f.title)}</h3>${f.quote ? `<blockquote>${esc(f.quote)}</blockquote>` : ''}<p>${esc(f.message)}</p>${f.suggestion ? `<div class="suggestion"><strong>Suggested edit</strong><br>${esc(f.suggestion)}</div>` : ''}<details><summary>${icon('book', 11)} ${esc(f.source.title)} · v${f.source.version}</summary><p>${esc(f.source.excerpt)}</p><p>Source: ${esc(f.source.source)}<br>Method: ${esc(f.certainty)}</p>${f.evidence ? `<p><strong>Related approved evidence</strong><br>${esc(f.evidence.excerpt)}<br>${esc(f.evidence.source)} · v${f.evidence.version}</p>` : ''}</details>${f.decision !== 'open' ? `<div class="decision-line">${esc(f.decision)} by ${esc(f.decided_by)}<br>${esc(f.reason)}</div>` : ''}${
    r.status !== 'approved'
      ? `<div class="finding-actions">${
          f.suggestion && Number.isInteger(f.start) && editable(r)
            ? btn('Apply suggestion', 'apply', 'sm', '' + f.id, 'check') +
              (r.gdoc ? btn('Apply & sync to Google Doc', 'gdoc-apply', 'sm primary', '' + f.id, 'file') : '')
            : ''
        }${btn(f.decision === 'open' ? 'Record decision' : 'Reopen finding', 'decision', 'sm', '' + f.id, 'pen')}</div>`
      : ''
  }</article>`;
}

function queue() {
  const list = S.state.reviews;
  return `${head('Good work deserves a second look.', 'Review the details, discuss changes and sign off with confidence.', btn('New review', 'new-review', 'primary', '', 'plus'))}<div class="banner info">${icon('shield')}Approval requires a different team member, current guidelines and no unresolved high-severity findings. Google Docs approvals bind to the exact document revision.</div><section class="panel"><div class="panel-head"><h2>All content</h2><span class="pill neutral">${list.length} drafts</span></div>${reviewTable([...list].sort((a, b) => (b.status === 'in_review') - (a.status === 'in_review') || b.updated_at.localeCompare(a.updated_at)))}</section>`;
}

function knowledge() {
  const canManage = ['admin', 'manager'].includes(S.user.role),
    items = S.state[knowledgeTab] || [],
    isFacts = knowledgeTab === 'facts';
  return `${head(
    'Your brand’s source of truth.',
    'Approved knowledge gives every review a clear foundation.',
    canManage
      ? btn(
          knowledgeTab === 'assets' ? 'Approve asset' : isFacts ? 'Add approved fact' : 'Add guideline',
          knowledgeTab === 'assets' ? 'add-asset' : isFacts ? 'add-fact' : 'add-rule',
          'primary',
          '',
          'plus'
        )
      : ''
  )}<div class="banner info">${icon('book')}Knowledge v${S.state.knowledge_version} · ${S.state.rules.length} guidelines · ${S.state.facts.length} approved facts. ${S.organisation.is_demo ? 'All example material is fictional.' : ''}</div><div class="toolbar"><div class="tabs" style="margin:0">${[['rules', 'Guidelines'], ['facts', 'Approved facts'], ['assets', 'Visual assets']].map(([id, n]) => `<button data-action="knowledge-tab" data-id="${id}" class="${knowledgeTab === id ? 'active' : ''}">${n}</button>`).join('')}</div>${canManage ? btn('Brand settings', 'brand-settings', '', '', 'pen') : ''}</div>${
    knowledgeTab !== 'assets'
      ? `<div class="toolbar"><input class="search-input" id="knowledge-search" placeholder="Search approved knowledge…" aria-label="Search approved knowledge"><span class="small muted">${items.length} sources</span></div><div class="knowledge-grid" id="knowledge-list">${items.map(s => knowledgeCard(s, isFacts, canManage)).join('')}</div>`
      : `<section class="panel"><div class="panel-head"><h2>Approved visual assets & geometry</h2></div>${
          items.length
            ? `<div class="panel-body">${items.map(a => `<div class="revision"><h3>${esc(a.name)}</h3><p class="mono">SHA-256: ${a.sha256}</p><p class="small">Reference geometry: ${a.width || 512} × ${a.height || 512} px · Approved by ${esc(a.approved_by)} · ${date(a.at)}</p></div>`).join('')}</div>`
            : empty('A home for your approved assets.', 'Upload the approved logo file. Future logo uploads are checked for fingerprint, aspect-ratio distortion, cropping and palette fidelity.')
        }</section>`
  }<div class="notes" style="margin-top:20px">Approved facts power both exact matching and structured semantic paraphrase verification (matching quantities, canonical units, negation polarity and expiry date).</div>`;
}

function knowledgeCard(s, isFact, canManage) {
  return `<article class="knowledge-card" data-search="${esc((s.title + ' ' + (s.text || s.body)).toLowerCase())}"><div class="row between"><span class="pill ${isFact ? 'green' : 'neutral'}">${icon(isFact ? 'check' : 'book', 11)}${isFact ? 'Approved fact' : esc(s.type)}</span><span class="small muted">v${s.version}${s.active === false ? ' · Inactive' : ''}</span></div><h3>${esc(s.title)}</h3><p>${esc(s.text || s.body)}</p>${isFact ? `<p style="margin-top:10px;font-size:10px">Valid until ${esc(s.valid_until || 'No expiry set')}</p>` : ''}<footer><span>${esc(s.source)}</span>${canManage ? `<button class="link-btn" data-action="${isFact ? 'edit-fact' : 'edit-rule'}" data-id="${s.id}">Edit</button>` : ''}</footer></article>`;
}

function insightPage() {
  const i = S.insights;
  return `${head('Make the guidelines better, too.', 'See recurring friction and the rules your team keeps questioning.', btn('Export workspace', 'export-workspace', '', '', 'download'))}<div class="metrics">${metric('Reviews analysed', i.reviews, 'Latest revision of each draft', 'file')}${metric('Open findings', i.open_issues, 'Issues still awaiting action', 'alert')}${metric('Human approvals', i.approved, 'Approved current revisions', 'shield')}${metric('Guidelines in use', S.state.rules.filter(r => r.active !== false).length, 'Active brand policies', 'book')}</div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Guideline health</h2><p>Frequent overrides can be a signal to clarify a rule.</p></div>${icon('chart')}</div><div class="table-wrap"><table><thead><tr><th>Guideline</th><th>Flags</th><th>Disputed</th><th>Health</th></tr></thead><tbody>${i.rule_health.map(r => `<tr><td>${esc(r.title)}</td><td>${r.flags}</td><td>${r.overrides}</td><td><span class="health-score">${r.health === null ? '—' : r.health + '%'}</span></td></tr>`).join('')}</tbody></table></div><div class="disclosure">${esc(i.formula)} Findings and disputes refer to current revisions; earlier decisions remain in history and the audit trail.</div></section><section class="panel"><div class="panel-head"><h2>Content by channel</h2></div><div class="panel-body">${i.by_channel.length ? i.by_channel.map(b => `<div class="bar-row"><div class="bar-label"><strong>${esc(b.channel)}</strong><span>${b.reviews} drafts · ${b.issues} findings</span></div><div class="bar"><i style="width:${(100 * b.reviews) / Math.max(...i.by_channel.map(c => c.reviews))}%"></i></div></div>`).join('') : empty('No data yet.', 'Your first review will appear here.')}</div></section></div>`;
}

function auditPage() {
  return `${head('A clear record of every decision.', 'Who changed what, when, and why.', btn('Verify HMAC & SHA-256 chain', 'verify-audit', 'primary', '', 'shield'))}<div class="banner info">${icon('lock')}Events are linked by SHA-256 hashes AND signed with HMAC-SHA256 anchors. Workspace state is encrypted at rest with AES-256-GCM.</div><section class="panel"><div class="panel-head"><h2>Workspace activity</h2><span class="pill neutral">${S.state.audit.length} signed events</span></div>${S.state.audit
    .slice()
    .reverse()
    .map(
      e =>
        `<article class="audit-item"><span class="audit-dot">${icon(e.action.includes('approve') ? 'shield' : 'clock', 14)}</span><div style="min-width:0;flex:1"><div class="row between wrap"><h3>${esc(e.actor)} <span class="muted" style="font-weight:400">· ${esc(e.role)}</span></h3><span class="muted" style="font-size:9px">${date(e.at, true)}</span></div><p><strong>${esc(e.action.replaceAll('.', ' / '))}</strong> · ${esc(e.detail)}</p><span class="mono">Hash: ${e.hash.slice(0, 20)}… ${e.anchor ? '· HMAC Anchor: ' + e.anchor.slice(0, 16) + '…' : ''}</span></div></article>`
    )
    .join('')}</section>`;
}

function teamPage() {
  const isAdmin = S.user.role === 'admin';
  const ret = S.state.retention || { max_drafts: 120, max_revisions: 25, demo_ttl_hours: 24 };
  return `${head(
    'Team, security & retention.',
    'Manage members, signed invitations, TOTP multi-factor authentication and workspace retention.',
    isAdmin ? `<div class="row gap-sm">${btn('Invite member', 'invite-member', '', '', 'plus')}${btn('Add member directly', 'add-member', 'primary', '', 'plus')}</div>` : ''
  )}<div class="dashboard-grid"><section class="panel"><div class="panel-head"><h2>Account security & MFA</h2><span class="pill ${S.user.mfa_enabled ? 'green' : 'neutral'}">${S.user.mfa_enabled ? 'MFA active' : 'Standard auth'}</span></div><div class="panel-body"><p style="font-size:12px;margin-bottom:14px">Signed in as <strong>${esc(S.user.name)}</strong> (${esc(S.user.email)}) · Role: <strong>${esc(S.user.role)}</strong></p><div class="row wrap gap-sm">${btn('Set up TOTP MFA', 'mfa-modal', 'sm primary', '', 'shield')}${btn('Change password', 'password-modal', 'sm', '', 'lock')}</div></div></section>${
    isAdmin
      ? `<section class="panel"><div class="panel-head"><h2>Retention & demo cleanup</h2></div><div class="panel-body"><form id="retention-form"><div class="form-grid">${field('Max drafts / workspace', 'max_drafts', ret.max_drafts, 'number', 'min="10" max="500"')}${field('Max revisions / draft', 'max_revisions', ret.max_revisions, 'number', 'min="5" max="100"')}</div>${field('Demo workspace expiry (hours)', 'demo_ttl_hours', ret.demo_ttl_hours, 'number', 'min="1" max="720"')}<button class="btn primary sm" type="submit">Save limits & run cleanup</button></form></div></section>`
      : ''
  }</div>${
    isAdmin
      ? `<section class="panel" style="margin-top:20px"><div class="panel-head"><h2>Workspace members</h2>${btn('Refresh', 'load-members', 'sm')}</div><div id="member-list">${
          memberData.length
            ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${memberData.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td><span class="pill neutral">${esc(m.role)}</span></td></tr>`).join('')}</tbody></table></div>`
            : empty('Load your team.', 'Use Refresh to view current workspace members and pending invitations.')
        }</div></section>`
      : ''
  }`;
}

function gdocHubModal() {
  const docs = S.state.gdocs || [];
  modal(
    'Google Docs review integration',
    `<p>Submit Google Docs content to BrandCompass, inspect findings and approval status, and apply accepted corrections back to the document. Approvals are cryptographically bound to the reviewed document revision.</p>${
      docs.length
        ? `<div class="stack" style="margin-bottom:20px">${docs
            .map(g => {
              const linked = S.state.reviews.find(r => r.gdoc?.doc_id === g.doc_id);
              const bound = linked?.gdoc?.approval_bound_revision;
              const isValid = linked?.status === 'approved' && bound?.doc_revision_id === g.doc_revision_id;
              return `<div class="revision"><div class="row between wrap"><strong>${esc(g.doc_title)}</strong><span class="pill ${isValid ? 'green' : 'neutral'}">Doc ${esc(g.doc_revision_id)} · ${
                isValid ? 'Approved & bound' : linked ? statusName[linked.status] || linked.status : 'Not reviewed yet'
              }</span></div><p class="small muted">${esc(g.doc_url)}</p><pre>${esc(g.text)}</pre><div class="row gap-sm" style="margin-top:10px">${btn(
                linked ? 'Open & sync in Studio' : 'Review this Google Doc',
                'review-gdoc',
                'sm primary',
                g.doc_id,
                'arrow'
              )}</div></div>`;
            })
            .join('')}</div>`
        : ''
    }<hr style="border:0;border-top:1px solid var(--line);margin:18px 0"><h3>Connect or import another Google Doc</h3><form id="gdoc-connect-form">${field('Google Doc title', 'doc_title', '', 'text', 'required maxlength="160" placeholder="Q4 Campaign Copy"')}<div class="form-grid">${field('Google Doc ID or URL', 'doc_id', '', 'text', 'required maxlength="120" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"')}${field('Document revision tag', 'doc_revision_id', 'rev-1', 'text', 'required maxlength="40"')}</div><div class="field"><label for="gdoc-channel">Target channel</label><select id="gdoc-channel" name="channel">${['Website', 'Instagram', 'LinkedIn', 'Email', 'Press release'].map(c => `<option>${c}</option>`).join('')}</select></div><div class="field"><label for="gdoc-text">Document text</label><textarea id="gdoc-text" name="text" required maxlength="16000" placeholder="Paste or sync the Google Doc content to review…"></textarea></div><button class="btn primary full" type="submit">Connect & run BrandCompass review</button></form>`
  );
}

function gdocSyncModal(reviewId) {
  const r = S.state.reviews.find(x => x.id === reviewId) || currentReview();
  if (!r?.gdoc) return;
  const revNum = (parseInt(String(r.gdoc.doc_revision_id).replace(/\D+/g, ''), 10) || 1) + 1;
  modal(
    'Sync / simulate Google Doc edit',
    `<p>When a collaborator edits the linked Google Doc (<code>${esc(r.gdoc.doc_id)}</code>), its document revision advances. Syncing updated text into BrandCompass automatically invalidates any previous approval and requires a fresh review.</p><form id="gdoc-sync-form"><input type="hidden" name="review_id" value="${esc(r.id)}">${field('New Google Doc revision ID', 'doc_revision_id', `rev-${revNum}`, 'text', 'required maxlength="40"')}<div class="field"><label for="gdoc-sync-text">Updated Google Doc text</label><textarea id="gdoc-sync-text" name="text" required maxlength="16000">${esc(r.text)}</textarea></div><button class="btn primary full" type="submit">Sync new document revision & re-verify</button></form>`
  );
}

function ruleModal(id) {
  const r = S.state.rules.find(x => x.id === id);
  modal(
    r ? 'Edit guideline' : 'Add a guideline',
    `<form id="knowledge-form"><input type="hidden" name="kind" value="rule"><input type="hidden" name="id" value="${esc(r?.id || '')}">${field('Guideline title', 'title', r?.title || '', 'text', 'required maxlength="100"')}<div class="form-grid"><div class="field"><label for="rule-type">Check type</label><select name="type" id="rule-type">${['term', 'tone', 'claims', 'alt', 'contrast', 'palette', 'asset', 'readability', 'disclaimer'].map(t => `<option ${r?.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div class="field"><label for="severity">Severity</label><select name="severity" id="severity">${['low', 'medium', 'high'].map(t => `<option ${t === (r?.severity || 'medium') ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div><div class="field"><label for="source-text">Guideline wording</label><textarea id="source-text" name="text" required maxlength="2000">${esc(r?.body || '')}</textarea><label class="link-btn" style="font-size:10px;cursor:pointer">Import TXT / PDF / DOCX <input type="file" id="source-document" accept=".txt,.md,.pdf,.docx" class="hidden"></label></div>${field('Source name or reference', 'source', r?.source || 'Brand Handbook', 'text', 'required maxlength="160"')}<div class="notes">Choose a check type to define its behaviour. Term checks use the replacements below; tone checks use the phrases.</div><div class="spacer"></div><div class="field"><label for="term-lines">Terms (one “avoid → preferred” pair per line)</label><textarea id="term-lines" name="term_lines" rows="2" placeholder="cheap → affordable">${esc((r?.config.terms || []).map(t => t.term + ' → ' + t.replacement).join('\n'))}</textarea></div>${field('Tone phrases to flag, comma separated', 'phrases', (r?.config.phrases || []).join(', '))}${field('Required offer statement (disclaimer check)', 'required_text', r?.config.text || 'Terms apply.')}<label class="check"><input type="checkbox" name="active" ${r?.active === false ? '' : 'checked'}>Active guideline</label><button class="btn primary full" type="submit">Save approved guideline</button></form>`
  );
}

function factModal(id) {
  const f = S.state.facts.find(x => x.id === id);
  modal(
    f ? 'Edit approved fact' : 'Add an approved fact',
    `<form id="knowledge-form"><input type="hidden" name="kind" value="fact"><input type="hidden" name="id" value="${esc(f?.id || '')}">${field('Fact title', 'title', f?.title || '', 'text', 'required maxlength="100"')}<div class="field"><label for="source-text">Approved statement</label><textarea id="source-text" name="text" required maxlength="2000" placeholder="Verdant Bottle holds 750 ml.">${esc(f?.text || '')}</textarea><label class="link-btn" style="font-size:10px;cursor:pointer">Import source text <input type="file" id="source-document" accept=".txt,.md,.pdf,.docx" class="hidden"></label></div>${field('Source name or reference', 'source', f?.source || 'Product Fact Sheet', 'text', 'required maxlength="160"')}${field('Valid until (optional)', 'valid_until', f?.valid_until || '', 'date')}<label class="check"><input type="checkbox" name="active" ${f?.active === false ? '' : 'checked'}>Approved and active</label><div class="notes" style="margin-bottom:18px">Facts support both exact statements and verified paraphrases when quantities, canonical units, polarity and expiry all pass.</div><button class="btn primary full" type="submit">Save approved fact</button></form>`
  );
}

function decisionModal(id) {
  const f = currentReview().analysis.findings.find(x => x.id === id),
    isHigh = f.severity === 'high';
  modal(
    'Record a human decision',
    `<p>${esc(f.title)}</p><form id="decision-form"><input type="hidden" name="finding_id" value="${f.id}"><div class="field"><label for="decision">Decision</label><select name="decision" id="decision">${f.decision !== 'open' ? '<option value="open">Reopen finding</option>' : isHigh ? '<option value="overridden">Override with a documented reason</option>' : '<option value="dismissed">Dismiss finding</option><option value="overridden">Override (reviewer / manager only)</option>'}</select></div><div class="field"><label for="reason">Why is this appropriate?</label><textarea id="reason" name="reason" required minlength="5" maxlength="600" placeholder="Explain your decision for the next reviewer…"></textarea></div>${isHigh ? '<div class="notes" style="margin-bottom:16px">High-severity decisions require a reviewer, manager or administrator.</div>' : ''}<button class="btn primary full">Save decision</button></form>`
  );
}

function guide() {
  modal(
    'A three-minute demo',
    `<div class="eyebrow" style="color:var(--teal);margin-bottom:18px">BRANDCOMPASS v2.0 / BYTERIFT</div><p>Use the fictional Verdant workspace to demonstrate the whole review journey, including Improvements 1, 2 and 3.</p><ol><li><strong>Semantic claims & paraphrases (Improvement 1).</strong> Open the seeded draft or paste a paraphrase like <code>The Verdant Bottle has a capacity of 750 millilitres and is priced at ₹999.</code> Show that valid paraphrases with matching quantities/units are verified, while implicit claims like <code>Our bottle lasts twice as long</code> are flagged.</li><li><strong>Server OCR & visual validation (Improvement 2).</strong> Upload a graphic or logo to demonstrate server-verified dimensions, regional palette violations (top-left, center, etc.), logo distortion checks and OCR text extraction.</li><li><strong>Google Docs integration (Improvement 3).</strong> Open <strong>Google Docs</strong> in the top bar, review the connected doc, push an accepted correction back to the doc, approve it under another role, and show that editing the Google Doc invalidates the prior approval.</li><li><strong>Native PDF & HMAC Audit.</strong> Download the native PDF report directly and verify the HMAC-signed audit chain.</li></ol>`
  );
}

function compareModal() {
  const r = currentReview(),
    p = r.versions.at(-1),
    a = p.text,
    b = r.text;
  let start = 0,
    end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length, b.length) - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const format = (text, tag) =>
    esc(text.slice(0, start)) + `<${tag}>` + esc(text.slice(start, end ? text.length - end : text.length)) + `</${tag}>` + esc(end ? text.slice(-end) : '');
  modal(
    'Compare the latest revisions',
    `<p>Changed text is highlighted from the first difference to the last.</p><div class="diff-grid"><div><strong>Revision ${p.version} · Score ${p.analysis.score}</strong><hr>${format(a, 'del')}</div><div><strong>Revision ${r.version} · Score ${r.analysis.score}</strong><hr>${format(b, 'mark')}</div></div>`
  );
}

async function reviewAction(action, extra = {}) {
  if (dirty) throw new Error('Save and review your edits before taking another action.');
  await api('/api/reviews/' + current, { revision: S.revision, action, ...extra });
  await load();
}

async function clickAction(action, id, el) {
  if (action === 'nav') {
    navigate(id);
    if (id === 'team' && S.user.role === 'admin') {
      const res = await api('/api/members');
      memberData = res.members;
      inviteData = res.invitations || [];
      render();
    }
    return;
  }
  if (action === 'menu') {
    $('.sidebar').classList.toggle('open');
    return;
  }
  if (action === 'close-modal') {
    closeModal();
    return;
  }
  if (action === 'auth-toggle') {
    authMode = authMode === 'login' ? 'signup' : 'login';
    render();
    return;
  }
  if (action === 'recover-modal') {
    modal(
      'Recover your password',
      `<form id="recover-form">${field('Account email', 'email', '', 'email', 'required')}<button class="btn primary full" type="submit">Generate recovery token</button></form><div class="spacer"></div><form id="reset-form">${field('Recovery token', 'token', '', 'text', 'required')}${field('New password (min 10 chars)', 'new_password', '', 'password', 'required minlength="10"')}<button class="btn full" type="submit">Reset password</button></form>`
    );
    return;
  }
  if (action === 'accept-invite-modal') {
    modal(
      'Accept team invitation',
      `<form id="accept-invite-form">${field('Invitation token', 'token', '', 'text', 'required')}${field('Choose your password (min 10 chars)', 'password', '', 'password', 'required minlength="10"')}<button class="btn primary full" type="submit">Join workspace</button></form>`
    );
    return;
  }
  if (action === 'demo') {
    await api('/api/demo', {});
    view = 'overview';
    await load();
    return;
  }
  if (action === 'logout') {
    if (dirty && !confirm('Discard your unsaved changes and sign out?')) return;
    await api('/api/logout', {});
    S = null;
    current = null;
    draftMemory = blank();
    render();
    return;
  }
  if (action === 'new-review') {
    draftMemory = blank();
    navigate('studio');
    return;
  }
  if (action === 'open-review') {
    navigate('studio', id);
    return;
  }
  if (action === 'sample') {
    draftMemory = {
      ...blank(),
      title: 'A better everyday bottle',
      text: "Introducing the revolutionary Verdant Bottle! The world's best bottle keeps drinks cold for 48 hours. This cheap upgrade costs INR 699. HURRY, SHOP NOW!!!",
      foreground: '#9CA3AF',
      background: '#FFFFFF'
    };
    render();
    markDirty();
    return;
  }
  if (action === 'gdoc-hub') {
    gdocHubModal();
    return;
  }
  if (action === 'review-gdoc') {
    const doc = (S.state.gdocs || []).find(g => g.doc_id === id);
    if (!doc) return;
    const res = await api('/api/gdocs', { ...doc, create_review: true, revision: S.revision });
    closeModal();
    await load();
    navigate('studio', res.review_id);
    toast('Google Doc synced into Review Studio.');
    return;
  }
  if (action === 'gdoc-sync-modal') {
    gdocSyncModal(id);
    return;
  }
  if (action === 'gdoc-apply') {
    await reviewAction('gdoc_apply', { finding_id: id });
    toast('Correction applied and synced back to the linked Google Doc.');
    return;
  }
  if (action === 'gdoc-apply-all') {
    await reviewAction('gdoc_apply', { apply_all: true });
    toast('All suggested corrections applied and synced back to the Google Doc.');
    return;
  }
  if (action === 'filter') {
    filter = id;
    const memory = editorValues();
    render();
    if (dirty && memory) restoreEditor(memory);
    return;
  }
  if (action === 'guide') {
    guide();
    return;
  }
  if (action === 'knowledge-tab') {
    knowledgeTab = id;
    render();
    return;
  }
  if (action === 'add-rule' || action === 'edit-rule') {
    ruleModal(id);
    return;
  }
  if (action === 'add-fact' || action === 'edit-fact') {
    factModal(id);
    return;
  }
  if (action === 'add-asset') {
    modal(
      'Approve a visual asset',
      '<p>Select the original approved logo or asset. Its SHA-256 fingerprint, reference dimensions and palette are stored for distortion & recolouring checks.</p><form id="asset-form"><div class="field"><label for="asset-file">Approved file</label><input id="asset-file" type="file" accept="image/png,image/jpeg,image/webp" required></div><button class="btn primary full">Approve asset fingerprint & geometry</button></form>'
    );
    return;
  }
  if (action === 'brand-settings') {
    const b = S.state.brand;
    modal(
      'Brand settings',
      `<form id="brand-form">${field('Brand name', 'name', b.name, 'text', 'required maxlength="80"')}${field('Tagline', 'tagline', b.tagline, 'text', 'maxlength="160"')}${field('Approved colours, comma separated', 'palette', b.palette.join(', '), 'text', 'required')}<button class="btn primary full">Save brand settings</button></form>`
    );
    return;
  }
  if (action === 'apply') {
    await reviewAction('apply', { finding_id: id });
    toast('Suggestion applied. A new revision has been reviewed.');
    return;
  }
  if (action === 'decision') {
    if (dirty) throw new Error('Save your edits before recording a decision.');
    decisionModal(id);
    return;
  }
  if (action === 'submit') {
    await reviewAction('submit');
    toast('Submitted. A different team member can now review it.');
    return;
  }
  if (action === 'approve' || action === 'request-changes') {
    modal(
      action === 'approve' ? 'Approve this revision' : 'Request changes',
      `<form id="workflow-form"><input type="hidden" name="action" value="${action === 'approve' ? 'approve' : 'request_changes'}"><div class="field"><label for="workflow-reason">${action === 'approve' ? 'Approval note' : 'What needs to change?'}</label><textarea name="reason" id="workflow-reason" required minlength="5" maxlength="600"></textarea></div><button class="btn primary full">${action === 'approve' ? 'Approve current revision' : 'Send revision request'}</button></form>`
    );
    return;
  }
  if (action === 'history') {
    const r = currentReview();
    modal(
      'Revision history',
      [...r.versions, { ...r, at: r.updated_at }]
        .reverse()
        .map(
          v =>
            `<div class="revision"><div class="row between"><strong>Revision ${v.version}${v.gdoc ? ` · Google Doc ${esc(v.gdoc.doc_revision_id)}` : ''}</strong>${statusBadge(v.status)}</div><p class="small">${date(v.at, true)} · Score ${v.analysis.score} · ${v.analysis.findings.length} findings</p><pre>${esc(v.text)}</pre>${
              v.decisions
                ?.filter(f => f.decision !== 'open')
                .map(f => `<p class="small">${esc(f.title)}: ${esc(f.decision)} — ${esc(f.reason)}</p>`)
                .join('') || ''
            }</div>`
        )
        .join('')
    );
    return;
  }
  if (action === 'compare') {
    compareModal();
    return;
  }
  if (action === 'comments') {
    const r = currentReview();
    modal(
      'Team discussion',
      `${
        r.comments.length
          ? r.comments.map(c => `<div class="comment"><strong class="small">${esc(c.author)}</strong> <small>${esc(c.role)} · ${date(c.at, true)}</small><p>${esc(c.text)}</p></div>`).join('')
          : '<p>Start a conversation about this draft.</p>'
      }<div class="spacer"></div><form id="comment-form"><div class="field"><label for="comment-text">Your comment</label><textarea id="comment-text" name="text" required maxlength="1200"></textarea></div><button class="btn primary">Add comment</button></form>`
    );
    return;
  }
  if (action === 'remove-image') {
    editorImage = null;
    $('#image-area').innerHTML = imageArea({ image: null });
    markDirty();
    return;
  }
  if (action === 'export-review') {
    if (dirty) throw new Error('Save and review before exporting.');
    const r = currentReview();
    modal(
      'Export & publish your review',
      `<p>Download the current revision in native PDF, HTML, JSON or CSV format, or publish approved content to a connected channel.</p><div class="stack"><a class="btn primary" href="/api/reports/${r.id}/pdf" download>Download native PDF report (.pdf)</a><a class="btn" href="/api/reports/${r.id}/html" download>Download report (.html)</a><a class="btn" href="/api/reports/${r.id}/json" download>Download review (.json)</a><a class="btn" href="/api/reports/${r.id}/csv" download>Download findings (.csv)</a><a class="btn" href="/api/reports/${r.id}/html?inline=1" target="_blank" rel="noopener">Open printable report</a>${
        r.status === 'approved' && ['admin', 'manager'].includes(S.user.role)
          ? btn('Publish approved content to CMS / Webhook', 'publish-review', 'lime', r.id, 'arrow')
          : ''
      }</div><div class="notes" style="margin-top:20px">Native PDF is generated directly on the server. Publishing requires an active approval on the current guideline and document revision.</div>`
    );
    return;
  }
  if (action === 'publish-review') {
    await reviewAction('publish', { target: 'cms_webhook' });
    closeModal();
    toast('Approved review published and logged in the audit chain.');
    return;
  }
  if (action === 'export-workspace') {
    download('BrandCompass_Workspace.json', JSON.stringify(await api('/api/export'), null, 2));
    toast('Workspace exported.');
    return;
  }
  if (action === 'verify-audit') {
    const result = await api('/api/audit');
    toast(
      result.valid
        ? `Audit chain verified (${result.events.length} events, HMAC-SHA256 signed, anchor ${result.latest_anchor?.slice(0, 12) || 'OK'}…).`
        : 'Audit integrity check failed.',
      !result.valid
    );
    return;
  }
  if (action === 'load-members') {
    const res = await api('/api/members');
    memberData = res.members;
    inviteData = res.invitations || [];
    render();
    return;
  }
  if (action === 'add-member') {
    modal(
      'Add a workspace member',
      `<form id="member-form">${field('Full name', 'name', '', 'text', 'required minlength="2" maxlength="80"')}${field('Email', 'email', '', 'email', 'required')}${field('Temporary password', 'password', '', 'password', 'required minlength="10" maxlength="200" autocomplete="new-password"')}<div class="field"><label for="member-role">Role</label><select id="member-role" name="role">${['creator', 'reviewer', 'manager', 'admin'].map(r => `<option>${r}</option>`).join('')}</select></div><button class="btn primary full">Create team account</button></form>`
    );
    return;
  }
  if (action === 'invite-member') {
    modal(
      'Send signed member invitation',
      `<form id="invite-form">${field('Full name', 'name', '', 'text', 'required minlength="2" maxlength="80"')}${field('Email', 'email', '', 'email', 'required')}<div class="field"><label for="invite-role">Role</label><select id="invite-role" name="role">${['creator', 'reviewer', 'manager', 'admin'].map(r => `<option>${r}</option>`).join('')}</select></div><button class="btn primary full">Generate signed invitation token</button></form><div id="invite-token-box" class="notes hidden" style="margin-top:14px"></div>`
    );
    return;
  }
  if (action === 'mfa-modal') {
    const setup = await api('/api/account/security', { action: 'mfa_setup' });
    modal(
      'Enable TOTP multi-factor authentication',
      `<p>Scan or enter this TOTP secret in your authenticator app, then verify with the 6-digit code.</p><div class="notes" style="margin-bottom:14px"><strong>Secret:</strong> <code>${esc(setup.secret)}</code><br><strong>Current test TOTP code:</strong> <code>${esc(setup.current_code)}</code></div><form id="mfa-form">${field('6-digit TOTP code', 'code', setup.current_code, 'text', 'required pattern="\\d{6}"')}<button class="btn primary full" type="submit">Verify & activate MFA</button></form>`
    );
    return;
  }
  if (action === 'password-modal') {
    modal(
      'Change your password',
      `<form id="password-form">${field('Current password', 'current_password', '', 'password', 'required')}${field('New password (min 10 chars)', 'new_password', '', 'password', 'required minlength="10"')}<button class="btn primary full" type="submit">Update password</button></form>`
    );
    return;
  }
}

function markDirty() {
  dirty = true;
  $('#dirty-banner')?.classList.remove('hidden');
}

function restoreEditor(d) {
  const form = $('#editor-form');
  for (const [k, v] of Object.entries(d)) {
    if (k === 'image' || k === 'gdoc') continue;
    const f = form.elements[k];
    if (!f) continue;
    if (f.type === 'checkbox') f.checked = !!v;
    else f.value = v;
  }
  editorImage = d.image;
  editorGdoc = d.gdoc;
  $('#image-area').innerHTML = imageArea(d);
  markDirty();
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.preventDefault();
  if (el.disabled) return;
  el.disabled = true;
  try {
    await clickAction(el.dataset.action, el.dataset.id, el);
  } catch (error) {
    toast(error.message, true);
    if ($('#modal').open && $('#modal-error')) $('#modal-error').textContent = error.message;
  } finally {
    el.disabled = false;
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target,
    submit = form.querySelector('button[type=submit],button:not([type])');
  if (submit) submit.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === 'auth-form') {
      await api('/api/' + (authMode === 'login' ? 'login' : 'signup'), data);
      view = 'overview';
      await load();
    } else if (form.id === 'recover-form') {
      const res = await api('/api/account/recover', data);
      if (res.recovery_token) {
        $('#reset-form').elements.token.value = res.recovery_token;
        toast('Recovery token generated and pre-filled below.');
      } else {
        toast(res.message || 'Recovery request processed.');
      }
    } else if (form.id === 'reset-form') {
      await api('/api/account/reset', data);
      closeModal();
      toast('Password reset complete. Sign in with your new password.');
    } else if (form.id === 'accept-invite-form') {
      await api('/api/members/accept-invite', data);
      closeModal();
      view = 'overview';
      await load();
      toast('Invitation accepted! Welcome to the workspace.');
    } else if (form.id === 'editor-form') {
      const values = editorValues(),
        result = await api(current ? '/api/reviews/' + current : '/api/reviews', {
          ...values,
          revision: S.revision,
          ...(current ? { action: 'save' } : {})
        });
      current = result.id;
      dirty = false;
      await load();
      toast('Review complete. Your draft is saved.');
    } else if (form.id === 'gdoc-connect-form') {
      const res = await api('/api/gdocs', { ...data, create_review: true, revision: S.revision });
      closeModal();
      await load();
      navigate('studio', res.review_id);
      toast('Google Doc connected and reviewed.');
    } else if (form.id === 'gdoc-sync-form') {
      await api('/api/reviews/' + data.review_id, {
        action: 'gdoc_sync',
        doc_revision_id: data.doc_revision_id,
        text: data.text,
        revision: S.revision
      });
      closeModal();
      await load();
      toast('Synced new Google Doc revision. Previous approval was invalidated for fresh review.');
    } else if (form.id === 'knowledge-form') {
      if (!data.id) delete data.id;
      if (data.kind === 'rule')
        data.terms = data.term_lines
          .split('\n')
          .filter(Boolean)
          .map(line => {
            const parts = line.split(/→|=>/);
            return { term: parts[0]?.trim(), replacement: parts.slice(1).join('→').trim() };
          });
      data.active = form.elements.active.checked;
      await api('/api/knowledge', { ...data, revision: S.revision });
      closeModal();
      await load();
      toast('Knowledge saved. Existing reviews now need a fresh check.');
    } else if (form.id === 'brand-form') {
      await api('/api/knowledge', { ...data, kind: 'brand', palette: data.palette.split(',').map(x => x.trim()), revision: S.revision });
      closeModal();
      await load();
      toast('Brand updated.');
    } else if (form.id === 'asset-form') {
      const img = await inspectImage($('#asset-file').files[0]);
      await api('/api/knowledge', {
        kind: 'asset',
        name: img.name,
        sha256: img.sha256,
        width: img.width,
        height: img.height,
        colors: img.colors,
        revision: S.revision
      });
      closeModal();
      await load();
      toast('Asset fingerprint and reference geometry approved.');
    } else if (form.id === 'decision-form') {
      await reviewAction('decision', data);
      closeModal();
      toast('Decision recorded in the audit trail.');
    } else if (form.id === 'workflow-form') {
      await reviewAction(data.action, { reason: data.reason });
      closeModal();
      toast(data.action === 'approve' ? 'Revision approved and bound.' : 'Changes requested.');
    } else if (form.id === 'comment-form') {
      await reviewAction('comment', data);
      closeModal();
      toast('Comment added.');
    } else if (form.id === 'member-form') {
      await api('/api/members', { ...data, revision: S.revision });
      closeModal();
      await load();
      memberData = (await api('/api/members')).members;
      render();
      toast('Team member created.');
    } else if (form.id === 'invite-form') {
      const res = await api('/api/members/invite', { ...data, revision: S.revision });
      await load();
      const box = $('#invite-token-box');
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = `<strong>Signed invitation token:</strong><br><code>${esc(res.invite_token)}</code>`;
      }
      toast('Signed invitation created.');
    } else if (form.id === 'mfa-form') {
      await api('/api/account/security', { action: 'mfa_enable', code: data.code });
      closeModal();
      await load();
      toast('TOTP MFA enabled on your account.');
    } else if (form.id === 'password-form') {
      await api('/api/account/security', { action: 'change_password', ...data });
      closeModal();
      await load();
      toast('Password updated.');
    } else if (form.id === 'retention-form') {
      const res = await api('/api/admin/retention', { ...data, revision: S.revision });
      await load();
      toast(`Retention limits updated (${res.cleaned_demos} expired demos cleaned).`);
    }
  } catch (error) {
    toast(error.message, true);
    const errorEl = $('#modal').open ? $('#modal-error') : $('#auth-error');
    if (errorEl) errorEl.textContent = error.message;
  } finally {
    if (submit) submit.disabled = false;
  }
});

document.addEventListener('change', async e => {
  try {
    if (e.target.id === 'demo-role') {
      if (dirty && !confirm('Discard unsaved draft changes and switch roles?')) {
        e.target.value = S.user.role;
        return;
      }
      await api('/api/demo/role', { role: e.target.value });
      await load();
      toast('Demo role switched. Permissions are enforced by the server.');
    }
    if (e.target.id === 'doc-file' || e.target.id === 'source-document') {
      const file = e.target.files[0];
      if (!file) return;
      toast('Reading document (including tables, headers & OCR fallback)…');
      const text = await extractDocument(file),
        target = e.target.id === 'doc-file' ? $('#draft-text') : $('#source-text');
      if (e.target.id === 'source-document' && text.length > 2000)
        throw new Error('Source is over 2,000 characters. Import a shorter excerpt as one rule or fact.');
      target.value = text;
      if (e.target.id === 'doc-file') {
        markDirty();
        $('#word-count').textContent = text.trim().split(/\s+/).length + ' words';
      }
      toast('Text imported. Review it before saving.');
    }
    if (e.target.id === 'image-file') {
      const file = e.target.files[0];
      if (!file) return;
      toast('Inspecting image & running server OCR…');
      editorImage = await inspectImage(file);
      $('#image-area').innerHTML = imageArea({ image: editorImage });
      markDirty();
      toast('Image verified and ready for review.');
    }
  } catch (error) {
    toast(error.message, true);
    if ($('#modal').open && $('#modal-error')) $('#modal-error').textContent = error.message;
  }
});

document.addEventListener('input', e => {
  if (e.target.closest('#editor-form')) {
    markDirty();
    if (e.target.id === 'draft-text')
      $('#word-count').textContent = (e.target.value.trim() ? e.target.value.trim().split(/\s+/).length : 0) + ' words';
    if (e.target.id === 'ocr-text' && editorImage) editorImage.ocr_text = e.target.value;
  }
  if (e.target.id === 'knowledge-search') {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('[data-search]').forEach(el => (el.hidden = !el.dataset.search.includes(q)));
  }
});

window.addEventListener('beforeunload', e => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
try {
  await load();
} catch (error) {
  renderAuth();
  if (!error.message.includes('Sign in')) toast(error.message, true);
}
