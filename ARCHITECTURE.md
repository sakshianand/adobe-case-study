# Architecture — Marketing Data Ingestion & RAG Assistant

**Deliverable:** Architecture diagram — components, data flows, AI integration points

**Companion documents:** [HIGH_LEVEL_DESIGN.md](HIGH_LEVEL_DESIGN.md) (design rationale and tradeoffs), [README.md](README.md) (how to run it)

---

## 0. How to read this document

This document answers three questions, in order, each with a diagram and a table:

| Section | Question it answers |
|---|---|
| §2 System context | What is inside the system, what is outside it, and who talks to whom |
| §3 Component architecture | What the internal building blocks are, and how they are layered |
| §4–§6 Data flows | How data actually moves — the ingestion path, the query path, the scheduled path |
| §7 AI integration points | Exactly where a model is invoked, what it is allowed to decide, and what guards it |
| §8 State & lifecycle | How one unit of work (a job) progresses and settles |
| §9 Security architecture | Where the trust boundary sits and how identity flows through it |
| §10 Production evolution | Which boxes change shape at scale, and which stay |

**One architectural thesis runs through all of it.** The system separates *computation* from *phrasing*, and *suggestion* from *application*:

> Deterministic code computes every fact. AI interprets fuzzy input and phrases facts into English. A human authorises every change to data. No single one of those three ever does another's job.

Every diagram below is annotated to show where that line falls, because the line — not the box diagram — is the actual architecture.

**Figure index.** Twelve diagrams, in order: 1 system context · 2 component architecture · 3–4 ingestion control flow (upload→complete, then review→warehouse) · 5 data transformation · 6 post-approval fan-out · 7 assistant query paths · 8 scheduled ingestion · 9 AI integration points · 10 job lifecycle · 11 security architecture · 12 production evolution.

---

## 1. Architectural style at a glance

| Dimension | Choice |
|---|---|
| Style | Modular monolith — single Node process, strictly layered internally (routes → services → stores) |
| Frontend | React SPA, thin: renders server-computed state, holds no business rules |
| Communication | REST over HTTP; client **polls** for long-running work (no websockets) |
| Concurrency model | Accept-then-process: the upload endpoint returns `202` immediately, work continues on the event loop |
| Coupling to externals | Every external dependency (LLM, vector store, ad platform, warehouse) is reached only through a dedicated service module — never from a route, never from the browser |
| State | In-memory stores behind a module interface, deliberately swappable for a database (see §10) |
| Failure posture | Critical path fails loudly; non-critical side effects fail in isolation without failing the job |

---

## 2. System context

Who and what sits outside the system, and every line that crosses the boundary.

```mermaid
flowchart TB
    subgraph Actors["Human actors — authenticated, role-scoped"]
        Uploader(["Uploader<br/>submits campaign CSVs"])
        Approver(["Approver<br/>accepts/rejects AI suggestions"])
        Admin(["Admin<br/>schedules, audits"])
    end

    subgraph Trust["── Trust boundary: the browser is untrusted ──"]
        SPA["<b>React SPA</b><br/>Login · Upload · Validation Results<br/>Review · Reconciliation · Pipeline Status<br/>Scheduling · Dashboard · Audit Log · Assistant chat"]
    end

    subgraph Backend["<b>Backend — Express API (single Node process)</b>"]
        API["Auth gate → RBAC → routes → services → stores<br/><i>the only component holding credentials<br/>or making trust decisions</i>"]
        Cron["node-cron scheduler<br/><i>in-process</i>"]
        Xenova[["<b>Xenova/all-MiniLM-L6-v2</b><br/>embeddings — runs <i>inside</i> this process<br/><i>a function call, not a network hop</i>"]]
    end

    subgraph Ext["External dependencies — every one mediated by the backend"]
        Groq[("<b>Groq LLM API</b><br/>llama-3.3-70b-versatile<br/><i>phrasing only</i>")]
        Chroma[("<b>Chroma</b><br/>vector store<br/>collection: ingestion_runs_v1")]
        AdPlat[("<b>Ad Platform API</b><br/>Google Ads — simulated")]
        DBX[("<b>Databricks</b><br/>bronze + silver — simulated")]
        Sources[("<b>Meta / Google / Amazon</b><br/>reporting APIs — simulated")]
    end

    Uploader --> SPA
    Approver --> SPA
    Admin --> SPA

    SPA <-->|"REST + session cookie<br/>+ ~1s polling"| API
    Cron -->|triggers same pipeline| API

    API -->|"exact JSON facts → one sentence"| Groq
    API <-->|"upsert run summaries<br/>top-5 similarity search"| Chroma
    API -->|"embed campaign names<br/>embed questions & documents"| Xenova
    API -->|"push approved rows"| AdPlat
    API -->|"fetch reported spend"| AdPlat
    API -->|"land raw + cleaned rows"| DBX
    Cron -->|"scheduled source pull"| Sources
```

### Boundary contract

| Crossing | Direction | Why it is shaped this way |
|---|---|---|
| Browser → API | REST + `httpOnly` session cookie | The token is never readable by page JavaScript, so one XSS bug is not a session-theft bug |
| Browser → any external | **Does not exist** | No API key ever reaches the client; every AI call is subject to the same server-side grounding discipline regardless of which screen triggered it |
| API → Groq | Outbound only, per job / per query | Groq never initiates; a Groq outage degrades phrasing, not correctness |
| API → Xenova | **In-process function call, not a network call** | Shapes a real design decision: embedding is CPU-bound and sequential, so `matchAllCampaigns` deliberately does *not* `Promise.all` — there is no network latency to overlap |
| API → Chroma | Read/write, fire-and-forget on write | A Chroma outage loses searchability of that run, never the run itself |
| Cron → pipeline | Internal | A scheduled run and a manual upload converge on the identical code path, so there is exactly one ingestion implementation to reason about |

---

