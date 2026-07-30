# Trade-offs — Decisions Made, Alternatives Considered, What I'd Do With More Time

**Deliverable:** Trade-offs — decisions made, alternatives considered, what you'd do with more time
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) (how the chosen design fits together), [SCALABILITY_RELIABILITY.md](SCALABILITY_RELIABILITY.md) (the production path for the infra-level decisions below), [AI_INTEGRATION.md](AI_INTEGRATION.md) (grounding-discipline decisions), [HIGH_LEVEL_DESIGN.md](HIGH_LEVEL_DESIGN.md) (full rationale tables)

---

## 1. How this document is organized

Ten decisions, each in the same shape: **what was chosen, what else was on the table, why the choice won for a time-boxed prototype, and what I'd actually do with more time.** I've ordered them roughly by how much they shaped everything downstream — architecture-level decisions first, then the AI-specific ones, then the ones that are honestly just scope cuts.

Two decisions get the deepest treatment (§2 vector store, §3 campaign matching) because they're the ones a reviewer is most likely to probe, and because "why isn't everything just in Chroma" is a real question with a real answer, not a hand-wave.

---

## 2. Where to put the vector store — Chroma for run summaries, not for everything

**Decision:** Chroma holds embeddings of completed ingestion-run summaries, for the RAG assistant's semantic search. Relational-shaped data (jobs, validation results, review decisions, audit entries) stays in the in-memory job store today and would move to Postgres in production — never into Chroma.

**Alternatives considered:**
- *Vector DB for everything*, including job metadata — rejected because a vector store is bad at exact filtering and joins, which is most of what job/audit querying actually needs (`queryJobs()`'s structured filters map directly onto SQL `WHERE` clauses, not nearest-neighbor search).
- *No vector store at all* — keyword search over run summaries — rejected because the target queries ("why did the Meta upload fail last week?") are semantic, not keyword-shaped; a keyword search would miss a summary that describes the same failure in different words.
- *pgvector inside the same Postgres instance* as the relational data — a real contender, not rejected outright, see below.

**Why Chroma won for the prototype:** it's the one place in this system where a dedicated vector store actually earns its keep — a corpus that *grows* (one document per completed run, forever) and needs real nearest-neighbor search, not a fixed-size lookup. Running it standalone rather than folding it into Postgres from day one kept the two concerns (structured job state vs. semantic run-history search) cleanly separated while the schema for both was still being figured out.

**What I'd do with more time:** revisit pgvector specifically. Running two datastores (Postgres + Chroma) is one more thing to operate, monitor, and keep in sync for a system this size, and pgvector inside the same Postgres instance that would already hold job/audit state removes that operational cost entirely, at the price of a less specialized similarity-search feature set than a dedicated vector DB. For the corpus size this system will realistically reach (tens of thousands of run summaries, not tens of millions), I don't think that specialization gap matters — I'd want to actually benchmark query latency on both before committing, rather than assume Chroma stays the right call as the system matures past prototype scale.

---

## 3. Campaign-name matching — in-memory cosine similarity, deliberately not Chroma

**Decision:** `campaignMatcher.js` embeds the uploaded name, embeds the ~15-entry master campaign list once at startup, caches both in memory, and does a brute-force O(n) cosine-similarity scan per lookup — no database, no index.

**Alternatives considered and why each lost:**

| Alternative | Why it would make sense | Why it lost here |
|---|---|---|
| Route master campaigns through Chroma too | Consistency — one vector-search codepath instead of two | Chroma is built for a *growing, persisted* corpus; a static 15-entry list gets nothing from persistence or upsert semantics, and mixing a static fixture with an ever-growing job-history collection blurs two different data lifecycles and complicates re-embedding one without touching the other |
| In-memory ANN index (HNSW via `hnswlib-node`, FAISS) | Sub-linear lookup once the list is large | At n=15, "sub-linear" and "linear" are both instant — the added dependency and complexity buys nothing yet |
| Exact/fuzzy string matching (Levenshtein, Jaro-Winkler, trigram) | Cheaper, fully explainable, no embedding model needed | Campaign name drift in the brief's examples is as much semantic/paraphrase (`"Q3 Promo"` vs `"Third Quarter Promotion"`) as typo-shaped — pure string similarity would miss the semantic cases embeddings catch |
| Hybrid: cheap string match first, embedding fallback only on a miss | Minimizes embedding calls | Real optimization, but premature at n=15 uploaded names per file — the embedding call isn't the bottleneck yet |
| pgvector column on the master-campaign table | One fewer datastore | Same "no upsert workload, no persistence need" argument as the Chroma option — there's nothing here that benefits from being in a database at all yet |

**Why brute-force in-memory won:** it's the simplest thing that is still correct, testable, and reads as one function with no network dependency. Given the brief's actual scope (~15 known campaigns), any of the alternatives above would have been solving a scale problem that doesn't exist yet, at the cost of real complexity (a second Chroma collection with its own versioning story, or a new dependency, or a matching algorithm with materially different failure modes than the one this project's grounding discipline was built and documented around).

