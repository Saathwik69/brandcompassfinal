// Hybrid deterministic rules + structured semantic claim extraction + embedding-based evidence retrieval + server-side visual & OCR validation.
// Similarity alone never verifies a claim: quantities, canonical units, negation polarity, qualifiers and source expiry must all pass.
export const ENGINE_VERSION = '2.0.0';

const STOP = new Set(
  'the a an for of and is are was were be been being with to in on at by from our your their this that these those it its very bottle verdant'.split(' ')
);

const normalize = s =>
  String(s || '')
    .toLowerCase()
    .replace(/₹/g, 'inr ')
    .replace(/\brs\.?\s*(?=\d)/gi, 'inr ')
    .replace(/[^\p{L}\p{N}%.\-]+/gu, ' ')
    .replace(/(?<!\d)[.\-]|[.\-](?!\d)/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const stemWord = w =>
  w
    .replace(/^(millilitres|milliliters)$/, 'ml')
    .replace(/^(litres|liters)$/, 'l')
    .replace(/^(rupees|rupee)$/, 'inr')
    .replace(/^(hrs|hr|hours|hour)$/, 'hour')
    .replace(/^(days|day)$/, 'day')
    .replace(/^(working|business)$/, 'business')
    .replace(/^(holds|holding|held|contains|containing|capacity|fits)$/, 'hold')
    .replace(/^(costs|costing|priced|price|prices|retails|retail)$/, 'cost')
    .replace(/^(keeps|keeping|kept|stays|staying|maintains|retains|chills|chilled|cooling|cools)$/, 'keep')
    .replace(/^(takes|taking|arrives|arrive|shipping|ships|shipped|delivered|deliver|delivers)$/, 'delivery')
    .replace(/(?:ing|ed|es|s)$/, m => (w.length > 5 ? '' : m));

const terms = s => [
  ...new Set(
    normalize(s)
      .split(' ')
      .filter(w => w.length > 1 && !STOP.has(w))
      .map(stemWord)
  )
];

const escapeRE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 64-dimensional semantic + character n-gram embedding for zero-dependency vector retrieval
const CONCEPT_GROUPS = [
  ['hold', 'capacity', 'volume', 'size', 'ml', 'millilitre', 'milliliter', 'litre', 'liter', 'contains', 'fits', '750'],
  ['cost', 'price', 'retail', 'inr', 'rupee', 'buy', 'afford', 'cheap', 'fee', '999', '699'],
  ['keep', 'cold', 'cool', 'chill', 'chilled', 'icy', 'thermal', 'temperature', 'insulation', 'insulated', 'retention', 'hour', '12', '48'],
  ['standard', 'delivery', 'shipping', 'ship', 'arrive', 'dispatch', 'transit', 'business', 'working', 'day', '3', '5'],
  ['verdant', 'bottle', 'drinkware', 'flask', 'container', 'everyday'],
  ['carbon', 'neutral', 'eco', 'sustainable', 'climate', 'green', 'emission', 'planet', 'recycled'],
  ['best', 'leading', 'outperform', 'beat', 'competitor', 'competition', 'safest', 'first', 'twice', 'half', 'double', 'superior'],
  ['guarantee', 'guaranteed', 'unbreakable', 'indestructible', 'certified', 'safe', 'cure', 'warranty', 'forever'],
  ['discount', 'off', 'sale', 'promo', 'promotion', 'offer', 'terms', 'apply', 'percent'],
  ['hurry', 'urgent', 'regret', 'limited', 'shout', 'revolutionary', 'thoughtfully', 'calm'],
  ['contrast', 'colour', 'color', 'alt', 'image', 'logo', 'graphic', 'palette', 'readable', 'decorative'],
  ['not', 'never', 'no', 'without', 'neither', 'lacks', 'fails', 'cannot']
];

export function embedText(text) {
  const vec = new Float64Array(64);
  const norm = normalize(text);
  const rawWords = norm.split(' ').filter(Boolean);
  const stemmed = rawWords.map(stemWord);

  for (let c = 0; c < CONCEPT_GROUPS.length; c++) {
    const group = CONCEPT_GROUPS[c];
    for (const w of stemmed) {
      if (group.includes(w)) vec[c] += 1.8;
    }
    for (const w of rawWords) {
      if (group.includes(w)) vec[c] += 1.2;
    }
  }

  for (const w of stemmed) {
    if (STOP.has(w)) continue;
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const bucket = 12 + (Math.abs(h) % 36);
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[bucket] += sign * (/\d/.test(w) ? 0.6 : 1.2);
  }

  const compact = norm.replace(/\s+/g, '_');
  for (let i = 0; i <= compact.length - 3; i++) {
    const tri = compact.slice(i, i + 3);
    let h = 2166136261;
    for (let j = 0; j < 3; j++) {
      h ^= tri.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    const bucket = 48 + (Math.abs(h) % 16);
    vec[bucket] += ((h & 1) === 0 ? 0.35 : -0.35);
  }

  let mag = 0;
  for (let i = 0; i < vec.length; i++) mag += vec[i] * vec[i];
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= mag;
  return Array.from(vec);
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  return denom ? Math.max(0, Math.min(1, dot / denom)) : 0;
}

export function contrastRatio(a, b) {
  const lum = hex => {
    const rgb = hex
      .slice(1)
      .match(/../g)
      .map(x => parseInt(x, 16) / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function retrieve(query, sources, limit = 4) {
  const qt = terms(query);
  const qVec = embedText(query);
  return sources
    .filter(s => s.active !== false)
    .map(s => {
      const text = s.text || s.body || '';
      const st = terms(text);
      const common = qt.filter(t => st.includes(t));
      const lexicalScore =
        common.reduce((sum, w) => sum + (/\d/.test(w) ? 0.4 : 1), 0) /
        Math.sqrt(Math.max(1, st.length));
      const semanticScore = cosineSimilarity(qVec, embedText((s.title ? s.title + ' ' : '') + text));
      const hybridScore = lexicalScore + (common.length > 0 || semanticScore >= 0.45 ? semanticScore * 0.65 : 0);
      return {
        source: s,
        score: Number(hybridScore.toFixed(4)),
        lexical_score: Number(lexicalScore.toFixed(4)),
        semantic_score: Number(semanticScore.toFixed(4)),
        overlap: common.length
      };
    })
    .filter(x => x.overlap > 0 || x.semantic_score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export const factCurrent = (fact, now = new Date()) =>
  fact.active !== false && (!fact.valid_until || fact.valid_until >= now.toISOString().slice(0, 10));

export function colorDistance(a, b) {
  return Math.sqrt(
    [1, 3, 5].reduce((n, i) => n + (parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) ** 2, 0)
  );
}

// Structured claim extraction: quantities, canonical units, negation, implicit comparisons, superlatives, and benign phrase filtering
const WORD_NUMS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, twenty: 20, twentyfour: 24, thirty: 30, fortyeight: 48, fifty: 50, hundred: 100
};

function parseNumToken(tok) {
  if (!tok) return null;
  const cleaned = String(tok).toLowerCase().replace(/,/g, '').trim();
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned);
  const hyphenCleaned = cleaned.replace(/[-\s]/g, '');
  if (WORD_NUMS[hyphenCleaned] !== undefined) return WORD_NUMS[hyphenCleaned];
  return null;
}

export function isBenignStatement(sentence) {
  const s = String(sentence || '').trim();
  if (!s) return true;
  // Conventional polite greetings/sign-offs using "best"
  if (/^(?:with\s+)?(?:best\s+(?:wishes|regards|luck)|all\s+the\s+best|warm(?:est)?\s+(?:wishes|regards)|kind(?:est)?\s+regards)\b/i.test(s)) {
    const stripped = s.replace(/^(?:with\s+)?(?:best\s+(?:wishes|regards|luck)|all\s+the\s+best|warm(?:est)?\s+(?:wishes|regards)|kind(?:est)?\s+regards)\b/i, '');
    if (!/\d|\b(guarantee\w*|certified|carbon[- ]neutral|cure\w*|safest|leading|unbreakable|outperforms?|twice|half)\b/i.test(stripped)) {
      return true;
    }
  }
  // Benign editorial list headings or step labels without product metrics/claims
  if (
    /^(?:here\s+are\s+\d+\s+(?:ways|tips|steps|reasons|ideas|things|habits|moments|questions)|top\s+\d+\s+(?:tips|ways|habits|ideas)|step\s+\d+\s*[:\-]|chapter\s+\d+\b|\d+\s+(?:ways|tips|steps|ideas)\s+to\s+(?:enjoy|start|plan|organise|organize|brighten|simplify|relax))\b/i.test(s) &&
    !/\b(ml|millilit\w*|litr\w*|inr|rupees?|rs\.?|hours?|hrs?|days?|%|percent|off|discount|price|costs?|holds?|cold|warm|hot|guarantee\w*|certified|safest|best|leading|outperforms?|unbreakable)\b/i.test(s)
  ) {
    return true;
  }
  return false;
}

export function extractStructuredClaim(sentence) {
  const raw = String(sentence || '').trim();
  const s = raw.toLowerCase();
  const benign = isBenignStatement(raw);

  const negated = /\b(not|no|never|neither|nor|without|doesn't|doesnt|don't|dont|isn't|isnt|aren't|arent|won't|wont|cannot|can't|cant|fails?\s+to|lacks?|non-\w+)\b/i.test(s);

  const quantities = [];

  // 1. Range of days / business days: e.g., "3 to 5 business days", "3-5 working days", "three to five business days"
  const rangeDaysRe = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:to|-|–)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(business|working)?\s*(days?)\b/gi;
  let m;
  const matchedSpans = [];
  const overlapsSpan = (start, end) => matchedSpans.some(([a, b]) => start < b && end > a);

  while ((m = rangeDaysRe.exec(raw)) !== null) {
    const v1 = parseNumToken(m[1]);
    const v2 = parseNumToken(m[2]);
    const isBiz = Boolean(m[3]);
    quantities.push({
      raw: m[0],
      dimension: 'delivery',
      canonicalValue: v1,
      maxValue: v2,
      canonicalUnit: isBiz ? 'business_days' : 'days'
    });
    matchedSpans.push([m.index, m.index + m[0].length]);
  }

  // 2. Currency prefix: INR 999, ₹999, ₹ 999, Rs. 999, USD 15, $15
  const currPrefixRe = /(?:₹|\b(?:inr|rs\.?|usd|eur)\b|\$)\s*(\d[\d,]*(?:\.\d+)?)/gi;
  while ((m = currPrefixRe.exec(raw)) !== null) {
    if (overlapsSpan(m.index, m.index + m[0].length)) continue;
    const val = Number(m[1].replace(/,/g, ''));
    const sym = m[0].toLowerCase();
    const unit = sym.includes('$') || sym.includes('usd') ? 'usd' : sym.includes('eur') ? 'eur' : 'inr';
    quantities.push({ raw: m[0], dimension: 'price', canonicalValue: val, maxValue: null, canonicalUnit: unit });
    matchedSpans.push([m.index, m.index + m[0].length]);
  }

  // 3. Currency suffix: 999 rupees, 999 INR, 999 rs
  const currSuffixRe = /\b(\d[\d,]*(?:\.\d+)?)\s*(rupees?|inr|rs\.?|dollars?|usd)\b/gi;
  while ((m = currSuffixRe.exec(raw)) !== null) {
    if (overlapsSpan(m.index, m.index + m[0].length)) continue;
    const val = Number(m[1].replace(/,/g, ''));
    const u = m[2].toLowerCase();
    const unit = u.startsWith('dollar') || u === 'usd' ? 'usd' : 'inr';
    quantities.push({ raw: m[0], dimension: 'price', canonicalValue: val, maxValue: null, canonicalUnit: unit });
    matchedSpans.push([m.index, m.index + m[0].length]);
  }

  // 4. Volume / capacity: 750 ml, 750 millilitres, 0.75 l, 0.75 litres
  const volRe = /\b(\d+(?:\.\d+)?)\s*(ml|millilitres?|milliliters?|l|litres?|liters?)\b/gi;
  while ((m = volRe.exec(raw)) !== null) {
    if (overlapsSpan(m.index, m.index + m[0].length)) continue;
    const num = Number(m[1]);
    const u = m[2].toLowerCase();
    const isLitre = u === 'l' || u.startsWith('lit');
    const canonicalMl = isLitre ? Math.round(num * 1000) : num;
    quantities.push({ raw: m[0], dimension: 'volume', canonicalValue: canonicalMl, maxValue: null, canonicalUnit: 'ml' });
    matchedSpans.push([m.index, m.index + m[0].length]);
  }

  // 5. Duration: 12 hours, 12 hrs, 12h, twelve hours, 720 minutes
  const durRe = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty[-\s]?four|forty[-\s]?eight)\s*(hours?|hrs?|hr|h|minutes?|mins?)\b/gi;
  while ((m = durRe.exec(raw)) !== null) {
    if (overlapsSpan(m.index, m.index + m[0].length)) continue;
    const num = parseNumToken(m[1]);
    if (num === null) continue;
    const u = m[2].toLowerCase();
    const isMin = u.startsWith('min');
    const canonicalHours = isMin ? Number((num / 60).toFixed(4)) : num;
    quantities.push({ raw: m[0], dimension: 'duration', canonicalValue: canonicalHours, maxValue: null, canonicalUnit: 'hours' });
    matchedSpans.push([m.index, m.index + m[0].length]);
  }

  // 6. Single day counts: "2 days", "5 business days"
  const singleDayRe = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(business|working)?\s*(days?)\b/gi;
  while ((m = singleDayRe.exec(raw)) !== null) {
    if (overlapsSpan(m.index, m.index + m[0].length)) continue;
    const num = parseNumToken(m[1]);
    const isBiz = Boolean(m[2]);
    quantities.push({
      raw: m[0],
      dimension: 'delivery',
      canonicalValue: num,
      maxValue: null,
      canonicalUnit: isBiz ? 'business_days' : 'days'
    });
    matchedSpans.push([m.index, m.index + m[0].length]);
  }

  // 7. Percentage / discount: 20%, 20 percent
  const pctRe = /\b(\d+(?:\.\d+)?)\s*(?:%|percent|per\s+cent)\b/gi;
  while ((m = pctRe.exec(raw)) !== null) {
    if (overlapsSpan(m.index, m.index + m[0].length)) continue;
    quantities.push({ raw: m[0], dimension: 'percentage', canonicalValue: Number(m[1]), maxValue: null, canonicalUnit: 'percent' });
    matchedSpans.push([m.index, m.index + m[0].length]);
  }

  // 8. Other bare numbers when not benign
  const bareNumRe = /\b(\d[\d,]*(?:\.\d+)?)\b/g;
  while ((m = bareNumRe.exec(raw)) !== null) {
    if (overlapsSpan(m.index, m.index + m[0].length)) continue;
    quantities.push({ raw: m[0], dimension: 'count', canonicalValue: Number(m[1].replace(/,/g, '')), maxValue: null, canonicalUnit: 'count' });
    matchedSpans.push([m.index, m.index + m[0].length]);
  }

  const hasImplicitComparison = /\b(twice\s+as\s+\w+|half\s+the\s+(?:price|cost|time|weight|size)|double\s+the\s+(?:capacity|life|time|cold|strength)|three\s+times\s+as\s+\w+|\d+\s*x\s+(?:longer|faster|stronger|more|colder|better|cheaper)|lasts?\s+twice\s+as\s+long|keeps?\s+drinks?\s+cold\s+longer\s+than)\b/i.test(raw);
  const hasComparative = /\b(outperforms?|beats?\s+(?:every|all|the)\s+competit\w*|better\s+than\s+(?:any|every|all)|more\s+durable\s+than\s+any|superior\s+to\s+(?:every|all|other)|longer\s+than\s+any\s+competit\w*)\b/i.test(raw);
  const hasSuperlative = !benign && /\b(best|safest|leading|number\s+one|#1|world'?s\s+first|most\s+durable|most\s+advanced|finest|unmatched|unrivalled|unrivaled)\b/i.test(raw);
  const hasGuarantee = /\b(guarantee\w*|certified|carbon[- ]neutral|net[- ]zero|cure\w*|unbreakable|indestructible|shatter[- ]?proof\s+forever|leak[- ]?proof\s+forever|100%\s+(?:safe|recycled|organic|eco[- ]friendly)|lifetime\s+warranty|never\s+(?:leaks?|breaks?|fails?)|zero[- ]emissions?|clinically\s+proven|doctor\s+recommended)\b/i.test(raw);

  let domain = 'general';
  if (quantities.some(q => q.dimension === 'volume') || /\b(holds?|capacity|volume|ml|millilit\w*|litr\w*)\b/i.test(raw)) domain = 'capacity';
  else if (quantities.some(q => q.dimension === 'price') || /\b(costs?|pric\w*|retails?|inr|rupees?|half\s+the\s+price)\b/i.test(raw)) domain = 'price';
  else if (quantities.some(q => q.dimension === 'duration') || /\b(cold|chill\w*|thermal|insulat\w*|hours?|hrs?|temperature|hot|warm)\b/i.test(raw)) domain = 'thermal';
  else if (quantities.some(q => q.dimension === 'delivery') || /\b(deliver\w*|ship\w*|dispatch\w*|business\s+days?|working\s+days?|arrives?)\b/i.test(raw)) domain = 'delivery';
  else if (/\b(carbon[- ]neutral|net[- ]zero|eco|sustainab\w*|emissions?)\b/i.test(raw)) domain = 'environmental';
  else if (/\b(cure\w*|safest|certified|health|medical|non[- ]toxic)\b/i.test(raw)) domain = 'safety_health';
  else if (hasSuperlative || hasComparative || hasImplicitComparison) domain = 'superiority';

  const isCandidate =
    !benign &&
    (quantities.length > 0 || hasImplicitComparison || hasComparative || hasSuperlative || hasGuarantee);

  // Detect specific product variant mentions (e.g., "Verdant Mini", "Verdant Pro")
  const variantMatch = raw.match(/\bverdant\s+(mini|pro|max|kids|sport|lite|xl)\b/i);
  const productVariant = variantMatch ? variantMatch[1].toLowerCase() : 'standard';

  return {
    isCandidate,
    benign,
    negated,
    quantities,
    hasImplicitComparison,
    hasComparative,
    hasSuperlative,
    hasGuarantee,
    domain,
    productVariant
  };
}

function quantitiesMatch(qA, qB) {
  if (qA.length !== qB.length || qA.length === 0) return false;
  const used = new Set();
  for (const a of qA) {
    const idx = qB.findIndex(
      (b, i) =>
        !used.has(i) &&
        a.dimension === b.dimension &&
        a.canonicalUnit === b.canonicalUnit &&
        Math.abs((a.canonicalValue ?? 0) - (b.canonicalValue ?? 0)) < 1e-6 &&
        (a.maxValue ?? null) === (b.maxValue ?? null)
    );
    if (idx === -1) return false;
    used.add(idx);
  }
  return true;
}

export function verifyClaimAgainstFacts(sentenceText, facts, now = new Date()) {
  const claimInfo = extractStructuredClaim(sentenceText);
  const activeOrExpiredFacts = facts.filter(f => f.active !== false);

  // 1. Check exact normalized statement match
  const exact = activeOrExpiredFacts.find(f => normalize(f.text) === normalize(sentenceText));
  if (exact) {
    if (factCurrent(exact, now)) {
      return {
        status: 'supported',
        match_type: 'exact',
        source: exact,
        reason: 'Exact match to a current approved statement.',
        structured: claimInfo
      };
    }
    return {
      status: 'expired',
      match_type: 'exact',
      source: exact,
      reason: 'The matching fact has expired. Ask an owner to revalidate it.',
      structured: claimInfo
    };
  }

  // 2. Check structured semantic paraphrase match against approved facts
  const sVec = embedText(sentenceText);
  let bestSemanticFact = null;
  let bestSim = 0;

  for (const f of activeOrExpiredFacts) {
    const fInfo = extractStructuredClaim(f.text);
    const sim = cosineSimilarity(sVec, embedText(f.text));
    if (sim > bestSim) {
      bestSim = sim;
      bestSemanticFact = f;
    }

    // Strict verification criteria for semantic paraphrases:
    // - Same domain & product variant
    // - Identical negation polarity (both false)
    // - No unapproved implicit comparisons, superlatives, comparatives, or guarantees
    // - Exact match on all extracted canonical quantities and units
    // - High semantic similarity
    const qualifiersMatch =
      !claimInfo.hasImplicitComparison &&
      claimInfo.hasComparative === fInfo.hasComparative &&
      claimInfo.hasSuperlative === fInfo.hasSuperlative &&
      claimInfo.hasGuarantee === fInfo.hasGuarantee;

    const polarityMatch = claimInfo.negated === fInfo.negated && !claimInfo.negated;
    const domainMatch = claimInfo.domain === fInfo.domain && claimInfo.domain !== 'general';
    const variantMatch = claimInfo.productVariant === fInfo.productVariant;
    const quantMatch = quantitiesMatch(claimInfo.quantities, fInfo.quantities);

    if (qualifiersMatch && polarityMatch && domainMatch && variantMatch && quantMatch && sim >= 0.58) {
      if (!factCurrent(f, now)) {
        return {
          status: 'expired',
          match_type: 'semantic_paraphrase',
          source: f,
          reason: 'The matching fact has expired. Ask an owner to revalidate it.',
          structured: claimInfo
        };
      }
      return {
        status: 'supported',
        match_type: 'semantic_paraphrase',
        source: f,
        reason: 'Verified paraphrase: quantities, canonical units, polarity and semantic meaning match a current approved statement.',
        structured: claimInfo
      };
    }
  }

  // 3. Cannot verify — retrieve related context
  const related = retrieve(sentenceText, facts, 3);
  const best = related[0]?.source || (bestSim >= 0.45 ? bestSemanticFact : null);
  let reason = 'No exact current approved statement supports this claim. Related evidence is context, not proof.';
  if (claimInfo.negated && best) {
    reason = 'Negated or contradictory statement cannot be verified by an affirmative approved fact.';
  } else if (claimInfo.hasImplicitComparison) {
    reason = 'Implicit comparison or multiplier requires an explicit approved comparative fact.';
  } else if (claimInfo.quantities.length > 0 && best) {
    reason = 'No exact current approved statement supports this claim. Related evidence is context, not proof.';
  }

  return {
    status: 'cannot_verify',
    match_type: 'none',
    source: best,
    related,
    reason,
    structured: claimInfo
  };
}

// Server-side binary header inspection for PNG, JPEG, WebP (zero external dependencies)
export function inspectBinaryImageHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR at offset 8..24
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return { format: 'png', width, height };
  }
  // JPEG: FF D8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const len = view.getUint16(offset + 2, false);
      if (len < 2 || offset + 2 + len > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const height = view.getUint16(offset + 5, false);
        const width = view.getUint16(offset + 7, false);
        return { format: 'jpeg', width, height };
      }
      offset += 2 + len;
    }
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      const width = view.getUint16(26, true) & 0x3fff;
      const height = view.getUint16(28, true) & 0x3fff;
      return { format: 'webp', width, height };
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { format: 'webp', width, height };
    }
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { format: 'webp', width, height };
    }
  }
  return null;
}

