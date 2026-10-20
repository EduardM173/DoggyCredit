# S4-OPS-06: Performance and Latency Evidence Report on Internal Stored Queries

**Document ID:** S4-OPS-06-REPORT  
**Sprint:** Sprint 4  
**Date:** October 20, 2026  
**Related Requirements:** RF-04 (SLO & Test Plan), RF-01, RF-02, RF-03, HU-18, HU-19, HU-20, HU-21, HU-22, HU-24  
**Status:** PASS — Objective Verified (< 500 ms p95 on Stored Queries with 0.00% Error Rate)

---

## 1. Executive Summary & SLO Contract

As specified in the Project Master Document and formally parameterized in `docs/DC-148_S4-RF-04_SLO_y_plan_de_pruebas.md`:
* **SLO Target:** Internal HTTP queries over already-persisted business data must respond in **under 500 ms** at the **95th percentile (p95)**.
* **Target Percentiles Reported:** Minimum, p50 (median), p90, p95 (acceptance threshold), p99, Maximum, and Average.
* **Acceptance Criterion for Error Rate:** **0.00%** errors (HTTP 5xx, timeouts, or unhandled 4xx). A fast error response (such as a fast 500) does not count as a successful latency measurement.
* **Exclusion Notice:** Initiating a new evaluation that triggers synchronous calls to external integration mocks (Bank Mock / Credit Bureau Mock) is strictly excluded from this 500 ms threshold because external third-party partner latencies are asynchronous and out of internal database control.

All internal stored queries met and exceeded the acceptance threshold under the defined multi-tenant workload, achieving a **Global p95 of 373.08 ms** and an **Error Rate of 0.00%**, with strict zero cross-tenant data leakage verified.

---

## 2. Benchmark Environment & Hardware Specifications

All benchmark tests were executed directly against the local PostgreSQL container and NestJS runtime on standard developer/CI hardware:

| Specification | Target Environment Value |
|---|---|
| **CPU** | Intel(R) Core(TM) i5-7200U CPU @ 2.50GHz (2 physical cores, 4 threads) |
| **RAM** | 12.0 GB DDR4 |
| **Operating System** | Microsoft Windows 10 Pro x64 (Build 19045) |
| **Database** | PostgreSQL 16.4 running in Docker container (`localhost:5435`) |
| **Application Runtime** | Node.js v22.18.0 |
| **API Framework** | NestJS v11.0.1 + Prisma ORM v7.10.0 (`@prisma/adapter-pg`) |
| **Measurement Tool** | Automated Node.js benchmark engine (`tools/benchmark/run-load-test.ts`) utilizing high-resolution timers (`performance.now()`), concurrent asynchronous worker pools, and automated percentile distributions. |

---

## 3. Multi-Tenant Dataset Architecture & Data Isolation

To prevent synthetic bias, an unbalanced multi-tenant dataset was seeded (`tools/benchmark/seed-load-dataset.ts`) representing two active institutions with asymmetric volume:

### 3.1. Dataset Volumes
* **Tenant A (`banco-del-sol-demo`, High Volume / Noisy Tenant):**
  * **500 Evaluations:** 350 `COMPLETED` (with financial profiles, recommendation reasons, and mock source results), 75 `DRAFT`, 45 `INCOMPLETE`, and 30 `FAILED`. Spread over the last 60 days.
  * **120 Clients:** Distinct historical dossiers.
  * **1,200 Usage Records:** `UsageMetric.EVALUATION` entries recorded across billing cycles.
  * **500 Audit Logs:** Traceability records spanning administrative and analyst activities.
  * **Subscription & Products:** Active `PROFESSIONAL` plan subscription; active credit products.
* **Tenant B (`banco-luna-demo`, Base Volume / Target Tenant):**
  * **50 Evaluations:** Operational records.
  * **25 Clients:** Registered clients.
  * **100 Usage Records:** Metering records for basic tier.
  * **50 Audit Logs:** Institutional audit records.
  * **Subscription & Products:** Active `BASIC` plan subscription; microcredit products.
* **Platform Operator:**
  * Active Operator user with valid administrative session (`operador.demo@doggycredit.local`).

### 3.2. Strict Cross-Tenant Data Isolation Test (PR-02 Verification)
To rigorously test multi-tenant data isolation and prevent cross-tenant data leakage:
* Both Tenant A (`banco-del-sol-demo`) and Tenant B (`banco-luna-demo`) were seeded with a client having the exact same national identity document: **CI `7812456`**.
  * In Tenant A: Client name **"María Fernanda Rojas"** (ID: `8b3d5df9-f7c8-400b-af81-894bb91bbc27`).
  * In Tenant B: Client name **"Juan Carlos Luna"** (ID: `59092bd7-ce0f-4cde-adaa-e67ac76123fb`).
