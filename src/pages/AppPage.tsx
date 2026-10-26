import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PlanCards } from "@/components/PlanCards";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { useAuthUser } from "@/components/RequireAuth";
import { usePageMeta } from "@/hooks/use-page-meta";

export function AppPage() {
  usePageMeta({
    title: "Dashboard — Flight Price Notifier",
    description: "Your flight price tracking dashboard.",
    ogTitle: "Dashboard — Flight Price Notifier",
    ogDescription: "Your flight price tracking dashboard.",
    twitterCard: "summary",
  });
  const user = useAuthUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate("/signin", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Button variant="outline" onClick={signOut}>Sign out / 登出</Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-bold break-all">Hi {user.email}</h1>
        <p className="mt-2 text-muted-foreground">
          選一條航線、設定目標價，下個月的來回最低價一達標，我們就寄信通知你。
        </p>
        {user.email ? (
          <PlanCards email={user.email} />
        ) : (
          <p className="mt-8 text-destructive">這個帳號沒有 email，無法訂閱通知。</p>
        )}
      </main>
    </div>
  );
}
