import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RoutePicker, type RouteValue } from "@/components/RoutePicker";
import { ConditionFields } from "@/components/ConditionFields";
import { MatchPreview } from "@/components/MatchPreview";
import {
  compact,
  defaultConditions,
  fromStored,
  summary,
  todayYmd,
  validate,
  type Conditions,
} from "@/lib/conditions";
import {
  MAX_ROUTES,
  MONTHLY_FEE_TWD,
  ORIGINS,
  cancelSubscription,
  deleteSubscription,
  displayStatus,
  goToCheckout,
  listSubscriptions,
  routeInfo,
  routeLabel,
  saveSubscription,
  type RouteInfo,
  type Subscription,
  type SubscriptionStatus,
} from "@/lib/flight-api";

/** A route + target price picked from the fare search; `nonce` makes repeat picks re-apply. */
export type Prefill = { route: RouteInfo; price: number; conditions: Conditions; nonce: number };

const HINT = "依下面的條件，找到最便宜的來回票低於目標價時就寄信通知你";

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
  free: { label: "追蹤中", variant: "default" },
};

function PlanCard({
  info,
  email,
  sub,
  prefill,
  billing,
}: {
  info: RouteInfo;
  email: string;
  sub: Subscription | undefined;
  prefill: Prefill | null;
  billing: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sub ? String(sub.target_price) : "");
  const [cond, setCond] = useState<Conditions>(() => fromStored(sub?.conditions));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"cancel" | "delete" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const status = sub ? displayStatus(sub, billing) : undefined;
  // Paying subscribers change the target in place; with billing on everyone else goes through checkout.
  const paying = status === "active" || status === "cancelled";
  const needsCheckout = billing && !paying;

  // Only react to picks made while this card exists (a route just added from a pick must not reopen).
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    if (!prefill || prefill.route.route !== info.route || prefill.nonce < mountedAt.current) return;
    setValue(String(prefill.price));
    setCond(prefill.conditions);
    setEditing(true);
    setError(null);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [prefill, info.route]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["subscriptions", email] });

  const save = useMutation({
    mutationFn: (target: number) =>
      saveSubscription({ route: info.route, target_price: target, conditions: compact(cond) }),
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
    mutationFn: () => cancelSubscription(info.route),
    onSuccess: async () => {
      setConfirming(null);
      setError(null);
      await refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const removal = useMutation({
    mutationFn: () => deleteSubscription(info.route),
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
    const err = validate(cond, { future: true });
    if (err) return setError(err);
    save.mutate(Math.round(n));
  }

  function startEdit() {
    setValue(String(sub?.target_price ?? ""));
    setCond(fromStored(sub?.conditions));
    setEditing(true);
    setConfirming(null);
    setError(null);
  }

  const showForm = !sub || editing;
  const inputId = `target-${info.route}`;
  const until = sub?.current_period_end_date;
  const stored = sub?.conditions?.["date_from"] ? (sub.conditions as Partial<Conditions>) : null;
  // The tracked dates are all in the past: no fare can match any more.
  const rangeOver = Boolean(stored?.date_to && stored.date_to < todayYmd());

  return (
    <div ref={cardRef} className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
            <Plane className="h-5 w-5 text-primary-glow" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{routeLabel(info)}</h2>
            <p className="text-xs text-muted-foreground">{info.route} · 來回</p>
          </div>
        </div>
        {status && <Badge variant={BADGE[status].variant}>{BADGE[status].label}</Badge>}
      </div>

      {sub && status && !editing && (
        <div className="mt-6">
          <p className="text-sm text-muted-foreground">目前目標價</p>
          <p className="text-2xl font-bold">{fmt(sub.target_price)}</p>
          <p className="mt-1 text-sm">
            <span className="text-muted-foreground">條件：</span>
            {stored ? summary(stored) : "下個月任何時間（尚未設定條件）"}
          </p>
          {rangeOver && (
            <p className="mt-2 rounded-lg border border-amber-500/50 p-2 text-sm text-amber-500">
              追蹤期間已過，不會再收到通知。請按「更新目標價與條件」設定新的日期
              {status === "active" ? "；月費仍會照常扣款，不需要的話請取消續訂" : ""}。
            </p>
          )}

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
          {status === "free" && (
            <p className="mt-2 text-sm text-muted-foreground">
              目前免費開放，票價達標就會寄信通知你。
            </p>
          )}

          {confirming === "cancel" ? (
            <div className="mt-4 space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm">
                確定要取消{routeLabel(info)}的續訂嗎？之後不會再扣款，
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
              <p className="text-sm">確定要刪除{routeLabel(info)}這筆追蹤嗎？</p>
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
                className={paying || status === "free" ? "flex-1" : undefined}
                disabled={busy}
                onClick={startEdit}
              >
                更新目標價與條件
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
          <p className="text-xs text-muted-foreground">{HINT}</p>
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <ConditionFields value={cond} onChange={setCond} idPrefix={`c-${info.route}`} />
          </div>
          <MatchPreview route={info.route} conditions={cond} target={Number(value) || undefined} />
          {needsCheckout && (
            <p className="text-xs text-muted-foreground">
              送出後前往綠界以信用卡付款，月費 {fee}，每月自動扣款，可隨時取消續訂。
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy}>
              {save.isPending
                ? needsCheckout
                  ? "前往付款…"
                  : "儲存中…"
                : needsCheckout
                  ? "訂閱並付款"
                  : sub
                    ? "儲存"
                    : "開始追蹤"}
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

/** "新增追蹤": pick a Taiwan origin + any destination and a target price. */
function AddRouteCard({
  email,
  billing,
  full,
  prefill,
  tracked,
}: {
  email: string;
  billing: boolean;
  full: boolean;
  prefill: Prefill | null;
  tracked: Set<string>;
}) {
  const queryClient = useQueryClient();
  const [route, setRoute] = useState<RouteValue>({ origin: ORIGINS[0]!, destination: null });
  const [value, setValue] = useState("");
  const [cond, setCond] = useState<Conditions>(defaultConditions);
  const applied = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Apply each pick once (the parent re-renders often and `tracked` is rebuilt every time).
    if (!prefill || prefill.nonce === applied.current || tracked.has(prefill.route.route)) return;
    applied.current = prefill.nonce;
    const [o, d = ""] = prefill.route.route.split("-");
    setRoute({
      origin: ORIGINS.find((x) => x.code === o) ?? ORIGINS[0]!,
      destination: { code: d, name: prefill.route.destinationName },
    });
    setValue(String(prefill.price));
    setCond(prefill.conditions);
    setError(null);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [prefill, tracked]);

  const save = useMutation({
    mutationFn: (v: { route: string; target: number }) =>
      saveSubscription({ route: v.route, target_price: v.target, conditions: compact(cond) }),
    onSuccess: async (res) => {
      if (res.kind === "checkout") {
        goToCheckout(res.html);
        return;
      }
      setRoute({ origin: ORIGINS[0]!, destination: null });
      setValue("");
      setCond(defaultConditions());
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["subscriptions", email] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!route.destination) return setError("請從清單選擇目的地");
    const code = `${route.origin.code}-${route.destination.code}`;
    if (tracked.has(code)) return setError("這條航線已經在追蹤了，可以直接更新它的目標價");
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return setError("請輸入大於 0 的新台幣金額");
    const err = validate(cond, { future: true });
    if (err) return setError(err);
    save.mutate({ route: code, target: Math.round(n) });
  }

  if (full) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
        最多可以追蹤 {MAX_ROUTES} 條航線。想換一條，請先刪除或取消其中一條。
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="rounded-2xl border border-dashed border-border bg-card p-6 sm:col-span-2"
    >
      <h3 className="text-lg font-semibold">新增追蹤</h3>
      <p className="text-xs text-muted-foreground">
        從台灣出發、目的地不限 · 最多 {MAX_ROUTES} 條航線
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <RoutePicker value={route} onChange={setRoute} />
        <div className="space-y-2">
          <Label htmlFor="new-target">目標價（新台幣）</Label>
          <Input
            id="new-target"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="例如 10000"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{HINT}</p>
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <ConditionFields value={cond} onChange={setCond} idPrefix="new" />
          </div>
          <MatchPreview
            route={route.destination ? `${route.origin.code}-${route.destination.code}` : null}
            conditions={cond}
            target={Number(value) || undefined}
          />
          {billing && (
            <p className="text-xs text-muted-foreground">
              送出後前往綠界以信用卡付款，每條航線月費 {fee}，每月自動扣款，可隨時取消續訂。
            </p>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={save.isPending}>
          {save.isPending
            ? billing
              ? "前往付款…"
              : "儲存中…"
            : billing
              ? "訂閱並付款"
              : "開始追蹤"}
        </Button>
      </form>
    </div>
  );
}

export function PlanCards({
  email,
  prefill,
  billing,
}: {
  email: string;
  prefill: Prefill | null;
  billing: boolean;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["subscriptions", email],
    queryFn: () => listSubscriptions(),
  });

  if (isLoading) return <p className="mt-8 text-muted-foreground">載入訂閱中…</p>;
  if (isError)
    return <p className="mt-8 text-destructive">無法載入訂閱：{(error as Error).message}</p>;

  const subs = data ?? [];
  const tracked = new Set(subs.map((s) => s.route));
  return (
    <div className="mt-4 grid gap-6 sm:grid-cols-2">
      {subs.length === 0 && (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          還沒有追蹤任何航線。可以先在上面查詢票價，再按「設為目標價」，或直接在下面新增。
        </p>
      )}
      {subs.map((sub) => (
        <PlanCard
          key={sub.route}
          info={routeInfo(sub.route, sub.origin_name, sub.destination_name)}
          email={email}
          sub={sub}
          prefill={prefill}
          billing={billing}
        />
      ))}
      <AddRouteCard
        email={email}
        billing={billing}
        full={subs.length >= MAX_ROUTES}
        prefill={prefill}
        tracked={tracked}
      />
    </div>
  );
}
