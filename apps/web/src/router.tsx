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

export const router = createBrowserRouter([
  { path: "/admin/login", element: <AdminLoginPage /> },
  {
    path: "/admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <ReviewListPage /> },
      { path: "solicitudes", element: <ReviewListPage /> },
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
