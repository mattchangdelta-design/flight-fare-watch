import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, TrendingDown } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { airlineName } from "@/lib/airlines";
import { getHistory, type HistoryPoint } from "@/lib/flight-api";

const RANGES = [
  { days: 7, label: "7 天" },
  { days: 30, label: "30 天" },
  { days: 180, label: "全部" },
] as const;

const WEEK = "日一二三四五六";
const nt = (n: number) => `NT$${n.toLocaleString("en-US")}`;
/** UTC ISO -> Taiwan local "10/26 17:24". */
function twTime(ms: number) {
  const d = new Date(ms + 8 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}
const twDay = (ms: number) => {
  const d = new Date(ms + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
/** '2026-11-03T06:50:00+09:00' -> '11/3（二）' (date in the airport's own time). */
function legDay(iso: string | null) {
  if (!iso) return "";
  const [y, m, d] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)].map(Number) as [
    number,
    number,
    number,
  ];
  return `${m}/${d}（${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}

/** Round-numbered ticks (step 100/200/250/500/1000…) spanning [lo, hi] with some headroom. */
function niceTicks(lo: number, hi: number): number[] {
  const raw = Math.max(hi - lo, 300) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag;
  let start = Math.floor(lo / step) * step;
  if (lo - start < step * 0.3) start -= step;
  let end = Math.ceil(hi / step) * step;
  if (end - hi < step * 0.3) end += step;
  const out: number[] = [];
  for (let v = Math.max(0, start); v <= end; v += step) out.push(v);
  return out;
}

type Row = HistoryPoint & {
  ms: number;
  /** The cheapest fare is a different itinerary than at the previous priced point. */
  switched: boolean;
  /** Synthetic point carrying the last value up to "now" (no marker, no tooltip of its own). */
  tail?: boolean;
};

function build(points: HistoryPoint[], now: number): { rows: Row[]; condChanges: number[] } {
  const rows: Row[] = [];
  const condChanges: number[] = [];
  let lastKey = "";
  points.forEach((p, i) => {
    const ms = Date.parse(p.t);
    const prev = points[i - 1];
    if (prev && prev.cond !== p.cond) condChanges.push(ms);
    const switched = p.price != null && lastKey !== "" && p.key !== lastKey;
    if (p.price != null) lastKey = p.key;
    rows.push({ ...p, ms, switched });
  });
  const last = rows[rows.length - 1];
  if (last && now > last.ms) rows.push({ ...last, ms: now, switched: false, tail: true });
  return { rows, condChanges };
}

function TrendTooltip({ active, payload }: TooltipProps<number, string>) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground">
        {row.tail ? "目前（最後一次檢查的結果）" : `${twTime(row.ms)} 檢查`}
      </p>
      {row.price == null ? (
        <p className="mt-1 font-medium">沒有符合條件的票</p>
      ) : (
        <>
          <p className="mt-1 text-sm font-semibold">{nt(row.price)}</p>
          <p className="text-muted-foreground">
            {legDay(row.depart)}去{row.ret ? ` · ${legDay(row.ret)}回` : ""}
            {row.airline ? ` · ${airlineName(row.airline)}` : ""}
          </p>
          <p className="text-muted-foreground">符合條件 {row.count} 筆</p>
          {row.switched && <p className="mt-1">最低價換成另一個行程</p>}
        </>
      )}
    </div>
  );
}

/** Ring marker on points where the cheapest matching fare switched to another itinerary. */
function SwitchDot(props: { cx?: number; cy?: number; payload?: Row }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload?.switched || payload.price == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.5}
      fill="var(--card)"
      stroke="var(--primary-glow)"
      strokeWidth={2}
    />
  );
}

function Chart({ points, target }: { points: HistoryPoint[]; target: number }) {
  // Re-anchors "now" whenever new data arrives (refetch), so the tail reaches the present.
  const now = useMemo(() => Date.now(), [points]); // eslint-disable-line react-hooks/exhaustive-deps
  const { rows, condChanges } = useMemo(() => build(points, now), [points, now]);
  const prices = rows.map((r) => r.price).filter((p): p is number => p != null);
  const latest = rows[rows.length - 1];
  const low = prices.length ? Math.min(...prices) : null;
  const ticks = niceTicks(Math.min(target, ...prices), Math.max(target, ...prices));
  const gaps = rows.some((r) => r.price == null && !r.tail);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="text-muted-foreground">目前最低 </span>
          <span className="text-lg font-semibold">
            {latest?.price != null ? nt(latest.price) : "沒有符合的票"}
          </span>
          {latest?.price != null && (
            <span className="text-muted-foreground">（符合 {latest.count} 筆）</span>
          )}
        </p>
        {low != null && (
          <p className="text-sm text-muted-foreground">
            期間最低 {nt(low)} · 目標價 {nt(target)}
            {low <= target ? "（曾達標）" : `（還差 ${nt(low - target)}）`}
          </p>
        )}
      </div>
      <div className="h-48 w-full" role="img" aria-label="票價走勢圖">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} vertical={false} />
            <XAxis
              dataKey="ms"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={twDay}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={[ticks[0]!, ticks[ticks.length - 1]!]}
              ticks={ticks}
              tickFormatter={(v: number) => v.toLocaleString("en-US")}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            {condChanges.map((ms) => (
              <ReferenceLine
                key={ms}
                x={ms}
                stroke="var(--muted-foreground)"
                strokeDasharray="2 3"
                label={{
                  value: "條件變更",
                  position: "insideTopLeft",
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }}
              />
            ))}
            <ReferenceLine
              y={target}
              stroke="var(--muted-foreground)"
              strokeDasharray="5 4"
              label={{
                value: `目標 ${target.toLocaleString("en-US")}`,
                position: "insideBottomLeft",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
            <Tooltip
              content={<TrendTooltip />}
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            />
            <Line
              type="stepAfter"
              dataKey="price"
              stroke="var(--primary-glow)"
              strokeWidth={2}
              connectNulls={false}
              dot={<SwitchDot />}
              activeDot={{
                r: 4,
                fill: "var(--primary-glow)",
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        每 30 分鐘檢查一次「符合你條件的最低來回票價」。
        {rows.some((r) => r.switched) ? "空心圓點表示最低價換成另一個行程；" : ""}
        {gaps ? "線條中斷的地方表示當時沒有符合條件的票；" : ""}
        價格是 Travelpayouts 的快取資料，走勢從開始記錄後才有（2026/10/26 起），之前的無法補。
      </p>
    </>
  );
}

/** Collapsible "價格走勢" section on a tracking card; fetches only when opened. */
export function PriceTrend({ route, target }: { route: string; target: number }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number>(30);
  const q = useQuery({
    queryKey: ["history", route, days],
    queryFn: () => getHistory(route, days),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const points = q.data ?? [];

  return (
    <div className="mt-4 rounded-xl border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-primary-glow" />
          價格走勢
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="border-t border-border px-3 pb-3 pt-3">
          <div className="mb-3 flex gap-1" role="group" aria-label="期間">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                aria-pressed={days === r.days}
                onClick={() => setDays(r.days)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  days === r.days
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">載入走勢…</p>
          ) : q.isError ? (
            <p className="text-sm text-destructive">走勢載入失敗：{q.error.message}</p>
          ) : points.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              這段期間還沒有記錄。系統每 30 分鐘檢查一次，下次檢查後就會開始出現走勢。
            </p>
          ) : (
            <Chart points={points} target={target} />
          )}
        </div>
      )}
    </div>
  );
}