**What I'd do with more time:** nothing to the matching *logic* until the master list actually grows past a few hundred entries or needs to be edited without a redeploy — at that point it graduates to Chroma or pgvector with metadata filtering (by platform, by active/inactive), exactly as the "when it would make sense" column above describes. What I would tighten sooner is the confidence threshold itself (§7) and the fact that master-list changes currently require editing a source file and redeploying rather than writing to a store — that's a real operational gap even before the list gets large.

---

## 4. State storage — in-memory `Map`s, not a database, for the prototype

**Decision:** `jobStore`, `auditStore`, `scheduleStore`, `userStore`, and `databricksStore` are all in-memory `Map`s and arrays, reset on every process restart.

**Alternative considered:** Postgres from day one.

**Why in-memory won for a time-boxed prototype:** it removes an entire category of setup, migration, and connection-management work that doesn't change the answer to "does the pipeline logic work" — the question this prototype needed to answer fastest. Every store is accessed through a narrow function interface (`createJob`, `updateJob`, `queryJobs`, and so on) rather than callers touching a shared object directly, specifically so that this decision is reversible without touching route or service code later.

**Cost of this choice, named plainly:** no state survives a restart, nothing is visible across more than one process, and this is the single reason the system cannot run on more than one backend instance today (detailed in [SCALABILITY_RELIABILITY.md](SCALABILITY_RELIABILITY.md) §2.1). This isn't a minor caveat — it's the load-bearing limitation of the whole prototype.

**What I'd do with more time:** this is the first thing I would fix, not the last. Postgres for `jobStore`/`auditStore`/`scheduleStore`/`userStore` is a bigger unlock than almost anything else on this list, because it's the prerequisite for horizontal scaling, for surviving a restart without losing in-flight jobs, and for the audit log actually being trustworthy (an append-only log that itself disappears on crash undermines its own purpose — see [SCALABILITY_RELIABILITY.md](SCALABILITY_RELIABILITY.md) §3.6). I'd reach for a lightweight ORM or even hand-written SQL over something heavier, since the query shapes here (`queryJobs`'s filters, audit lookups) are simple and don't need an abstraction layer fighting them.

---

## 5. Processing model — synchronous-in-process, not a queue

**Decision:** `POST /upload` returns `202` immediately, then `runJob()` continues on the same Node process's event loop — not on a separate worker, not via a queue.

**Alternative considered:** SQS/BullMQ/Kafka + a dedicated worker pool from the start.

**Why in-process won:** a queue is infrastructure to stand up, monitor, and reason about failure modes for (poison messages, redelivery, dead-letter handling) — real cost for a feature (independent worker scaling) that doesn't matter until there's real concurrent upload volume to scale against. The accept-then-process shape (`202` + background continuation) already gets the *user-facing* benefit of async processing — the request doesn't block on a large file — without needing the queue's operational overhead yet.

**Cost:** API capacity and processing capacity are the same resource; a burst of large uploads competes with unrelated requests for the same event loop.

