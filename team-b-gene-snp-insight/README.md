# Gene/SNP Insight Summarizer

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Overview

A lightweight web app that turns a gene symbol (e.g., TP53) or SNP rsID (e.g., rs429358) into a compact, clinician-friendly insight summary.
It combines primary bioinformatics lookups with an optional AI summarizer (Claude) and supports CSV/JSON export, plus ClinVar and Open Targets hooks.

## Key Features

### Query types: 

Human genes (symbol) and SNPs (rsIDs).

### Primary sources:

MyGene.info → gene summary, GO terms, Reactome pathways.

Ensembl Variation REST → rsID consequence, mappings, pop freqs (approx MAF).

### AI summary (optional):

Uses Anthropic Claude via a local Express proxy (/api/claude).

Server stores your key in .env (ANTHROPIC_API_KEY), never exposed to the browser.

### Evidence hooks:

ClinVar (E-utilities) → short list of related records (by gene or rsID).

### Open Targets (GraphQL) 

Top disease associations for the gene (via Ensembl ID).

### Export

One-click JSON or CSV with base facts, AI summary, and hook data.

### Minimal UI

React + Tailwind-friendly components, no heavy UI deps needed.

## Architecture 

```bash
React (Vite/CRA)
  ├─ Fetch MyGene.info / Ensembl for base facts
  ├─ Optional POST /api/claude  (local Express server)
  ├─ Fetch ClinVar (NCBI E-utilities) and Open Targets GQL
  └─ Render + Export (CSV/JSON)

Express server (server.js)
  └─ POST /api/claude → Anthropic Messages API
      - Reads ANTHROPIC_API_KEY from .env
      - Returns concise JSON-like summary text
```

## Setup (dev)

### Backend (Claude proxy)

```bash
npm i express dotenv cors

# server.js configured with CORS for http://localhost:3000 or 5173
# .env contains: ANTHROPIC_API_KEY=sk-ant-...

node server.js   # prints: Claude proxy on http://localhost:8787
```

### Frontend

Place the app code in src/App.jsx (or use the provided App_complete.jsx).

Start your dev server (CRA or Vite).

If you don’t want to use a dev proxy, the frontend calls
http://localhost:8787/api/claude directly (CORS is enabled on the server).

## Usage

Enter a gene (TP53) or rsID (rs429358) and click Collect facts.

View Facts collected (raw source data) and Insight Summary (AI JSON-style).

Explore ClinVar records and Open Targets disease associations.

Click Export JSON or Export CSV to save the combined result.


## Findings & Notes (from the build)

### Reliability: 

MyGene.info and Ensembl are fast and stable for core facts.

### MAF: 

Calculated as a simple max frequency across populations when available; treat as approximate.

### ClinVar: 

Works, but browser CORS can intermittently block E-utilities; proxy via Node if needed.

### Open Targets: 

GQL is CORS-friendly; returns disease names + scores (top N).

### Claude: 

The proxy fully avoids client-side key exposure and CORS issues.

### Common pitfalls:

Cannot POST /api/claude → either server not running, wrong route, or proxy not configured.

PowerShell curl flags → use Invoke-RestMethod or curl.exe.

## Error Handling

Network errors show user-friendly messages under each panel.

AI errors don’t block base facts; the app still renders primary data.

Graceful JSON parsing: If Claude returns non-strict JSON, we fall back to raw text in the summary.

## Security & Privacy

Your Anthropic API key stays server-side (.env), never sent to the browser.

No state is stored server-side; all results remain in the client until exported.

## Limitations

No variant effect prediction beyond what Ensembl provides.

MAF is simplified; not a population-weighted calculation.

ClinVar CORS may require server proxying in some environments.

## Roadmap/Nice-To-Haves

Proxy ClinVar through the Node server for consistent CORS behavior.

Add Open Targets evidence deep links and confidence breakdowns.

Add HGVS parsing and gnomAD frequencies.

Batch queries + result caching.

Optional authentication and saved workspaces.

## Commands Cheatsheet

### Server (Claude proxy)
```bash
node server.js
```

### Frontend (Vite)
```bash
npm run dev
```

### Frontend (CRA)
```bash
npm start
```

### PowerShell test of proxy
```bash
$body = @{ facts = @{ type='gene'; core=@{ symbol='TP53' } } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri 'http://localhost:8787/api/claude' -ContentType 'application/json' -Body $body
```

## License: 

MIT 


## Contact: 

Open an issue or ping the maintainer of this repository.

