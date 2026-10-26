import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PLANS,
  deleteSubscription,
  listSubscriptions,
  saveSubscription,
  type Plan,
  type Subscription,
} from "@/lib/flight-api";

const fmt = (n: number) => `NT$${n.toLocaleString("en-US")}`;

function PlanCard({
  plan,
  email,
  sub,
}: {
  plan: Plan;
  email: string;
  sub: Subscription | undefined;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sub ? String(sub.target_price) : "");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (target: number) =>
      saveSubscription({ email, plan_name: plan.name, target_price: target }),
    onSuccess: async () => {
      setEditing(false);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["subscriptions", email] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const removal = useMutation({
    mutationFn: () => deleteSubscription(email, plan.name),
    onSuccess: async () => {
      setConfirmingDelete(false);
      setError(null);
      setValue("");
      await queryClient.invalidateQueries({ queryKey: ["subscriptions", email] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError("請輸入大於 0 的新台幣金額");
      return;
    }
    mutation.mutate(Math.round(n));
  }

  const showForm = !sub || editing;
  const inputId = `target-${plan.name}`;

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
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
        {sub && <Badge>已訂閱</Badge>}
      </div>

      {sub && !editing && (
        <div className="mt-6">
          <p className="text-sm text-muted-foreground">目前目標價</p>
          <p className="text-2xl font-bold">{fmt(sub.target_price)}</p>
          {confirmingDelete ? (
            <div className="mt-4 space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm">
                確定要取消追蹤{plan.label}嗎？之後不會再收到這條航線的通知。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={removal.isPending}
                  onClick={() => removal.mutate()}
                >
                  {removal.isPending ? "取消中…" : "確定取消"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={removal.isPending}
                  onClick={() => setConfirmingDelete(false)}
                >
                  保留
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setValue(String(sub.target_price));
                  setEditing(true);
                }}
              >
                更新目標價
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
                取消訂閱
              </Button>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={mutation.isPending}>
              {mutation.isPending ? "儲存中…" : sub ? "儲存" : "開始追蹤"}
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

export function PlanCards({ email }: { email: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["subscriptions", email],
    queryFn: () => listSubscriptions(email),
  });

  if (isLoading) return <p className="mt-8 text-muted-foreground">載入訂閱中…</p>;
  if (isError)
    return <p className="mt-8 text-destructive">無法載入訂閱：{(error as Error).message}</p>;

  const byRoute = new Map((data ?? []).map((s) => [s.route, s]));
  return (
    <div className="mt-8 grid gap-6 sm:grid-cols-2">
      {PLANS.map((plan) => (
        <PlanCard key={plan.name} plan={plan} email={email} sub={byRoute.get(plan.route)} />
      ))}
    </div>
  );
}
