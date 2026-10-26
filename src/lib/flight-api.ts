import { supabase } from "@/integrations/supabase/client";

// Client for the M1 subscription API (AWS API Gateway → Lambda → DynamoDB).
// The browser holds no AWS credentials; it only calls these public endpoints.
export const FLIGHT_API_URL =
  (import.meta.env["VITE_FLIGHT_API_URL"] as string | undefined) ??
  "https://z3i3apvemd.execute-api.us-east-1.amazonaws.com";

export type PlanName = "tokyo" | "seoul";

export type Plan = {
  name: PlanName;
  label: string;
  route: string;
  hint: string;
};

export const PLANS: Plan[] = [
  {
    name: "tokyo",
    label: "台北 ✈ 東京",
    route: "TPE-TYO",
    hint: "比對的是下個月出發的最低來回票價",
  },
  {
    name: "seoul",
    label: "台北 ✈ 首爾",
    route: "TPE-SEL",
    hint: "比對的是下個月出發的最低來回票價",
  },
];

// Monthly fee shown in the UI. Keep in sync with `amount` in the flight/ecpay secret,
// which is what the checkout actually charges.
export const MONTHLY_FEE_TWD = 300;

export type SubscriptionStatus = "pending_payment" | "active" | "cancelled" | "expired" | "free";

export type Subscription = {
  email: string;
  route: string;
  plan_name: PlanName;
  target_price: number;
  currency: "TWD";
  created_at?: string;
  updated_at?: string;
  /** Missing on rows created before payments existed; treated as pending_payment. */
  subscription_status?: SubscriptionStatus;
  /** UTC "YYYY-MM-DDTHH:MM:SSZ": paid through this moment. */
  current_period_end?: string;
  /** Taiwan-local date of current_period_end, for display. */
  current_period_end_date?: string;
};

/** Status as the user should see it: no status = unpaid, a cancelled row past its period = ended. */
export function effectiveStatus(sub: Subscription, now = new Date()): SubscriptionStatus {
  const st = sub.subscription_status ?? "pending_payment";
  if (st === "cancelled") {
    const end = sub.current_period_end ? Date.parse(sub.current_period_end) : NaN;
    if (!Number.isFinite(end) || end < now.getTime()) return "expired";
  }
  return st;
}

/**
 * What a card shows once the site-wide billing switch is taken into account:
 * paying rows always keep their real status; with billing off every other row is "free";
 * with billing on, a row created during a free period needs payment like any unpaid row.
 */
export function displayStatus(sub: Subscription, billing: boolean): SubscriptionStatus {
  const st = effectiveStatus(sub);
  if (st === "active" || st === "cancelled") return st;
  if (!billing) return "free";
  return st === "free" ? "pending_payment" : st;
}

export type SiteSettings = {
  billing_enabled: boolean;
  is_admin: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
};

export async function getSettings(): Promise<SiteSettings> {
  const res = await fetch(`${FLIGHT_API_URL}/settings`, { headers: await authHeaders() });
  return (await readJson(res)) as SiteSettings;
}

export async function setBillingEnabled(billing_enabled: boolean): Promise<SiteSettings> {
  const res = await fetch(`${FLIGHT_API_URL}/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ billing_enabled }),
  });
  return (await readJson(res)) as SiteSettings;
}

async function readJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("登入已過期，請重新登入");
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body;
}

// The API identifies the user from the Supabase access token, never from an email we send.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("請先登入");
  return { authorization: `Bearer ${token}` };
}

export async function listSubscriptions(): Promise<Subscription[]> {
  const res = await fetch(`${FLIGHT_API_URL}/subscriptions`, { headers: await authHeaders() });
  const body = (await readJson(res)) as { subscriptions?: Subscription[] };
  return body.subscriptions ?? [];
}

export async function deleteSubscription(plan_name: PlanName): Promise<void> {
  const q = new URLSearchParams({ plan_name });
  const res = await fetch(`${FLIGHT_API_URL}/subscriptions?${q.toString()}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  await readJson(res);
}

export type SaveResult =
  /** Unpaid subscription: an auto-submitting ECPay checkout page to hand the browser to. */
  | { kind: "checkout"; html: string }
  /** Paying subscriber (target changed in place) or billing switched off (saved for free). */
  | { kind: "updated" };

// /subscribe answers text/html (ECPay checkout form) or application/json (in-place update),
// so branch on Content-Type instead of always calling res.json().
export async function saveSubscription(input: {
  plan_name: PlanName;
  target_price: number;
}): Promise<SaveResult> {
  const res = await fetch(`${FLIGHT_API_URL}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) {
    return { kind: "checkout", html: await res.text() };
  }
  await readJson(res);
  return { kind: "updated" };
}

/** Replace the page with the checkout form; its inline script POSTs the shopper to ECPay. */
export function goToCheckout(html: string) {
  document.open();
  document.write(html);
  document.close();
}

export async function cancelSubscription(plan_name: PlanName): Promise<void> {
  const res = await fetch(`${FLIGHT_API_URL}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ plan_name }),
  });
  await readJson(res);
}

export type Fare = {
  price: number;
  airline: string | null;
  flight_number: string | number | null;
  origin_airport: string | null;
  destination_airport: string | null;
  departure_at: string;
  arrival_at: string | null;
  return_at: string | null;
  return_arrival_at: string | null;
  transfers: number | null;
  return_transfers: number | null;
  link: string | null;
};

export type FareSearch = {
  plan_name: PlanName;
  date_from: string;
  date_to: string;
  time_from: string;
  time_to: string;
  // Optional return-leg filters ("" = no limit).
  trip_min?: string;
  trip_max?: string;
  ret_time_from?: string;
  ret_time_to?: string;
};

export async function searchFares(
  params: FareSearch,
): Promise<{ results: Fare[]; scanned: number; partial: boolean }> {
  const q = new URLSearchParams(
    Object.entries(params).filter((kv): kv is [string, string] => Boolean(kv[1])),
  );
  const res = await fetch(`${FLIGHT_API_URL}/fares?${q.toString()}`, {
    headers: await authHeaders(),
  });
  return (await readJson(res)) as { results: Fare[]; scanned: number; partial: boolean };
}
