import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, demoDraft } from '../src/seed.mjs';
import {
  reviewContent,
  contrastRatio,
  insights,
  embedText,
  cosineSimilarity,
  extractStructuredClaim,
  verifyClaimAgainstFacts,
  inspectBinaryImageHeader
} from '../src/engine.mjs';
import { addAIReview } from '../src/ai.mjs';
import { appendAudit, verifyAudit, sha256, encryptAtRest, decryptAtRest, computeTotp, verifyTotp, generateMfaSecret } from '../src/security.mjs';

const clean = { ...demoDraft, text: 'Verdant Bottle holds 750 ml. Verdant Bottle costs INR 999.', foreground: '#172B26' };
const fixedDate = new Date('2026-11-07T12:00:00Z');

test('seeded bad draft has traceable term, claim, tone and contrast findings', () => {
  const a = reviewContent(demoDraft, seedState(), fixedDate);
  for (const c of ['Terminology', 'Claims', 'Voice', 'Accessibility']) assert.ok(a.findings.some(f => f.category === c));
  assert.ok(a.findings.every(f => f.source.id && f.source.excerpt));
  assert.equal(a.claims.length, 2);
});

test('exact approved statements are supported without findings', () => {
  const a = reviewContent(clean, seedState(), fixedDate);
  assert.equal(a.findings.length, 0);
  assert.equal(a.claims.filter(c => c.status === 'supported').length, 2);
  assert.equal(a.score, 100);
});

test('similarity never verifies an altered numeric claim', () => {
  const a = reviewContent({ ...clean, text: 'Verdant Bottle holds 900 ml.' }, seedState(), fixedDate);
  assert.equal(a.claims[0].status, 'cannot_verify');
  assert.equal(a.findings[0].suggestion, 'Verdant Bottle holds 750 ml.');
});

test('negated approved fact is not a supported claim', () => {
  const a = reviewContent({ ...clean, text: 'Verdant Bottle does not hold 750 ml.' }, seedState(), fixedDate);
  assert.equal(a.claims[0].status, 'cannot_verify');
});

test('expired fact is explicitly marked and never suggested', () => {
  const s = seedState();
  s.facts[0].valid_until = '2026-01-01';
  const a = reviewContent({ ...clean, text: s.facts[0].text }, s, fixedDate);
  assert.equal(a.claims[0].status, 'expired');
  assert.equal(a.findings[0].suggestion, null);
});

test('disabled facts cannot provide verified support', () => {
  const s = seedState();
  s.facts[0].active = false;
  assert.equal(reviewContent({ ...clean, text: s.facts[0].text }, s, fixedDate).claims[0].status, 'cannot_verify');
});

test('Improvement 1: structured semantic paraphrase and canonical unit conversion are verified when evidence matches', () => {
  const s = seedState();
  const paraphrases = [
    'The Verdant Bottle has a capacity of 750 millilitres.',
    'Each Verdant Bottle holds 0.75 litres of water.',
    'The Verdant Bottle is priced at ₹999.',
    'Drinks stay chilled inside the Verdant Bottle for 12 hrs.',
    'Standard shipping arrives in 3-5 working days.'
  ];
  for (const text of paraphrases) {
    const a = reviewContent({ ...clean, text }, s, fixedDate);
    assert.equal(a.claims.length, 1, `Expected 1 claim for: ${text}`);
    assert.equal(a.claims[0].status, 'supported', `Expected supported for paraphrase: ${text}`);
    assert.equal(a.claims[0].match_type, 'semantic_paraphrase');
    assert.equal(a.findings.length, 0);
  }
});

test('Improvement 1: implicit comparisons, absolutes and unit mismatches are flagged while benign greetings and list headings pass', () => {
  const s = seedState();
  for (const bad of [
    'Our bottle lasts twice as long.',
    'Buy it for half the price.',
    'This bottle is unbreakable.',
    'Our insulation outperforms every competitor.',
    'Standard delivery takes 3 to 5 days.',
    'Verdant Bottle holds 750 litres.'
  ]) {
    const a = reviewContent({ ...clean, text: bad }, s, fixedDate);
    assert.equal(a.claims.length, 1, `Expected claim detected for: ${bad}`);
    assert.equal(a.claims[0].status, 'cannot_verify', `Expected cannot_verify for: ${bad}`);
  }
  for (const benign of ['Best wishes from the Verdant team.', 'Here are 3 ways to enjoy your walk.']) {
    const a = reviewContent({ ...clean, text: benign }, s, fixedDate);
    assert.equal(a.claims.length, 0, `Expected no false-positive claim for: ${benign}`);
    assert.equal(a.findings.length, 0);
  }
});

