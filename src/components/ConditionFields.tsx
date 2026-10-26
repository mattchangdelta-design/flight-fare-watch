import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/RoutePicker";
import type { Conditions } from "@/lib/conditions";

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const HOURS_TO = [...HOURS.slice(1), "23:59"];
const NIGHTS = Array.from({ length: 14 }, (_, i) => String(i + 1));
const hm = (h: string) => (h === "23:59" ? "24:00" : h);

/** Date range, departure window, nights and return window - rendered as cells of a 2-column grid. */
export function ConditionFields({
  value,
  onChange,
  idPrefix,
}: {
  value: Conditions;
  onChange: (c: Conditions) => void;
  idPrefix: string;
}) {
  const set = (k: keyof Conditions) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  const id = (s: string) => `${idPrefix}-${s}`;

  const select = (key: keyof Conditions, label: string, opts: [string, string][]) => (
    <div className="space-y-2">
      <Label htmlFor={id(key)}>{label}</Label>
      <select id={id(key)} className={selectClass} value={value[key]} onChange={set(key)}>
        {opts.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
  const any: [string, string] = ["", "不限"];

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={id("from")}>出發日期（從）</Label>
        <Input
          id={id("from")}
          type="date"
          required
          value={value.date_from}
          onChange={set("date_from")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id("to")}>出發日期（到）</Label>
        <Input id={id("to")} type="date" required value={value.date_to} onChange={set("date_to")} />
      </div>
      {select(
        "time_from",
        "出發時段（從）",
        HOURS.map((h) => [h, h]),
      )}
      {select(
        "time_to",
        "出發時段（到）",
        HOURS_TO.map((h) => [h, hm(h)]),
      )}
      <div className="pt-2 sm:col-span-2">
        <p className="text-sm font-medium">回程條件（選填）</p>
        <p className="text-xs text-muted-foreground">不填就不限制。條件越多，符合的票越少。</p>
      </div>
      {select("trip_min", "停留晚數（最少）", [
        any,
        ...NIGHTS.map((n): [string, string] => [n, `${n} 晚（${Number(n) + 1} 天）`]),
      ])}
      {select("trip_max", "停留晚數（最多）", [
        any,
        ...NIGHTS.map((n): [string, string] => [n, `${n} 晚（${Number(n) + 1} 天）`]),
      ])}
      {select("ret_time_from", "回程出發時段（從）", [
        any,
        ...HOURS.map((h): [string, string] => [h, h]),
      ])}
      {select("ret_time_to", "回程出發時段（到）", [
        any,
        ...HOURS_TO.map((h): [string, string] => [h, hm(h)]),
      ])}
    </>
  );
}
