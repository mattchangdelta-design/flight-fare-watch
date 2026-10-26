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
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body;
}

export async function listSubscriptions(email: string): Promise<Subscription[]> {
  const res = await fetch(`${FLIGHT_API_URL}/subscriptions?email=${encodeURIComponent(email)}`);
  const body = (await readJson(res)) as { subscriptions?: Subscription[] };
  return body.subscriptions ?? [];
}

export async function deleteSubscription(email: string, plan_name: PlanName): Promise<void> {
  const q = new URLSearchParams({ email, plan_name });
  const res = await fetch(`${FLIGHT_API_URL}/subscriptions?${q.toString()}`, { method: "DELETE" });
  await readJson(res);
}

export async function saveSubscription(input: {
  email: string;
  plan_name: PlanName;
  target_price: number;
}): Promise<Subscription> {
  const res = await fetch(`${FLIGHT_API_URL}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await readJson(res)) as Subscription;
}