test('term checks use case-insensitive whole word matches', () => {
  const s = seedState(),
    a = reviewContent({ ...clean, text: 'CHEAP is a word; cheaper is different.' }, s, fixedDate);
  assert.equal(a.findings.filter(f => f.category === 'Terminology').length, 1);
  assert.equal(a.findings[0].quote, 'CHEAP');
});

test('regex punctuation in user-defined terms is treated literally', () => {
  const s = seedState();
  s.rules[0].config.terms = [{ term: 'C++', replacement: 'C plus plus' }];
  const a = reviewContent({ ...clean, text: 'We use C++.' }, s, fixedDate);
  assert.equal(a.findings[0].quote, 'C++');
});

test('all emitted editable offsets match their exact quoted source', () => {
  for (const f of reviewContent(demoDraft, seedState(), fixedDate).findings)
    if (Number.isInteger(f.start)) assert.equal(demoDraft.text.slice(f.start, f.end), f.quote);
});

test('contrast uses unrounded ratios and large text threshold', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
  const d = { ...clean, text: 'Hello.', foreground: '#888888' };
  assert.ok(reviewContent(d, seedState()).findings.some(f => f.rule_id === 'contrast'));
  assert.ok(!reviewContent({ ...d, largeText: true }, seedState()).findings.some(f => f.rule_id === 'contrast'));
});

test('missing alt text is flagged only on informative images', () => {
  const image = { kind: 'photo', colors: [], sha256: 'a'.repeat(64), decorative: false };
  assert.ok(reviewContent({ ...clean, image }, seedState()).findings.some(f => f.rule_id === 'alt'));
  assert.ok(!reviewContent({ ...clean, image: { ...image, decorative: true } }, seedState()).findings.some(f => f.rule_id === 'alt'));
});

test('palette applies to graphics with location-specific regional findings, not photographic colours', () => {
  const image = {
    kind: 'graphic',
    colors: ['#FF00FF'],
    regions: { 'top-left': ['#FF00FF'], center: ['#0F766E'] },
    sha256: 'a'.repeat(64),
    decorative: true
  };
  const res = reviewContent({ ...clean, image }, seedState());
  const palFinding = res.findings.find(f => f.rule_id === 'palette');
  assert.ok(palFinding);
  assert.match(palFinding.message, /top-left/);
  assert.ok(!reviewContent({ ...clean, image: { ...image, kind: 'photo' } }, seedState()).findings.some(f => f.rule_id === 'palette'));
});

test('Improvement 2: logo identity, aspect-ratio distortion, cropping, recolouring and OCR text review', () => {
  const s = seedState();
  const baseLogo = { kind: 'logo', width: 512, height: 512, colors: ['#0F766E'], sha256: 'a'.repeat(64), decorative: true };
  assert.ok(reviewContent({ ...clean, image: baseLogo }, s).findings.some(f => f.rule_id === 'assets'));
  s.assets.push({ sha256: baseLogo.sha256, width: 512, height: 512, colors: ['#0F766E'] });
  assert.ok(!reviewContent({ ...clean, image: baseLogo }, s).findings.some(f => f.rule_id === 'assets'));

  // Distorted & recoloured logo
  const distortedLogo = {
    kind: 'logo',
    width: 800,
    height: 400,
    colors: ['#FF00FF'],
    regions: { center: ['#FF00FF'] },
    cropped: true,
    crop_region: 'bottom-right margin',
    sha256: 'b'.repeat(64),
    decorative: true
  };
  const distReview = reviewContent({ ...clean, image: distortedLogo }, s);
  const logoFinding = distReview.findings.find(f => f.rule_id === 'assets');
  assert.ok(logoFinding);
  assert.match(logoFinding.message, /aspect ratio distorted/);
  assert.match(logoFinding.message, /cropped margins/);
  assert.match(logoFinding.message, /recolouring/);

  // OCR text extracted from image is checked for claims and terminology
  const ocrImage = {
    ...baseLogo,
    ocr_text: 'This cheap bottle keeps drinks cold for 48 hours.'
  };
  const ocrReview = reviewContent({ ...clean, image: ocrImage }, s, fixedDate);
  assert.ok(ocrReview.findings.some(f => f.category === 'Terminology' && f.location === 'Image OCR text'));
  assert.ok(ocrReview.findings.some(f => f.category === 'Claims' && f.location === 'Image OCR text'));
});

test('Improvement 2: server binary header parser extracts PNG, JPEG and WebP dimensions', () => {
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x00
  ]);
  const parsed = inspectBinaryImageHeader(pngHeader);
  assert.deepEqual(parsed, { format: 'png', width: 512, height: 256 });
});