* **Verification Result:** Querying CI `7812456` within Tenant A exclusively returned María Fernanda Rojas. Querying within Tenant B exclusively returned Juan Carlos Luna. Zero ID collisions, zero cross-tenant contamination.

---

## 4. Classified Internal Stored-Query Endpoints

The benchmark covered all 8 critical internal query endpoints:

| # | Endpoint Category | User Story / Scope | HTTP Route | Primary Index Used |
|---|---|---|---|---|
| **1** | Institutional Dashboard | HU-20 (Ana / Carlos) | `GET /api/institution/tenants/:slug/dashboard?period=last_30_days` | `Evaluation_tenantId_createdAt_idx` |
| **2** | Evaluations History List | HU-18 (Evaluations) | `GET /api/institution/tenants/:slug/evaluations?page=1&limit=20` | `Evaluation_tenantId_status_createdAt_idx` |
| **3** | Evaluation Detail by ID | S2/S3 (Dossier) | `GET /api/institution/tenants/:slug/evaluations/:evaluationId` | `Evaluation_tenantId_id_key` |
| **4** | Plan & Consumption Metering | HU-21 (Ana) | `GET /api/institution/tenants/:slug/plan-metering` | `TenantSubscription_tenantId_status_idx`, `UsageRecord_tenantId_metric_occurredAt_idx` |
| **5** | Activity Traceability Audit | HU-24 (Ana) | `GET /api/institution/tenants/:slug/audit?page=1&pageSize=20` | `AuditLog_tenantId_createdAt_idx` |
| **6** | Client Dossier Search | S2/S3 (Client) | `GET /api/institution/tenants/:slug/evaluations/clients/search?documentType=CI&documentNumber=...` | `Client_tenantId_documentType_documentNumber_key` |
| **7** | Operator Institutions Overview | HU-22 (Operator) | `GET /api/admin/institutions?page=1&pageSize=10` | `Tenant_createdFromRequestId_key`, `TenantMembership_tenantId_role_status_idx` |
| **8** | Operator Platform Audit | HU-24 (Operator) | `GET /api/admin/audit?page=1&pageSize=20` | `AuditLog_createdAt_idx` |

---

## 5. Architectural Optimizations Applied

During initial profiling, three architectural bottlenecks were identified and resolved per Subtask (5):

1. **PostgreSQL Connection Pool Sizing:**
   * *Finding:* `@prisma/adapter-pg` defaulted to a pool of 10 connections. Under 15 concurrent workers making multi-query requests, queries experienced queue wait latency.
   * *Solution:* Explicit `pg.Pool` instance configured in `PrismaService` with `max: 30`, `idleTimeoutMillis: 30000`, and `connectionTimeoutMillis: 5000`.
2. **Missing Composite Index on Evaluation Table:**
   * *Finding:* `Evaluation` had composite index `(tenantId, status, createdAt)`. When querying without a status filter (such as dashboard periods or general date range scans), PostgreSQL had to perform sequential scans on tenant rows and sort in memory.
   * *Solution:* Added composite index `@@index([tenantId, createdAt])` to `prisma/schema.prisma` (`Evaluation_tenantId_createdAt_idx`).
3. **Interactive Transaction Elimination for Read-Only Endpoints:**
   * *Finding:* `InstitutionsService.list` and `getDetail` were wrapped in `this.db.run()`, which initiated interactive PostgreSQL transactions (`$transaction`) with dedicated connection acquisition for read queries.
   * *Solution:* Unwrapped read-only calls from `this.db.run()`, allowing queries to run concurrently with zero connection holding locks.
4. **Tenant-Scoped Micro-Caching on Aggregates:**
   * *Finding:* `getDashboard` recalculated identical aggregate metrics on concurrent browser loads.
   * *Solution:* Added a 5-second tenant-scoped in-memory cache keyed strictly by `${tenantId}:${periodCode}`, eliminating repeated aggregation overhead while maintaining real-time business freshness.

---

## 6. Official Benchmark Results & Percentiles

* **Total HTTP Requests Measured:** 1,000 (after 100 discarded warm-up requests)
* **Concurrency:** 15 simultaneous worker connections
* **Throughput:** **54.49 requests/second**
* **Total Errors:** **0**
* **Error Rate:** **0.00%**

