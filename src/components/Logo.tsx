import { Link } from "@tanstack/react-router";
import { Plane } from "lucide-react";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
        <Plane className="h-4 w-4 text-primary-foreground" />
      </span>
      <span>Flight Price Notifier</span>
    </Link>
  );
}
