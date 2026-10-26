import type { RouteObject } from "react-router";
import { RootLayout } from "@/components/RootLayout";
import { RequireAuth } from "@/components/RequireAuth";
import { ErrorPage, NotFoundPage } from "@/components/ErrorPages";
import { Index } from "@/pages/Index";
import { SignIn } from "@/pages/SignIn";
import { SignUp } from "@/pages/SignUp";
import { AppPage } from "@/pages/AppPage";
import { ForgotPassword } from "@/pages/ForgotPassword";
import { ResetPassword } from "@/pages/ResetPassword";

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "/", element: <Index /> },
      { path: "/signin", element: <SignIn /> },
      { path: "/signup", element: <SignUp /> },
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/reset-password", element: <ResetPassword /> },
      {
        element: <RequireAuth />,
        children: [{ path: "/app", element: <AppPage /> }],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
