import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { airlineName } from "@/lib/airlines";
import {
  ORIGINS,
  routeInfo,
  routeLabel,
  searchFares,
  type Fare,
  type FareSearchResult,
  type FunnelStage,
  type RouteInfo,
} from "@/lib/flight-api";
import { RoutePicker, type RouteValue } from "@/components/RoutePicker";
import { ConditionFields } from "@/components/ConditionFields";
import { defaultConditions, fromStored, validate, type Conditions } from "@/lib/conditions";

const WEEK = "日一二三四五六";

/** '2026-11-03T06:50:00+08:00' -> '11/3（二）06:50', in the timestamp's own (local) offset. */
function when(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)].map(Number) as [
    number,
    number,
    number,
  ];
  const wd = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}（${wd}）${iso.slice(11, 16)}`;
}
const time = (iso: string | null) => (iso ? iso.slice(11, 16) : "—");
const nextDay = (a: string | null, b: string | null) =>
  a && b && b.slice(0, 10) !== a.slice(0, 10) ? "+1" : "";
const stops = (n: number | null) => (n == null ? "" : n === 0 ? "直飛" : `轉機 ${n} 次`);

const MISS: Record<FunnelStage, string> = {
  total: "",
  dates: "出發日期不在範圍內",
  dep_time: "去程時段不符",
  nights: "停留晚數不符",
  ret_time: "回程時段不符",
};

const STAGE: Record<FunnelStage, string> = {
  total: "查詢月份共",
  dates: "出發日期內",
  dep_time: "去程時段內",
  nights: "停留晚數符合",
  ret_time: "回程時段符合",
};

const monthLabel = (m: string) => `${Number(m.slice(5, 7))} 月`;

/** "11 月共 9 筆 → 出發日期內 5 → 去程時段內 2 → 回程時段符合 0", with the step that empties it highlighted. */
function Funnel({ data }: { data: FareSearchResult }) {
  const steps = data.funnel ?? [];
  if (steps.length === 0) return null;
  const months = (data.months ?? []).map(monthLabel).join("、");
  const firstZero = steps.findIndex(
    (s, i) => i > 0 && s.count === 0 && (steps[i - 1]?.count ?? 0) > 0,
  );
  return (
    <div className="mb-4 rounded-xl bg-accent/40 p-3 text-sm">
      <p className="mb-1 text-xs text-muted-foreground">篩選過程</p>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {steps.map((s, i) => (
          <span key={s.stage} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span className={i === firstZero ? "font-semibold text-destructive" : undefined}>
              {s.stage === "total" ? `${months || "查詢月份"} 共` : STAGE[s.stage]} {s.count} 筆
            </span>
          </span>
        ))}
      </p>
      {firstZero > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          是「{STAGE[steps[firstZero]!.stage].replace(/內|符合/, "")}
          」這個條件把結果篩光了，可以先放寬它。
        </p>
      )}
    </div>
  );
}

function FareRow({
  fare,
  rank,
  onPick,
}: {
  fare: Fare;
  rank: number;
  onPick: (price: number) => void;
}) {
  const fn = fare.flight_number ? `${fare.airline ?? ""} ${fare.flight_number}`.trim() : null;
  return (
    <li className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {fare.miss ? (
            <p className="text-xs font-medium text-amber-500">{MISS[fare.miss]}</p>
          ) : (
            <p className="text-xs text-muted-foreground">#{rank}</p>
          )}
          <p className="text-xl font-bold">NT${fare.price.toLocaleString("en-US")}</p>
          <p className="text-sm text-muted-foreground">
            {airlineName(fare.airline)}
            {fn ? ` · ${fn}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button size="sm" onClick={() => onPick(fare.price)}>
            設為目標價
          </Button>
          {fare.link && (
            <a
              href={fare.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary-glow hover:underline"
            >
              查看 <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1 text-sm">
        <dt className="text-muted-foreground">去程</dt>
        <dd>
          {when(fare.departure_at)} {fare.origin_airport ?? ""} → {time(fare.arrival_at)}
          {nextDay(fare.departure_at, fare.arrival_at)} {fare.destination_airport ?? ""}{" "}
          <span className="text-muted-foreground">{stops(fare.transfers)}</span>
        </dd>
        <dt className="text-muted-foreground">回程</dt>
        <dd>
          {fare.return_at ? (
            <>
              {when(fare.return_at)} → {time(fare.return_arrival_at)}
              {nextDay(fare.return_at, fare.return_arrival_at)}{" "}
              <span className="text-muted-foreground">{stops(fare.return_transfers)}</span>
            </>
          ) : (
            "—"
          )}
        </dd>
      </dl>
    </li>
  );
}

export function FareSearch({
  onPick,
}: {
  onPick: (route: RouteInfo, price: number, conditions: Conditions) => void;
}) {
  const [route, setRoute] = useState<RouteValue>({
    origin: ORIGINS[0]!,
    destination: { code: "TYO", name: "東京" },
  });
  const [cond, setCond] = useState<Conditions>(defaultConditions);
  const [formError, setFormError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: searchFares,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!route.destination) return setFormError("請從清單選擇目的地");
    const err = validate(cond);
    if (err) return setFormError(err);
    search.mutate({ route: `${route.origin.code}-${route.destination.code}`, ...cond });
  }

  const results = search.data?.results ?? [];
  // The route + conditions the shown results belong to (the form may have changed since).
  const searched = search.variables
    ? routeInfo(search.variables.route, search.data?.origin_name, search.data?.destination_name)
    : null;
  const searchedCond = search.variables ? fromStored(search.variables) : cond;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">查詢目前票價</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        先看看指定日期、出發時段和行程天數的最低來回票價，再決定目標價。按「設為目標價」會連同這些條件一起帶到追蹤。
      </p>

      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <RoutePicker value={route} onChange={setRoute} />
        </div>
        <ConditionFields value={cond} onChange={setCond} idPrefix="fs" />
        <div className="sm:col-span-2">
          {formError && <p className="mb-2 text-sm text-destructive">{formError}</p>}
          <Button type="submit" className="w-full" disabled={search.isPending}>
            <Search className="h-4 w-4" />
            {search.isPending ? "查詢中…" : "查詢前 10 名最低價"}
          </Button>
        </div>
      </form>

      {search.isError && (
        <p className="mt-4 text-sm text-destructive">查詢失敗：{search.error.message}</p>
      )}

      {search.isSuccess && (
        <div className="mt-6">
          {(results.length < 10 || (search.data.funnel?.length ?? 0) > 2) && (
            <Funnel data={search.data} />
          )}
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search.data.scanned === 0
                ? "這條航線在這段期間目前沒有任何票價資料（比較冷門的航線常常如此），可以換個月份或目的地試試。"
                : "沒有完全符合條件的票。"}
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                {searched ? `${routeLabel(searched)}：` : ""}找到 {results.length} 筆（依價格排序）
                {results.length < 10 ? "，這個條件目前只有這些資料" : ""}
                {search.data.partial ? "；部分月份查詢失敗，結果可能不完整" : ""}
              </p>
              <ol className="space-y-3">
                {results.map((f, i) => (
                  <FareRow
                    key={`${f.departure_at}-${f.return_at}-${f.flight_number}-${i}`}
                    fare={f}
                    rank={i + 1}
                    onPick={(price) => searched && onPick(searched, price, searchedCond)}
                  />
                ))}
              </ol>
            </>
          )}
          {(search.data.near?.length ?? 0) > 0 && (
            <div className="mt-6">
              <p className="mb-3 text-sm font-medium">
                接近的結果
                <span className="ml-1 font-normal text-muted-foreground">
                  （只差一個條件，標示的是不符合的那一項）
                </span>
              </p>
              <ol className="space-y-3">
                {search.data.near!.map((f, i) => (
                  <FareRow
                    key={`near-${f.departure_at}-${f.return_at}-${f.flight_number}-${i}`}
                    fare={f}
                    rank={i + 1}
                    onPick={(price) => searched && onPick(searched, price, searchedCond)}
                  />
                ))}
              </ol>
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            票價是 Travelpayouts 彙整近 48
            小時其他旅客搜尋到的快取資料，不是即時報價，實際價格以訂購頁面為準。時間為各機場當地時間；停留晚數以去程與回程的當地日期計算（例如
            11/3 去、11/7 回是 4 晚，即 5 天 4 夜）。
            追蹤時會用你設定的條件比對，所以通知的票跟這裡查到的一致。
          </p>
        </div>
      )}
    </section>
  );
}