## 3. Component architecture

Five layers. A dependency arrow never points upward.

```mermaid
flowchart TB
    L1["<b>① PRESENTATION — React SPA</b>
    ────────────────────────────────
    <b>Pages</b>  Login · Upload · ValidationResults · Review · Reconciliation
    PipelineStatus · Scheduling · Dashboard · AuditLog (admin)
    <b>Shared</b>  StatusBadge · MetricCard · JobProgress · ChatWidget · Layout
    RequireAuth · RequireRole  <i>(route guards — UX only, not security)</i>
    <b>Context</b>  AuthContext (user, role) · JobContext (activeJobId)
    <b>api/client.js</b>  <i>single egress point, credentials always included</i>"]

    L2["<b>② HTTP EDGE — Express middleware, in order</b>
    ────────────────────────────────
    cors (explicit origin + credentials) · express.json · cookieParser
    <b>requireAuth</b>  <i>global gate — everything mounted below it needs a valid session</i>
    <b>requireRole(...)</b>  <i>applied INSIDE each router, never at the mount call</i>
    central error handler  <i>no stack trace ever reaches a client</i>"]

    L3["<b>③ ROUTES — one file per REST surface</b>
    ────────────────────────────────
    <b>public</b>  auth
    <b>any authenticated role</b>  validation · reconciliation · pipelineStatus · dashboard · assistant
    <b>uploader / admin</b>  upload
    <b>approver / admin</b>  approve · databricks/:id/retry
    <b>admin only</b>  schedules · audit"]

    L4["<b>④ SERVICES — all business logic and ALL external I/O</b>
    ────────────────────────────────
    <b>validation/</b>  schemaValidator · dateStandardizer · businessRules · validationPipeline
    &nbsp;&nbsp;&nbsp;<i>100% deterministic — streaming parse, weighted quality score</i>
    <b>ai/</b>  embeddings/embedClient · matching/campaignMatcher · summary/qualitySummary
    &nbsp;&nbsp;&nbsp;rag/{queryRouter · structuredHandler · semanticHandler · indexer}
    &nbsp;&nbsp;&nbsp;<i>the only AI surface in the codebase</i>
    <b>adtech/</b>  googleAdsClient · adPlatformPush · reconciliation · autoReconcile
    <b>databricks/</b>  databricksIngestion  <i>(idempotency + retry w/ backoff)</i>
    <b>scheduler/</b>  schedulerEngine · cronExpression · sourceFetcher · notifier
    <b>auth/</b>  jwt sign / verifySession"]

    L5["<b>⑤ DATA — in-memory today, DB-shaped interfaces (see §10)</b>
    ────────────────────────────────
    <b>jobStore</b>  —  <i>THE SYSTEM OF RECORD — every other component reads or writes it</i>
    auditStore  <i>append-only</i>  ·  userStore  <i>bcrypt</i>  ·  scheduleStore
    queryLogStore · conversationStore · databricksStore  <i>bronze + silver</i>"]

    L1 -->|"fetch — credentials: include"| L2
    L2 --> L3
    L3 --> L4
    L4 --> L5
    L3 -.->|"reads job state directly for status polling"| L5

    style L5 stroke-width:3px
```

### Component inventory

| # | Component | Responsibility | Deterministic? | Key files |
|---|---|---|---|---|
| 1 | **Validation pipeline** | Streams CSV rows; validates headers, schema, enums; standardises dates; applies business-rule corrections; detects duplicates; computes a weighted quality score | ✅ Fully | `services/validation/*` |
| 2 | **AI campaign matcher** | Embeds an uploaded campaign name, cosine-compares against a cached master list, returns `suggest` or `flag_for_review` | ⚠️ AI-scored, deterministically thresholded | `services/ai/matching/*` |
| 3 | **AI quality summary** | Converts a fixed JSON fact object into one plain-English sentence | ❌ LLM phrasing | `services/ai/summary/qualitySummary.js` |
| 4 | **RAG assistant** | Routes a question to an exact-computation path or a vector-retrieval path; both are LLM-phrased with citations | ⚠️ Routing + retrieval deterministic; phrasing is not | `routes/assistant.js`, `services/ai/rag/*` |
| 5 | **Review & approval** | Records a per-suggestion human decision — the single event that unlocks all downstream writes | ✅ Fully | `routes/approve.js` |
| 6 | **Ad platform push** | Pushes approved campaign performance data back to the ad platform (simulated transport) | ✅ Fully | `services/adtech/adPlatformPush.js` |
| 7 | **Spend reconciliation** | Compares uploaded vs. platform-reported spend per campaign; flags variance > 5% | ✅ Fully | `services/adtech/reconciliation.js`, `autoReconcile.js` |
| 8 | **Databricks ingestion** | Lands raw + cleaned rows into simulated bronze/silver tables with an idempotency key and retry-with-backoff | ✅ Fully | `services/databricks/databricksIngestion.js` |
| 9 | **Scheduler** | Per-source cron config; triggers the same pipeline programmatically; records run history; notifies on terminal failure | ✅ Fully | `services/scheduler/*` |
| 10 | **Dashboard aggregation** | Totals, quality trend, reconciliation pass rate, AI suggestion acceptance rate, RAG query stats, pipeline latency | ✅ Fully | `routes/dashboard.js` |
| 11 | **Job store** | The system of record for a run: status, validation results, matches, decisions, push/ingestion/reconciliation outcomes | ✅ Fully | `data/jobStore.js` |
| 12 | **Auth & RBAC** | Login, bcrypt verification, JWT signing, session verification, three-role enforcement | ✅ Fully | `routes/auth.js`, `middleware/auth.js`, `services/auth/jwt.js` |
| 13 | **Audit log** | Append-only record of every mutation, actor always derived from the verified session | ✅ Fully | `data/auditStore.js`, `routes/audit.js` |

**Two structural notes worth stating explicitly:**