**What I'd do with more time:** introduce the queue once — and only once — the same restart-durability argument from §4 applies: an unawaited in-process job that crashes mid-run is simply gone, with no automatic recovery. A durable queue solves both the scaling problem and this reliability gap in one move, which is exactly why [SCALABILITY_RELIABILITY.md](SCALABILITY_RELIABILITY.md) treats them as the same underlying fix rather than two separate projects.

---

## 6. Scheduling — `node-cron` in-process, not a workflow engine

**Decision:** `node-cron`, registered inside the same Node process as the API.

**Alternative considered:** Airflow, Prefect, Temporal, or at minimum a designated leader instance.

**Why `node-cron` won:** it's a five-minute integration for a prototype that needs to demonstrate "scheduled ingestion exists and works," not operate a workflow engine's control plane, UI, and its own persistence layer for a handful of demo schedules.

**Cost, stated without softening:** `node-cron` has no leader election. The moment this system runs on more than one instance, every instance fires every enabled schedule independently, and the same source gets fetched and ingested multiple times per tick. This is flagged in both [ARCHITECTURE.md](ARCHITECTURE.md) and [SCALABILITY_RELIABILITY.md](SCALABILITY_RELIABILITY.md) as the single sharpest edge in the current design — not because it's uniquely hard to fix, but because unlike most of the other prototype shortcuts, this one doesn't degrade gracefully under scale; it silently duplicates work.

**What I'd do with more time:** this is a "must fix before scaling out," not a "nice to have." The realistic fix isn't necessarily a full workflow engine — it's often enough to add a simple leader-election mechanism (a Postgres advisory lock, or a Redis-based lock with a TTL) so exactly one instance's cron actually fires, while the others no-op. A full Airflow/Temporal migration would only be worth it if the scheduling requirements grew genuinely complex (DAGs of dependent jobs, backfills, cross-source coordination) — nothing in the current brief needs that yet.

---

## 7. Campaign-match confidence threshold — 60%, a judgment call

**Decision:** `SUGGEST_THRESHOLD = 0.60` in `campaignMatcher.js` — at or above, a match becomes a suggestion; below, it's flagged for manual review.

**What informed it:** the brief supplies only widely-spaced reference points (94%/91%/97% → suggest; 12% → flag), with no worked example anywhere near the boundary. 60% is a reasonable midpoint given that gap, not a value derived from data.

**Alternative considered:** leave the threshold unset and always ask a human — rejected because it defeats the point of having a matcher at all; a threshold that auto-suggests the confident cases while routing genuinely ambiguous ones to review is the entire value proposition.

**What I'd do with more time:** tune this against a labeled sample of real mismatches rather than leave it as an untested guess — specifically, I'd want false-suggest and false-flag rates at a few candidate thresholds (50%, 60%, 70%) against real or realistic campaign-name variation, and pick based on which error is more expensive to a reviewer (a wrong suggestion someone rubber-stamps vs. an extra manual review for something that was actually a confident match). I'd also fix the stale code comment above the constant, which still argues for 70% while the actual value is 0.60 — a small thing, but exactly the kind of drift that erodes trust in comments generally.

---

## 8. LLM usage boundary — AI phrases facts, never computes them

**Decision:** every LLM call in the system (quality summary, structured RAG narration, semantic RAG answer) receives an already-computed fact object or an already-retrieved document set, and is explicitly instructed never to invent a number or say "not found" rather than guess. Query routing (structured vs. semantic) is a regex classifier, not a model call.

**Alternative considered:** let the LLM compute directly from raw job history — e.g., hand it every job record and ask "how many are below 80%?" — which is the more common RAG pattern and would have been less code to write.

**Why the stricter boundary won:** the brief's own worked examples are precise ("15 duplicates detected," exact percentages), and an LLM asked to count from raw context is exactly the failure mode ("confidently wrong number") that erodes trust in an AI feature fastest. Computing first and handing the model a finished answer to phrase makes that failure mode structurally impossible rather than merely unlikely — detailed fully in [AI_INTEGRATION.md](AI_INTEGRATION.md).

**Cost:** more code — every RAG path needs its own deterministic "get the exact answer" step before the LLM call, rather than one generic "stuff everything into context" function.

