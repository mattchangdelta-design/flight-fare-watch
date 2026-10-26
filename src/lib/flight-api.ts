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

export type Subscription = {
  email: string;
  route: string;
  plan_name: PlanName;
  target_price: number;
  currency: "TWD";
  created_at?: string;
  updated_at?: string;
};

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

export async function saveSubscription(input: {
  plan_name: PlanName;
  target_price: number;
}): Promise<Subscription> {
  const res = await fetch(`${FLIGHT_API_URL}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  return (await readJson(res)) as Subscription;
}