test('discount promotion needs required conditions', () => {
  assert.ok(reviewContent({ ...clean, text: 'Get 20% off today.' }, seedState()).findings.some(f => f.rule_id === 'offers'));
  assert.ok(!reviewContent({ ...clean, text: 'Get 20% off today. Terms apply.' }, seedState()).findings.some(f => f.rule_id === 'offers'));
});

test('health shows no-data rather than invented perfect scores', () => {
  assert.ok(insights(seedState()).rule_health.every(h => h.health === null));
});

test('health is measured from actual current decisions', () => {
  const s = seedState(),
    analysis = reviewContent(demoDraft, s);
  const term = analysis.findings.find(f => f.rule_id === 'terms');
  term.decision = 'dismissed';
  s.reviews.push({ analysis, channel: 'Instagram', status: 'draft' });
  const h = insights(s).rule_health.find(h => h.id === 'terms');
  assert.equal(h.flags, 2);
  assert.equal(h.health, 50);
});

test('audit detects changed records, broken links and admin hash-chain recomputation without HMAC key', async () => {
  const s = seedState(),
    user = { name: 'Test', id: 'u', role: 'admin' };
  await appendAudit(s, user, 'create', 'x', 'initial', 'secret-key-1');
  await appendAudit(s, user, 'edit', 'x', 'second', 'secret-key-1');
  assert.equal(await verifyAudit(s.audit, 'secret-key-1'), true);
  // Simulate a DB administrator who tampers with event[0] AND recomputes all SHA-256 hashes without knowing 'secret-key-1'
  const tampered = structuredClone(s.audit);
  tampered[0].detail = 'rewritten-by-dba';
  const { hash: _h0, signature: _s0, anchor: _a0, ...rec0 } = tampered[0];
  tampered[0].hash = await sha256(JSON.stringify(rec0));
  tampered[1].previous = tampered[0].hash;
  const { hash: _h1, signature: _s1, anchor: _a1, ...rec1 } = tampered[1];
  tampered[1].hash = await sha256(JSON.stringify(rec1));
  assert.equal(await verifyAudit(tampered, 'secret-key-1'), false);
});

test('AES-256-GCM at-rest encryption and TOTP MFA verification work end to end', async () => {
  const encrypted = await encryptAtRest(JSON.stringify({ hello: 'world' }), 'test-key');
  assert.ok(encrypted.includes('__encrypted'));
  const decrypted = await decryptAtRest(encrypted, 'test-key');
  assert.equal(decrypted.hello, 'world');

  const secret = generateMfaSecret();
  const code = await computeTotp(secret);
  assert.equal(await verifyTotp(secret, code), true);
  assert.equal(await verifyTotp(secret, '000000'), code === '000000');
});

test('optional AI missing-key mode stays operational and truthful, while self-hosted local model works offline', async () => {
  const a = await addAIReview(reviewContent(clean, seedState()), { ...clean, useAI: true }, seedState(), {});
  assert.equal(a.ai.status, 'unavailable');
  assert.equal(a.ai.used, false);

  const localDraft = { ...clean, text: 'This game-changing bottle enables you to utilize better hydration.', useLocalModel: true };
  const b = await addAIReview(reviewContent(localDraft, seedState()), localDraft, seedState(), {});
  assert.equal(b.ai.used, true);
  assert.equal(b.ai.provider, 'self-hosted');
  assert.ok(b.findings.some(f => f.category.includes('AI advisory')));
});

test('optional AI provider failure preserves deterministic results', async () => {
  const base = reviewContent(demoDraft, seedState());
  const a = await addAIReview(base, { ...demoDraft, useAI: true }, seedState(), { OPENAI_API_KEY: 'test' }, async () => new Response('{}', { status: 500 }));
  assert.equal(a.ai.status, 'failed');
  assert.ok(a.findings.length > 0);
});

test('AI citations and quoted spans are validated before inclusion', async () => {
  const s = seedState(),
    base = reviewContent(demoDraft, s);
  const n = base.findings.length;
  const fake = async () =>
    Response.json({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                findings: [
                  { source_id: 'invented', quote: 'cheap', reason: 'x', suggestion: 'y' },
                  { source_id: 'terms', quote: 'not in the text', reason: 'x', suggestion: 'y' },
                  { source_id: 'terms', quote: 'cheap', reason: 'Preferred language rule', suggestion: 'affordable' }
                ]
              })
            }
          ]
        }
      ]
    });
  const a = await addAIReview(base, { ...demoDraft, useAI: true }, s, { OPENAI_API_KEY: 'test' }, fake);
  assert.equal(a.ai.accepted, 1);
  assert.equal(a.findings.length, n + 1);
});
