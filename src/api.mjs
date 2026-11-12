import { seedState, demoDraft } from './seed.mjs';
import { reviewContent, insights, retrieve, inspectBinaryImageHeader } from './engine.mjs';
import { addAIReview } from './ai.mjs';
import { renderReport, renderCSV, renderPDF } from './reports.mjs';
import {
  uuid,
  timestamp,
  sha256,
  passwordHash,
  safeEqual,
  appendAudit,
  verifyAudit,
  encryptAtRest,
  decryptAtRest,
  signToken,
  verifyToken,
  generateMfaSecret,
  computeTotp,
  verifyTotp,
  securityHeaders
} from './security.mjs';

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new AppError(status, message);
};
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders, ...extra }
  });
const str = (value, min = 0, max = 200) =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max
    ? value.trim()
    : fail(400, `Enter text between ${min} and ${max} characters.`);
const checkRole = (u, roles) => {
  if (!roles.includes(u.role)) fail(403, 'Your role cannot perform this action.');
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'manager', 'reviewer', 'creator'];
const HEX = /^#[\da-fA-F]{6}$/;
const safeUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, org_id: u.org_id });

async function body(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail(415, 'Use a JSON request.');
  const text = await request.text();
  if (text.length > 2500000) fail(413, 'Request is too large.');
  try {
    const data = JSON.parse(text);
    if (!data || Array.isArray(data) || typeof data !== 'object') throw 0;
    return data;
  } catch {
    fail(400, 'Invalid JSON request.');
  }
}

async function rateLimit(db, key, limit = 60) {
  const now = Date.now(),
    window = 60000;
  await db
    .prepare(
      'INSERT INTO rate_limits(key,count,resets_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN resets_at < ? THEN 1 ELSE count+1 END, resets_at=CASE WHEN resets_at < ? THEN ? ELSE resets_at END'
    )
    .bind(key, now + window, now, now, now + window)
    .run();
  const row = await db.prepare('SELECT count FROM rate_limits WHERE key=?').bind(key).first();
  if (row.count > limit) fail(429, 'Too many requests. Please try again in a minute.');
}

async function sessionUser(request, db) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)bc_session=([^;]+)/)?.[1];
  if (!token) return null;
  return db
    .prepare(
      'SELECT u.*, o.is_demo, o.name AS org_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN organisations o ON o.id=u.org_id WHERE s.token_hash=? AND s.expires_at>?'
    )
    .bind(await sha256(token), Date.now())
    .first();
}

async function sessionResponse(request, db, user, extraPayload = {}) {
  const token = uuid() + uuid();
  const tokenHash = await sha256(token);
  const old = request.headers.get('cookie')?.match(/(?:^|;\s*)bc_session=([^;]+)/)?.[1];
  if (old) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(old)).run();
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(tokenHash, user.id, Date.now() + 8 * 3600000).run();
  return json({ user: safeUser(user), ...extraPayload }, 200, {
    'Set-Cookie': `bc_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${
      new URL(request.url).protocol === 'https:' ? '; Secure' : ''
    }`
  });
}

async function loadOrg(db, u, env = {}) {
  const row = await db.prepare('SELECT * FROM organisations WHERE id=?').bind(u.org_id).first();
  if (!row) fail(404, 'Workspace not found.');
  const data = await decryptAtRest(row.state, env.DATA_ENCRYPTION_KEY);
  data.gdocs ||= [];
  data.invitations ||= [];
  data.published_items ||= [];
  data.retention ||= { max_drafts: 120, max_revisions: 25, demo_ttl_hours: 24 };
  return { ...row, data };
}

async function saveOrg(db, org, data, env = {}) {
  const plain = JSON.stringify(data);
  if (plain.length > 3500000) fail(413, 'Workspace storage limit reached. Export your work or archive old revisions.');
  const serialized = await encryptAtRest(plain, env.DATA_ENCRYPTION_KEY);
  const result = await db
    .prepare('UPDATE organisations SET state=?,revision=revision+1 WHERE id=? AND revision=?')
    .bind(serialized, org.id, org.revision)
    .run();
  if (result.meta.changes !== 1) fail(409, 'This workspace changed in another session. Reload and try again.');
}

function assertRevision(org, data) {
  if (data.revision !== org.revision) fail(409, 'Your view is out of date. Reload before changing this workspace.');
}

function decodeDataUrlBytes(dataUrl) {
  const m = /^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  try {
    const bin = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes };
  } catch {
    return null;
  }
}

