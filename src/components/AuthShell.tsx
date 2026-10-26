import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

/** Centered card layout shared by the password-reset pages (matches AuthForm). */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-hero" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-glow">{children}</div>
      </div>
    </div>
  );
}
