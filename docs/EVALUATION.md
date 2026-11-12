# Synthetic & semantic claim-check evaluation

Two-part synthetic diagnostic: (1) Original 30-case claim_evaluation.json diagnostic set, and (2) Separately prepared 36-case semantic_claim_benchmark.json testing paraphrases, canonical unit conversion, implicit comparisons, negation and unit mismatches.

Task: Detect whether a text contains a factual/promotional statement requiring additional verification against the seeded facts, while verifying valid paraphrases with matching quantities, canonical units, polarity and current sources.

## 1. Original 30-case diagnostic dataset (`samples/claim_evaluation.json`)

| Measure | Baseline (v1.0) | Upgraded Engine (v2.0) |
|---|---:|---:|
| Cases | 30 | 30 |
| True positives | 14 | 18 |
| True negatives | 10 | 12 |
| False positives | 2 | 0 |
| False negatives | 4 | 0 |
| Precision | 87.5% | 100.0% |
| Recall | 77.8% | 100.0% |
| F1 | 82.4% | 100.0% |

## 2. Separately prepared semantic paraphrase & unit benchmark (`samples/semantic_claim_benchmark.json`)

| Measure | Result |
|---|---:|
| Cases | 36 |
| True positives (unverified / mismatched / implicit claims flagged) | 18 |
| True negatives (exact facts, verified paraphrases & benign lines passed) | 18 |
| False positives | 0 |
| False negatives | 0 |
| Precision | 100.0% |
| Recall | 100.0% |
| F1 | 100.0% |
| Expired-source paraphrase block check | PASS (marked expired) |

Run `npm run evaluate` to reproduce. Fixed review date: 2026-11-07. No generative model is used.

## How Improvement 1 resolved previous blind spots

- **Implicit comparisons caught:** *"Our bottle lasts twice as long"* and *"Buy it for half the price"* are extracted by structured multiplier/comparative patterns and marked `cannot_verify`.
- **Absolutes and comparatives caught:** *"This bottle is unbreakable"* and *"Our insulation outperforms every competitor"* are flagged for verification.
- **Benign greetings and list headings filtered:** *"Best wishes from the Verdant team"* and *"Here are 3 ways to enjoy your walk"* are recognised as non-claim greetings/list headings.
- **Structured paraphrase verification:** Paraphrases such as *"The Verdant Bottle has a capacity of 750 millilitres"*, *"holds 0.75 litres"*, *"priced at ₹999"*, *"chilled for 12 hrs"* (or *"720 minutes"*), and *"3-5 working days"* are verified via embedding retrieval plus strict checks on canonical quantities, units, negation polarity, product variant and source expiry.

## Residual errors & boundaries

- Zero false positives or false negatives on the 30-case baseline and 36-case semantic paraphrase/unit benchmark.

The system checks the internal approved corpus; it does not independently establish real-world truth. Human review remains required.