async function draftInput(d) {
  const title = str(d.title, 1, 120),
    text = str(d.text || '', 0, 16000),
    channel = str(d.channel, 1, 40),
    audience = str(d.audience || '', 0, 160),
    alt = str(d.alt || '', 0, 700);
  if (!['Instagram', 'LinkedIn', 'Website', 'Email', 'Press release'].includes(channel)) fail(400, 'Select a supported channel.');
  const foreground = d.foreground || '',
    background = d.background || '';
  if ((foreground || background) && (!HEX.test(foreground) || !HEX.test(background))) fail(400, 'Choose two valid six-digit hex colours.');
  let image = null;
  if (d.image) {
    if (typeof d.image !== 'object' || !['photo', 'graphic', 'logo'].includes(d.image.kind) || !/^([a-f0-9]{64})$/.test(d.image.sha256 || ''))
      fail(400, 'Invalid image metadata.');
    const width = Number(d.image.width),
      height = Number(d.image.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 25000000)
      fail(400, 'Image dimensions exceed the supported limit.');
    const colors = d.image.colors;
    if (!Array.isArray(colors) || colors.length > 12 || colors.some(c => !HEX.test(c))) fail(400, 'Invalid image colours.');
    const thumb = d.image.thumbnail || '';
    if (thumb && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb) || thumb.length > 350000))
      fail(400, 'Invalid image preview.');

    // Server-side verification of raw image binary if supplied
    let serverVerified = d.image.server_verified !== false;
    let verificationNote = d.image.verification_note || '';
    if (d.image.raw_b64) {
      const parsed = decodeDataUrlBytes(d.image.raw_b64);
      if (!parsed) fail(400, 'Invalid raw image binary.');
      const actualHash = await sha256(parsed.bytes);
      const header = inspectBinaryImageHeader(parsed.bytes);
      if (actualHash !== d.image.sha256) {
        serverVerified = false;
        verificationNote = 'Client SHA-256 fingerprint does not match server-computed binary hash.';
      } else if (header && (header.width !== width || header.height !== height)) {
        serverVerified = false;
        verificationNote = `Client dimensions (${width}×${height}) do not match binary header (${header.width}×${header.height}).`;
      } else {
        serverVerified = true;
      }
    } else if (thumb) {
      const parsedThumb = decodeDataUrlBytes(thumb);
      const header = parsedThumb ? inspectBinaryImageHeader(parsedThumb.bytes) : null;
      if (header && header.width > 0 && header.height > 0) {
        serverVerified = d.image.server_verified !== false;
      }
    }

    let regions = null;
    if (d.image.regions && typeof d.image.regions === 'object' && !Array.isArray(d.image.regions)) {
      regions = {};
      for (const [k, v] of Object.entries(d.image.regions).slice(0, 9)) {
        if (Array.isArray(v) && v.every(c => HEX.test(c))) regions[str(k, 1, 30)] = v.slice(0, 6);
      }
    }

    image = {
      name: str(d.image.name, 1, 160),
      width,
      height,
      sha256: d.image.sha256,
      kind: d.image.kind,
      colors,
      regions,
      ocr_text: d.image.ocr_text ? str(String(d.image.ocr_text), 0, 8000) : '',
      cropped: d.image.cropped === true,
      crop_region: d.image.crop_region ? str(String(d.image.crop_region), 0, 80) : '',
      distorted: d.image.distorted === true,
      server_verified: serverVerified,
      verification_note: verificationNote,
      thumbnail: thumb,
      decorative: d.image.decorative === true
    };
  }
  if (!text && !image) fail(400, 'Add some text or an image to review.');

  let gdoc = null;
  if (d.gdoc && typeof d.gdoc === 'object' && d.gdoc.doc_id) {
    gdoc = {
      doc_id: str(d.gdoc.doc_id, 2, 120),
      doc_title: str(d.gdoc.doc_title || d.title || 'Google Doc', 1, 160),
      doc_url: str(d.gdoc.doc_url || `https://docs.google.com/document/d/${d.gdoc.doc_id}/edit`, 5, 300),
      doc_revision_id: str(d.gdoc.doc_revision_id || 'rev-1', 1, 80),
      content_sha256: await sha256(text),
      synced_at: timestamp(),
      approval_bound_revision: d.gdoc.approval_bound_revision || null
    };
  }

  return {
    title,
    text,
    channel,
    audience,
    alt,
    foreground,
    background,
    largeText: d.largeText === true,
    image,
    gdoc,
    campaign: str(d.campaign || '', 0, 100),
    useAI: d.useAI === true,
    useLocalModel: d.useLocalModel === true
  };
}

async function analyze(draft, state, env) {
  return addAIReview(reviewContent(draft, state), draft, state, env);
}

function canEdit(user, r) {
  if (!(user.role === 'admin' || user.role === 'manager' || (user.role === 'creator' && r.created_by === user.id)))
    fail(403, 'Only the creator or a brand manager can edit this draft.');
}

function snapshot(r) {
  return {
    version: r.version,
    at: timestamp(),
    text: r.text,
    title: r.title,
    alt: r.alt,
    channel: r.channel,
    foreground: r.foreground,
    background: r.background,
    largeText: r.largeText,
    image: r.image,
    gdoc: r.gdoc ? structuredClone(r.gdoc) : null,
    analysis: structuredClone(r.analysis),
    status: r.status,
    decisions: structuredClone(r.analysis?.findings || [])
  };
}

function reversion(r, draft, analysis, user, maxRevisions = 25) {
  if (r.versions.length >= maxRevisions)
    fail(400, `This workspace keeps at most ${maxRevisions} revisions per draft. Create a new draft to continue.`);
  r.versions.push(snapshot(r));
  const nextGdoc = draft.gdoc || (r.gdoc ? { ...r.gdoc, approval_bound_revision: null } : null);
  Object.assign(r, draft, {
    gdoc: nextGdoc,
    analysis,
    version: r.version + 1,
    status: 'draft',
    last_editor: user.id,
    updated_at: timestamp(),
    approved_by: null,
    approved_at: null
  });
}

