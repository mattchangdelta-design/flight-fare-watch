import { AuthForm } from "@/components/AuthForm";
import { usePageMeta } from "@/hooks/use-page-meta";

export function SignIn() {
  usePageMeta({
    title: "Sign in — Flight Price Notifier",
    description: "Sign in to manage your flight price alerts.",
    ogTitle: "Sign in — Flight Price Notifier",
    ogDescription: "Sign in to manage your flight price alerts.",
    twitterCard: "summary",
  });
  return <AuthForm mode="signin" />;
}