1. **`jobStore` is the integration hub, and that is intentional.** Validation, matching, approval, push, ingestion, reconciliation, RAG indexing, and the dashboard all converge on one record rather than passing payloads between each other. This is why independently-timed processes can write to the same run without coordinating: they occupy different *fields* (`status`, `pushStatus`, `ingestionStatus`, `reconciliation`) of the same object. A job **accumulates** state; it never replaces it.
2. **RBAC is applied inside each router, not at the mount call.** `app.use('/', middleware, router)` would run `middleware` for every request reaching that line — the mount path `'/'` matches everything as a prefix, not just routes that exist inside the router. Gating with `router.use(requireRole(...))` avoids accidentally 403-ing unrelated routes.

---

## 4. Data flow — the ingestion path (primary flow)

### 4.1 Control flow, part 1 — upload to `status: complete`

Everything in this first half determines the user's "is my upload done" signal.

```mermaid
sequenceDiagram
    autonumber
    actor U as Uploader (or Scheduler)
    participant API as Express route layer
    participant Val as validationPipeline
    participant Match as AI matcher (Xenova)
    participant Groq as Groq LLM
    participant Job as jobStore
    participant Chroma as Chroma
    participant Rec as Reconciliation

    U->>API: POST /upload (multipart CSV)
    API->>Job: checkIdempotency(fileHash + uploadDate)
    alt already processed today
        Job-->>API: existing jobId
        API-->>U: 200 { status: "duplicate" }
    else new file
        API->>Job: createJob() → jobId, status=processing
        API-->>U: 202 { jobId } — returns immediately
    end

    Note over API,Val: everything below is off the request/response path

    API->>Val: validateFileStreaming(filePath)
    loop one row at a time — bounded memory
        Val->>Val: headers → schema → enums → date → business rules → dedupe
    end
    Val-->>API: validationSummary + qualityScore (weighted, deterministic)
    API->>Job: status=matching

    API->>Match: matchAllCampaigns(processedCampaigns)
    loop per distinct campaign name — sequential by design
        Match->>Match: embed(normalize(name)) → cosine vs cached master vectors
    end
    Match-->>API: matches[] — suggest (≥60%) or flag_for_review

    API->>Groq: exact JSON fact object → "write one sentence"
    Groq-->>API: qualitySummary text
    Note over API,Groq: wrapped in try/catch — a Groq failure<br/>degrades the sentence, never the job
    API->>Job: status=complete, matches, qualitySummary

    par fire-and-forget — failures isolated
        API->>Chroma: embed run summary → upsert
    and
        API->>Rec: reconcileSpend(job) → cache on job
    end
```

### 4.2 Control flow, part 2 — review to warehouse write

The human gate, and the two writes it unlocks.

```mermaid
sequenceDiagram
    autonumber
    actor U as Approver
    participant API as Express route layer
    participant Job as jobStore
    participant Aud as auditStore
    participant Ad as Ad Platform (stub)
    participant DBX as Databricks (stub)

    loop client polls ~1s until status settles
        U->>API: GET /validation/:jobId
        API->>Job: read current state
        API-->>U: job snapshot (status, matches, qualitySummary)
    end

    U->>API: POST /approve { decisions } + session cookie
    API->>API: requireRole('approver','admin')
    Note over API,Job: actor = req.user.username from the verified session — never a client-supplied field
    API->>Aud: log approval (actor, jobId, decisions)
    API->>Job: approved=true, decisions,<br/>pushStatus=pushing, ingestionStatus=pending
    API-->>U: 200 ack

    par fire-and-forget — neither blocks the other
        API->>Ad: push accepted rows
        Note over API,Ad: a rejected suggestion → the row keeps its raw name
        Ad-->>API: pushStatus = push_success | push_failed
    and
        API->>DBX: bronze (raw rows as received)
        API->>DBX: silver (cleaned + approved names)
        loop up to 3 attempts, linear backoff
            DBX-->>API: attempt result
            API->>Aud: log ingestion attempt
        end
        API->>Job: ingestionStatus = ingestion_success | ingestion_failed
    end

    opt ingestion_failed
        U->>API: POST /databricks/:jobId/retry
        Note over API,DBX: one manual attempt, reusing the upload's own idempotency key
    end
```

### 4.3 Data transformation flow — what the payload *is* at each hop

```mermaid
flowchart TB
    CSV[/"Raw CSV<br/>mixed date formats<br/>inconsistent enums<br/>duplicates, garbage rows"/]

    DET["<b>DETERMINISTIC TRANSFORMATION — no AI, streamed one row at a time</b>
    ─────────────────────────────────────────────
    <b>1 Header check</b>  missing required column → reject the whole file
    <b>2 Schema · type · enum</b>  unmapped enum value → reject the row
    <b>3 Date standardisation</b>  unparseable date → dateFlag, row kept
    <b>4 Business rules</b>  known-bad value → correct it AND record the correction
    <b>5 Dedupe</b>  duplicate campaignId or row hash → flag
    <b>6 Quality score</b>  schema·0.3 + dates·0.2 + dupes·0.3 + rules·0.2"]

    VS[("<b>validationSummary</b><br/>totalRows · processed · rejected · needsReview · cleanRows<br/>schemaIssues · dateFlags · duplicates · corrections · qualityScore<br/><i>every downstream number originates here</i>")]

    AIS["<b>AI STAGE — suggests, never applies</b>
    ─────────────────────────────────────────────
    embed(normalizeForEmbedding(name)) → 384-dim vector
    cosine similarity vs ~15 cached master campaign vectors"]

    TH{"confidence ≥ 60%?<br/><i>threshold lives in code,<br/>not in the model</i>"}

    MATCH[("<b>matches[]</b><br/>uploadedName · matchedName · confidence · action")]
    SUM[("<b>qualitySummary</b><br/><i>one sentence — prose only,<br/>zero new numbers</i>")]

    JOB[("<b>jobStore record</b><br/>status · validationSummary · matches · decisions<br/>pushStatus · ingestionStatus · reconciliation")]

    CSV --> DET --> VS
    VS -->|"distinct campaign names"| AIS --> TH
    TH -->|"yes → action: suggest"| MATCH
    TH -->|"no → action: flag_for_review"| MATCH
    VS -->|"exact fact object"| SUM
    MATCH --> SUM
    VS --> JOB
    MATCH --> JOB
    SUM --> JOB

    style VS stroke-width:3px
    style JOB stroke-width:3px
```