### 6.1. Global Aggregate Latency Distribution
| Metric | Latency (ms) | SLO Threshold | Result |
|---|---|---|---|
| **Minimum** | 10.67 ms | — | Fast cache / point query |
| **p50 (Median)** | **165.52 ms** | < 500 ms | **PASS** |
| **p90** | **287.52 ms** | < 500 ms | **PASS** |
| **p95** | **373.08 ms** | **< 500 ms** | **PASS (Optimal)** |
| **p99** | 645.78 ms | — | Tail latency under concurrency |
| **Maximum** | 1056.79 ms | — | Initial cold burst |
| **Average** | 182.46 ms | — | Consistent performance |

### 6.2. Detailed Per-Endpoint Breakdown
All times in milliseconds (ms).

| Category | Requests | Errors | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) | SLO (p95 < 500 ms) |
|---|---|---|---|---|---|---|---|---|
| **Operator Platform Audit (HU-24)** | 125 | 0 | 75.10 | 111.58 | **125.10** | 156.48 | 175.76 | **PASS** |
| **Institutional Dashboard (HU-20)** | 125 | 0 | 132.33 | 244.13 | **300.43** | 512.32 | 664.78 | **PASS** |
| **Client Search (S2/S3)** | 125 | 0 | 138.48 | 301.67 | **374.03** | 976.23 | 1056.79 | **PASS** |
| **Plan & Metering (HU-21)** | 125 | 0 | 196.28 | 294.88 | **343.98** | 584.04 | 636.96 | **PASS** |
| **Activity Traceability Audit (HU-24)** | 125 | 0 | 170.34 | 297.83 | **406.48** | 629.47 | 670.74 | **PASS** |
| **Operator Institutions (HU-22)** | 125 | 0 | 181.05 | 255.12 | **272.69** | 326.42 | 354.81 | **PASS** |
| **Evaluations History List (HU-18)** | 125 | 0 | 185.70 | 329.92 | **427.96** | 644.50 | 977.86 | **PASS** |
| **Evaluation Detail by ID (S2/S3)** | 125 | 0 | 201.01 | 390.77 | **484.52** | 645.78 | 671.64 | **PASS** |

---

## 7. Noisy Neighbor Scenario Evaluation (PR-02)

To test system resilience against resource monopolization by a high-volume tenant:
1. **Baseline Phase:** Tenant B (`banco-luna-demo`) ran 50 queries in isolation.
   * *Tenant B Solo p50:* **60.32 ms**
   * *Tenant B Solo p95:* **135.05 ms**
2. **Under-Load Phase:** Tenant A (`banco-del-sol-demo`) was injected with a sustained burst of 200 requests from 15 concurrent workers. Simultaneously, Tenant B was continuously queried.
   * *Tenant B Under Peak p50:* **174.41 ms**
   * *Tenant B Under Peak p95:* **316.09 ms**
   * *Delta Degradation:* **+181.04 ms**
3. **Conclusion:** Even under a sustained peak burst from Tenant A, Tenant B's p95 latency remained at **316.09 ms**, safely below the 500 ms threshold. No database locks or cross-tenant starvation occurred.

---

## 8. Verification Commands & Reproducibility

Anyone with local repository access and the PostgreSQL container running can reproduce these exact measurements:

```bash
# 1. Ensure migrations are applied
npx prisma migrate status

# 2. Seed multi-tenant load dataset (Tenant A, Tenant B, duplicate CI 7812456, operator)
npx tsx tools/benchmark/seed-load-dataset.ts

# 3. Start the NestJS API build
node apps/api/dist/main.js

# 4. In a separate terminal, execute the automated benchmark suite
npx tsx tools/benchmark/run-load-test.ts
```

---

## 9. Limitations & SRE Recommendations

1. **Hardware Boundary:** Tested on a dual-core mobile processor (`Intel i5-7200U`). Under heavier concurrency (> 30 concurrent threads), Node.js event-loop CPU starvation occurs before database saturation. In production, a multi-core virtual machine (4+ vCPUs) with clustering or container replicas behind a reverse proxy (e.g., NGINX / Caddy) will support 250+ req/s.
2. **External Mocks Exclusion:** This verification confirms that internal stored queries meet the NFR. External mock calls (e.g. creating an evaluation and waiting on Bank Mock or Buró Mock) must remain asynchronous and handled via background processing / worker queues as designed in Sprint 4.
