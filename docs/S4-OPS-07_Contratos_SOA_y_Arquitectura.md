# S4-OPS-07: SOA Architecture Contracts, Prisma Integrity & Extensibility Report

**Document ID:** S4-OPS-07-REPORT  
**Sprint:** Sprint 4  
**Date:** October 20, 2026  
**Related Requirements:** RF-01, RF-02, RF-03, RF-04, RF-05, S4-OPS-06, S4-OPS-07  
**Status:** PASS — Verified & Documented

---

## 1. Architectural Decision: Modular Monolith vs. Premature Distributed Microservices

### 1.1. Context & Problem Statement
DoggyCredit is a multi-tenant B2B SaaS platform that provides financial institutions with credit evaluation, customer dossier management, catalog recommendation, subscription metering, and operational auditability.

In enterprise software engineering, teams often prematurely decompose a nascent product into distributed microservices (e.g., Auth Service, Evaluation Service, Profile Service, Recommendations Service, Metering Service, Audit Service). For DoggyCredit, this was deliberately rejected in favor of a **Strict Modular Monolith (Service-Oriented Architecture in-process)**.

### 1.2. Decision Rationale & Tradeoff Analysis

```mermaid
graph TD
    subgraph "Distributed Microservices (Rejected)"
        MS_AUTH[Auth Microservice]
        MS_EVAL[Evaluation Microservice]
        MS_METER[Metering Microservice]
        MS_PROF[Profile Microservice]
        MS_AUTH -. Network Hop / gRPC .-> MS_EVAL
        MS_EVAL -. 2PC / Saga Network Call .-> MS_METER
        MS_EVAL -. Network Hop .-> MS_PROF
    end

    subgraph "DoggyCredit: Strict Modular Monolith (Adopted)"
        MOD_ID[Identity & Tenants Bounded Context]
        MOD_EVAL[Evaluations Bounded Context]
        MOD_INT[Financial Integrations Bounded Context]
        MOD_PROF[Financial Profile Bounded Context]
        MOD_REC[Recommendations Bounded Context]
        MOD_PLAN[Plans & Metering Bounded Context]
        MOD_AUDIT[Audit Bounded Context]

        MOD_EVAL -->|In-Process Service Call| MOD_PROF
        MOD_EVAL -->|In-Process Service Call| MOD_REC
        MOD_EVAL -->|In-Process Event / Call| MOD_PLAN
        MOD_EVAL -->|In-Process Audit Log| MOD_AUDIT
        MOD_EVAL -->|Ports & Adapters| MOD_INT
    end
```

| Evaluation Dimension | Distributed Microservices (Rejected) | Modular Monolith (Adopted in DoggyCredit) |
|---|---|---|
| **Data Consistency & Transactions** | Requires distributed 2PC or Saga patterns across databases; high risk of dual-write discrepancies between evaluations and quota meters. | Guaranteed ACID relational consistency across bounded contexts via single PostgreSQL engine. |
| **SLO Latency Impact** | Multiple HTTP/gRPC hops and network serialization would compromise the `< 500 ms p95` SLO target. | Zero network latency for inter-context calls; memory-speed service invocations. |
| **Operational Overhead** | Multi-repo or complex service meshes, container orchestration (Kubernetes), distributed tracing, multiple databases. | Single deployable unit, unified migration pipeline, deterministic local debugging via Docker. |
| **Multi-Tenant Data Isolation** | Enforced at network edges; cross-service joins require data duplication or eventual consistency. | Enforced at the database engine level via composite constraints `@@unique([tenantId, ...])`. |
| **Future Extraction Readiness** | High upfront cost. | **High extraction readiness:** Since all contexts are bounded by explicit `public.ts` contracts and ports, any module (e.g. integrations) can be extracted into a remote service if independent horizontal scaling is required. |

---

## 2. High-Level Component & Dependency Architecture

The DoggyCredit backend is structured into seven distinct Bounded Contexts. Modules communicate strictly through explicit public interfaces (`public.ts`), preventing internal implementation leakage:

```mermaid
flowchart TD
    subgraph "Presentation Layer (React Web SPA - Browser Isolated)"
        WEB_APP["React 19 / Vite SPA\n(apps/web)\nStrictly Isolated: 0 DB Drivers / 0 Connection Strings"]
    end

    subgraph "API Gateway / HTTP Controllers (NestJS)"
        CTRL_AUTH["InstitutionAuthController / AdminAuthController"]
        CTRL_EVAL["EvaluationsController / DashboardController"]
        CTRL_CLIENT["ClientsController"]
        CTRL_PLAN["TenantPlanMeteringController / PublicPlansController"]
        CTRL_AUDIT["InstitutionAuditController / PlatformAuditController"]
        CTRL_PROV["PlatformProvidersController"]
    end

    WEB_APP -->|HTTP REST / HTTPS + Cookie Auth| CTRL_AUTH
    WEB_APP -->|HTTP REST| CTRL_EVAL
    WEB_APP -->|HTTP REST| CTRL_CLIENT
    WEB_APP -->|HTTP REST| CTRL_PLAN
    WEB_APP -->|HTTP REST| CTRL_AUDIT
    WEB_APP -->|HTTP REST| CTRL_PROV

    subgraph "Domain & Application Services (Bounded Contexts)"
        subgraph "Identity & Tenants Context"
            SRV_AUTH[InstitutionAuthService]
            SRV_TENANT[InstitutionsService]
            SRV_PREP[TenantPreparationService]
        end

        subgraph "Evaluations Context"
            SRV_EVAL[EvaluationsService]
            SRV_DASH[InstitutionDashboardService]
        end

        subgraph "Financial Integrations Context (Hexagonal Ports)"
            PORT_BANK["BankMockSource (Abstract Port)"]
            PORT_BUREAU["BureauMockSource (Abstract Port)"]
            ADAPT_BANK[BankMockSourceService]
            ADAPT_BUREAU[BureauMockSourceService]
            SRV_RESIL[ResilientSourcesService / Circuit Breaker]
        end

        subgraph "Financial Profile Context"
            SRV_PROF[FinancialProfileService / Consolidator]
        end

        subgraph "Recommendations Context"
            SRV_REC[RecommendationService / Catalog]
        end

        subgraph "Plans & Metering Context"
            SRV_METER[TenantPlanMeteringService]
        end

        subgraph "Audit Context"
            SRV_AUDIT[AuditReader / AuditWriter]
        end
    end

    CTRL_EVAL --> SRV_EVAL
    CTRL_EVAL --> SRV_DASH
    SRV_EVAL --> SRV_RESIL
    SRV_RESIL --> PORT_BANK
    SRV_RESIL --> PORT_BUREAU
    PORT_BANK -. Implemented by .-> ADAPT_BANK
    PORT_BUREAU -. Implemented by .-> ADAPT_BUREAU

    SRV_EVAL --> SRV_PROF
    SRV_EVAL --> SRV_REC
    SRV_EVAL --> SRV_METER
    SRV_EVAL --> SRV_AUDIT

    subgraph "Infrastructure & Persistence Layer"
        PRISMA[PrismaClient / PostgreSQL Adapter]
        PG[(PostgreSQL 16 DB\nMulti-Tenant Relational Schema)]
    end

    SRV_AUTH --> PRISMA
    SRV_TENANT --> PRISMA
    SRV_EVAL --> PRISMA
    SRV_PROF --> PRISMA
    SRV_REC --> PRISMA
    SRV_METER --> PRISMA
    SRV_AUDIT --> PRISMA
    PRISMA --> PG
```

---

## 3. Prisma Schema Invariants & Database Integrity

Database integrity is mathematically enforced by PostgreSQL composite unique indexes, ensuring that multi-tenant isolation is uncompromised regardless of application logic bugs:

| Entity | Constraint Type | Key Definition | Business Rule Enforced |
|---|---|---|---|
| `Client` | `@@unique` | `[tenantId, documentType, documentNumber]` | A tenant cannot duplicate a client identity. Different tenants can register the same document without collision. |
| `TenantMembership` | `@@unique` | `[tenantId, userId]` | A user can hold at most one active membership per institution. |
| `TenantMembership` | `@@unique` | `[tenantId, id]` | Compound tenant foreign key reference target. |
| `FinancialProduct` | `@@unique` | `[tenantId, name]` | Product names must be distinct within the institution's catalog. |
| `Evaluation` | `@unique` | `idempotencyKey` | Platform-wide evaluation submission idempotency; prevents duplicate processing. |
| `Evaluation` | `@@unique` | `[tenantId, id]` | Guarantees all evaluation operations are strictly tenant-scoped. |
| `FinancialProfile` | `@@unique` | `[tenantId, evaluationId]` | Enforces exact 1:1 relationship between an evaluation and its financial profile. |
| `EvaluationRecommendation` | `@@unique` | `[tenantId, evaluationId, productId]` | An evaluation cannot contain duplicate recommendation records for the same product. |
| `UsageRecord` | `@unique` | `idempotencyKey` | Metering events are strictly idempotent; prevents duplicate quota deductions. |

