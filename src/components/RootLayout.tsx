import { useEffect } from "react";
import { Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function RootLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") queryClient.invalidateQueries();
      // A reset link may land on the Site URL instead of /reset-password; send it to the form.
      if (event === "PASSWORD_RECOVERY" && pathname !== "/reset-password")
        navigate("/reset-password", { replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient, navigate, pathname]);

  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}
