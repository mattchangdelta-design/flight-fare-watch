import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isSignup = mode === "signup";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { data, error } = isSignup
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/app` } })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    if (data.session) navigate({ to: "/app" });
    else setError("請到信箱確認後再登入 · Please confirm your email, then sign in.");
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-hero" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-glow">
          <div>
            <h1 className="text-2xl font-bold">{isSignup ? "Sign up / 註冊" : "Sign in / 登入"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSignup ? "建立帳號，開始追蹤機票價格" : "歡迎回來"}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password / 密碼</Label>
            <Input id="password" type="password" required minLength={6} autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full bg-gradient-primary" disabled={loading}>
            {loading ? "…" : isSignup ? "Create account / 建立帳號" : "Sign in / 登入"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {isSignup ? (
              <>已有帳號？ <Link to="/signin" className="text-primary-glow hover:underline">Sign in</Link></>
            ) : (
              <>還沒有帳號？ <Link to="/signup" className="text-primary-glow hover:underline">Sign up</Link></>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