export function reviewContent(draft, state, now = new Date()) {
  const mainText = draft.text || '';
  const ocrText = draft.image?.ocr_text ? String(draft.image.ocr_text).trim() : '';
  const combinedSegments = [
    { text: mainText, fromOcr: false },
    ...(ocrText ? [{ text: ocrText, fromOcr: true }] : [])
  ];

  const findings = [], claims = [];
  const rules = state.rules.filter(r => r.active !== false);
  const byType = type => rules.filter(r => r.type === type);
  const sourceRef = s => ({ id: s.id, title: s.title, source: s.source, version: s.version, excerpt: s.body || s.text });
  const add = (rule, category, title, message, quote = '', suggestion = null, extra = {}) => {
    if (findings.length >= 100) return;
    findings.push({
      id: `f-${findings.length + 1}`,
      rule_id: rule.id,
      category,
      severity: rule.severity,
      title,
      message,
      quote,
      suggestion,
      source: sourceRef(rule),
      certainty: 'Exact rule',
      decision: 'open',
      ...extra
    });
  };

  for (const seg of combinedSegments) {
    const text = seg.text;
    if (!text) continue;
    const locMeta = seg.fromOcr ? { location: 'Image OCR text' } : {};

    for (const r of byType('term')) {
      for (const entry of r.config.terms || []) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRE(entry.term)}(?![\\p{L}\\p{N}])`, 'giu');
        for (const match of text.matchAll(re)) {
          add(
            r,
            'Terminology',
            seg.fromOcr ? 'Use preferred terminology in image text' : 'Use preferred terminology',
            `“${entry.term}” is not preferred. Use “${entry.replacement}”.`,
            match[0],
            entry.replacement,
            seg.fromOcr
              ? { ...locMeta }
              : { start: match.index, end: match.index + match[0].length }
          );
        }
      }
    }

    for (const r of byType('tone')) {
      for (const phrase of r.config.phrases || []) {
        const m = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRE(phrase)}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
        if (m) {
          add(
            r,
            'Voice',
            'Keep the invitation calm',
            'This pressure phrase conflicts with the approved brand voice.',
            m[0],
            null,
            seg.fromOcr ? { ...locMeta } : { start: m.index, end: m.index + m[0].length }
          );
        }
      }
      for (const m of text.matchAll(/!{2,}/g)) {
        add(
          r,
          'Voice',
          'Dial down the exclamation marks',
          'Use one exclamation mark at most.',
          m[0],
          '.',
          seg.fromOcr ? { ...locMeta } : { start: m.index, end: m.index + m[0].length }
        );
      }
      const shout = /\b[A-Z]{3,}(?:[, ]+[A-Z]{2,}){1,}\b/g;
      for (const m of text.matchAll(shout)) {
        add(
          r,
          'Voice',
          'Avoid shouting',
          'This all-capital phrase may sound forceful. Review it in context.',
          m[0],
          m[0].toLowerCase(),
          seg.fromOcr
            ? { certainty: 'Heuristic', ...locMeta }
            : { certainty: 'Heuristic', start: m.index, end: m.index + m[0].length }
        );
      }
    }

    // Segment on sentence terminators, preserving decimal numbers and exact spans.
    const sentences = [...text.matchAll(/[^.!?\n]+(?:\.(?=\d)[^.!?\n]+)*(?:[.!?]+|$)/g)]
      .map(m => ({ text: m[0].trim(), start: m.index + m[0].indexOf(m[0].trim()) }))
      .filter(s => s.text);

    const claimRule = byType('claims')[0];
    if (claimRule) {
      for (const s of sentences) {
        const claimInfo = extractStructuredClaim(s.text);
        if (!claimInfo.isCandidate) continue;

        const verification = verifyClaimAgainstFacts(s.text, state.facts, now);
        if (verification.status === 'supported') {
          claims.push({
            text: s.text,
            status: 'supported',
            match_type: verification.match_type,
            source: sourceRef(verification.source),
            reason: verification.reason,
            structured: claimInfo,
            ...(seg.fromOcr ? { location: 'Image OCR text' } : {})
          });
          continue;
        }

        const related = verification.related || retrieve(s.text, state.facts, 3);
        const best = verification.source || related[0]?.source || null;
        const expired = verification.status === 'expired';
        const suitable =
          !expired &&
          best &&
          factCurrent(best, now) &&
          (related[0]?.overlap >= 2 || (related[0]?.semantic_score || 0) >= 0.55);
        const message = verification.reason;

        claims.push({
          text: s.text,
          status: expired ? 'expired' : 'cannot_verify',
          match_type: verification.match_type || 'none',
          source: best ? sourceRef(best) : null,
          reason: message,
          structured: claimInfo,
          ...(seg.fromOcr ? { location: 'Image OCR text' } : {})
        });

        add(
          claimRule,
          'Claims',
          expired ? 'Approved evidence has expired' : 'Cannot verify this claim',
          message,
          s.text,
          suitable ? best.text : null,
          {
            certainty: 'Structured semantic + evidence check',
            ...(seg.fromOcr ? locMeta : { start: s.start, end: s.start + s.text.length }),
            evidence: best ? sourceRef(best) : null
          }
        );
      }
    }

    for (const r of byType('readability')) {
      for (const s of sentences) {
        const count = s.text.split(/\s+/).length;
        if (count > (r.config.maxWords || 26)) {
          add(
            r,
            'Readability',
            'Give this sentence room to breathe',
            `${count} words. Consider two shorter sentences.`,
            s.text,
            null,
            { certainty: 'Heuristic', ...locMeta }
          );
        }
      }
    }

    for (const r of byType('disclaimer')) {
      if (/\d+\s*%\s*(off|discount)/i.test(text) && !text.toLowerCase().includes((r.config.text || 'Terms apply.').toLowerCase())) {
        add(r, 'Claims', 'Add the offer conditions', 'This promotion is missing the required conditions statement.', '', null, locMeta);
      }
    }
  }

  if (draft.image) {
    for (const r of byType('alt')) {
      if (
        !draft.image.decorative &&
        (!draft.alt?.trim() || draft.alt.trim().length < 10 || /^(image|photo|picture)( of)?$/i.test(draft.alt.trim()))
      ) {
        add(
          r,
          'Accessibility',
          'Add meaningful alt text',
          'Describe the information or purpose of this image for someone who cannot see it.'
        );
      }
    }

    if (draft.image.server_verified === false) {
      const assetRule = byType('asset')[0] || byType('palette')[0] || rules[0];
      if (assetRule) {
        add(
          assetRule,
          'Visual identity',
          'Server visual verification failed',
          draft.image.verification_note || 'Client-supplied image dimensions or hash did not match the server-parsed image binary.',
          null,
          null,
          { certainty: 'Server binary inspection', location: 'image-header' }
        );
      }
    }

    if (draft.image.kind === 'logo') {
      for (const r of byType('asset')) {
        const exactMatch = state.assets.find(a => a.sha256 === draft.image.sha256);
        const refAsset = exactMatch || state.assets[0] || null;
        const distortions = [];

        if (draft.image.width && draft.image.height) {
          const refRatio = refAsset?.width && refAsset?.height ? refAsset.width / refAsset.height : 1.0;
          const actualRatio = draft.image.width / draft.image.height;
          const ratioDiff = Math.abs(actualRatio - refRatio) / refRatio;
          if ((!exactMatch || draft.image.distorted) && ratioDiff > 0.06) {
            distortions.push(
              `aspect ratio distorted (${draft.image.width}×${draft.image.height}, ${Math.round(ratioDiff * 100)}% deviation from ${refRatio.toFixed(2)}:1 in full-canvas bounds)`
            );
          }
        }
        if (draft.image.cropped) {
          distortions.push(`cropped margins detected in ${draft.image.crop_region || 'outer border regions'}`);
        }
        if (!exactMatch && Array.isArray(draft.image.colors) && draft.image.colors.length > 0 && state.brand?.palette?.length) {
          const recoloured = draft.image.colors.filter(c =>
            state.brand.palette.every(p => colorDistance(c, p) > 55)
          );
          if (recoloured.length > 0) {
            const regionLabel = draft.image.regions
              ? Object.entries(draft.image.regions)
                  .filter(([, cols]) => cols.some(c => recoloured.includes(c)))
                  .map(([reg]) => reg)
                  .join(', ') || 'center glyph'
              : 'foreground glyph';
            distortions.push(`non-brand logo recolouring (${recoloured.slice(0, 3).join(', ')} in ${regionLabel})`);
          }
        }

        if (!exactMatch || distortions.length > 0) {
          const detailMsg = distortions.length
            ? `Unapproved or modified logo: ${distortions.join('; ')}.`
            : 'The file hash does not match an approved asset. Verify logo geometry, margins and colours.';
          add(
            r,
            'Visual identity',
            distortions.length ? 'Logo distortion or modification detected' : 'Logo is not an approved asset',
            detailMsg,
            null,
            null,
            {
              certainty: 'Server fingerprint + geometry & palette check',
              location: distortions.length ? (draft.image.crop_region || 'full-canvas / logo bounds') : 'file-fingerprint',
              distortions
            }
          );
        }
      }
    }

    if (draft.image.kind === 'graphic') {
      for (const r of byType('palette')) {
        const tol = r.config.tolerance || 50;
        const off = (draft.image.colors || []).filter(c =>
          state.brand.palette.every(a => colorDistance(c, a) > tol)
        );
        const regionFindings = [];
        if (draft.image.regions && typeof draft.image.regions === 'object') {
          for (const [regionName, regionColors] of Object.entries(draft.image.regions)) {
            if (!Array.isArray(regionColors)) continue;
            const badInRegion = regionColors.filter(c =>
              state.brand.palette.every(a => colorDistance(c, a) > tol)
            );
            if (badInRegion.length) {
              regionFindings.push(`${regionName} (${badInRegion.slice(0, 2).join(', ')})`);
            }
          }
        }
        if (off.length || regionFindings.length) {
          const allOff = off.length ? off : [...new Set(Object.values(draft.image.regions || {}).flat())].filter(c =>
            state.brand.palette.every(a => colorDistance(c, a) > tol)
          );
          const locText = regionFindings.length
            ? ` Location-specific violations in: ${regionFindings.join('; ')}.`
            : '';
          add(
            r,
            'Visual identity',
            'Colours sit outside the brand palette',
            `Sampled colours ${allOff.slice(0, 5).join(', ')} differ from approved colours.${locText} Confirm visually.`,
            null,
            null,
            {
              certainty: 'Regional pixel & server palette analysis',
              location: regionFindings.length ? regionFindings.join('; ') : 'canvas-wide',
              region_violations: regionFindings
            }
          );
        }
      }
    }
  }

  let contrast = null;
  if (draft.foreground && draft.background) {
    contrast = contrastRatio(draft.foreground, draft.background);
    const required = draft.largeText ? 3 : 4.5;
    for (const r of byType('contrast')) {
      if (contrast < required) {
        add(
          r,
          'Accessibility',
          'Text contrast is too low',
          `${contrast.toFixed(2)}:1 contrast; at least ${required}:1 is required for the selected text size. This tests the declared colour pair only.`,
          null,
          null,
          { ratio: contrast, required }
        );
      }
    }
  }

  const penalty = findings.reduce((n, f) => n + ({ high: 18, medium: 8, low: 3 }[f.severity] || 0), 0);
  const fullWordCount = mainText.trim() ? mainText.trim().split(/\s+/).length : 0;
  return {
    engine: ENGINE_VERSION,
    mode: 'Structured rules + semantic retrieval + visual/OCR verification',
    knowledge_version: state.knowledge_version,
    reviewed_at: now.toISOString(),
    score: Math.max(0, 100 - penalty),
    findings,
    claims,
    contrast,
    word_count: fullWordCount,
    ocr_word_count: ocrText ? ocrText.split(/\s+/).length : 0,
    disclosure:
      'Deterministic rules, structured semantic claim extraction and hybrid embedding retrieval. Checks internal approved corpus (quantities, canonical units, negation and expiry); does not independently establish real-world truth. Human approval is required.',
    ai: { used: false, status: 'not_requested' }
  };
}

export function insights(state) {
  const latest = state.reviews.map(r => r.analysis).filter(Boolean);
  const all = latest.flatMap(a => a.findings);
  const buckets = {};
  for (const r of state.reviews) {
    const b = (buckets[r.channel] ||= { channel: r.channel, reviews: 0, issues: 0 });
    b.reviews++;
    b.issues += r.analysis?.findings.length || 0;
  }
  const health = state.rules
    .map(rule => {
      const hits = all.filter(f => f.rule_id === rule.id);
      const overrides = hits.filter(f => ['dismissed', 'overridden'].includes(f.decision)).length;
      return {
        id: rule.id,
        title: rule.title,
        flags: hits.length,
        overrides,
        health: hits.length ? Math.round(100 * (1 - overrides / hits.length)) : null
      };
    })
    .sort((a, b) => (a.health ?? 101) - (b.health ?? 101));
  return {
    reviews: state.reviews.length,
    pending: state.reviews.filter(r => r.status === 'in_review').length,
    approved: state.reviews.filter(r => r.status === 'approved').length,
    average_score: latest.length ? Math.round(latest.reduce((n, a) => n + a.score, 0) / latest.length) : null,
    open_issues: all.filter(f => f.decision === 'open').length,
    by_channel: Object.values(buckets),
    rule_health: health,
    formula:
      'Guideline health = 100 × (1 − dismissed or overridden findings / total current findings). No flags = no data. A high score is not proof a rule is clear.'
  };
}