Two things are true of every number that reaches the Validation Results screen: it was computed inside the grey deterministic block, and it travelled there through `validationSummary`. The AI stage contributes *suggestions* and *prose* to the job record — never a figure.

### 4.4 Post-approval fan-out — what the approval decision unlocks

```mermaid
flowchart LR
    JOB[("<b>jobStore record</b><br/>status = complete")]

    GATE{{"<b>HUMAN APPROVAL GATE</b><br/>per-suggestion accept / reject<br/><i>POST /approve — approver | admin</i>"}}

    subgraph Gated["Writes that require approval"]
        PUSH["Ad platform push<br/><i>accepted rows only</i>"]
        SILVER[("Databricks <b>silver</b><br/>cleaned rows<br/><i>accepted → matched name<br/>rejected → raw name retained</i>")]
    end

    subgraph Ungated["Writes that do not — they record, they do not decide"]
        BRONZE[("Databricks <b>bronze</b><br/>raw rows exactly as received")]
        AUD[("Audit log<br/>actor · action · timestamp<br/><i>actor from the verified session</i>")]
    end

    subgraph FF["Fire-and-forget on completion — never gated, never blocking"]
        IDX[("Chroma<br/>run summary vector")]
        RECON[("Reconciliation<br/>uploaded vs reported spend<br/><i>variance > 5% → review</i>")]
    end

    JOB --> GATE
    GATE --> PUSH
    GATE --> SILVER
    GATE --> AUD
    JOB --> BRONZE
    JOB -.-> IDX
    JOB -.-> RECON

    style GATE stroke-width:4px
    style Gated stroke-width:3px
```

**Bronze is deliberately not gated.** The raw table records what arrived, which is a fact independent of anyone's judgement; silver records what the organisation decided the data means, which is not. Separating them is what makes a rejected suggestion recoverable — the original name is still sitting in bronze — rather than lost.

### 4.5 Flow inventory

Every data flow in the system, with its transport, timing, and failure behaviour.

| Flow | Trigger | Payload | Sync? | On failure |
|---|---|---|---|---|
| Upload → job created | `POST /upload` | multipart CSV → `{jobId}` | Sync (`202` in ms) | 400 on missing file; duplicate returns the existing job |
| Validation | Job kickoff | file stream → `validationSummary` | Async, awaited in `runJob` | `status=failed`, error stored on the job — **critical path** |
| Campaign matching | After validation | campaign names → `matches[]` | Async, awaited, sequential per name | `status=failed` — **critical path** |
| Quality summary | After matching | fact JSON → one sentence | Async, awaited, **try/catch'd** | Job still reaches `complete` without the sentence — *not* critical path |
| Status polling | Client, ~1s | — → job snapshot | Sync read | Client retries on next tick |
| RAG indexing | Job `complete` | run summary → vector upsert | **Fire-and-forget** | Logged; run is un-searchable but intact |
| Auto-reconciliation | Job `complete` | job + platform spend → variance rows | **Fire-and-forget** | Logged; reconciliation page shows nothing for that run |
| Approval | `POST /approve` | `{decisions}` + session cookie | Sync ack | 403 on wrong role; audit entry written either way |
| Ad platform push | Approval | accepted rows → platform | **Fire-and-forget** | `pushStatus=push_failed`; job stays approved |
| Databricks ingestion | Approval | raw + cleaned rows | **Fire-and-forget**, 3 auto attempts w/ linear backoff | `ingestion_failed`; one manual retry available; every attempt audited |
| Assistant query | `POST /assistant/query` | question → answer + citations | Sync | Error surfaced in chat; query logged |
| Scheduled pull | cron tick | source fetch → same pipeline | Async | Run history records failure; `notify` fires |

**The design rule visible in that table:** exactly three flows are on the critical path — validation, matching, and the quality-summary attempt. Those three define `status: complete`, which is the user's "is my upload done" signal. Everything else is a *consequence* of a completed run rather than a *precondition* for reporting one, so nothing else is allowed to block it. RAG indexing, reconciliation, the push, and the warehouse write can each fail independently without failing the upload.

---

## 5. Data flow — the assistant query path

```mermaid
flowchart TB
    Q[/"Natural-language question"/]
    ROUTE{"<b>queryRouter.classifyQuery</b><br/>regex over known shapes:<br/>how many · count of · list all<br/>show me all · below/above N%<br/><br/><i>deliberately NOT an LLM call</i>"}

    subgraph Structured["Structured path — exact answers"]
        F["Parse filters from question<br/><i>threshold, status, platform</i>"]
        QJ["<b>jobStore.queryJobs(filters)</b><br/><i>deterministic filter —<br/>the answer already exists here</i>"]
        G1["Groq: narrate this exact list<br/><i>'say no matching runs found<br/>rather than guess'</i>"]
    end

    subgraph Semantic["Semantic path — explanatory answers"]
        EQ["Embed the question<br/><i>Xenova, in-process</i>"]
        RET["Chroma: top-5 nearest<br/>run summaries"]
        G2["Groq: answer from these<br/>documents only, with citations"]
    end

    A[/"Answer + citations"/]
    LOG[("queryLogStore<br/><i>feeds dashboard RAG stats</i>")]

    Q --> ROUTE
    ROUTE -->|"pattern hit"| F --> QJ --> G1 --> A
    ROUTE -->|"no pattern hit"| EQ --> RET --> G2 --> A
    A --> LOG

    style QJ stroke-width:3px
    style ROUTE stroke-width:3px
```

