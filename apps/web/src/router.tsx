import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { InstitutionRequestPage } from "./pages/InstitutionRequestPage";
import { RequestReceivedPage } from "./pages/RequestReceivedPage";
import { LoginPendingPage } from "./pages/LoginPendingPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { AdminLayout } from "./features/admin/AdminLayout";
import { AdminLoginPage } from "./features/admin/AdminLoginPage";
import { ReviewListPage } from "./features/admin/ReviewListPage";
import { ReviewDetailPage } from "./features/admin/ReviewDetailPage";
import { ContractingPage } from "./features/contracting/ContractingPage";
import { DoggyPayPage } from "./features/contracting/DoggyPayPage";
import { AdminContractingsPage } from "./features/contracting/AdminContractingsPage";
import { InstitutionsPage } from "./features/admin/InstitutionsPage";
import { ActivationPage } from "./features/activation/ActivationPage";

export const router = createBrowserRouter([
  { path: "/activar-cuenta", element: <ActivationPage /> },
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
      { path: "solicitudes/:id", element: <ReviewDetailPage /> },
    ],
  },
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/solicitar-acceso", element: <InstitutionRequestPage /> },
      { path: "/solicitud-recibida", element: <RequestReceivedPage /> },
      { path: "/verificar-correo", element: <VerifyEmailPage /> },
      { path: "/iniciar-sesion", element: <LoginPendingPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
