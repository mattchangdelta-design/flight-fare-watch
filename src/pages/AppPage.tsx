import { useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { PlanCards, type Prefill } from "@/components/PlanCards";
import { FareSearch } from "@/components/FareSearch";
import { AdminBillingSwitch } from "@/components/AdminBillingSwitch";
import { MONTHLY_FEE_TWD, getSettings } from "@/lib/flight-api";
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
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  // If the settings can't be read, assume billing is on (same default as the backend).
  const billing = settings.data?.billing_enabled ?? true;
  const [searchParams, setSearchParams] = useSearchParams();
  // Set by the ECPay return redirect (flight-ecpay-result): success | failed | unknown.
  const [purchase] = useState(() => searchParams.get("purchase"));

  useEffect(() => {
    if (!searchParams.has("purchase")) return;
    setSearchParams(
      (p) => {
        p.delete("purchase");
        return p;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // ECPay's server-to-server result can land a few seconds after the browser returns,
  // so re-read the subscriptions a few times before the badge settles on "已訂閱".
  useEffect(() => {
    if (purchase !== "success" || !user.email) return;
    const timers = [3000, 8000, 15000, 30000].map((ms) =>
      window.setTimeout(
        () => queryClient.invalidateQueries({ queryKey: ["subscriptions", user.email] }),
        ms,
      ),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [purchase, user.email, queryClient]);

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
          <Button variant="outline" onClick={signOut}>
            Sign out / 登出
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        {purchase === "success" && (
          <div className="mb-8 rounded-xl border border-border bg-accent p-4 text-sm">
            付款完成，謝謝訂閱！訂閱狀態會在幾秒內更新為「已訂閱」，確認信也會寄到你的信箱。
          </div>
        )}
        {purchase === "failed" && (
          <div className="mb-8 rounded-xl border border-destructive p-4 text-sm text-destructive">
            付款沒有完成，這次不會扣款。可以在下方按「完成付款」再試一次。
          </div>
        )}
        {purchase === "unknown" && (
          <div className="mb-8 rounded-xl border border-border p-4 text-sm">
            已從綠界返回，訂閱狀態請以下方顯示為準。
          </div>
        )}
        <h1 className="text-3xl font-bold break-all">Hi {user.email}</h1>
        <p className="mt-2 text-muted-foreground">
          先查詢目前的票價，再幫想去的航線設定目標價。
          {billing ? `訂閱後（月費 NT$${MONTHLY_FEE_TWD}），` : ""}
          只要下個月出發的來回最低價低於你的目標價，我們就會寄信通知你。
        </p>
        {user.email ? (
          <>
            {settings.data?.is_admin && (
              <div className="mt-8">
                <AdminBillingSwitch settings={settings.data} />
              </div>
            )}
            <FareSearch onPick={(plan, price) => setPrefill({ plan, price, nonce: Date.now() })} />
            <h2 className="mt-10 text-lg font-semibold">我的追蹤</h2>
            {settings.isPending ? (
              <p className="mt-4 text-muted-foreground">載入中…</p>
            ) : (
              <PlanCards email={user.email} prefill={prefill} billing={billing} />
            )}
          </>
        ) : (
          <p className="mt-8 text-destructive">這個帳號沒有 email，無法訂閱通知。</p>
        )}
      </main>
    </div>
  );
}