**Why routing is a regex and not a model.** There are a small number of known question shapes, a wrong route is cheap to fix with one more pattern, and an LLM router would add latency, cost, and non-determinism to a decision that has a mechanically correct answer. This is the same "AI only where it adds value" boundary from §7, applied one layer further up the stack.

**Why the structured path computes before it phrases.** `queryJobs()` produces the exact filtered result *first*. The LLM receives a finished answer and is asked only to read it out. It is structurally unable to miscount, because it was never asked to count — the failure mode of "confidently wrong number" is designed out rather than prompted against.

---

## 6. Data flow — the scheduled path

```mermaid
flowchart LR
    ADM(["Admin"]) -->|"POST /schedules<br/>{ source, frequency, notify }"| SS[("scheduleStore")]
    SS --> CE["cronExpression<br/><i>hourly / daily / weekly / manual</i>"]
    CE --> SE["<b>schedulerEngine.startAll</b><br/><i>node-cron, re-registered at boot</i>"]
    SE -->|tick| SF["sourceFetcher<br/><i>simulated Meta/Google/Amazon pull</i>"]
    SF -->|"produces a CSV"| PIPE["<b>the same runJob pipeline<br/>a manual upload uses</b>"]
    PIPE -->|success| HIST[("run history on the schedule")]
    PIPE -->|terminal failure| NOTIF["notifier<br/><i>stubbed email/webhook;<br/>trigger point and payload are real</i>"]
    PIPE --> AUD[("auditStore")]

    style PIPE stroke-width:3px
```

**One pipeline, two entry points.** A scheduled run and a manual upload converge on the identical code, so validation, matching, grounding, approval, and audit behave the same either way. There is no second implementation to keep in sync.

**The sharpest edge in the current design is here.** `node-cron` runs in-process with no leader election. If the API tier ever runs more than one instance, every instance fires the same cron and the same source is processed two or three times. This must be solved *before* horizontal scaling, not after — see §10.

---

## 7. AI integration points

### 7.1 The AI surface, in full

Six integration points, drawn as six independent chains. Read each row left to right: **deterministic input → what the model does → what constrains it → where the output lands.** The zone colouring is consistent across all six — 🔒 deterministic, 🤖 AI, 👤 human, ▣ destination.

```mermaid
flowchart TB
    subgraph One["<b>① CAMPAIGN NAME MATCHING</b> — Xenova/all-MiniLM-L6-v2, local — the only AI point with a path to written data"]
        direction LR
        a1["🔒 validationPipeline<br/>distinct campaign names"] --> a2["🤖 embed(normalize(name))<br/>→ 384-dim vector"] --> a3["🔒 cosineSimilarity vs<br/>~15 cached master vectors<br/><b>threshold 60% applied here,<br/>outside the model</b>"] --> a4["🔒 suggest | flag_for_review<br/><i>a pending decision,<br/>never an applied change</i>"] --> a5["👤 <b>HUMAN GATE</b><br/>per-suggestion<br/>approve / reject"] --> a6["▣ Ad platform push<br/>+ Databricks silver<br/><i>rejected → raw name kept</i>"]
    end

    subgraph Four["<b>④ AI QUALITY SUMMARY</b> — Groq llama-3.3-70b-versatile"]
        direction LR
        d1["🔒 computeQualityScore<br/><i>fixed weighted formula</i>"] --> d2["🔒 buildSummaryFacts()<br/>exact JSON fact object<br/><i>every count computed here</i>"] --> d3["🤖 'write one sentence<br/>using ONLY these facts'<br/><i>never invent a number;<br/>never say auto-corrected</i>"] --> d4["▣ One sentence on the<br/>Validation Results screen<br/><i>try/catch — job completes<br/>without it</i>"]
    end

    subgraph Five["<b>⑤ STRUCTURED RAG NARRATION</b> — Groq — 'how many files below 80%?'"]
        direction LR
        e1["🔒 queryRouter<br/><i>regex, not a model</i>"] --> e2["🔒 jobStore.queryJobs(filters)<br/><b>the answer already exists<br/>before the model is called</b>"] --> e3["🤖 narrate this exact list<br/><i>'say no matching runs found<br/>rather than guess'</i>"] --> e4["▣ Prose + citations<br/>in the chat widget"]
    end

    subgraph TwoSix["<b>② QUESTION EMBEDDING + ⑥ SEMANTIC ANSWER</b> — Xenova (retrieve) + Groq (generate) — 'why did the Meta upload fail?'"]
        direction LR
        f1["🔒 queryRouter<br/><i>no pattern hit → semantic</i>"] --> f2["🤖 <b>②</b> embed(question)"] --> f3["🔒 Chroma top-5 nearest<br/>run summaries<br/><i>corpus-scoped retrieval</i>"] --> f4["🤖 <b>⑥</b> answer from these<br/>documents only<br/><i>not-found if empty</i>"] --> f5["▣ Prose + citations<br/>in the chat widget"]
    end

    subgraph Three["<b>③ RUN SUMMARY INDEXING</b> — Xenova, local — builds the corpus ⑥ retrieves from"]
        direction LR
        g1["🔒 completed job record"] --> g2["🔒 buildRunSummaryText()<br/><i>one doc per run,<br/>not one chunk per row</i>"] --> g3["🤖 embed(document)"] --> g4["▣ Chroma<br/>ingestion_runs_v1<br/><i>fire-and-forget</i>"]
    end

    One ~~~ Four ~~~ Five ~~~ TwoSix ~~~ Three

    style a5 stroke-width:4px
    style a6 stroke-width:3px
```

