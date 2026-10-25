import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
        <div className="mt-8 rounded-2xl border border-border bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
            <LayoutDashboard className="h-6 w-6 text-primary-glow" />
          </div>
          <p className="text-lg font-medium">你的航線追蹤儀表板即將上線 — 下一個里程碑會加上訂閱航線的功能。</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your dashboard is coming soon. Route-subscription will be added in the next milestone.
          </p>
        </div>
      </main>
    </div>
  );
}