// Server-side OCR extraction helper (uses PNG text chunks + local tesseract CLI when running on Node)
async function performServerOcr(dataUrl, hintText = '') {
  const parsed = decodeDataUrlBytes(dataUrl);
  if (!parsed) fail(400, 'Provide a valid base64 data URL for OCR.');
  const { bytes } = parsed;

  // 1. Check PNG tEXt / iTXt metadata chunks for embedded OCR/caption strings
  const extractedChunks = [];
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 8;
    while (p + 12 <= bytes.length) {
      const len = view.getUint32(p, false);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      if (type === 'tEXt' && p + 8 + len <= bytes.length) {
        const raw = new TextDecoder().decode(bytes.slice(p + 8, p + 8 + len));
        const parts = raw.split('\0');
        const val = parts.slice(1).join(' ').trim();
        if (val) extractedChunks.push(val);
      }
      p += 12 + len;
    }
  }

  // 2. If running on Node with tesseract installed, invoke tesseract OCR on the image
  let tesseractText = '';
  try {
    const fsMod = await import('node:' + 'fs');
    const osMod = await import('node:' + 'os');
    const pathMod = await import('node:' + 'path');
    const cpMod = await import('node:' + 'child_process');
    const tmpFile = pathMod.join(osMod.tmpdir(), `bc_ocr_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
    fsMod.writeFileSync(tmpFile, bytes);
    try {
      const res = cpMod.spawnSync('tesseract', [tmpFile, 'stdout', '--psm', '6'], {
        encoding: 'utf8',
        timeout: 15000
      });
      if (res.status === 0 && res.stdout) {
        tesseractText = res.stdout.trim();
      }
    } finally {
      try {
        fsMod.unlinkSync(tmpFile);
      } catch {}
    }
  } catch {
    // Worker environment without child_process/tesseract
  }

  const combined = [tesseractText, ...extractedChunks, hintText].filter(Boolean).join('\n').trim();
  return {
    text: combined,
    engine: tesseractText ? 'tesseract-server-ocr' : extractedChunks.length ? 'embedded-metadata-ocr' : 'fallback-ocr',
    header: inspectBinaryImageHeader(bytes)
  };
}

export async function handleApi(request, env) {
  try {
    const url = new URL(request.url),
      path = url.pathname,
      method = request.method,
      db = env.DB;
    if (!db) fail(503, 'Database is unavailable. Check the server setup.');
    if (method === 'GET' && path === '/api/health') return json({ ok: true, version: '2.0.0' });
    if (!['GET', 'HEAD'].includes(method)) {
      if (request.headers.get('X-BC-Request') !== '1') fail(403, 'Missing request guard.');
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) fail(403, 'Cross-origin changes are not allowed.');
    }
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    if (method === 'POST' && ['/api/login', '/api/signup', '/api/demo', '/api/account/recover', '/api/account/reset', '/api/sso/login'].includes(path))
      await rateLimit(db, 'auth:' + ip, 30);

    if (method === 'POST' && path === '/api/login') {
      const data = await body(request),
        email = str(data.email, 3, 200).toLowerCase(),
        password = str(data.password, 1, 200);
      await rateLimit(db, 'email:' + (await sha256(email)), 10);
      const user = await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
      const candidate = await passwordHash(password, user?.salt || 'nonexistent-account');
      if (!user || !safeEqual(candidate, user.password_hash)) fail(401, 'Email or password is incorrect.');
      return sessionResponse(request, db, user);
    }

    if (method === 'POST' && path === '/api/signup') {
      if (env.ALLOW_SIGNUP === 'false') fail(403, 'New workspaces are disabled by the administrator.');
      const data = await body(request),
        email = str(data.email, 3, 200).toLowerCase(),
        password = str(data.password, 10, 200),
        name = str(data.name, 2, 80),
        orgName = str(data.organisation, 2, 100);
      if (!EMAIL.test(email)) fail(400, 'Enter a valid email address.');
      if (await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first()) fail(409, 'That email is already registered.');
      const orgId = uuid(),
        user = { id: uuid(), org_id: orgId, email, name, role: 'admin' },
        salt = uuid(),
        state = seedState();
      state.member_security = { [user.id]: { email_verified: false, mfa_enabled: false } };
      await appendAudit(state, user, 'workspace.created', orgId, 'New workspace with fictional sample guidelines.', env.AUDIT_SIGNING_KEY);
      const verificationToken = await signToken(
        { purpose: 'email_verify', user_id: user.id, org_id: orgId, email, exp: Date.now() + 24 * 3600000 },
        env.AUDIT_SIGNING_KEY
      );
      const encryptedState = await encryptAtRest(JSON.stringify(state), env.DATA_ENCRYPTION_KEY);
      await db.batch([
        db.prepare('INSERT INTO organisations(id,name,state,created_at) VALUES (?,?,?,?)').bind(orgId, orgName, encryptedState, timestamp()),
        db
          .prepare('INSERT INTO users(id,org_id,email,name,role,password_hash,salt,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .bind(user.id, orgId, email, name, 'admin', await passwordHash(password, salt), salt, timestamp())
      ]);
      return sessionResponse(request, db, user, { verification_token: verificationToken });
    }

    // Password recovery & reset endpoints
    if (method === 'POST' && path === '/api/account/recover') {
      const data = await body(request),
        email = str(data.email, 3, 200).toLowerCase();
      const user = await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
      if (!user) return json({ ok: true, message: 'If that account exists, a recovery token has been generated.' });
      const recovery_token = await signToken(
        { purpose: 'password_reset', user_id: user.id, email: user.email, salt_prefix: user.salt.slice(0, 8), exp: Date.now() + 3600000 },
        env.AUDIT_SIGNING_KEY
      );
      return json({ ok: true, recovery_token, expires_in_seconds: 3600 });
    }

    if (method === 'POST' && path === '/api/account/reset') {
      const data = await body(request),
        token = str(data.token, 10, 1000),
        newPassword = str(data.new_password, 10, 200);
      const payload = await verifyToken(token, 'password_reset', env.AUDIT_SIGNING_KEY);
      if (!payload) fail(400, 'Invalid or expired password recovery token.');
      const user = await db.prepare('SELECT * FROM users WHERE id=? AND email=?').bind(payload.user_id, payload.email).first();
      if (!user || user.salt.slice(0, 8) !== payload.salt_prefix) fail(400, 'Recovery token has already been used.');
      const newSalt = uuid();
      const newHash = await passwordHash(newPassword, newSalt);
      await db.batch([
        db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').bind(newHash, newSalt, user.id),
        db.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id)
      ]);
      return json({ ok: true });
    }

    // SSO / OIDC assertion login
    if (method === 'POST' && path === '/api/sso/login') {
      const data = await body(request),
        assertion = str(data.assertion, 10, 2000);
      const payload = await verifyToken(assertion, 'sso_login', env.SSO_SIGNING_KEY || env.AUDIT_SIGNING_KEY);
      if (!payload || !payload.email) fail(401, 'Invalid or expired SSO assertion.');
      const user = await db.prepare('SELECT * FROM users WHERE email=?').bind(payload.email.toLowerCase()).first();
      if (!user) fail(404, 'No workspace user matches this SSO identity.');
      return sessionResponse(request, db, user, { sso: true });
    }

    // Member invitation acceptance (unauthenticated or authenticated)
    if (method === 'POST' && path === '/api/members/accept-invite') {
      const data = await body(request),
        token = str(data.token, 10, 1500),
        password = str(data.password, 10, 200);
      const payload = await verifyToken(token, 'member_invite', env.AUDIT_SIGNING_KEY);
      if (!payload) fail(400, 'Invalid or expired invitation token.');
      if (await db.prepare('SELECT id FROM users WHERE email=?').bind(payload.email).first())
        fail(409, 'Email is already registered.');
      const orgRow = await db.prepare('SELECT * FROM organisations WHERE id=?').bind(payload.org_id).first();
      if (!orgRow) fail(404, 'Workspace not found.');
      const state = await decryptAtRest(orgRow.state, env.DATA_ENCRYPTION_KEY);
      const user = { id: uuid(), org_id: payload.org_id, email: payload.email, name: payload.name, role: payload.role };
      const salt = uuid();
      state.invitations = (state.invitations || []).map(inv =>
        inv.email === payload.email ? { ...inv, status: 'accepted', accepted_at: timestamp() } : inv
      );
      await appendAudit(state, user, 'member.invite_accepted', user.id, `${user.name} (${user.role})`, env.AUDIT_SIGNING_KEY);
      const encrypted = await encryptAtRest(JSON.stringify(state), env.DATA_ENCRYPTION_KEY);
      await db.batch([
        db
          .prepare('INSERT INTO users(id,org_id,email,name,role,password_hash,salt,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .bind(user.id, user.org_id, user.email, user.name, user.role, await passwordHash(password, salt), salt, timestamp()),
        db.prepare('UPDATE organisations SET state=?,revision=revision+1 WHERE id=?').bind(encrypted, orgRow.id)
      ]);
      return sessionResponse(request, db, user);
    }

    if (method === 'POST' && path === '/api/demo') {
      const orgId = uuid(),
        state = seedState(),
        people = ROLES.map(role => ({
          id: uuid(),
          org_id: orgId,
          email: `${role}.${orgId}@demo.local`,
          name: { admin: 'Alex Morgan', manager: 'Maya Chen', reviewer: 'Jordan Lee', creator: 'Sam Rivera' }[role],
          role
        }));
      const creator = people.find(p => p.role === 'creator'),
        analysis = reviewContent(demoDraft, state);
      state.reviews.push({
        ...demoDraft,
        id: uuid(),
        created_by: creator.id,
        created_name: creator.name,
        last_editor: creator.id,
        created_at: timestamp(),
        updated_at: timestamp(),
        version: 1,
        status: 'draft',
        analysis,
        versions: [],
        comments: []
      });
      await appendAudit(state, creator, 'demo.created', orgId, 'Isolated demo workspace; all brand data is fictional.', env.AUDIT_SIGNING_KEY);
      const encrypted = await encryptAtRest(JSON.stringify(state), env.DATA_ENCRYPTION_KEY);
      const statements = [
        db.prepare('INSERT INTO organisations(id,name,is_demo,state,created_at) VALUES (?,?,1,?,?)').bind(orgId, 'Verdant demo', encrypted, timestamp()),
        ...people.map(p =>
          db
            .prepare('INSERT INTO users(id,org_id,email,name,role,password_hash,salt,created_at) VALUES (?,?,?,?,?,?,?,?)')
            .bind(p.id, orgId, p.email, p.name, p.role, uuid(), uuid(), timestamp())
        )
      ];
      await db.batch(statements);
      return sessionResponse(request, db, creator);
    }

    const user = await sessionUser(request, db);
    if (!user) fail(401, 'Sign in to continue.');

    if (method === 'POST' && path === '/api/logout') {
      const token = request.headers.get('cookie')?.match(/(?:^|;\s*)bc_session=([^;]+)/)?.[1];
      await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token || '')).run();
      return json({ ok: true }, 200, { 'Set-Cookie': 'bc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }

    if (method === 'POST' && path === '/api/demo/role') {
      if (!user.is_demo) fail(403, 'Role switching is available only in an isolated demo.');
      const data = await body(request);
      if (!ROLES.includes(data.role)) fail(400, 'Unknown role.');
      const next = await db.prepare('SELECT * FROM users WHERE org_id=? AND role=?').bind(user.org_id, data.role).first();
      return sessionResponse(request, db, next);
    }

    const org = await loadOrg(db, user, env),
      state = org.data;

    if (method === 'GET' && path === '/api/state') {
      const sec = state.member_security?.[user.id] || { email_verified: false, mfa_enabled: false };
      return json({
        user: { ...safeUser(user), email_verified: !!sec.email_verified, mfa_enabled: !!sec.mfa_enabled },
        organisation: { id: org.id, name: org.name, is_demo: !!org.is_demo, encrypted_at_rest: true },
        revision: org.revision,
        state,
        insights: insights(state),
        ai_available: Boolean(env.OPENAI_API_KEY || env.SELF_HOSTED_LLM_URL),
        local_ai_available: true
      });
    }

    if (method === 'GET' && path === '/api/search')
      return json({ results: retrieve((url.searchParams.get('q') || '').slice(0, 500), [...state.rules, ...state.facts], 10) });

    if (method === 'GET' && path === '/api/audit') {
      const valid = await verifyAudit(state.audit, env.AUDIT_SIGNING_KEY);
      return json({
        valid,
        hmac_signed: state.audit.every(e => Boolean(e.signature && e.anchor)),
        latest_anchor: state.audit.at(-1)?.anchor || null,
        events: state.audit
      });
    }

    // Report downloads: HTML, JSON, CSV, and native PDF!
    const reportMatch = path.match(/^\/api\/reports\/([^/]+)\/(html|json|csv|pdf)$/);
    if (method === 'GET' && reportMatch) {
      const r = state.reviews.find(x => x.id === reportMatch[1]);
      if (!r) fail(404, 'Review not found in this workspace.');
      const format = reportMatch[2];
      if (format === 'pdf') {
        const pdfBytes = renderPDF(r);
        return new Response(pdfBytes, {
          headers: {
            ...securityHeaders,
            'Cache-Control': 'no-store',
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="BrandCompass_Review.pdf"'
          }
        });
      }
      const content = format === 'html' ? renderReport(r) : format === 'csv' ? renderCSV(r) : JSON.stringify(r, null, 2);
      return new Response(content, {
        headers: {
          ...securityHeaders,
          'Cache-Control': 'no-store',
          'Content-Type': { html: 'text/html; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8' }[format],
          'Content-Disposition': `${url.searchParams.get('inline') === '1' && format === 'html' ? 'inline' : 'attachment'}; filename="BrandCompass_Review.${format}"`
        }
      });
    }

    if (method === 'GET' && path === '/api/export')
      return json({ exported_at: timestamp(), format: 'brandcompass-workspace-v1', organisation: org.name, ...state });

    // Google Docs Integration GET routes (Improvement 3)
    if (method === 'GET' && path === '/api/gdocs') {
      return json({ gdocs: state.gdocs || [] });
    }

    const gdocStatusMatch = path.match(/^\/api\/gdocs\/([^/]+)\/status$/);
    if (method === 'GET' && gdocStatusMatch) {
      const docId = decodeURIComponent(gdocStatusMatch[1]);
      const doc = (state.gdocs || []).find(g => g.doc_id === docId);
      const linkedReview = state.reviews.find(r => r.gdoc?.doc_id === docId);
      if (!doc && !linkedReview) fail(404, 'Google Doc is not linked in this workspace.');
      const queriedRev = url.searchParams.get('revision_id') || doc?.doc_revision_id || linkedReview?.gdoc?.doc_revision_id;
      const currentText = doc?.text ?? linkedReview?.text ?? '';
      const currentHash = await sha256(currentText);
      const bound = linkedReview?.gdoc?.approval_bound_revision || null;
      const approvalValid = Boolean(
        linkedReview?.status === 'approved' &&
          bound &&
          bound.doc_revision_id === queriedRev &&
          bound.content_sha256 === currentHash &&
          linkedReview.analysis.knowledge_version === state.knowledge_version
      );
      return json({
        doc_id: docId,
        doc_title: doc?.doc_title || linkedReview?.gdoc?.doc_title || linkedReview?.title,
        doc_revision_id: queriedRev,
        review_id: linkedReview?.id || null,
        review_status: linkedReview?.status || 'unreviewed',
        effective_status: approvalValid
          ? 'approved_and_bound'
          : linkedReview?.status === 'approved'
          ? 'stale_revision_requires_review'
          : linkedReview?.status || 'unreviewed',
        approval_valid: approvalValid,
        approval_bound_revision: bound,
        score: linkedReview?.analysis?.score ?? null,
        open_findings: linkedReview?.analysis?.findings?.filter(f => f.decision === 'open').length ?? 0,
        findings: linkedReview?.analysis?.findings || []
      });
    }

    if (path === '/api/members' && method === 'GET') {
      checkRole(user, ['admin']);
      return json({
        members: (await db.prepare('SELECT id,email,name,role FROM users WHERE org_id=?').bind(user.org_id).all()).results,
        invitations: state.invitations || []
      });
    }

    if (path === '/api/members' && method === 'POST') {
      checkRole(user, ['admin']);
      const data = await body(request);
      const email = str(data.email, 3, 200).toLowerCase(),
        name = str(data.name, 2, 80),
        password = str(data.password, 10, 200);
      if (!EMAIL.test(email) || !ROLES.includes(data.role)) fail(400, 'Check the email and role.');
      if ((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE org_id=?').bind(user.org_id).first()).n >= 50)
        fail(400, 'Workspace member limit reached.');
      if (await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first()) fail(409, 'Email is already registered.');
      assertRevision(org, data);
      const id = uuid(),
        salt = uuid();
      await appendAudit(state, user, 'member.created', id, `${name}: ${data.role}`, env.AUDIT_SIGNING_KEY);
      const encrypted = await encryptAtRest(JSON.stringify(state), env.DATA_ENCRYPTION_KEY);
      const statements = [
        db
          .prepare(
            'INSERT INTO users(id,org_id,email,name,role,password_hash,salt,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM organisations WHERE id=? AND revision=?)'
          )
          .bind(id, org.id, email, name, data.role, await passwordHash(password, salt), salt, timestamp(), org.id, org.revision),
        db.prepare('UPDATE organisations SET state=?,revision=revision+1 WHERE id=? AND revision=?').bind(encrypted, org.id, org.revision)
      ];
      const result = await db.batch(statements);
      if (result[1].meta.changes !== 1) fail(409, 'Workspace changed. Reload and try again.');
      return json({ ok: true });
    }

    if (method !== 'POST') fail(404, 'Endpoint not found.');
    await rateLimit(db, 'user:' + user.id, 120);
    const data = await body(request);

    // Server-side OCR endpoint (does not mutate workspace state)
    if (path === '/api/ocr') {
      const res = await performServerOcr(str(data.data_url, 20, 2400000), str(data.hint_text || '', 0, 8000));
      return json({ ok: true, ...res });
    }

    // Account security actions (email verification, MFA setup/verify, password change)
    if (path === '/api/account/security') {
      state.member_security ||= {};
      const sec = (state.member_security[user.id] ||= { email_verified: false, mfa_enabled: false });
      if (data.action === 'verify_email') {
        const payload = await verifyToken(str(data.token, 10, 1000), 'email_verify', env.AUDIT_SIGNING_KEY);
        if (!payload || payload.user_id !== user.id) fail(400, 'Invalid email verification token.');
        sec.email_verified = true;
        sec.verified_at = timestamp();
        await appendAudit(state, user, 'account.email_verified', user.id, user.email, env.AUDIT_SIGNING_KEY);
        await saveOrg(db, org, state, env);
        return json({ ok: true, email_verified: true });
      }
      if (data.action === 'mfa_setup') {
        const secret = generateMfaSecret();
        sec.pending_mfa_secret = secret;
        const current_code = await computeTotp(secret);
        await saveOrg(db, org, state, env);
        return json({ ok: true, secret, otpauth_url: `otpauth://totp/BrandCompass:${encodeURIComponent(user.email)}?secret=${secret}&issuer=BrandCompass`, current_code });
      }
      if (data.action === 'mfa_enable') {
        const secret = sec.pending_mfa_secret || sec.mfa_secret;
        if (!secret || !(await verifyTotp(secret, data.code))) fail(400, 'Invalid 6-digit MFA code.');
        sec.mfa_enabled = true;
        sec.mfa_secret = secret;
        delete sec.pending_mfa_secret;
        await appendAudit(state, user, 'account.mfa_enabled', user.id, 'TOTP MFA activated', env.AUDIT_SIGNING_KEY);
        await saveOrg(db, org, state, env);
        return json({ ok: true, mfa_enabled: true });
      }
      if (data.action === 'change_password') {
        const currentPass = str(data.current_password, 1, 200),
          newPass = str(data.new_password, 10, 200);
        const dbUser = await db.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
        if (!safeEqual(await passwordHash(currentPass, dbUser.salt), dbUser.password_hash))
          fail(401, 'Current password is incorrect.');
        const newSalt = uuid();
        await db
          .prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?')
          .bind(await passwordHash(newPass, newSalt), newSalt, user.id)
          .run();
        await appendAudit(state, user, 'account.password_changed', user.id, 'Password updated', env.AUDIT_SIGNING_KEY);
        await saveOrg(db, org, state, env);
        return json({ ok: true });
      }
      fail(400, 'Unknown account security action.');
    }

    assertRevision(org, data);

    // Member invitation endpoint
    if (path === '/api/members/invite') {
      checkRole(user, ['admin']);
      const email = str(data.email, 3, 200).toLowerCase(),
        name = str(data.name, 2, 80),
        role = data.role;
      if (!EMAIL.test(email) || !ROLES.includes(role)) fail(400, 'Check the email and role.');
      if (await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first())
        fail(409, 'Email is already registered.');
      const inviteToken = await signToken(
        { purpose: 'member_invite', org_id: org.id, email, name, role, invited_by: user.name, exp: Date.now() + 7 * 86400000 },
        env.AUDIT_SIGNING_KEY
      );
      state.invitations ||= [];
      state.invitations.push({ id: uuid(), email, name, role, invited_by: user.name, status: 'pending', created_at: timestamp(), invite_token: inviteToken });
      await appendAudit(state, user, 'member.invited', email, `${name}: ${role}`, env.AUDIT_SIGNING_KEY);
      await saveOrg(db, org, state, env);
      return json({ ok: true, invite_token: inviteToken });
    }

    // Retention & Automated Demo Cleanup endpoint
    if (path === '/api/admin/retention') {
      checkRole(user, ['admin']);
      if (data.max_drafts) state.retention.max_drafts = Math.max(10, Math.min(500, Number(data.max_drafts) || 120));
      if (data.max_revisions) state.retention.max_revisions = Math.max(5, Math.min(100, Number(data.max_revisions) || 25));
      if (data.demo_ttl_hours) state.retention.demo_ttl_hours = Math.max(1, Math.min(720, Number(data.demo_ttl_hours) || 24));

      const cutoffIso = new Date(Date.now() - state.retention.demo_ttl_hours * 3600000).toISOString();
      await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
      await db.prepare('DELETE FROM rate_limits WHERE resets_at < ?').bind(Date.now()).run();
      const staleDemos = await db
        .prepare('SELECT id FROM organisations WHERE is_demo=1 AND created_at < ? AND id != ?')
        .bind(cutoffIso, org.id)
        .all();
      let cleanedDemos = 0;
      for (const dOrg of staleDemos.results || []) {
        await db.batch([
          db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id=?)').bind(dOrg.id),
          db.prepare('DELETE FROM users WHERE org_id=?').bind(dOrg.id),
          db.prepare('DELETE FROM organisations WHERE id=?').bind(dOrg.id)
        ]);
        cleanedDemos++;
      }
      await appendAudit(state, user, 'admin.retention_cleanup', org.id, `Cleaned ${cleanedDemos} expired demos; limits updated.`, env.AUDIT_SIGNING_KEY);
      await saveOrg(db, org, state, env);
      return json({ ok: true, cleaned_demos: cleanedDemos, retention: state.retention });
    }

    // Google Docs Integration POST endpoint (Improvement 3)
    if (path === '/api/gdocs') {
      checkRole(user, ['creator', 'manager', 'admin']);
      const docId = str(data.doc_id || `gdoc-${uuid().slice(0, 8)}`, 2, 120);
      const docTitle = str(data.doc_title || 'Untitled Google Doc', 1, 160);
      const docUrl = str(data.doc_url || `https://docs.google.com/document/d/${docId}/edit`, 5, 300);
      const text = str(data.text, 1, 16000);
      const channel = ['Instagram', 'LinkedIn', 'Website', 'Email', 'Press release'].includes(data.channel) ? data.channel : 'Website';
      const docRev = str(data.doc_revision_id || 'rev-1', 1, 80);

      state.gdocs ||= [];
      const existingDoc = state.gdocs.find(g => g.doc_id === docId);
      if (existingDoc) {
        Object.assign(existingDoc, { doc_title: docTitle, doc_url: docUrl, text, channel, doc_revision_id: docRev, updated_at: timestamp() });
      } else {
        state.gdocs.push({ doc_id: docId, doc_title: docTitle, doc_url: docUrl, text, channel, doc_revision_id: docRev, updated_at: timestamp() });
      }

      // If requested, create or sync the linked BrandCompass review
      let reviewId = null;
      if (data.create_review !== false) {
        const existingReview = state.reviews.find(r => r.gdoc?.doc_id === docId);
        const draft = await draftInput({
          title: docTitle,
          text,
          channel,
          audience: data.audience || 'Google Docs collaborators',
          foreground: data.foreground || '#172B26',
          background: data.background || '#FFFFFF',
          gdoc: { doc_id: docId, doc_title: docTitle, doc_url: docUrl, doc_revision_id: docRev }
        });
        const analysis = await analyze(draft, state, env);
        if (existingReview) {
          reversion(existingReview, draft, analysis, user, state.retention?.max_revisions || 25);
          reviewId = existingReview.id;
        } else {
          reviewId = uuid();
          state.reviews.unshift({
            ...draft,
            id: reviewId,
            created_by: user.id,
            created_name: user.name,
            last_editor: user.id,
            version: 1,
            status: 'draft',
            created_at: timestamp(),
            updated_at: timestamp(),
            analysis,
            versions: [],
            comments: []
          });
        }
      }
      await appendAudit(state, user, 'gdoc.synced', docId, `${docTitle} (${docRev})`, env.AUDIT_SIGNING_KEY);
      await saveOrg(db, org, state, env);
      return json({ ok: true, doc_id: docId, review_id: reviewId });
    }

    if (path === '/api/knowledge') {
      checkRole(user, ['admin', 'manager']);
      state.knowledge_history ||= [];
      state.knowledge_history.push({
        version: state.knowledge_version,
        at: timestamp(),
        rules: structuredClone(state.rules),
        facts: structuredClone(state.facts),
        brand: structuredClone(state.brand),
        assets: structuredClone(state.assets)
      });
      if (state.knowledge_history.length > 20) state.knowledge_history.shift();
      if (data.kind === 'fact') {
        if (state.facts.length >= 100 && !data.id) fail(400, 'Workspace fact limit reached.');
        const prev = state.facts.find(f => f.id === data.id);
        if (data.id && !prev) fail(404, 'Fact not found.');
        const validUntil = str(data.valid_until || '', 0, 10);
        if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) fail(400, 'Use a YYYY-MM-DD expiry date.');
        const item = {
          id: prev?.id || uuid(),
          title: str(data.title, 2, 100),
          text: str(data.text, 5, 2000),
          source: str(data.source, 2, 160),
          version: (prev?.version || 0) + 1,
          valid_until: validUntil,
          active: data.active !== false
        };
        if (prev) Object.assign(prev, item);
        else state.facts.push(item);
      } else if (data.kind === 'rule') {
        const prev = state.rules.find(r => r.id === data.id);
        if (data.id && !prev) fail(404, 'Rule not found.');
        if (state.rules.length >= 80 && !prev) fail(400, 'Workspace rule limit reached.');
        if (
          !['term', 'tone', 'claims', 'alt', 'contrast', 'palette', 'asset', 'readability', 'disclaimer'].includes(data.type) ||
          !['low', 'medium', 'high'].includes(data.severity)
        )
          fail(400, 'Invalid rule type or severity.');
        let config = {};
        if (data.type === 'term') {
          if (!Array.isArray(data.terms) || data.terms.length > 20 || !data.terms.length) fail(400, 'Add at least one term replacement.');
          config.terms = data.terms.map(t => ({ term: str(t.term, 1, 80), replacement: str(t.replacement, 1, 100) }));
        }
        if (data.type === 'tone')
          config.phrases = String(data.phrases || '')
            .split(',')
            .map(x => x.trim())
            .filter(Boolean)
            .slice(0, 20);
        if (data.type === 'disclaimer') config.text = str(data.required_text || 'Terms apply.', 1, 300);
        if (data.type === 'palette') config.tolerance = 50;
        if (data.type === 'readability') config.maxWords = 26;
        const item = {
          id: prev?.id || uuid(),
          title: str(data.title, 2, 100),
          body: str(data.text, 5, 2000),
          source: str(data.source, 2, 160),
          version: (prev?.version || 0) + 1,
          type: data.type,
          severity: data.severity,
          config,
          active: data.active !== false,
          updated_at: timestamp()
        };
        if (prev) Object.assign(prev, item);
        else state.rules.push(item);
      } else if (data.kind === 'brand') {
        if (!Array.isArray(data.palette) || data.palette.length < 2 || data.palette.length > 10 || data.palette.some(c => !HEX.test(c)))
          fail(400, 'Provide 2 to 10 six-digit hex colours.');
        state.brand = { ...state.brand, name: str(data.name, 2, 80), tagline: str(data.tagline || '', 0, 160), palette: data.palette };
      } else if (data.kind === 'asset') {
        if (!/^[a-f0-9]{64}$/.test(data.sha256 || '')) fail(400, 'Invalid asset fingerprint.');
        if (state.assets.length >= 60) fail(400, 'Workspace asset limit reached.');
        if (state.assets.some(a => a.sha256 === data.sha256)) fail(409, 'This file is already approved.');
        state.assets.push({
          id: uuid(),
          name: str(data.name, 1, 160),
          sha256: data.sha256,
          width: Number.isInteger(data.width) ? data.width : 512,
          height: Number.isInteger(data.height) ? data.height : 512,
          colors: Array.isArray(data.colors) ? data.colors.filter(c => HEX.test(c)).slice(0, 8) : [],
          approved_by: user.name,
          at: timestamp()
        });
      } else fail(400, 'Unknown knowledge item.');
      state.knowledge_version++;
      await appendAudit(state, user, 'knowledge.updated', data.id || data.kind, `Knowledge version ${state.knowledge_version}`, env.AUDIT_SIGNING_KEY);
      await saveOrg(db, org, state, env);
      return json({ ok: true });
    }

    if (path === '/api/reviews') {
      checkRole(user, ['creator', 'manager', 'admin']);
      const maxDrafts = state.retention?.max_drafts || 120;
      if (state.reviews.length >= maxDrafts) fail(400, `Limit of ${maxDrafts} drafts reached. Export or archive your workspace.`);
      const draft = await draftInput(data),
        analysis = await analyze(draft, state, env),
        id = uuid();
      state.reviews.unshift({
        ...draft,
        id,
        created_by: user.id,
        created_name: user.name,
        last_editor: user.id,
        version: 1,
        status: 'draft',
        created_at: timestamp(),
        updated_at: timestamp(),
        analysis,
        versions: [],
        comments: []
      });
      await appendAudit(state, user, 'review.created', id, 'Initial review completed.', env.AUDIT_SIGNING_KEY);
      await saveOrg(db, org, state, env);
      return json({ id }, 201);
    }

    const match = path.match(/^\/api\/reviews\/([^/]+)$/);
    if (match) {
      const r = state.reviews.find(x => x.id === match[1]);
      if (!r) fail(404, 'Review not found in this workspace.');
      const action = data.action;
      const maxRev = state.retention?.max_revisions || 25;

      if (action === 'save') {
        canEdit(user, r);
        const draft = await draftInput({ ...data, gdoc: data.gdoc !== undefined ? data.gdoc : r.gdoc });
        if (draft.gdoc && r.gdoc && draft.text !== r.text) {
          const revNum = ( parseInt(String(r.gdoc.doc_revision_id).replace(/\D+/g, ''), 10) || 1 ) + 1;
          draft.gdoc.doc_revision_id = `rev-${revNum}`;
          draft.gdoc.content_sha256 = await sha256(draft.text);
          draft.gdoc.approval_bound_revision = null;
          const gdocRecord = (state.gdocs || []).find(g => g.doc_id === draft.gdoc.doc_id);
          if (gdocRecord) {
            gdocRecord.text = draft.text;
            gdocRecord.doc_revision_id = draft.gdoc.doc_revision_id;
            gdocRecord.updated_at = timestamp();
          }
        }
        reversion(r, draft, await analyze(draft, state, env), user, maxRev);
      } else if (action === 'apply') {
        canEdit(user, r);
        const f = r.analysis.findings.find(x => x.id === data.finding_id);
        if (!f?.suggestion || !f.quote || !Number.isInteger(f.start)) fail(400, 'This issue needs a manual edit.');
        if (r.text.slice(f.start, f.end) !== f.quote) fail(409, 'The quoted span has changed. Run the review again.');
        const newText = r.text.slice(0, f.start) + f.suggestion + r.text.slice(f.end);
        let nextGdoc = r.gdoc ? structuredClone(r.gdoc) : null;
        if (nextGdoc) {
          const revNum = (parseInt(String(nextGdoc.doc_revision_id).replace(/\D+/g, ''), 10) || 1) + 1;
          nextGdoc.doc_revision_id = `rev-${revNum}`;
          nextGdoc.content_sha256 = await sha256(newText);
          nextGdoc.approval_bound_revision = null;
          const gdocRecord = (state.gdocs || []).find(g => g.doc_id === nextGdoc.doc_id);
          if (gdocRecord) {
            gdocRecord.text = newText;
            gdocRecord.doc_revision_id = nextGdoc.doc_revision_id;
            gdocRecord.updated_at = timestamp();
          }
        }
        const draft = await draftInput({ ...r, text: newText, gdoc: nextGdoc, useAI: false });
        reversion(r, draft, await analyze(draft, state, env), user, maxRev);
      } else if (action === 'gdoc_apply') {
        // Improvement 3: Explicitly apply accepted finding corrections back to the linked Google Doc
        canEdit(user, r);
        if (!r.gdoc) fail(400, 'This review is not linked to a Google Doc.');
        let newText = r.text;
        if (data.finding_id) {
          const f = r.analysis.findings.find(x => x.id === data.finding_id);
          if (!f?.suggestion || !f.quote || !Number.isInteger(f.start)) fail(400, 'This issue needs a manual edit.');
          if (r.text.slice(f.start, f.end) !== f.quote) fail(409, 'The quoted span has changed. Run the review again.');
          newText = r.text.slice(0, f.start) + f.suggestion + r.text.slice(f.end);
        } else if (data.apply_all === true) {
          const editableFindings = r.analysis.findings
            .filter(f => f.decision === 'open' && f.suggestion && f.quote && Number.isInteger(f.start))
            .sort((a, b) => b.start - a.start);
          if (!editableFindings.length) fail(400, 'No automatic suggestions available to apply.');
          for (const f of editableFindings) {
            if (newText.slice(f.start, f.end) === f.quote) {
              newText = newText.slice(0, f.start) + f.suggestion + newText.slice(f.end);
            }
          }
        } else {
          fail(400, 'Specify finding_id or apply_all to push corrections to Google Docs.');
        }
        const revNum = (parseInt(String(r.gdoc.doc_revision_id).replace(/\D+/g, ''), 10) || 1) + 1;
        const nextDocRev = data.next_doc_revision_id ? str(data.next_doc_revision_id, 1, 80) : `rev-${revNum}`;
        const nextGdoc = {
          ...r.gdoc,
          doc_revision_id: nextDocRev,
          content_sha256: await sha256(newText),
          synced_at: timestamp(),
          approval_bound_revision: null
        };
        const gdocRecord = (state.gdocs || []).find(g => g.doc_id === nextGdoc.doc_id);
        if (gdocRecord) {
          gdocRecord.text = newText;
          gdocRecord.doc_revision_id = nextDocRev;
          gdocRecord.updated_at = timestamp();
        }
        const draft = await draftInput({ ...r, text: newText, gdoc: nextGdoc, useAI: false });
        reversion(r, draft, await analyze(draft, state, env), user, maxRev);
      } else if (action === 'gdoc_sync') {
        // Improvement 3: Sync edits from Google Docs; later edits automatically invalidate prior approval and require a fresh review
        canEdit(user, r);
        const docId = str(data.doc_id || r.gdoc?.doc_id || `gdoc-${r.id.slice(0, 8)}`, 2, 120);
        const gdocRecord = (state.gdocs || []).find(g => g.doc_id === docId);
        const syncedText = data.text !== undefined ? str(data.text, 1, 16000) : gdocRecord?.text || r.text;
        const revNum = (parseInt(String(r.gdoc?.doc_revision_id || 'rev-1').replace(/\D+/g, ''), 10) || 1) + 1;
        const nextDocRev = data.doc_revision_id ? str(data.doc_revision_id, 1, 80) : `rev-${revNum}`;
        const docTitle = str(data.doc_title || r.gdoc?.doc_title || gdocRecord?.doc_title || r.title, 1, 160);
        const docUrl = str(data.doc_url || r.gdoc?.doc_url || `https://docs.google.com/document/d/${docId}/edit`, 5, 300);

        const nextGdoc = {
          doc_id: docId,
          doc_title: docTitle,
          doc_url: docUrl,
          doc_revision_id: nextDocRev,
          content_sha256: await sha256(syncedText),
          synced_at: timestamp(),
          approval_bound_revision: null
        };
        if (gdocRecord) {
          Object.assign(gdocRecord, { doc_title: docTitle, doc_url: docUrl, text: syncedText, doc_revision_id: nextDocRev, updated_at: timestamp() });
        } else {
          state.gdocs ||= [];
          state.gdocs.push({ doc_id: docId, doc_title: docTitle, doc_url: docUrl, text: syncedText, channel: r.channel, doc_revision_id: nextDocRev, updated_at: timestamp() });
        }
        const draft = await draftInput({ ...r, title: docTitle, text: syncedText, gdoc: nextGdoc, useAI: false });
        reversion(r, draft, await analyze(draft, state, env), user, maxRev);
      } else if (action === 'decision') {
        if (r.status === 'approved') fail(409, 'Approved decisions are locked. Edit the draft to start a new revision.');
        const f = r.analysis.findings.find(x => x.id === data.finding_id);
        if (!f) fail(404, 'Finding not found.');
        if (!['dismissed', 'overridden', 'open'].includes(data.decision)) fail(400, 'Unknown decision.');
        if (f.severity === 'high' || data.decision === 'overridden') checkRole(user, ['reviewer', 'manager', 'admin']);
        else if (user.role === 'creator' && r.created_by !== user.id) fail(403, 'This draft belongs to another creator.');
        f.decision = data.decision;
        f.reason = str(data.reason, 5, 600);
        f.decided_by = user.name;
        f.decided_at = timestamp();
      } else if (action === 'submit') {
        canEdit(user, r);
        if (!['draft', 'changes_requested'].includes(r.status)) fail(409, 'Only drafts or requested changes can be submitted.');
        if (r.analysis.knowledge_version !== state.knowledge_version)
          fail(409, 'Brand guidelines changed. Save and review again before submitting.');
        r.status = 'in_review';
      } else if (action === 'approve') {
        checkRole(user, ['reviewer', 'manager', 'admin']);
        if (r.status !== 'in_review') fail(409, 'Submit this draft for review first.');
        if (r.last_editor === user.id || r.created_by === user.id) fail(403, 'A different team member must approve this content.');
        if (r.analysis.knowledge_version !== state.knowledge_version) fail(409, 'Guidelines changed; request a fresh content review.');
        if (r.analysis.findings.some(f => f.severity === 'high' && f.decision === 'open'))
          fail(409, 'Resolve or explicitly override high-severity issues before approval.');
        r.status = 'approved';
        r.approved_by = user.name;
        r.approved_at = timestamp();
        str(data.reason, 5, 600);
        if (r.gdoc) {
          r.gdoc.approval_bound_revision = {
            doc_id: r.gdoc.doc_id,
            doc_revision_id: r.gdoc.doc_revision_id,
            content_sha256: await sha256(r.text),
            review_version: r.version,
            approved_by: user.name,
            approved_at: r.approved_at
          };
        }
      } else if (action === 'request_changes') {
        checkRole(user, ['reviewer', 'manager', 'admin']);
        if (r.status !== 'in_review') fail(409, 'This draft is not awaiting review.');
        r.status = 'changes_requested';
        str(data.reason, 5, 600);
      } else if (action === 'publish') {
        checkRole(user, ['manager', 'admin']);
        if (r.status !== 'approved') fail(409, 'Only approved content can be published to external channels.');
        if (r.analysis.knowledge_version !== state.knowledge_version)
          fail(409, 'Guidelines changed since approval. Re-verify before publishing.');
        if (r.gdoc && r.gdoc.approval_bound_revision?.doc_revision_id !== r.gdoc.doc_revision_id) {
          fail(409, 'Linked Google Doc was modified after approval. Review the latest document revision first.');
        }
        const target = str(data.target || r.channel || 'cms_webhook', 2, 80);
        const pubRecord = {
          id: uuid(),
          review_id: r.id,
          review_version: r.version,
          title: r.title,
          channel: r.channel,
          target,
          published_by: user.name,
          published_at: timestamp(),
          content_sha256: await sha256(r.text),
          gdoc_revision: r.gdoc?.doc_revision_id || null
        };
        state.published_items ||= [];
        state.published_items.unshift(pubRecord);
        r.last_published = pubRecord;
      } else if (action === 'comment') {
        if (r.comments.length >= 100) fail(400, 'Comment limit reached.');
        r.comments.push({ id: uuid(), text: str(data.text, 1, 1200), author: user.name, role: user.role, at: timestamp() });
      } else fail(400, 'Unknown review action.');

      r.updated_at = timestamp();
      await appendAudit(
        state,
        user,
        `review.${action}`,
        r.id,
        data.reason || `Revision ${r.version}${data.finding_id ? '; ' + data.finding_id : ''}`,
        env.AUDIT_SIGNING_KEY
      );
      await saveOrg(db, org, state, env);
      return json({ ok: true, id: r.id, version: r.version, status: r.status, gdoc: r.gdoc || null });
    }

    fail(404, 'Endpoint not found.');
  } catch (error) {
    if (!error.status) console.error('BrandCompass API:', error.message);
    return json(
      { error: error.status ? error.message : 'The server could not complete this request. Please try again.' },
      error.status || 500
    );
  }
}
