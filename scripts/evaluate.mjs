import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { seedState } from '../src/seed.mjs';
import { reviewContent } from '../src/engine.mjs';

const fixedDate = new Date('2026-11-07T12:00:00Z');
const pct = n => (n * 100).toFixed(1) + '%';

function runDataset(samples) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  const outcomes = [];
  for (const s of samples) {
    const review = reviewContent({ text: s.text, foreground: '#172B26', background: '#FFFFFF' }, seedState(), fixedDate);
    const actual = review.claims.some(c => c.status !== 'supported');
    const expected = s.needs_verification;
    const result = actual === expected ? (actual ? 'TP' : 'TN') : (actual ? 'FP' : 'FN');
    ({ TP: () => tp++, TN: () => tn++, FP: () => fp++, FN: () => fn++ })[result]();
    outcomes.push({
      ...s,
      predicted_needs_verification: actual,
      detected_claims: review.claims.map(c => ({ text: c.text, status: c.status, match_type: c.match_type })),
      result
    });
  }
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = (2 * precision * recall) / (precision + recall) || 0;
  return { count: samples.length, tp, tn, fp, fn, precision, recall, f1, outcomes };
}

const baselineSamples = JSON.parse(readFileSync(new URL('../samples/claim_evaluation.json', import.meta.url), 'utf8'));
const benchmarkSamples = JSON.parse(readFileSync(new URL('../samples/semantic_claim_benchmark.json', import.meta.url), 'utf8'));

const baselineEval = runDataset(baselineSamples);
const benchmarkEval = runDataset(benchmarkSamples);

// Also test source expiry detection explicitly
const expiredState = seedState();
expiredState.facts[0].valid_until = '2026-01-01';
const expiredReview = reviewContent(
  { text: 'The Verdant Bottle has a capacity of 750 millilitres.', foreground: '#172B26', background: '#FFFFFF' },
  expiredState,
  fixedDate
);
const expiryVerified = expiredReview.claims[0]?.status === 'expired';

const report = {
  dataset: 'Two-part synthetic diagnostic: (1) Original 30-case claim_evaluation.json diagnostic set, and (2) Separately prepared 36-case semantic_claim_benchmark.json testing paraphrases, canonical unit conversion, implicit comparisons, negation and unit mismatches.',
  task: 'Detect whether a text contains a factual/promotional statement requiring additional verification against the seeded facts, while verifying valid paraphrases with matching quantities, canonical units, polarity and current sources.',
  count: baselineEval.count,
  confusion_matrix: { tp: baselineEval.tp, tn: baselineEval.tn, fp: baselineEval.fp, fn: baselineEval.fn },
  precision: baselineEval.precision,
  recall: baselineEval.recall,
  f1: baselineEval.f1,
  outcomes: baselineEval.outcomes,
  semantic_benchmark: {
    count: benchmarkEval.count,
    confusion_matrix: { tp: benchmarkEval.tp, tn: benchmarkEval.tn, fp: benchmarkEval.fp, fn: benchmarkEval.fn },
    precision: benchmarkEval.precision,
    recall: benchmarkEval.recall,
    f1: benchmarkEval.f1,
    expiry_check_passed: expiryVerified,
    outcomes: benchmarkEval.outcomes
  }
};

mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/evaluation_results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');

const allErrors = [...baselineEval.outcomes, ...benchmarkEval.outcomes].filter(o => o.result === 'FP' || o.result === 'FN');
const errorSection = allErrors.length
  ? allErrors.map(o => `- **${o.result}:** ${o.text} — ${o.note}`).join('\n')
  : '- Zero false positives or false negatives on the 30-case baseline and 36-case semantic paraphrase/unit benchmark.';

const md = `# Synthetic & semantic claim-check evaluation

${report.dataset}

Task: ${report.task}

## 1. Original 30-case diagnostic dataset (\`samples/claim_evaluation.json\`)

| Measure | Baseline (v1.0) | Upgraded Engine (v2.0) |
|---|---:|---:|
| Cases | 30 | ${baselineEval.count} |
| True positives | 14 | ${baselineEval.tp} |
| True negatives | 10 | ${baselineEval.tn} |
| False positives | 2 | ${baselineEval.fp} |
| False negatives | 4 | ${baselineEval.fn} |
| Precision | 87.5% | ${pct(baselineEval.precision)} |
| Recall | 77.8% | ${pct(baselineEval.recall)} |
| F1 | 82.4% | ${pct(baselineEval.f1)} |

## 2. Separately prepared semantic paraphrase & unit benchmark (\`samples/semantic_claim_benchmark.json\`)

| Measure | Result |
|---|---:|
| Cases | ${benchmarkEval.count} |
| True positives (unverified / mismatched / implicit claims flagged) | ${benchmarkEval.tp} |
| True negatives (exact facts, verified paraphrases & benign lines passed) | ${benchmarkEval.tn} |
| False positives | ${benchmarkEval.fp} |
| False negatives | ${benchmarkEval.fn} |
| Precision | ${pct(benchmarkEval.precision)} |
| Recall | ${pct(benchmarkEval.recall)} |
| F1 | ${pct(benchmarkEval.f1)} |
| Expired-source paraphrase block check | ${expiryVerified ? 'PASS (marked expired)' : 'FAIL'} |

Run \`npm run evaluate\` to reproduce. Fixed review date: 2026-11-07. No generative model is used.

## How Improvement 1 resolved previous blind spots

- **Implicit comparisons caught:** *"Our bottle lasts twice as long"* and *"Buy it for half the price"* are extracted by structured multiplier/comparative patterns and marked \`cannot_verify\`.
- **Absolutes and comparatives caught:** *"This bottle is unbreakable"* and *"Our insulation outperforms every competitor"* are flagged for verification.
- **Benign greetings and list headings filtered:** *"Best wishes from the Verdant team"* and *"Here are 3 ways to enjoy your walk"* are recognised as non-claim greetings/list headings.
- **Structured paraphrase verification:** Paraphrases such as *"The Verdant Bottle has a capacity of 750 millilitres"*, *"holds 0.75 litres"*, *"priced at ₹999"*, *"chilled for 12 hrs"* (or *"720 minutes"*), and *"3-5 working days"* are verified via embedding retrieval plus strict checks on canonical quantities, units, negation polarity, product variant and source expiry.

## Residual errors & boundaries

${errorSection}

The system checks the internal approved corpus; it does not independently establish real-world truth. Human review remains required.
`;

writeFileSync(new URL('../docs/EVALUATION.md', import.meta.url), md);
console.log(
  JSON.stringify(
    {
      baseline: {
        cases: baselineEval.count,
        tp: baselineEval.tp,
        tn: baselineEval.tn,
        fp: baselineEval.fp,
        fn: baselineEval.fn,
        precision: pct(baselineEval.precision),
        recall: pct(baselineEval.recall),
        f1: pct(baselineEval.f1)
      },
      semantic_benchmark: {
        cases: benchmarkEval.count,
        tp: benchmarkEval.tp,
        tn: benchmarkEval.tn,
        fp: benchmarkEval.fp,
        fn: benchmarkEval.fn,
        precision: pct(benchmarkEval.precision),
        recall: pct(benchmarkEval.recall),
        f1: pct(benchmarkEval.f1),
        expiry_verified: expiryVerified
      }
    },
    null,
    2
  )
);
