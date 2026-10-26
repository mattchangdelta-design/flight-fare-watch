import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/AuthShell";
import { usePageMeta } from "@/hooks/use-page-meta";

/** Landing page for the email reset link: the link signs the user in, then they set a new password. */
export function ResetPassword() {
  usePageMeta({
    title: "Reset password — Flight Price Notifier",
    description: "Set a new password for your Flight Price Notifier account.",
    ogTitle: "Reset password — Flight Price Notifier",
    ogDescription: "Set a new password for your Flight Price Notifier account.",
    twitterCard: "summary",
  });
  const navigate = useNavigate();
  const [ready, setReady] = useState<"checking" | "yes" | "no">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
        setReady("yes");
      }
    });
    // The client parses the link's tokens on load; give it a moment before deciding.
    const timer = setTimeout(async () => {
      const { data: s } = await supabase.auth.getSession();
      if (active) setReady((r) => (r === "yes" || s.session ? "yes" : "no"));
    }, 1500);
    return () => {
      active = false;
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("兩次輸入的密碼不一樣 · Passwords do not match.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(error.message);
    navigate("/app", { replace: true });
  }

  return (
    <AuthShell>
      {ready === "checking" && <p className="text-sm text-muted-foreground">驗證連結中…</p>}
      {ready === "no" && (
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">連結無效或已過期</h1>
          <p className="text-sm text-muted-foreground">
            重設密碼的連結只能使用一次，而且有時效。請重新申請一次。
          </p>
          <Link
            to="/forgot-password"
            className="block text-center text-sm text-primary-glow hover:underline"
          >
            重新寄送重設連結 · Send a new link
          </Link>
        </div>
      )}
      {ready === "yes" && (
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold">Reset password / 設定新密碼</h1>
            <p className="mt-1 text-sm text-muted-foreground">至少 6 個字元</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">New password / 新密碼</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm / 再輸入一次</Label>
            <Input
              id="confirm"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full bg-gradient-primary" disabled={loading}>
            {loading ? "…" : "Update password / 更新密碼"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
