import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchFares } from "@/lib/flight-api";
import { validate, type Conditions } from "@/lib/conditions";

/** "目前符合 3 筆，最低 NT$6,940" for a route + conditions, so people see how often alerts could fire. */
export function MatchPreview({
  route,
  conditions,
  target,
}: {
  route: string | null;
  conditions: Conditions;
  target?: number | undefined;
}) {
  const key = JSON.stringify({ route, conditions });
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(key), 600);
    return () => window.clearTimeout(t);
  }, [key]);
  const valid = Boolean(route) && validate(conditions) === null;

  const q = useQuery({
    queryKey: ["match-preview", debounced],
    queryFn: () => {
      const v = JSON.parse(debounced) as { route: string; conditions: Conditions };
      return searchFares({ route: v.route, ...v.conditions });
    },
    enabled: valid && debounced === key,
    staleTime: 5 * 60_000,
  });

  if (!valid) return null;
  if (q.isFetching || debounced !== key)
    return <p className="text-xs text-muted-foreground">正在查目前符合條件的票價…</p>;
  if (q.isError) return null;
  const results = q.data?.results ?? [];
  if (results.length === 0)
    return (
      <p className="text-xs text-amber-500">
        目前沒有符合這些條件的票價資料，可能很久都不會收到通知。可以放寬日期或時段。
      </p>
    );
  const low = results[0]!.price;
  const reached = target !== undefined && target > 0 && target >= low;
  return (
    <p className="text-xs text-muted-foreground">
      目前符合 {results.length}
      {results.length === 10 ? "+" : ""} 筆，最低 NT${low.toLocaleString("en-US")}
      {reached ? "（已低於你的目標價，下一次檢查就會通知）" : ""}
    </p>
  );
}
