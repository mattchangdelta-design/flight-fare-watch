// Search / tracking conditions. Same shape the API takes (query string for /fares, `conditions` for
// /subscribe) and stores on a subscription. Empty optional fields mean "no limit".
export type Conditions = {
  date_from: string;
  date_to: string;
  time_from: string;
  time_to: string;
  trip_min: string;
  trip_max: string;
  ret_time_from: string;
  ret_time_to: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayYmd = () => ymd(new Date());

/** Next month, any time, any length - also what a subscription without conditions means. */
export function defaultConditions(): Conditions {
  const now = new Date();
  return {
    date_from: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    date_to: ymd(new Date(now.getFullYear(), now.getMonth() + 2, 0)),
    time_from: "00:00",
    time_to: "23:59",
    trip_min: "",
    trip_max: "",
    ret_time_from: "",
    ret_time_to: "",
  };
}

/** Fill a stored (possibly partial) condition map into a full form value. */
export function fromStored(c?: Partial<Record<string, string>> | null): Conditions {
  const base = defaultConditions();
  for (const k of Object.keys(base) as (keyof Conditions)[]) {
    const v = c?.[k];
    if (typeof v === "string") base[k] = v;
  }
  return base;
}

/** Only the fields that are set - what gets sent to the API. */
export function compact(c: Conditions): Partial<Conditions> {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => Boolean(v))) as Partial<Conditions>;
}

/** Form-level checks shared by search and tracking (the API re-validates). */
export function validate(c: Conditions, opts: { future?: boolean } = {}): string | null {
  if (!c.date_from || !c.date_to) return "請選擇出發日期";
  if (c.date_to < c.date_from) return "結束日期要在開始日期之後";
  if ((Date.parse(c.date_to) - Date.parse(c.date_from)) / 86400000 > 92)
    return "日期區間最多 3 個月";
  if (opts.future && c.date_to < todayYmd()) return "出發日期區間已經過了，請選擇今天以後的日期";
  if (c.time_to < c.time_from) return "出發時段的結束時間要晚於開始時間";
  if (c.trip_min && c.trip_max && Number(c.trip_max) < Number(c.trip_min))
    return "停留晚數的上限要大於或等於下限";
  if (c.ret_time_from && c.ret_time_to && c.ret_time_to < c.ret_time_from)
    return "回程時段的結束時間要晚於開始時間";
  return null;
}

const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const hm = (s: string) => (s === "23:59" ? "24:00" : s);

/** "11/3–11/13 出發 · 去程 04:00–12:00 · 停留 2 晚以上 · 回程 12:00–18:00" */
export function summary(c: Partial<Conditions>): string {
  const parts = [`${md(c.date_from ?? "")}–${md(c.date_to ?? "")} 出發`];
  const tf = c.time_from ?? "00:00";
  const tt = c.time_to ?? "23:59";
  if (tf !== "00:00" || tt !== "23:59") parts.push(`去程 ${tf}–${hm(tt)}`);
  const { trip_min: n1, trip_max: n2 } = c;
  if (n1 && n2) parts.push(n1 === n2 ? `停留 ${n1} 晚` : `停留 ${n1}–${n2} 晚`);
  else if (n1) parts.push(`停留 ${n1} 晚以上`);
  else if (n2) parts.push(`停留 ${n2} 晚以內`);
  if (c.ret_time_from || c.ret_time_to)
    parts.push(`回程 ${c.ret_time_from || "00:00"}–${hm(c.ret_time_to || "23:59")}`);
  return parts.join(" · ");
}