**The shape of that diagram is the point.** Only *one* of the six integration points has any path to written data — ① campaign matching — and that path is interrupted by a human gate before it reaches either destination. The other five terminate in text on a screen or in a search index. There is no arrow anywhere in this system from a model directly into a data write.

**Note the deliberate asymmetry in each row:** the 🔒 boxes always bracket the 🤖 box. Every AI step receives already-computed input and hands its output to something that constrains it — a threshold, a citation requirement, a human, or a screen. The model is never at either end of a chain.

### 7.2 Integration point reference

| # | Integration point | Model | Input | Output | What it may decide | Grounding guard | Failure mode |
|---|---|---|---|---|---|---|---|
| ① | **Campaign name matching** | `Xenova/all-MiniLM-L6-v2`, local | Normalized uploaded name | 384-dim vector → cosine score vs ~15 cached master vectors | *Nothing.* It produces a similarity score; deterministic code applies the 60% threshold and a human applies the decision | Never auto-applies. `suggest` and `flag_for_review` are both pending human decisions. A rejected suggestion carries the raw name all the way into the silver table | Model load failure fails the job (critical path). A bad score produces a wrong *suggestion*, never a wrong *write* |
| ② | **Question embedding** | Same, local | User question | Query vector | Nothing — retrieval only | Retrieval is scoped to one collection of run summaries; nothing outside the corpus can be returned | Empty/failed retrieval → "no matching runs found" |
| ③ | **Run summary indexing** | Same, local | Completed job record | Vector + document in `ingestion_runs_v1` | Nothing | One summary document per run, not one chunk per row — row-level detail belongs to the structured path, so the semantic path cannot be asked to do arithmetic | Fire-and-forget; run is un-searchable but intact |
| ④ | **AI quality summary** | Groq `llama-3.3-70b-versatile` | An exact JSON fact object (`qualityScore`, `totalRows`, `rejectedRows`, `fieldCorrections`, `unrecognizedValues`, `dateFlagCount`, `duplicateCount`, `suggestedCampaignMatches`, `flaggedCampaignMatches`) | One plain sentence | Only *wording* | Prompt forbids inventing any number, field, or count; forbids mentioning zero-count categories; requires ending with the exact unchanged score; **explicitly forbids calling a suggested match "auto-corrected"** because the matcher never applies one | `try/catch` — the job completes without a summary sentence |
| ⑤ | **Structured RAG narration** | Groq | An already-filtered exact result set from `queryJobs()` | Prose + citations | Only wording | The answer is computed before the model is called. Instructed to say "no matching runs found" rather than speculate | Error surfaced in chat |
| ⑥ | **Semantic RAG answer** | Groq (+ Xenova for retrieval) | Top-5 retrieved run summaries | Prose + citations | Only wording and which retrieved evidence to cite | Classic retrieve-then-generate: answer only from supplied documents, say not-found if empty | Error surfaced in chat |
| — | **Query routing** | **None — regex** | Question text | `structured` \| `semantic` | — | Routing has a mechanically correct answer for the known question shapes; a model here would add cost and non-determinism for no accuracy gain | A miss routes to semantic, which still answers |

### 7.3 The four guards, stated as invariants

These are the properties that make the AI trustworthy in this system. Each is enforced structurally, not by prompt wording alone.

1. **Compute-then-phrase.** Every number the LLM emits was computed by deterministic code before the model was invoked. The model is handed a finished fact object and asked for a sentence. It cannot miscount because it is never asked to count.
2. **Suggest-never-apply.** The matcher's output is always a pending decision. The human gate sits between the AI suggestion and *both* downstream writes — the ad-platform push and the silver table's campaign names. A rejected suggestion is not merely ignored; the raw name is deliberately preserved end-to-end.
3. **Threshold outside the model.** The AI produces a continuous score; deterministic code turns it into `suggest` / `flag_for_review` at 60%. Tuning behaviour means changing one constant, not re-prompting a model.
4. **Fail-open on phrasing, fail-closed on facts.** A Groq outage removes a sentence. It never removes, delays, or corrupts a validated row. Conversely, a validation failure stops the run outright.

> **The one-line summary of the AI boundary:** *AI decides what a fact probably means, or how to phrase a fact into English. It never decides what the fact is, and it never applies a change unsupervised.*

### 7.4 Two things worth flagging honestly

- **The 60% threshold is a judgment call, not a derived number.** The brief supplies only widely-spaced reference points (94/91/97% → suggest, 12% → flag). In production this would be tuned against a labelled sample of real mismatches. Note also that the explanatory comment above `SUGGEST_THRESHOLD` in `services/ai/matching/campaignMatcher.js` still discusses *70%* while the constant is `0.60` — the comment is stale relative to the code and should be reconciled.
- **Embedding versioning is deliberate but incomplete.** `embedClient` exports `modelName`, `modelVersion`, `normalizationVersion`, and `embeddingSchemaVersion`, and the Chroma collection is named `ingestion_runs_v1`, so changing the model means creating a new versioned collection and re-embedding rather than silently mixing vectors from two pipelines. The versioning *metadata* exists; the *migration job* that would use it does not yet.

---

## 8. State & lifecycle

A job accumulates independent, differently-timed state on one record.

```mermaid
stateDiagram-v2
    [*] --> processing: createJob()
    processing --> matching: validation complete
    processing --> failed: validation error
    matching --> complete: quality summary attempted
    matching --> failed: matching error

    state complete {
        [*] --> awaiting_review
    }

    complete --> approved: POST /approve (approver/admin)

    state "independent, concurrent, fire-and-forget" as FF {
        state "pushStatus" as PS {
            [*] --> pushing
            pushing --> push_success
            pushing --> push_failed
        }
        state "ingestionStatus" as IS {
            [*] --> ingesting
            ingesting --> ingestion_success
            ingesting --> ingestion_failed
            ingestion_failed --> ingesting: manual retry (one attempt)
        }
    }

    approved --> FF
    complete --> reconciled: auto-reconcile
    complete --> indexed: RAG indexing
```

