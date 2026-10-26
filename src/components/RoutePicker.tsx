import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ORIGINS, searchPlaces, type Place } from "@/lib/flight-api";

export type RouteValue = { origin: Place; destination: Place | null };

export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Taiwan origin <select> + destination search box (any city with an airport). */
export function RoutePicker({
  value,
  onChange,
}: {
  value: RouteValue;
  onChange: (v: RouteValue) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value.destination?.name ?? "");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const q = useDebounced(text.trim(), 250);

  // Keep the box text in sync when the parent sets a destination (e.g. a reset or a prefill).
  useEffect(() => {
    setText(value.destination?.name ?? "");
  }, [value.destination?.code, value.destination?.name]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const typing = value.destination ? text !== value.destination.name : true;
  const places = useQuery({
    queryKey: ["places", q],
    queryFn: () => searchPlaces(q),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const results = (places.data ?? []).filter((p) => p.code !== value.origin.code);

  return (
    <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
      <div className="space-y-2">
        <Label htmlFor={`${id}-origin`}>出發地</Label>
        <select
          id={`${id}-origin`}
          className={selectClass}
          value={value.origin.code}
          onChange={(e) =>
            onChange({
              ...value,
              origin: ORIGINS.find((o) => o.code === e.target.value) ?? ORIGINS[0]!,
            })
          }
        >
          {ORIGINS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div ref={boxRef} className="relative space-y-2">
        <Label htmlFor={`${id}-dest`}>目的地</Label>
        <Input
          id={`${id}-dest`}
          autoComplete="off"
          placeholder="輸入城市，例如 大阪、曼谷、Paris"
          value={text}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (value.destination) onChange({ ...value, destination: null });
          }}
        />
        {open && (
          <ul
            id={`${id}-list`}
            role="listbox"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-card p-1 shadow-lg"
          >
            {!q && typing && (
              <li className="px-2 py-1 text-xs text-muted-foreground">台灣有直飛的熱門城市</li>
            )}
            {places.isFetching && results.length === 0 && (
              <li className="px-2 py-2 text-sm text-muted-foreground">搜尋中…</li>
            )}
            {places.isError && (
              <li className="px-2 py-2 text-sm text-destructive">無法搜尋城市，請稍後再試</li>
            )}
            {places.isSuccess && results.length === 0 && (
              <li className="px-2 py-2 text-sm text-muted-foreground">找不到這個城市</li>
            )}
            {results.map((p) => (
              <li key={p.code} role="option" aria-selected={value.destination?.code === p.code}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onChange({ ...value, destination: p });
                    setText(p.name);
                    setOpen(false);
                  }}
                >
                  <span>
                    {p.name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {p.name_en} · {p.country}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {p.direct ? "有直飛 · " : ""}
                    {p.code}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
