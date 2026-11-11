# BrandCompass v2.0

**Every draft. True to your brand.**

A complete brand governance studio for **ByteRift — Poorvi S and Saathwik P Shettigar**, upgraded with **Semantic Claim Extraction & Paraphrase Verification (Improvement 1)**, **Server-Side OCR & Visual Forensics (Improvement 2)**, **Google Docs Version-Bound Review Integration (Improvement 3)**, **Native PDF Reports**, **Self-Hosted Local Advisory AI**, **TOTP MFA / Signed Invitations / Password Recovery**, **AES-256-GCM At-Rest Encryption**, and **HMAC-Signed Audit Anchors**.

## Run it on your laptop

1. Install **Node.js** (works with Node 18, 20, 22, and 24 LTS).
2. Extract the ZIP and open the `BrandCompass` folder in VS Code.
3. Run:

```bash
npm start
```

4. Open **http://localhost:3000** and click **Explore the live demo**.

## What is included in v2.0

| Capability | Implementation |
|---|---|
| **Improvement 1: Semantic claim extraction & evidence verification** | Structured extraction of quantities, canonical units (`750 millilitres` / `0.75 L` = `750 ml`, `₹999` = `INR 999`, `12 hrs` / `720 min` = `12 hours`, `3-5 working days` = `3 to 5 business days`), negation polarity, implicit multipliers (`twice as long`, `half the price`), comparatives (`outperforms`), absolutes (`unbreakable`), and polite greeting/list-heading filters (`Best wishes`, `Here are 3 ways...`), backed by 64-dim concept + n-gram vector embeddings |
| **Improvement 2: Server OCR & visual validation** | Server-side `/api/ocr` (using Tesseract + PNG metadata chunks) for scanned PDFs and campaign artwork; DOCX table (`w:tbl`) and header/footer layout extraction; encrypted PDF detection; server binary header verification (`PNG`/`JPEG`/`WebP`); logo aspect-ratio distortion, cropping & recolouring detection; and 5-region (`top-left`, `center`, etc.) palette findings |
| **Improvement 3: Google Docs review integration** | Connect Google Docs (`/api/gdocs`), inspect findings and live version-bound status (`/api/gdocs/:doc_id/status`), explicitly apply accepted corrections back to the document (`gdoc_apply`), and bind approvals to `{ doc_id, doc_revision_id, content_sha256 }` so later edits (`gdoc_sync`) automatically require re-review |
| **AI review options** | Built-in offline self-hosted advisory model (`useLocalModel`), self-hosted HTTP LLM support (`SELF_HOSTED_LLM_URL` for Ollama/vLLM), and optional OpenAI Responses API (`OPENAI_API_KEY`), all with strict citation ID and quote span validation |
| **Account security & storage** | Password recovery/reset, email verification, signed team invitations, TOTP MFA, SSO login assertion support, `AES-256-GCM` encryption at rest, `HMAC-SHA256` signed audit chain + anchors, and automated demo retention cleanup |
| **Native PDF & publishing exports** | Server-generated native `%PDF-1.4` reports (`/api/reports/:id/pdf`), HTML, JSON, CSV exports, and approval-gated external CMS/webhook publishing |

## Verification

```bash
npm test
npm run evaluate
npm run build
```

- `npm test`: **41 passed, 0 failed**.
- `npm run evaluate`: **100.0% F1** on both the 30-case `samples/claim_evaluation.json` baseline and the separately prepared 36-case `samples/semantic_claim_benchmark.json` dataset.
- `npm run smoke -- http://localhost:3000`: **10 HTTP end-to-end checks passed**.
