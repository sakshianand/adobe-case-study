



# Adobe Case Study - Marketing Ingestion & RAG Assistant

## Overview

This project is a prototype for a marketing data ingestion workflow. Users upload CSV files, the backend validates and normalizes the data, AI is used for the fuzzy parts such as campaign-name matching and natural-language Q&A, and the results are surfaced in a review UI.

---

## Documents

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data flows, and AI integration points|
| [AI_INTEGRATION.md](AI_INTEGRATION.md) | Where AI is used, why, and how errors are handled, point by point |
| [SCALABILITY_RELIABILITY.md](SCALABILITY_RELIABILITY.md) | Scalability & reliability design: where load concentrates, what's already reliable vs. deferred, and why |
| [TRADEOFFS.md](TRADEOFFS.md) | Decisions made, alternatives considered, and what I'd do with more time, ranked by priority |
| [CICD_STRATEGY.md](CICD_STRATEGY.md) | CI/CD strategy: pipeline stages, environments, deploy/rollback, and secrets handling, with diagrams |
| [HIGH_LEVEL_DESIGN.md](HIGH_LEVEL_DESIGN.md) | Design rationale, security decisions, repository map, honest gap map |

---

## Demo video

https://github.com/user-attachments/assets/3b55b166-45b2-44fc-a9ad-0d30d88a7749





---

## How to run it

### Prerequisites

- **Node.js 18+** and npm
- A **Groq API key** — free at [console.groq.com](https://console.groq.com) — needed for the AI quality summary and the RAG assistant's phrasing
- **Python 3 + `chromadb`** (`pip install chromadb`), to run a local Chroma server — only required for the RAG assistant's semantic search and run indexing; everything else (upload, validation, campaign matching, approval, dashboard) works without it

### 1. Start Chroma (optional, but needed for the full RAG assistant experience)

```bash
chroma run --path ./backend/chroma-data
```

Leave this running in its own terminal. If you skip this step, uploads, validation, matching, and approval all still work — only semantic RAG queries and run indexing will fail (caught and logged, not fatal — see [AI_INTEGRATION.md](AI_INTEGRATION.md)).

### 2. Configure and start the backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` and set:
- `GROQ_API_KEY` — your Groq key
- `JWT_SECRET` — any long random string for local dev (generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), or leave blank to get a random per-process secret (sessions just reset on restart)
- `FRONTEND_ORIGIN` — defaults to `http://localhost:5173`, matching the frontend dev server below

```bash
node app.js
```

*(`backend/package.json` has no `start` script yet — `node app.js` is the direct equivalent. See [CICD_STRATEGY.md](CICD_STRATEGY.md) §1.1 and §6 for this and the similarly-missing `test` script.)*

The API listens on `http://localhost:3000` by default (`PORT` env var to override).

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`.

### 4. Log in

Three seeded demo accounts, one per role:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | admin |
| `approver` | `approver123` | approver |
| `uploader` | `uploader123` | uploader |

Log in as `uploader` to upload a CSV, then as `approver` to review and approve AI suggestions, then as `admin` to see scheduling, dashboard, and the audit log.

### Running backend tests

```bash
cd backend
node --test test/
```
