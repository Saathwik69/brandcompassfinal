# Implemented protections, v2.0 upgrades and scope boundaries

## Implemented in v2.0

### Core Governance & Security
- **Tenant & role isolation:** Tenant ID comes from the server-side session, not a client-selected organisation. Role checks and record ownership checks run in the API independently of disabled UI controls.
- **Account security, MFA, recovery & invitations:**
  - Passwords use PBKDF2-SHA256 (100,000 iterations) and per-user random salts.
  - Signed time-limited tokens (`HMAC-SHA256`) power **password recovery** (`/api/account/recover`, `/api/account/reset`), **email verification**, **team invitations** (`/api/members/invite`, `/api/members/accept-invite`), and **SSO assertions** (`/api/sso/login`).
  - **TOTP multi-factor authentication** (`/api/account/security` with `mfa_setup` / `mfa_enable`) uses 6-digit RFC-style HMAC codes.
- **AES-256-GCM encryption at rest:** Workspace state stored in SQLite (`organisations.state`) is encrypted at rest using Web Crypto `AES-256-GCM` with random 96-bit IVs (`encryptAtRest` / `decryptAtRest`).
- **HMAC-signed audit chain & anchors:** Each audit record is linked by SHA-256 (`previous` → `hash`) **and** signed with a server `HMAC-SHA256` signature (`signature`) and chained anchor (`anchor`). A database administrator without the signing secret cannot rewrite and recompute the audit chain without detection (`verifyAudit`).
- **Automated retention & demo cleanup:** Configurable workspace limits (default 120 drafts/workspace, 25 saved revisions/draft) and `/api/admin/retention` cleanup for expired sessions, rate-limit counters, and expired demo workspaces.

### Improvement 1: Semantic Claim Extraction & Evidence Verification
- **Structured claim extraction (`extractStructuredClaim`):** Extracts numerical quantities, canonical units (automatically converting `0.75 L` / `750 millilitres` ↔ `750 ml`, `₹999` / `999 rupees` ↔ `INR 999`, `12 hrs` / `720 minutes` ↔ `12 hours`, `3-5 working days` ↔ `3 to 5 business days`), negation polarity, product variants, implicit multipliers (`"twice as long"`, `"half the price"`), comparatives (`"outperforms every competitor"`), and absolutes (`"unbreakable"`).
- **Benign phrase filtering:** Filters polite greetings (`"Best wishes..."`, `"All the best..."`) and editorial numbered list headings (`"Here are 3 ways to enjoy your walk."`) so they are not overflagged as product claims.
- **Embedding retrieval & paraphrase verification (`embedText`, `verifyClaimAgainstFacts`):** Uses 64-dimensional concept + character n-gram vector embeddings with cosine similarity. A paraphrase is marked `supported` (`match_type: 'semantic_paraphrase'`) **only** when canonical quantities, units, negation polarity, qualifiers, product variant, and source expiry (`valid_until`) all match an active approved fact; otherwise it retains an explicit `cannot_verify` or `expired` outcome.
- **Benchmarked on two datasets:** Evaluated on both the original 30-case `samples/claim_evaluation.json` and the separately prepared 36-case `samples/semantic_claim_benchmark.json` via `npm run evaluate`.

### Improvement 2: OCR & Server-Side Visual Validation
- **Server-side OCR (`/api/ocr`) & scanned PDF fallback:** Extracts text from scanned PDFs and campaign images using local `tesseract` OCR when available on the server plus PNG `tEXt` metadata extraction. Extracted `ocr_text` is automatically checked for brand terminology, voice, and factual claims with `location: 'Image OCR text'`.
- **DOCX & PDF layout extraction:** Preserves DOCX tables (`w:tbl` formatted as pipe tables), headers (`word/header*.xml`), and footers (`word/footer*.xml`), and groups PDF text items by spatial coordinates while detecting password-encrypted PDFs explicitly.
- **Server-side binary image verification (`inspectBinaryImageHeader`):** Parses PNG (`IHDR`), JPEG (`SOF`), and WebP (`VP8`/`VP8L`/`VP8X`) headers on the server to verify dimensions and SHA-256 integrity.
- **Logo distortion, cropping & regional palette findings:** Detects aspect-ratio distortion (stretched/squashed logos), cropped margins, and non-brand logo recolouring against approved asset geometry, and reports location-specific palette violations across 5 spatial regions (`top-left`, `top-right`, `center`, `bottom-left`, `bottom-right`).

### Improvement 3: Google Docs Review Integration
- **Connected Google Docs workflow (`/api/gdocs`, `gdoc_apply`, `gdoc_sync`):** Creators can connect or sync a Google Doc into BrandCompass, inspect cited findings, and push accepted edits (`gdoc_apply`) directly back to the document (incrementing `doc_revision_id` and updating `content_sha256`).
- **Version-bound approvals (`/api/gdocs/:doc_id/status`):** Every approval on a Google Doc review is cryptographically bound to `{ doc_id, doc_revision_id, content_sha256, review_version }`. Any subsequent edit in the Google Doc (`gdoc_sync` or newer `revision_id`) automatically invalidates the approval and requires a fresh review.

### Native PDF Reports, Self-Hosted AI & External Publishing
- **Native PDF report generation (`/api/reports/:id/pdf`):** Generates downloadable standards-compliant `%PDF-1.4` reports directly on the server alongside HTML, JSON, and CSV exports.
- **Self-hosted & local advisory AI (`src/ai.mjs`):** Supports OpenAI Responses API, self-hosted OpenAI-compatible endpoints (`SELF_HOSTED_LLM_URL` for Ollama/vLLM), and an offline built-in local advisory model (`useLocalModel: true`), all with strict citation ID and exact quote span validation.
- **External publishing gate (`action: 'publish'`):** Allows managers/admins to publish approved content to external webhook/CMS targets only when approval and document revision bindings are current.

## Residual Boundaries
- **Internal corpus vs. real-world truth:** Claim verification checks the organisation's internal approved facts; it is not an independent real-world fact-checker.
- **Key management:** For production deployments, supply distinct `DATA_ENCRYPTION_KEY` and `AUDIT_SIGNING_KEY` secrets via environment variables and store audit anchors in an external append-only log.
