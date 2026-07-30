# Scalability & Reliability Design

**Deliverable:** Scalability & reliability design
**Companion documents:** [ARCHITECTURE.md](ARCHITECTURE.md) §10 (production evolution diagram), [HIGH_LEVEL_DESIGN.md](HIGH_LEVEL_DESIGN.md) §7–8 (tradeoff tables), [AI_INTEGRATION.md](AI_INTEGRATION.md) (error handling for the AI-specific paths)

---

## 1. How to read this

These are two related but distinct questions, and the prototype answers them differently:

- **Scalability** — what happens as *volume* grows: more files, bigger files, more concurrent users, more history. Answered honestly here as *"this prototype doesn't scale past one process, and here's exactly what would change to fix that."*
- **Reliability** — what happens when a *dependency fails*: Groq is down, Chroma is unreachable, a warehouse write times out, the ad platform rejects a batch. Answered here as *"most of this is already handled correctly, in patterns that would carry to production unchanged — only the transport underneath them is simulated."*

The distinction matters because the two problems have different urgency. Reliability patterns (retries, idempotency, fire-and-forget isolation) are cheap to build correctly from day one and hard to retrofit once real traffic depends on their absence. Scalability infrastructure (queues, worker pools, a real database) is expensive to build ahead of need and easy to add later *if* the code was written to make that swap clean. This system was built on that basis: get reliability right now, and keep every state-holding module behind a narrow interface so scaling is a topology change, not a rewrite.

---

## 2. Scalability: current shape, and where it breaks first

### 2.1 What "current shape" actually is

Everything — the Express API, the `node-cron` scheduler, the local embedding model, and every piece of state — runs in **one Node.js process**. There's no queue, no separate worker tier, no database; `jobStore`, `auditStore`, `scheduleStore`, and `userStore` are all in-memory `Map`s and arrays that live and die with that process.

This isn't an oversight — it's the correct scope for a time-boxed prototype whose job is to prove the pipeline logic and the AI grounding discipline, not to prove it can survive production load. But it means the system has exactly one instance, and cannot have more than one without breaking things, for two specific reasons:

**Reason 1 — state isn't shared.** If you ran two copies of this API behind a load balancer today, instance B would have no idea a job instance A created even exists. A user uploads a file, gets routed to instance A, and polls `GET /validation/:jobId` — if that poll lands on instance B, the job simply isn't there. This is the single most disqualifying property for horizontal scaling, and it's also the easiest to name precisely: **any state that must be visible to more than one request needs to live outside the process that handles that request.**

**Reason 2 — the scheduler has no leader election.** `node-cron` runs inside the same process, on the same schedule, with no coordination mechanism. Run two instances and every enabled schedule fires twice — the same source gets fetched and ingested twice, on every tick. This is worse than the state problem, because it doesn't just degrade (a lost poll can be retried); it actively corrupts behavior by silently duplicating work. **This is the single blocking issue that must be solved before this system runs on more than one instance, full stop** — everything else on the scaling list can be phased in, but two schedulers double-processing the same file is not a tolerable transitional state.

### 2.2 Where load actually concentrates, and what changes at each point

Scaling isn't one problem — it's several independent bottlenecks that each get solved differently. Walking the pipeline in the order load hits it:

**File intake.** Today, an uploaded CSV is written to local disk (`uploads/`) via `multer`, streamed for validation, then deleted. This ties every file to the one server instance that received it — if that instance restarts mid-job, the file is gone and the job can never finish. At scale, uploads move to object storage (S3/Azure Blob/GCS) via a pre-signed URL the browser writes to directly — the file never transits the API tier at all, and any worker can pick it up afterward.

**Upload processing.** `runJob()` executes on the same process that received the HTTP request — it's not blocking the response (the endpoint returns `202` immediately and processing continues on the event loop), but it does mean API capacity and processing capacity are the same resource. Heavy traffic competing for the event loop slows down unrelated requests. The fix is a queue (SQS/BullMQ/Kafka) that the API only publishes to, plus a separate worker pool that consumes it — this decouples "accept the file" from "process the file" completely, and lets workers scale independently based on queue depth rather than request rate.

**CSV validation.** This one doesn't need to change — it's already the right pattern. `validateFileStreaming()` parses one row at a time via `fs.createReadStream().pipe(parse(...))`, so memory use is bounded regardless of file size; a 10-row file and a 10-million-row file are processed identically from a memory standpoint. At scale, the only change is *where* this runs (inside a worker reading from object storage instead of local disk) — not *how*.

