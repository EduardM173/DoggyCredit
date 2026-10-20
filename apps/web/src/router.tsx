import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { InstitutionRequestPage } from "./pages/InstitutionRequestPage";
import { RequestReceivedPage } from "./pages/RequestReceivedPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { AdminLayout } from "./features/admin/AdminLayout";
import { AdminLoginPage } from "./features/admin/AdminLoginPage";
import { ReviewListPage } from "./features/admin/ReviewListPage";
import { ReviewDetailPage } from "./features/admin/ReviewDetailPage";
import { ContractingPage } from "./features/contracting/ContractingPage";
import { DoggyPayPage } from "./features/contracting/DoggyPayPage";
import { AdminContractingsPage } from "./features/contracting/AdminContractingsPage";
import { InstitutionsPage } from "./features/admin/InstitutionsPage";
import { TestInboxPage } from "./features/admin/TestInboxPage";
import { ProvidersPage } from "./features/admin/ProvidersPage";
import { ActivationPage } from "./features/activation/ActivationPage";
import { InstitutionLoginPage } from "./features/institution/InstitutionLoginPage";
import { InstitutionSelectPage } from "./features/institution/InstitutionSelectPage";
import { InstitutionHomePage } from "./features/institution/InstitutionHomePage";
import { IntegrationsPage } from "./features/admin/IntegrationsPage";
import { IntegrationDetailPage } from "./features/admin/IntegrationDetailPage";
import { PasswordRecoveryPage } from "./features/password-recovery/PasswordRecoveryPage";
import { PlatformTeamPage } from "./features/admin/PlatformTeamPage";
import { OperatorActivationPage } from "./features/activation/OperatorActivationPage";

export const router = createBrowserRouter([
  { path: "/activar-cuenta", element: <ActivationPage /> },
  { path: "/activar-operador", element: <OperatorActivationPage /> },
  { path: "/iniciar-sesion", element: <InstitutionLoginPage /> },
  { path: "/recuperar-contrasena", element: <PasswordRecoveryPage /> },
  { path: "/restablecer-contrasena", element: <PasswordRecoveryPage reset /> },
  { path: "/elegir-institucion", element: <InstitutionSelectPage /> },
  { path: "/contratacion", element: <ContractingPage /> },
  { path: "/doggypay-demo", element: <DoggyPayPage /> },
  { path: "/admin/login", element: <AdminLoginPage /> },
  {
    path: "/admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <ReviewListPage /> },
      { path: "solicitudes", element: <ReviewListPage /> },
      { path: "contrataciones", element: <AdminContractingsPage /> },
      { path: "instituciones", element: <InstitutionsPage /> },
      { path: "bandeja-pruebas", element: <TestInboxPage /> },
      { path: "proveedores", element: <ProvidersPage /> },
      { path: "equipo-interno", element: <PlatformTeamPage /> },
      { path: "solicitudes/:id", element: <ReviewDetailPage /> },
      { path: "integraciones", element: <IntegrationsPage /> },
      { path: "integraciones/:code", element: <IntegrationDetailPage /> },
    ],
  },
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/solicitar-acceso", element: <InstitutionRequestPage /> },
      { path: "/solicitud-recibida", element: <RequestReceivedPage /> },
      { path: "/verificar-correo", element: <VerifyEmailPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "/:tenantSlug", element: <InstitutionHomePage /> },
  { path: "/:tenantSlug/configuracion", element: <InstitutionHomePage step="settings" /> },
  { path: "/:tenantSlug/institucion", element: <InstitutionHomePage step="institution" /> },
  { path: "/:tenantSlug/fuentes-financieras", element: <InstitutionHomePage step="source" /> },
  { path: "/:tenantSlug/productos", element: <InstitutionHomePage step="products" /> },
  { path: "/:tenantSlug/equipo", element: <InstitutionHomePage step="team" /> },
  { path: "/:tenantSlug/evaluaciones", element: <InstitutionHomePage step="evaluations" /> },
  { path: "/:tenantSlug/evaluaciones/nueva", element: <InstitutionHomePage step="new-evaluation" /> },
  { path: "/:tenantSlug/evaluaciones/:id", element: <InstitutionHomePage step="evaluation-detail" /> },
  { path: "/:tenantSlug/clientes/:clientId", element: <InstitutionHomePage step="client-dossier" /> },
  { path: "/:tenantSlug/expediente/:clientId", element: <InstitutionHomePage step="client-dossier" /> },
]);
