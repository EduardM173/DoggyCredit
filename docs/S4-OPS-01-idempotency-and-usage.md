# S4-OPS-01 contract

- The billable unit is one completed `Evaluation`; source-provider retries do not create extra usage.
- A `UsageRecord` is committed with the transition to `COMPLETED` and its critical audit record. Failed and incomplete attempts do not create usage.
- There is no strict commercial quota in the approved scope. The active contracted subscription is still required to start a new evaluation; `planInterest` is not consulted.
- `INCOMPLETE` evaluations may be retried using their existing evaluation and idempotency key. A second concurrent processor observes the persisted in-progress state.
- Idempotency keys are unique within a tenant, retained on the evaluation, and paired with a SHA-256 fingerprint of canonical business input. Same key/different payload returns conflict. A deliberate new evaluation uses a new key.
- A retry after a lost response returns the persisted evaluation. Completed history is not overwritten, and completed legacy evaluations are backfilled into `UsageRecord` by the OPS-01 migration.
- The project currently defines no quota period or key-expiration policy; markers are retained for the lifetime of the evaluation rather than expiring independently.
