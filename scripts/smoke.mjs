import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function getCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

// Creates a separate fictional demo workspace. It never edits a user's workspace.
// Redirects are rejected so a sign-in wall cannot look like a successful test.
export async function smoke(baseURL, extraHeaders = {}) {
  const base = new URL(baseURL);
  assert.ok(['http:', 'https:'].includes(base.protocol), 'Use an HTTP(S) app URL.');
  assert.ok(!base.username && !base.password, 'Do not include credentials in the URL.');
  const origin = base.origin;
  let cookie = '';
  let passed = 0;
  const pass = label => {
    passed++;
    console.log(`PASS ${label}`);
  };
  async function request(path, data, status = 200) {
    const response = await fetch(origin + path, {
      method: data === undefined ? 'GET' : 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(90000),
      headers: {
        ...extraHeaders,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data === undefined
          ? {}
          : {
              'Content-Type': 'application/json',
              'X-BC-Request': '1',
              Origin: origin
            })
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    assert.equal(
      response.status,
      status,
      `${path}: expected HTTP ${status}, received ${response.status}. Check deployment, access and database setup.`
    );
    const nextCookie = getCookies(response.headers).find(value => value.startsWith('bc_session='));
    if (nextCookie) cookie = nextCookie.split(';')[0];
    return response;
  }
  const json = async (path, data, status) => (await request(path, data, status)).json();
  const state = () => json('/api/state');

  assert.equal((await json('/api/health')).ok, true);
  pass('health endpoint');
  assert.match(await (await request('/')).text(), /BrandCompass/);
  for (const path of ['/app.js', '/styles.css', '/imports.js', '/vendor/pdf.min.mjs', '/vendor/pdf.worker.min.mjs']) {
    const response = await request(path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, `${path} is empty`);
  }
  pass('homepage and frontend assets');
  await request('/api/state', undefined, 401);
  pass('workspace requires a session');
  const demo = await request('/api/demo', {});
  const cookieHeader = getCookies(demo.headers).find(value => value.startsWith('bc_session=')) || '';
  assert.ok(cookieHeader.includes('HttpOnly') && cookieHeader.includes('SameSite=Strict'), 'Session cookie protections missing');
  if (base.protocol === 'https:') assert.ok(cookieHeader.includes('Secure'), 'HTTPS session cookie must be Secure');
  let s = await state();
  assert.equal(s.organisation.is_demo, true);
  assert.ok(s.state.reviews.length > 0 && s.state.reviews[0].analysis.findings.length > 0);
  pass('isolated demo, seeded review and session cookie');

  // Test Improvement 1: exact + semantic paraphrase verification
  const clean = {
    title: 'Deployment smoke check',
    text: 'Verdant Bottle holds 750 ml. The Verdant Bottle is priced at ₹999.',
    channel: 'Instagram',
    audience: 'Hackathon judges',
    foreground: '#172B26',
    background: '#FFFFFF',
    alt: '',
    campaign: '',
    useAI: false
  };
  const created = await json('/api/reviews', { ...clean, revision: s.revision }, 201);
  s = await state();
  const review = s.state.reviews.find(r => r.id === created.id);
  assert.ok(review, 'Saved review was not returned');
  assert.equal(review.analysis.findings.length, 0);
  assert.equal(review.analysis.claims.length, 2);
  assert.ok(review.analysis.claims.every(c => c.status === 'supported'));
  pass('save, reload, exact & semantic paraphrase claim review');

  // Test Improvement 2: Server OCR endpoint
  const posterPath = new URL('../samples/campaign_poster_ocr.png', import.meta.url);
  const posterB64 = 'data:image/png;base64,' + readFileSync(posterPath).toString('base64');
  const ocrRes = await json('/api/ocr', { data_url: posterB64 });
  assert.equal(ocrRes.ok, true);
  assert.match(ocrRes.text, /750/i);
  assert.deepEqual(ocrRes.header, { format: 'png', width: 800, height: 400 });
  pass('server-side OCR and binary header verification');

  // Test Improvement 3: Google Docs review workflow & version binding
  const gdocCreated = await json('/api/gdocs', {
    doc_id: 'gdoc-smoke-test',
    doc_title: 'Smoke Test Google Doc',
    doc_revision_id: 'rev-1',
    channel: 'Website',
    text: 'Verdant Bottle holds 750 ml. Verdant Bottle keeps drinks cold for 12 hours.',
    create_review: true,
    revision: s.revision
  });
  assert.equal(gdocCreated.ok, true);
  s = await state();

  const reviewPath = '/api/reviews/' + encodeURIComponent(created.id);
  await json(reviewPath, { revision: s.revision, action: 'submit' });
  await json('/api/demo/role', { role: 'reviewer' });
  s = await state();
  await json(reviewPath, { revision: s.revision, action: 'approve', reason: 'Verified approved product facts during deployment check.' });
  s = await state();
  assert.equal(s.state.reviews.find(r => r.id === created.id).status, 'approved');
  pass('submission, independent reviewer, Google Docs sync and approval');

  for (const format of ['html', 'json', 'csv', 'pdf']) {
    const response = await request('/api/reports/' + encodeURIComponent(created.id) + '/' + format);
    assert.ok(response.headers.get('content-disposition')?.includes('attachment'));
    assert.ok((await response.text()).length > 50);
  }
  pass('HTML, JSON, CSV and native PDF report exports');

  const auditData = await json('/api/audit');
  assert.equal(auditData.valid, true);
  assert.equal(auditData.hmac_signed, true);
  assert.equal((await json('/api/export')).format, 'brandcompass-workspace-v1');
  pass('HMAC-signed audit verification and workspace export');

  await json('/api/logout', {});
  await request('/api/state', undefined, 401);
  pass('logout revokes access');
  console.log(`${passed} HTTP checks passed at ${origin}`);
  return { passed, origin };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const extraHeaders = process.env.BC_SMOKE_SITE_TOKEN ? { 'OAI-Sites-Authorization': `Bearer ${process.env.BC_SMOKE_SITE_TOKEN}` } : {};
    await smoke(process.argv[2] || 'http://localhost:3000', extraHeaders);
  } catch (error) {
    console.error('Smoke check failed:', error.message);
    process.exitCode = 1;
  }
}