All constraints were verified by automated integration tests in [`apps/api/src/s4-ops-07-soa-integrity.spec.ts`](file:///d:/DEV/doggycreadit/apps/api/src/s4-ops-07-soa-integrity.spec.ts). Attempting to violate any invariant consistently throws Prisma Error Code `P2002` (Unique constraint failed).

---

## 4. Hexagonal Extensibility Proof (Provider Adapter Substitution)

The platform implements the **Ports and Adapters (Hexagonal Architecture)** pattern for external data sources:
* **The Port:** `BankMockSource` abstract class in `apps/api/src/financial-integrations/public.ts`.
* **The Adapter:** `BankMockSourceService` (or any third-party provider adapter).
* **The Domain Consumer:** `FinancialProfileService` and `EvaluationsService`.

### Substitution Proof:
In [`apps/api/src/s4-ops-07-soa-integrity.spec.ts`](file:///d:/DEV/doggycreadit/apps/api/src/s4-ops-07-soa-integrity.spec.ts), an `AlternativeBankAdapter` was created implementing the `BankMockSource` interface. The adapter was queried, returning normalized financial statements (`NormalizedFinancialData`), and supplied directly to `FinancialProfileService.consolidate()`.

**Verification:**
* Debt-to-income (DTI), average monthly income, disposable income, and active credits were derived accurately.
* **Zero changes were required in `FinancialProfileService`, `EvaluationsService`, or the React frontend UI.**
* Proves that DoggyCredit is ready to ingest real Open Banking APIs (e.g., Belvo, Prometeo, or direct bank webhooks) without refactoring the financial derivation or recommendation algorithms.

---

## 5. Decision on Machine Learning (Explicit Scope Notice)

> [!IMPORTANT]
> **No Real Machine Learning is Claimed:**
> In accordance with the Kata specifications, DoggyCredit **does NOT claim to implement machine learning (ML) or artificial intelligence (AI)** in Sprint 4.
> * The scoring and recommendation engines are **deterministic, rule-based systems** based on audited financial thresholds (DTI ceiling, minimum disposable income, arrears history, and product category matching).
> * The system provides an extensible interface (`RecommendationEnginePort` / `ProfileCalculator`) that allows future plug-and-play integration of statistical ML scoring models, but all existing outputs are transparent and rule-derived.

---

## 6. Frontend Security & Credential Isolation

A security audit of `apps/web` confirmed complete isolation from database credentials:
1. **Zero Database Dependencies:** `apps/web/package.json` contains no database drivers, ORMs, or query builders (`pg`, `@prisma/client`, `typeorm`, etc.).
2. **Pure HTTP REST Communication:** All client interactions occur via asynchronous `fetch()` calls to `/api/...` routes.
3. **Zero Leaked Secrets:** Environment inspection confirmed that no database connection strings (`DATABASE_URL`), database passwords, or internal server secrets exist in the frontend bundle.
4. **Session Security:** Session tokens are delivered via `HttpOnly`, `SameSite: strict` cookies (`dc-institution-session`, `doggycredit_admin`).

---

## 7. Real Technical Debt Register

In adherence to Senior Architect principles, technical debt is documented transparently:

| # | Technical Debt Item | Architectural Impact | Proposed Mitigation / Future Sprint |
|---|---|---|---|
| **TD-01** | **Synchronous Evaluation Processing** | In `EvaluationsService.processEvaluation()`, calls to Bank Mock and Bureau Mock are executed synchronously inside the HTTP request. If a mock or real provider takes 4 seconds, the HTTP connection is blocked. | Implement an asynchronous queue (e.g. BullMQ with Redis or a transactional PostgreSQL outbox table with polling worker). |
| **TD-02** | **In-Memory Circuit Breaker State** | `CircuitBreaker` states (`CLOSED`, `OPEN`, `HALF_OPEN`) and sliding windows reside in Node.js instance memory. In a multi-replica deployment without sticky sessions, breaker states are per-instance rather than globally shared. | Persist circuit breaker health transitions in a shared state store (Redis or `TenantIntegration` database leases). |
| **TD-03** | **Deterministic Mock Control via Document Suffix** | Mock scenarios are determined by document number endings (`999` for UNAVAILABLE, `500` for ERROR, `000` for NO_DATA). While deterministic for test fixtures, it does not allow dynamic fault injection per tenant in production demos. | Add an administrative mock simulation control table for tenant-scoped chaos testing. |
| **TD-04** | **Legacy React Effect Cascades** | Linter identifies synchronous `setState` in certain legacy `useEffect` handlers in `apps/web`. | Refactor to data-fetching loaders (e.g., React Router loaders or TanStack Query). |

---

## 8. Verification & Execution Status

* **`npx prisma validate`:** Validated with 0 errors.
* **Prisma Migrations:** 16 migrations applied cleanly; database schema synchronized.
* **Automated Unit & Integration Suites:**
  * **API Tests:** 48 suites, **294 tests PASSED** (including `s4-ops-07-soa-integrity.spec.ts`).
  * **Web Tests:** 25 suites, **175 tests PASSED**.
  * **Total Workspace Test Count:** **469 tests passing 100%**.
