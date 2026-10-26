import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { airlineName } from "@/lib/airlines";
import { PLANS, searchFares, type Fare, type PlanName } from "@/lib/flight-api";

const WEEK = "日一二三四五六";
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const TRIP_DAYS = Array.from({ length: 14 }, (_, i) => String(i + 1));
const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function nextMonthRange() {
  const now = new Date();
  return {
    from: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    to: ymd(new Date(now.getFullYear(), now.getMonth() + 2, 0)),
  };
}

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
          <p className="text-xs text-muted-foreground">#{rank}</p>
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

export function FareSearch({ onPick }: { onPick: (plan: PlanName, price: number) => void }) {
  const range = nextMonthRange();
  const [plan, setPlan] = useState<PlanName>("tokyo");
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const [timeFrom, setTimeFrom] = useState("00:00");
  const [timeTo, setTimeTo] = useState("23:59");
  const [tripMin, setTripMin] = useState("");
  const [tripMax, setTripMax] = useState("");
  const [retFrom, setRetFrom] = useState("");
  const [retTo, setRetTo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: searchFares,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (dateTo < dateFrom) return setFormError("結束日期要在開始日期之後");
    if ((Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000 > 92)
      return setFormError("日期區間最多 3 個月");
    if (timeTo < timeFrom) return setFormError("出發時段的結束時間要晚於開始時間");
    if (tripMin && tripMax && Number(tripMax) < Number(tripMin))
      return setFormError("停留晚數的上限要大於或等於下限");
    if (retFrom && retTo && retTo < retFrom)
      return setFormError("回程時段的結束時間要晚於開始時間");
    search.mutate({
      plan_name: plan,
      date_from: dateFrom,
      date_to: dateTo,
      time_from: timeFrom,
      time_to: timeTo,
      trip_min: tripMin,
      trip_max: tripMax,
      ret_time_from: retFrom,
      ret_time_to: retTo,
    });
  }

  const results = search.data?.results ?? [];
  const searchedPlan = search.variables?.plan_name ?? plan;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">查詢目前票價</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        先看看指定日期、出發時段和行程天數的最低來回票價，再決定目標價。
      </p>

      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="fs-plan">航線</Label>
          <select
            id="fs-plan"
            className={selectClass}
            value={plan}
            onChange={(e) => setPlan(e.target.value as PlanName)}
          >
            {PLANS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fs-from">出發日期（從）</Label>
          <Input
            id="fs-from"
            type="date"
            required
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fs-to">出發日期（到）</Label>
          <Input
            id="fs-to"
            type="date"
            required
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fs-tfrom">出發時段（從）</Label>
          <select
            id="fs-tfrom"
            className={selectClass}
            value={timeFrom}
            onChange={(e) => setTimeFrom(e.target.value)}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fs-tto">出發時段（到）</Label>
          <select
            id="fs-tto"
            className={selectClass}
            value={timeTo}
            onChange={(e) => setTimeTo(e.target.value)}
          >
            {[...HOURS.slice(1), "23:59"].map((h) => (
              <option key={h} value={h}>
                {h === "23:59" ? "24:00" : h}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 pt-2">
          <p className="text-sm font-medium">回程條件（選填）</p>
          <p className="text-xs text-muted-foreground">不填就不限制。條件越多，符合的票越少。</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fs-nmin">停留晚數（最少）</Label>
          <select
            id="fs-nmin"
            className={selectClass}
            value={tripMin}
            onChange={(e) => setTripMin(e.target.value)}
          >
            <option value="">不限</option>
            {TRIP_DAYS.map((n) => (
              <option key={n} value={n}>
                {n} 晚（{Number(n) + 1} 天）
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fs-nmax">停留晚數（最多）</Label>
          <select
            id="fs-nmax"
            className={selectClass}
            value={tripMax}
            onChange={(e) => setTripMax(e.target.value)}
          >
            <option value="">不限</option>
            {TRIP_DAYS.map((n) => (
              <option key={n} value={n}>
                {n} 晚（{Number(n) + 1} 天）
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fs-rfrom">回程出發時段（從）</Label>
          <select
            id="fs-rfrom"
            className={selectClass}
            value={retFrom}
            onChange={(e) => setRetFrom(e.target.value)}
          >
            <option value="">不限</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fs-rto">回程出發時段（到）</Label>
          <select
            id="fs-rto"
            className={selectClass}
            value={retTo}
            onChange={(e) => setRetTo(e.target.value)}
          >
            <option value="">不限</option>
            {[...HOURS.slice(1), "23:59"].map((h) => (
              <option key={h} value={h}>
                {h === "23:59" ? "24:00" : h}
              </option>
            ))}
          </select>
        </div>
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
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              這個條件目前沒有票價資料。可以放寬日期、時段或回程條件再試一次。
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                找到 {results.length} 筆（依價格排序）
                {results.length < 10 ? "，這個條件目前只有這些資料" : ""}
                {search.data.partial ? "；部分月份查詢失敗，結果可能不完整" : ""}
              </p>
              <ol className="space-y-3">
                {results.map((f, i) => (
                  <FareRow
                    key={`${f.departure_at}-${f.return_at}-${f.flight_number}-${i}`}
                    fare={f}
                    rank={i + 1}
                    onPick={(price) => onPick(searchedPlan, price)}
                  />
                ))}
              </ol>
            </>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            票價是 Travelpayouts 彙整近 48
            小時其他旅客搜尋到的快取資料，不是即時報價，實際價格以訂購頁面為準。時間為各機場當地時間；停留晚數以去程與回程的當地日期計算（例如
            11/3 去、11/7 回是 4 晚，即 5 天 4 夜）。
            降價通知目前比對的是「下個月整個月、任何時段、任何天數」的最低價，不會套用這裡的查詢條件。
          </p>
        </div>
      )}
    </section>
  );
}
