# ByteRift presentation guide

**Project:** BrandCompass  
**Team:** Poorvi S and Saathwik P Shettigar  
**Event context from the supplied brief:** CodeNexus India

## Opening: 25 seconds

“Teams publish content through employees, agencies and AI tools. But the final draft can still contain a wrong product claim, an off-brand phrase or an inaccessible graphic. BrandCompass is a checkpoint before publication. It checks a draft against the organisation's approved knowledge and explains what needs attention, with the source beside each finding.”

## Live demonstration: 2 minutes

| Time | Show | Say |
|---|---|---|
| 0:00–0:25 | Seeded draft and high findings | “This caption claims 48 hours and a price of INR 699. Those statements are not in the approved product facts.” |
| 0:25–0:45 | Expand a source; apply a word edit | “A finding is traceable to a particular rule version. We can accept an edit, but the software never silently rewrites our draft.” |
| 0:45–1:10 | Paste approved caption; fix contrast; rerun | “The review is recalculated against the latest sources. A supported claim is an exact approved statement, not something an AI guessed.” |
| 1:10–1:35 | Submit; switch demo role; approve | “The creator cannot approve their own work. The server enforces roles, current knowledge and high-severity resolution.” |
| 1:35–2:00 | Audit, revision comparison and insights | “We keep the human decisions. Repeated disputes also tell the brand manager which guidelines may need rewriting.” |

Clean caption: `Verdant Bottle holds 750 ml. Verdant Bottle costs INR 999. Verdant Bottle keeps drinks cold for 12 hours.` Text colour: `#172B26`; background: `#FFFFFF`.

For the image extension, upload `off_palette_graphic.png` as a graphic and leave alt text empty. For controlled assets, approve `approved_logo.png` in the knowledge base, then upload that same file as a logo.

## Closing: 20 seconds

“Our differentiator is the combination of cited review, enforced human approval and feedback about the guidelines themselves. The no-key rules mode makes the demo reliable. Optional grounded AI adds language advice. Our next step is a real pilot to evaluate review effort, false alerts and guideline clarity.”

## Six-slide outline

1. **Problem:** too many contributors, inconsistent drafts, slow manual review. Describe a concrete example; do not invent market statistics.
2. **Solution:** one brand checkpoint with approved sources and clear human decisions.
3. **Live product:** show the bad-to-good caption, visual checks and traceable findings.
4. **Architecture:** browser input → authenticated API → rules/retrieval → versioned findings → human approval → database/audit.
5. **Differentiator and evidence:** guideline health, permission checks, test results and the synthetic evaluation's failure cases.
6. **Next steps:** user interviews/pilot, stronger semantic checks, OCR, larger-scale storage and integrations.

## Questions judges may ask

**Is this just ChatGPT with a prompt?**  
No. The application has deterministic checks, a versioned approved knowledge base, role-enforced workflow, persisted content history and linked audit records. Optional AI adds grounded language advice; the core product works without it.

**Where is the AI?**  
The default engine uses rules and lexical retrieval. A real optional OpenAI Responses API path retrieves sources, requests structured findings and validates citation IDs and quote spans. It is disabled until a server key is provided. Do not describe default mode as a trained neural model or vector RAG.

**Does it prove a product claim is true?**  
No. It checks a claim against approved internal facts. Exact current statements can be supported; unmatched claims go to a human. The quality of the approved facts still matters.

**What happens when guidelines change?**  
Knowledge versions increment. Old analyses cannot be submitted or approved until they are reviewed again. Existing historical snapshots retain their original sources.

**Can a creator bypass approval by calling the API?**  
Server-side role and ownership checks prevent that. Tests include forbidden approvals, cross-workspace access and stale writes.

**Why this stack rather than the PDF's planned stack?**  
A dependency-light Node/SQLite local application makes setup and offline demonstration predictable. The same API builds into a Worker with D1 for hosting. The prototype can be migrated to the originally planned services when scale warrants it.

**How accurate is it?**  
Present `docs/EVALUATION.md` as a small synthetic diagnostic, not an independent benchmark. It includes known false positives and false negatives. A check score is not model accuracy. Real-user and independent evaluation remain future work.

**What is not built yet?**  
Semantic logo detection, scanned-document OCR, email recovery/invitations, enterprise SSO, live-channel plugins and production-grade external audit storage. Basic file fingerprint and pixel palette checks are included.

## Suggested team split

- Poorvi: problem, user journey, interface, visual checks, guideline health and usability.
- Saathwik: API, rule engine, source retrieval, optional AI, database, permissions, tests and architecture.

Both should be able to run the demo without internet and explain why uncertain claims require human review.