**Why the frontend runs three separate polling loops** (`pollJob`, `pollPushStatus`, `pollIngestionStatus`) rather than one: `status`, `pushStatus`, and `ingestionStatus` are independent fields settling at independent times. A single loop would either poll too aggressively for the slow field or report the fast one late.

**Idempotency is proven end-to-end, not just at the edge.** `fileHash + uploadDate` deduplicates the upload *and* is reused as the Databricks ingestion idempotency key — the same concept holds at both ends of the pipeline, so the pattern is validated rather than asserted.

---

## 9. Security architecture

```mermaid
flowchart TB
    subgraph Untrusted["🌐 Untrusted zone — the browser"]
        B["React SPA<br/><i>hides nav links and redirects routes<br/>purely for UX — a hidden button<br/>is not a security control</i>"]
    end

    subgraph Trusted["🔒 Trusted zone — the server decides what is true"]
        CK["session cookie<br/><b>httpOnly</b> · SameSite=Lax<br/><i>invisible to document.cookie<br/>and every other JS API</i>"]
        RA["<b>requireAuth</b><br/>verify JWT → req.user = { username, role }"]
        RR["<b>requireRole(...)</b><br/>uploader · approver · admin"]
        RT["Routes<br/><i>re-check role server-side regardless<br/>of what the SPA's router decided</i>"]
        AUD[("auditStore<br/><i>actor = req.user.username,<br/>never a request-body field</i>")]
    end

    ENV[["Secrets — process.env only<br/>GROQ_API_KEY · JWT_SECRET<br/><i>.env gitignored, .env.example documents shape,<br/>no literal ever in source</i>"]]

    B -->|"cookie attached automatically;<br/>page JS never touches the token"| CK
    CK --> RA --> RR --> RT --> AUD
    RT --> ENV

    style Trusted stroke-width:3px
```

| Control | Decision | Why this way |
|---|---|---|
| Session transport | `httpOnly` cookie, **not** `localStorage` | A token in `localStorage` is readable by any script on the page, including a compromised third-party dependency — one XSS becomes full session theft. An `httpOnly` cookie is unreachable from JS entirely |
| CSRF | `SameSite=Lax`, no separate token | `localhost:5173` and `:3000` are same-site (SameSite compares registrable domain, not port), so the SPA's own fetches carry the cookie — but Lax refuses to attach it to a cross-site state-changing request, which is exactly the CSRF request shape. A double-submit token becomes worthwhile only if the SPA and API move to genuinely different sites |
| Passwords | bcrypt hashed, never compared in plaintext | Accounts are seeded demo users rather than self-registered — a prototype shortcut on *provisioning*, deliberately not on *storage* |
| JWT secret | `process.env.JWT_SECRET`; if unset, a random per-process secret plus a loud warning | The failure mode is safe (sessions reset on restart) rather than silent (signing with a secret anyone reading the source also knows) |
| Audit actor | Always `req.user.username` | Both `/approve` and the Databricks retry endpoint previously accepted a free-text `reviewer` field and logged *that* — trivially spoofable. An audit log that trusts client input for "who did this" is not an audit log |

### Role → route matrix

| Route(s) | Role | Rationale |
|---|---|---|
| `POST /auth/login` | public | must be reachable while logged out |
| `GET /validation`, `/reconciliation`, `/pipeline-status`, `/dashboard`, `POST /assistant/query` | any authenticated | read-only visibility; every role needs run history to do its part |
| `POST /upload` | uploader, admin | only these roles start a new run |
| `POST /approve`, `POST /databricks/:id/retry` | approver, admin | the "commits changes" surface |
| `/schedules*`, `GET /audit` | admin | operational and administrative concerns |

**Known gap, stated rather than hidden:** job visibility is **role-based, not ownership-based**. A job record has no `uploadedBy` field and `GET /validation/:jobId` has no ownership check beyond `requireAuth`, so any authenticated role can view any job by ID and any approver can approve any job. That is intentional — approval is a role capability, not an ownership one — but it also means there is no "my uploads" filter and no per-job access control today. Relatedly, cross-session handoff from uploader to approver currently rides on `sessionStorage.activeJobId`, which survives a logout/login in the same browser tab but not a new tab or device. The production replacement is a durable jobs table queried by a real pending-review endpoint (`GET /jobs?status=complete&approved=false`).

---

## 10. Production evolution — which boxes change shape

Same logical architecture, different physical one. The dashed boxes are what a production deployment adds.

```mermaid
flowchart TB
    Now["<b>CURRENT</b> — one Node process: Express API + cron + embeddings<br/>+ in-memory stores + local disk <code>uploads/</code> + single-node Chroma"]

    subgraph Prod["Production shape"]
        P0["Browser → <b>pre-signed URL</b> → object storage<br/><i>the file never transits the API tier</i>"]
        P1["<b>API tier</b> — stateless, N instances<br/><i>accepts and reads only</i>"]
        P2[["<b>Queue</b> — SQS / BullMQ / Kafka"]]
        P3["<b>Worker pool</b> — scales on queue depth,<br/>not request rate"]
        P4[("<b>Postgres</b><br/>jobs · schedules · audit · users")]
        P5[("<b>Object storage</b><br/>S3 / Blob / GCS")]
        P6["<b>Embedding service</b><br/><i>batched, concurrency-limited</i>"]
        P7[("<b>Managed vector DB</b><br/>Pinecone / Weaviate / pgvector")]
        P8["<b>Workflow engine</b><br/>Airflow / Prefect / Temporal<br/><i>or one elected leader</i>"]
        P9[["<b>DLQ</b> — instead of dropping<br/>a row after max retries"]]
        P10["<b>Observability</b><br/>structured logs · metrics · traces"]

        P0 --> P5
        P1 --> P2 --> P3
        P3 --> P5
        P3 --> P4
        P3 --> P6 --> P7
        P8 --> P2
        P3 --> P9
        P1 --> P10
        P3 --> P10
    end

    Now ==>|"same logic,<br/>different topology"| Prod

    style P8 stroke-width:3px
    style P2 stroke-width:3px
```