**What I'd do with more time:** extend the same discipline to a wider set of question shapes. `structuredHandler.js`'s filter extraction (`extractFilters()`) is regex-based and covers the brief's known shapes (`below X%`, `last week`, by platform) — a real user will eventually ask something that regex doesn't parse and that falls through to the semantic path even though it's actually a structured question with an exact answer available. I'd want telemetry on which questions land on which path in practice, then either expand the regex set or graduate filter extraction to a constrained LLM function-call (still producing a query the deterministic path executes, never letting the model compute the answer itself) once the regex approach starts visibly missing real questions.

---

## 9. Frontend job hand-off — `sessionStorage`, not a real "pending review" queue

**Decision:** the frontend tracks the in-progress job via `sessionStorage.activeJobId` (`JobContext.jsx`), so an uploader's browser tab knows which job to show. There's no `GET /jobs?status=complete&approved=false` endpoint an approver could load independently.

**Alternative considered:** a durable jobs table with an `uploadedBy` field and a real "pending review" list endpoint any authorized session can query.

**Why `sessionStorage` won for the prototype:** it's genuinely enough to demonstrate the upload → review → approve flow end to end within one browser session, which is what the brief's demo path actually exercises, without needing the jobs table (§4) built out first.

**Cost:** this only works if the approver reuses the uploader's own browser tab — it doesn't survive a new tab, a different device, or a different person picking up the review. Job visibility is also currently role-based rather than ownership-based (any authenticated role can view any job by ID), which is a related but separate gap — intentional (approval is a role capability, not an ownership one) but worth naming alongside this one since both stem from the same missing piece: a real jobs table with query support.

**What I'd do with more time:** this is a direct consequence of §4 (move state to Postgres) — once jobs live in a real table, `GET /jobs?status=complete&approved=false` is a small addition, and it turns the review handoff from "whoever has the tab open" into "whoever has the right role, from anywhere."

---

## 10. Secrets — `.env` files, not a managed secrets service

**Decision:** `GROQ_API_KEY` and `JWT_SECRET` are read from environment variables via `dotenv`, loaded from a git-ignored `.env` file with an `.env.example` documenting the shape.

**Alternative considered:** Vault, AWS Secrets Manager, or platform-native secret injection at deploy time.

**Why `.env` won:** it's the correct, standard pattern for local development regardless of what production eventually uses — there's no version of "prototype running on a laptop" that benefits from a secrets-manager integration, and building one before there's a real deployment target to integrate with would be speculative work against an unknown API surface.

**What I'd do with more time:** nothing changes about *how* secrets are referenced in code (`process.env.X` throughout, no literal ever committed) — only *where* they're injected from, which becomes the deploying platform's environment-variable mechanism or a real secrets manager at deploy time. This is close to a non-decision: the code is already written in a way that makes this swap trivial, so it's genuinely one of the lowest-priority items on this list despite sounding like a security gap.

---

## 11. What I'd prioritize first, if given more time — a ranked list

Not every deferred item is equally urgent. In the order I'd actually tackle them:

1. **Move state to Postgres** (§4) — unlocks horizontal scaling, restart durability, and a trustworthy audit log in one move; almost everything else on this list either depends on it or gets easier once it's done.
2. **Fix scheduler leader election** (§6) — the one gap that doesn't degrade gracefully; must be solved before this system ever runs on more than one instance, not after.
3. **Durable queue for uploads and fire-and-forget side effects** (§5) — closes the "crash mid-job silently loses work" gap and is the natural next step once state is already durable.
4. **Tune the matching threshold against real data** (§7) — cheap to do, currently an untested guess standing in for a number that should be measured.
5. **Real "pending review" endpoint** (§9) — small once #1 is done, meaningfully improves the actual review workflow for more than one person.
6. **Re-evaluate pgvector vs. standalone Chroma** (§2) — worth revisiting once the run-history corpus size is known for real, not before.

Everything else (secrets injection target, ANN index for campaign matching, workflow-engine migration for scheduling) is correctly sequenced *after* these — either because the current simple version isn't actually costing anything yet, or because the fix is a natural byproduct of one of the six items above.
