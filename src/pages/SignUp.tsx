import { AuthForm } from "@/components/AuthForm";
import { usePageMeta } from "@/hooks/use-page-meta";

export function SignUp() {
  usePageMeta({
    title: "Sign up — Flight Price Notifier",
    description: "Create an account and get emailed when fares drop.",
    ogTitle: "Sign up — Flight Price Notifier",
    ogDescription: "Create an account and get emailed when fares drop.",
    twitterCard: "summary",
  });
  return <AuthForm mode="signup" />;
}
