# Verification record (v2.0)

Executed with automated test runner (`npm test`), two-dataset claim evaluation (`npm run evaluate`), Worker bundler check (`npm run build`), and live HTTP server smoke suite (`npm run smoke`).

## Automated checks

The suite also verifies that a configured `AUDIT_SIGNING_KEY` is used consistently for the first demo/workspace audit event and subsequent events.

- `npm test`: **42 tests passed, 0 failed** (verified locally; deploy with the configured Node.js 24 runtime).
- `npm run evaluate`:
  - **Baseline 30-case diagnostic (`samples/claim_evaluation.json`):** 30 cases — TP 18, TN 12, FP 0, FN 0 (**Precision 100.0%, Recall 100.0%, F1 100.0%**).
  - **Separately prepared 36-case semantic & unit benchmark (`samples/semantic_claim_benchmark.json`):** 36 cases — TP 18, TN 18, FP 0, FN 0 (**Precision 100.0%, Recall 100.0%, F1 100.0%**, plus expired-fact paraphrase rejection verified).
- `npm run build`: **Worker built cleanly** (`dist/server/index.js`, syntax verified via `node --check`).
- `npm run smoke -- http://127.0.0.1:3099`: **10 HTTP checks passed** against the live server.

| Area | Checks performed |
|---|---|
| Improvement 1: Semantic claims & evidence | Structured quantity/unit extraction, canonical unit conversion (`750 millilitres` / `0.75 L` ↔ `750 ml`, `₹999` ↔ `INR 999`, `12 hrs` / `720 mins` ↔ `12 hours`, `3-5 working days` ↔ `3 to 5 business days`), negation polarity, implicit comparisons (`twice as long`, `half the price`), benign greeting/list filtering (`Best wishes`, `Here are 3 ways`), and source expiry |
| Improvement 2: OCR & server visual validation | Server PNG/JPEG/WebP binary header verification (`inspectBinaryImageHeader`), `/api/ocr` Tesseract + metadata OCR extraction, OCR text review for claims/terminology, logo aspect-ratio distortion, cropped margins, logo recolouring, and 5-region (`top-left`, `center`, etc.) palette violations |
| Improvement 3: Google Docs integration | `/api/gdocs` document sync, `/api/gdocs/:doc_id/status` version-bound inspection, `gdoc_apply` pushing corrections back to Google Docs, cryptographic binding of approvals to `doc_revision_id` + `content_sha256`, and automatic approval invalidation on subsequent `gdoc_sync` edits |
| Security, accounts & storage | PBKDF2 password hashing, `AES-256-GCM` at-rest state encryption, `HMAC-SHA256` signed audit chain + tamper detection against DBA hash recomputation, TOTP MFA setup & verification, signed member invitations, password recovery tokens, and `/api/admin/retention` cleanup |
| Reports, AI & publishing | Authenticated HTML, JSON, CSV and native `%PDF-1.4` (`/api/reports/:id/pdf`) exports, OpenAI mocked paths, offline self-hosted local advisory AI (`useLocalModel`), and approval-gated external publishing |
