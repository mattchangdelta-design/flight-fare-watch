import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MONTHLY_FEE_TWD,
  PLANS,
  cancelSubscription,
  deleteSubscription,
  effectiveStatus,
  goToCheckout,
  listSubscriptions,
  saveSubscription,
  type Plan,
  type PlanName,
  type Subscription,
  type SubscriptionStatus,
} from "@/lib/flight-api";

/** A target price picked from the fare search; `nonce` makes repeat picks of the same price re-apply. */
export type Prefill = { plan: PlanName; price: number; nonce: number };

const fmt = (n: number) => `NT$${n.toLocaleString("en-US")}`;
const fee = `${fmt(MONTHLY_FEE_TWD)} / 月`;

const BADGE: Record<
  SubscriptionStatus,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  active: { label: "已訂閱", variant: "default" },
  pending_payment: { label: "未完成付款", variant: "outline" },
  cancelled: { label: "已取消續訂", variant: "secondary" },
  expired: { label: "已結束", variant: "secondary" },
};

function PlanCard({
  plan,
  email,
  sub,
  prefill,
}: {
  plan: Plan;
  email: string;
  sub: Subscription | undefined;
  prefill: Prefill | null;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sub ? String(sub.target_price) : "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"cancel" | "delete" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const status = sub ? effectiveStatus(sub) : undefined;
  // Paying subscribers change the target in place; everyone else goes through checkout.
  const paying = status === "active" || status === "cancelled";

  useEffect(() => {
    if (!prefill || prefill.plan !== plan.name) return;
    setValue(String(prefill.price));
    setEditing(true);
    setError(null);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [prefill, plan.name]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["subscriptions", email] });

  const save = useMutation({
    mutationFn: (target: number) =>
      saveSubscription({ plan_name: plan.name, target_price: target }),
    onSuccess: async (res) => {
      if (res.kind === "checkout") {
        goToCheckout(res.html);
        return;
      }
      setEditing(false);
      setError(null);
      await refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const cancel = useMutation({
    mutationFn: () => cancelSubscription(plan.name),
    onSuccess: async () => {
      setConfirming(null);
      setError(null);
      await refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const removal = useMutation({
    mutationFn: () => deleteSubscription(plan.name),
    onSuccess: async () => {
      setConfirming(null);
      setError(null);
      setValue("");
      await refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const busy = save.isPending || cancel.isPending || removal.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError("請輸入大於 0 的新台幣金額");
      return;
    }
    save.mutate(Math.round(n));
  }

  function startEdit() {
    setValue(String(sub?.target_price ?? ""));
    setEditing(true);
    setConfirming(null);
    setError(null);
  }

  const showForm = !sub || editing;
  const inputId = `target-${plan.name}`;
  const until = sub?.current_period_end_date;

  return (
    <div ref={cardRef} className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
            <Plane className="h-5 w-5 text-primary-glow" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{plan.label}</h2>
            <p className="text-xs text-muted-foreground">{plan.route} · 下個月出發 · 來回</p>
          </div>
        </div>
        {status && <Badge variant={BADGE[status].variant}>{BADGE[status].label}</Badge>}
      </div>

      {sub && status && !editing && (
        <div className="mt-6">
          <p className="text-sm text-muted-foreground">目前目標價</p>
          <p className="text-2xl font-bold">{fmt(sub.target_price)}</p>

          {status === "active" && until && (
            <p className="mt-2 text-sm text-muted-foreground">
              月費 {fee} · 本期有效至 {until}，到期自動續訂
            </p>
          )}
          {status === "cancelled" && (
            <p className="mt-2 text-sm text-muted-foreground">
              已取消續訂，不會再扣款。{until ? `${until} 前` : "本期結束前"}仍會照常通知你。
            </p>
          )}
          {status === "pending_payment" && (
            <p className="mt-2 text-sm text-muted-foreground">
              付款完成後才會開始寄送降價通知（{fee}）。
            </p>
          )}
          {status === "expired" && (
            <p className="mt-2 text-sm text-muted-foreground">訂閱已結束，不會再收到通知。</p>
          )}

          {confirming === "cancel" ? (
            <div className="mt-4 space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm">
                確定要取消{plan.label}的續訂嗎？之後不會再扣款，
                {until ? `${until} 前` : "本期結束前"}仍會收到通知。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => cancel.mutate()}
                >
                  {cancel.isPending ? "取消中…" : "確定取消續訂"}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                  保留
                </Button>
              </div>
            </div>
          ) : confirming === "delete" ? (
            <div className="mt-4 space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm">確定要刪除{plan.label}這筆追蹤嗎？</p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => removal.mutate()}
                >
                  {removal.isPending ? "刪除中…" : "確定刪除"}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                  保留
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {status === "pending_payment" && (
                <Button
                  className="flex-1"
                  disabled={busy}
                  onClick={() => save.mutate(sub.target_price)}
                >
                  {save.isPending ? "前往付款…" : "完成付款"}
                </Button>
              )}
              {status === "expired" && (
                <Button
                  className="flex-1"
                  disabled={busy}
                  onClick={() => save.mutate(sub.target_price)}
                >
                  {save.isPending ? "前往付款…" : "重新訂閱"}
                </Button>
              )}
              <Button
                variant="outline"
                className={paying ? "flex-1" : undefined}
                disabled={busy}
                onClick={startEdit}
              >
                更新目標價
              </Button>
              {status === "active" && (
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming("cancel")}>
                  取消訂閱
                </Button>
              )}
              {!paying && (
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming("delete")}>
                  刪除
                </Button>
              )}
            </div>
          )}
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <Label htmlFor={inputId}>目標價（新台幣）</Label>
          <Input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="例如 10000"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{plan.hint}</p>
          {!paying && (
            <p className="text-xs text-muted-foreground">
              送出後前往綠界以信用卡付款，月費 {fee}，每月自動扣款，可隨時取消續訂。
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy}>
              {save.isPending ? (paying ? "儲存中…" : "前往付款…") : paying ? "儲存" : "訂閱並付款"}
            </Button>
            {sub && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                取消
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

export function PlanCards({ email, prefill }: { email: string; prefill: Prefill | null }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["subscriptions", email],
    queryFn: () => listSubscriptions(),
  });

  if (isLoading) return <p className="mt-8 text-muted-foreground">載入訂閱中…</p>;
  if (isError)
    return <p className="mt-8 text-destructive">無法載入訂閱：{(error as Error).message}</p>;

  const byRoute = new Map((data ?? []).map((s) => [s.route, s]));
  return (
    <div className="mt-4 grid gap-6 sm:grid-cols-2">
      {PLANS.map((plan) => (
        <PlanCard
          key={plan.name}
          plan={plan}
          email={email}
          sub={byRoute.get(plan.route)}
          prefill={prefill}
        />
      ))}
    </div>
  );
}
