import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/AuthShell";
import { usePageMeta } from "@/hooks/use-page-meta";

export function ForgotPassword() {
  usePageMeta({
    title: "Forgot password — Flight Price Notifier",
    description: "Reset your Flight Price Notifier password.",
    ogTitle: "Forgot password — Flight Price Notifier",
    ogDescription: "Reset your Flight Price Notifier password.",
    twitterCard: "summary",
  });
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) return setError(error.message);
    setSent(true);
  }

  return (
    <AuthShell>
      {sent ? (
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">請查收信件</h1>
          <p className="text-sm text-muted-foreground">
            如果 {email}{" "}
            有註冊帳號，我們已寄出重設密碼的連結。請點信中的連結設定新密碼（記得也看看垃圾郵件）。
          </p>
          <p className="text-sm text-muted-foreground">
            If an account exists for this email, a reset link is on its way.
          </p>
          <Link
            to="/signin"
            className="block text-center text-sm text-primary-glow hover:underline"
          >
            回到登入 · Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold">Forgot password / 忘記密碼</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              輸入註冊用的 email，我們會寄重設密碼的連結給你
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full bg-gradient-primary" disabled={loading}>
            {loading ? "…" : "Send reset link / 寄送重設連結"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            想起來了？{" "}
            <Link to="/signin" className="text-primary-glow hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