| Concern | Current | Production | Why it matters at scale |
|---|---|---|---|
| **Scheduler** ⚠️ | `node-cron` in-process | Workflow engine, or one elected leader | **Blocking issue for horizontal scaling.** Every instance would independently fire the same cron and double-process the same source. `node-cron` has no leader election — this must be solved *before* adding instances |
| Job/schedule/audit state | In-memory `Map`s | Postgres (Redis for hot state) | Instance B cannot see a job instance A created. This alone blocks multi-instance deployment |
| File storage | Local disk, deleted after processing | Object storage + pre-signed browser upload | Local disk ties processing to one instance and does not survive that instance dying mid-job |
| Upload processing | `runJob()` on the same process that took the request | Queue + separate worker pool | Decouples "accept the file" from "process the file"; workers scale on queue depth |
| CSV validation | Streaming, one row at a time | **Same pattern** — a worker streams from object storage | The streaming approach is already right; only *where* it runs changes |
| Campaign matching | Brute-force cosine over ~15 in-memory vectors | ANN index (HNSW/FAISS), or move into the vector DB | O(n) is free at n=15 and a real cost at n=10,000+ |
| Embeddings | Local model, sequential, CPU-bound | Dedicated batched embedding service with a concurrency limit | Sequential is correct for a local model (no network latency to overlap); a hosted API inverts that calculus entirely |
| Vector store | Single-node Chroma | Managed/replicated vector DB | No HA and no read scaling as history grows |
| LLM calls | One synchronous call per job/query | Request queuing, streamed responses, cost monitoring, prompt caching | Stops one slow call stalling the pipeline; puts a ceiling on cost |
| Push / warehouse write | Simulated, deterministic retry | Real async polling + DLQ, same idempotency key | The retry-with-backoff *pattern* is already production-shaped; only the transport is fake |
| Audit log | In-memory append-only array | Durable, immutable, tamper-evident table | An in-memory array satisfies neither compliance requirement |
| Secrets | `.env` + `dotenv` | Vault / AWS Secrets Manager / platform injection | Fine for local dev, not for a deployed multi-person environment |
| Observability | `console.log` + dashboard-derived health | Structured logging, metrics, tracing | The dashboard's pipeline-health numbers come from job records, not real instrumentation |

---

## 11. Build status

| Area | Status |
|---|---|
| Ingestion, validation, campaign matching, RAG assistant, AI quality summary | ✅ Fully built and wired end-to-end |
| Review approve/reject → ad platform push → Databricks ingestion → audit trail | ✅ Fully built; transport layers simulated and documented per-file |
| Scheduling | ✅ Fully built — config, cron execution, run history, failure notification. The *source fetch* is the one simulated piece (no real platform credentials) |
| Dashboard | ✅ Fully built, aggregating real job-store / query-log / reconciliation data |
| Auth & RBAC | ✅ Fully built — login, httpOnly-cookie sessions, three roles enforced server-side. Seeded demo accounts rather than SSO is the one deliberate shortcut |
| Secrets management | ⚠️ `.env` + `.env.example` + `.gitignore`, nothing hardcoded — real practice for a prototype, not a secrets manager |
| Observability | ❌ No structured logging, metrics, or tracing beyond `console.*` |
| Multi-instance safety | ❌ In-memory state and in-process cron both assume exactly one backend process |

---

## 12. Appendix — repository map

```
backend/
  app.js                          — app wiring: CORS, cookies, auth gate, route mounting, scheduler boot
  middleware/auth.js              — requireAuth (session verification), requireRole (RBAC)
  data/                           — jobStore · auditStore · scheduleStore · userStore
                                     queryLogStore · conversationStore · databricksStore
  routes/                         — auth · upload · validation · approve · reconciliation
                                     databricks · schedules · dashboard · assistant
                                     pipelineStatus · audit
  services/
    auth/jwt.js                   — sign / verifySession
    validation/                   — schemaValidator · dateStandardizer · businessRules
                                     validationPipeline (streaming + weighted quality score)
    ai/embeddings/embedClient.js  — shared local embedder + version metadata
    ai/matching/                  — campaignMatcher · cosineSimilarity
                                     masterCampaignList · normalizeForEmbedding · matchAllCampaigns
    ai/summary/qualitySummary.js  — fact object → one sentence (Groq)
    ai/rag/                       — queryRouter · structuredHandler · semanticHandler · indexer
    adtech/                       — googleAdsClient · adPlatformPush · reconciliation · autoReconcile
    databricks/                   — databricksIngestion (idempotency + retry w/ backoff)
    scheduler/                    — schedulerEngine · cronExpression · sourceFetcher · notifier
  test/                           — adPlatformPush · campaignMatcher · databricksIngestion
                                     embedVersioning · reconciliation · uploadRoute

frontend/
  src/pages/                      — Login → Upload → ValidationResults → Review →
                                     Reconciliation → PipelineStatus → Scheduling →
                                     Dashboard, plus admin-only AuditLog
  src/components/                 — StatusBadge · MetricCard · JobProgress · ChatWidget
                                     Layout · PreviewNotice · RequireAuth · RequireRole
  src/api/client.js               — every backend call in one place (credentials always included)
  src/context/JobContext.jsx      — active jobId, shared across pages
  src/context/AuthContext.jsx     — current user/role, login() / logout()
```

**Reading this alongside the code:** nearly every file referenced above carries its own "why" as a comment at the point of the decision. This document is the map; the comments are the territory. Where the two disagree, trust the code comment — it is closer to what shipped — and treat the mismatch as something to reconcile (§7.4 names one such case).
