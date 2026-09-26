-- Capa adicional OPCIONAL para PostgreSQL.
-- La autorización principal sigue estando en NestJS.
-- Antes de cada transacción tenant-scoped, el backend debe ejecutar:
-- SELECT set_config('app.tenant_id', '<TENANT_UUID>', true);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'TenantMembership',
    'MembershipInvitation',
    'TenantSubscription',
    'TenantIntegration',
    'FinancialProduct',
    'FinancialProductPurpose',
    'Client',
    'Evaluation',
    'EvaluationSourceResult',
    'FinancialProfile',
    'ProfileSource',
    'EvaluationRecommendation',
    'RecommendationReason',
    'UsageRecord'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true)::uuid)',
      tbl
    );
  END LOOP;
END $$;
