import { createFileRoute, Link } from "@tanstack/react-router";
import { Radar, BellRing, CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flight Price Notifier — 機票降價通知" },
      { name: "description", content: "設定航線與目標價，機票降價就通知你。Set a route and a target price — we email you when the fare drops." },
      { property: "og:title", content: "Flight Price Notifier — 機票降價通知" },
      { property: "og:description", content: "Set a route and a target price — we email you when the fare drops." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const features = [
  { icon: Radar, title: "盯緊熱門航線 (Always-on route watching)", body: "持續監控台北出發的熱門航線（東京、首爾），自動抓最低票價。" },
  { icon: BellRing, title: "達標自動通知 (Target-price email alerts)", body: "低於你設定的目標價，就寄 email 提醒你，附上立即訂購連結。" },
  { icon: CalendarX, title: "隨時取消 (Cancel anytime)", body: "月訂閱制，不想用隨時停，沒有綁約。" },
];

function Index() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Button asChild>
            <Link to="/signin">Sign in / 登入</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-gradient-hero" />
          <div className="relative mx-auto max-w-4xl px-4 py-24 text-center sm:px-6 sm:py-32">
            <Reveal>
              <p className="mb-6 inline-block rounded-full border border-border bg-card/60 px-4 py-1 text-xs font-medium text-muted-foreground">
                機票降價通知 · 台北出發
              </p>
              <h1 className="text-5xl font-extrabold tracking-tight sm:text-7xl">
                <span className="text-gradient">Flight Price Notifier</span>
              </h1>
              <p className="mt-6 text-xl font-semibold sm:text-2xl">設定航線與目標價，機票降價就通知你</p>
              <p className="mt-3 text-base text-muted-foreground sm:text-lg">
                Set a route and a target price — we email you when the fare drops.
              </p>
              <div className="mt-10">
                <Button asChild size="lg" className="bg-gradient-primary shadow-glow">
                  <Link to="/signup">免費開始 · Get started</Link>
                </Button>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="grid gap-6 md:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 120}>
                <div className="h-full rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/50">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent">
                    <f.icon className="h-5 w-5 text-primary-glow" />
                  </div>
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © 2026 Flight Price Notifier
      </footer>
    </div>
  );
}