**Campaign matching.** Brute-force cosine similarity over ~15 cached master vectors is instant at this size and would start costing real latency once the master list grows into the thousands — that's the point to introduce an approximate-nearest-neighbor index (HNSW/FAISS), or move the master list into Chroma itself if it also needs persistence or multi-instance sharing. Separately: matching currently runs sequentially per campaign name (`matchAllCampaigns` deliberately does *not* `Promise.all`), because the embedding model is local and CPU-bound — there's no network latency to overlap by running requests concurrently, so parallelizing them just adds CPU contention for no benefit. If this ever becomes a hosted embedding API instead of a local model, that calculus inverts completely, and a concurrency-limited `Promise.all` (via something like `p-limit`) becomes the right move.

**LLM calls.** Every Groq call today is a single synchronous request per job or per query, with no rate limiting and no queuing. At scale this needs request queuing (so a burst of uploads doesn't fire 200 simultaneous Groq calls), streamed responses to the client for the chat assistant specifically, and cost/usage monitoring — an unmonitored per-query LLM call is also an unbounded per-query cost.

**Vector store.** Single-node Chroma has no high availability and no horizontal read scaling. As run history grows into the millions of indexed summaries, this becomes a managed or replicated vector store (Pinecone, Weaviate, or pgvector alongside the relational store) instead.

**State itself.** In-memory `Map`s move to Postgres (with Redis for genuinely hot state, if profiling shows it's needed) — this is the change that actually unblocks multi-instance deployment, since it's what makes "instance B can see what instance A created" true.

**The scheduler.** As covered above: `node-cron` in-process becomes a real workflow engine (Airflow, Prefect, Temporal) or, at minimum, a single elected leader instance responsible for firing schedules. There's no partial version of this fix — either exactly one thing decides when a schedule fires, or duplicate processing is guaranteed.

### 2.3 The design decision that makes this list credible

None of the above requires touching the pipeline's actual logic — validation rules, matching thresholds, grounding prompts, RBAC checks. Every stateful thing in this codebase (`jobStore`, `auditStore`, `scheduleStore`, `userStore`, `databricksStore`) is accessed through a small, explicit function interface (`createJob`, `updateJob`, `getJob`, `queryJobs`, and so on) rather than callers reaching into a shared object directly. Swapping the in-memory `Map` behind that interface for a Postgres-backed implementation is a change to one file per store, not a change to every route and service that calls it. That's the concrete reason "scaling this out" is a topology change rather than a rewrite — the seam was placed deliberately, even though nothing on the other side of it is durable yet.

---

## 3. Reliability: what's already built, and how each pattern behaves under failure

Unlike scalability, reliability is not a list of future work — these mechanisms are implemented today, tested, and would carry into a production deployment largely unchanged. What's simulated is the *transport* underneath them (a real network call instead of a deterministic stub); the *pattern* — retry, idempotency, isolation — is real.

### 3.1 Idempotency — proven at both ends of the pipeline, not just the edge

`checkIdempotency()` in `jobStore.js` computes a key from `fileHash + uploadDate`: re-uploading the identical file on the same day returns the existing job (`status: 'duplicate'`) instead of reprocessing it from scratch. That alone would be a reasonable edge-of-system safeguard. What makes it a *pattern* rather than a one-off check is that the exact same key is reused as the Databricks ingestion idempotency key (`store.ingestionKey(job.fileHash, job.uploadDate)` in `databricksIngestion.js`) — before any write, `ingestJob()` checks `alreadyIngested(key)` and short-circuits with `skippedAsDuplicate: true` if so. The same concept holds at the upload boundary and at the warehouse-write boundary, which is what makes it trustworthy under retry: if a worker crashes after writing to Databricks but before marking the job complete, and a retry runs the whole pipeline again, the second attempt cannot double-write.

### 3.2 Retry-with-backoff — a real strategy, deterministic instead of random for testability

`databricksIngestion.js`'s `ingestJob()` attempts up to `MAX_ATTEMPTS` (3) writes, with linear backoff between attempts (`simulateNetworkDelay(300 * i)`), recording an audit entry for every single attempt — success, failure, and skip. On its own, the automatic loop always exhausts and lands on `status: 'failed'` (it's tuned so success requires a cumulative attempt count of 4, one past what the automatic loop alone provides), which deliberately exercises the "auto-retry, then land on failed" path on every run rather than only sometimes. A subsequent manual retry (`POST /databricks/:jobId/retry`) is the fourth cumulative attempt and is what actually recovers it, reusing the same idempotency key from §3.1.

This determinism is a testability choice, not a realism gap: a real Databricks write fails transiently for reasons this stub can't reproduce (network blips, cluster autoscale pauses, a table lock from a concurrent writer) — but the *shape* of the fix (bounded automatic retries, then one human-triggered retry, every attempt audited) is exactly what a real integration needs, and it's already built and exercised by every single ingestion run, not just the unlucky ones.

The ad-platform push (`adPlatformPush.js`) uses the same "deterministic instead of random" philosophy for a different failure trigger: a batch is rejected outright if the run's quality score is below `MIN_QUALITY_TO_PUSH` (70%), reusing the quality score computed during validation rather than inventing a new signal — which also mirrors a real constraint (no ad platform should receive campaign performance data that failed most of its own validation).

### 3.3 Failure isolation — fire-and-forget is a reliability mechanism, not just a performance one

Four operations run fire-and-forget after a job reaches `status: complete`: RAG indexing, auto-reconciliation, the ad-platform push, and Databricks ingestion. This is usually framed as a latency optimization (don't make the user wait on non-critical work), but it's equally a reliability property: **each of these fails independently, and none of their failures propagate back to corrupt job state or block anything else.**

Concretely:
- `indexJob(finishedJob).catch((err) => console.error(...))` — a Chroma outage logs an error and leaves that run unsearchable by the semantic assistant. It does not fail the upload, and it does not retry indefinitely; the job stays exactly as complete as it was.
- `autoReconcile(finishedJob)` wraps its own call in try/catch and writes `{ reconciliation: { error: err.message } }` onto the job rather than throwing — so a broken ad-platform client produces a visible, inspectable error on the job record instead of an unhandled rejection.
- The push and Databricks ingestion each carry their own status field (`pushStatus`, `ingestionStatus`) independent of the job's overall `status` and independent of each other — a push failure and an ingestion success (or vice versa) are both representable, because they're genuinely independent operations that shouldn't be coupled just because they both happen to fire after approval.

The common shape across all four: **failure is caught at the boundary of the side effect, recorded in a way that's visible and diagnosable, and never allowed to become an unhandled exception that could crash the process or corrupt a record.**

### 3.4 Reliability through the AI layer specifically

The AI integration points follow the identical isolation principle, detailed fully in [AI_INTEGRATION.md](AI_INTEGRATION.md) — summarized here because it's a reliability property as much as a correctness one:

- The **quality summary** call is wrapped in its own try/catch inside `runJob()`; a Groq failure leaves `qualitySummary: null` and the job still completes normally.
- **RAG indexing** is fire-and-forget per §3.3.
- **Chat queries** (structured or semantic RAG) are caught at the route level in `assistant.js` and turned into a `500` scoped to that one request — no job state, no conversation history, and no other feature is affected by a failed chat turn.
- **Campaign matching** is the one AI call that is allowed to fail a job outright (an uncaught exception there propagates to `runJob`'s outer catch, landing the job on `status: 'failed'`) — because its output is structurally required for the Review page to render at all, unlike the other three, which are optional additions on top of an already-complete job.

The pattern worth naming explicitly: **only one of six AI integration points can fail a job, and even that one fails safely — no partial writes, no silently wrong suggestions, just a clearly-labeled failed job the user can retry.**

### 3.5 Audit trail — reliability as an accountability property, not just a debugging one

`auditStore.js` is an append-only log, written to for every login (success *and* failure), every upload (manual or scheduled), every approval decision, every schedule change, and every Databricks ingestion attempt — not just the terminal outcome. This matters for reliability specifically because it's what makes a failure *investigable after the fact*: if a scheduled run silently fails at 3am, the audit log has an entry for every retry attempt with a timestamp and an error message, not just a final "failed" status with no history. The actor on every entry is always derived from the verified session (`req.user.username`), never client input — an audit log that trusted a client-supplied "who did this" field would undermine its own purpose the moment anyone had a reason to misattribute an action.

### 3.6 What's explicitly *not* solved yet, stated plainly

Two reliability gaps exist and are worth naming rather than hiding:

- **The audit log itself is in-memory**, so a process crash loses it — the exact failure mode the audit log exists to protect *other* data against, not currently protected in itself. Production fix: a durable, immutable table.
- **Fire-and-forget side effects (§3.3) are currently just unawaited promises**, not a durable queue. A crash in the exact window between "job marked complete" and "indexing finishes" silently loses that one run's searchability, with no automatic recovery — the failure is logged, but nothing retries it. Production fix: the same queue infrastructure introduced for scalability (§2.2) also solves this, since a durably-queued side effect survives a process crash by definition.

Both of these are consequences of the same root cause named in §2.1 — no durable state outside one process — which is precisely why the scalability and reliability stories converge on the same fix (a queue, a real database) even though they started as separate concerns.

---

## 4. The one sentence version

**Reliability was built correctly from the start because the patterns (idempotency, bounded retry, failure isolation, audit trail) are cheap to get right early and expensive to retrofit; scalability was deliberately deferred because the infrastructure it needs (a queue, a shared database, worker pool) is expensive to build ahead of actual load — but every stateful module sits behind a narrow interface specifically so that when scale is needed, swapping what's behind that interface is a topology change, not a rewrite.**
