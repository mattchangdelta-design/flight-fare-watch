import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setBillingEnabled, type SiteSettings } from "@/lib/flight-api";

/** Site-wide 收費功能 switch. Only rendered for admins; the API rejects everyone else anyway. */
export function AdminBillingSwitch({ settings }: { settings: SiteSettings }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: setBillingEnabled,
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const on = settings.billing_enabled;
  const updated = settings.updated_at
    ? new Date(settings.updated_at).toLocaleString("zh-TW", { hour12: false })
    : null;

  return (
    <section className="mb-8 rounded-2xl border border-dashed border-border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Settings className="h-4 w-4" /> 管理員設定 · 收費功能
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {on
              ? "開啟中：新訂閱要先付月費，只有付費者會收到降價通知。"
              : "關閉中：所有人免費使用，只要有追蹤就會收到降價通知。已付費的使用者仍照常扣款，可自行取消續訂。"}
          </p>
          {updated && (
            <p className="mt-1 text-xs text-muted-foreground">
              上次變更：{updated}
              {settings.updated_by ? `（${settings.updated_by}）` : ""}
            </p>
          )}
          {error && <p className="mt-1 text-sm text-destructive">切換失敗：{error}</p>}
        </div>
        <Switch
          aria-label="收費功能"
          checked={on}
          disabled={toggle.isPending}
          onCheckedChange={(v) => toggle.mutate(v)}
        />
      </div>
    </section>
  );
}
