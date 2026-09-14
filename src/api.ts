export type GrowthRecord = {
  id: string;
  title: string;
  cat: string;
  quote: string;
  time: string;
  tone: string;
  version: number;
};
export type Child = {
  nickname: string;
  age: number;
  grade: string;
  height: string;
  weight: string;
  traits: string;
  focus_direction: string;
  interests: string[];
  support_note: string;
};
export type Homework = {
  id: string;
  subject: string;
  content: string;
  due_label: string;
  support_mode: string;
  status: string;
  check_required: boolean;
};
export type SchedulePlan = {
  name: string;
  period_start: string;
  period_end: string;
};
export type ScheduleEntry = {
  id: string;
  category: string;
  module: string;
  weekday: number;
  time_label: string;
  content: string;
};
export type FollowUp = {
  id: string;
  title: string;
  fact: string;
  owner: string;
  review_label: string;
  priority: string;
  status: string;
  conclusion: string;
  source_record_id?: string;
};
export type Goal = {
  id: string;
  title: string;
  category: string;
  child_agreement: string;
  parent_support: string;
  review_label: string;
  status: string;
};
export type Family = { name: string; timezone: string; members: string[] };
export type FamilyAccount = {
  id: string;
  username: string;
  display_name: string;
  role: "监护人" | "家庭成员" | "照护者";
};
export type AccountPayload = Omit<FamilyAccount, "id"> & { password: string };
export type AppData = {
  child: Child;
  family: Family;
  accounts: FamilyAccount[];
  current_account_id: string;
  data_location: string;
  records: GrowthRecord[];
  homework: Homework[];
  schedule_plan: SchedulePlan;
  schedule_entries: ScheduleEntry[];
  followups: FollowUp[];
  goals: Goal[];
};
const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD
    ? "/api/v1"
    : `${window.location.protocol}//${window.location.hostname}:8000/api/v1`);
const TOKEN_KEY = "yanwu_family_token";
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `请求失败 (${response.status})`);
  }
  return response.json();
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const api = {
  hasToken: () => Boolean(localStorage.getItem(TOKEN_KEY)),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
  authStatus: () => request<{ has_accounts: boolean }>("/auth/status"),
  setupAccount: (body: AccountPayload) =>
    request<{ token: string; account: FamilyAccount }>(
      "/auth/setup",
      json("POST", body),
    ),
  login: (body: { username: string; password: string }) =>
    request<{ token: string; account: FamilyAccount }>(
      "/auth/login",
      json("POST", body),
    ),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  createAccount: (body: AccountPayload) =>
    request<FamilyAccount>("/auth/accounts", json("POST", body)),
  updateAccount: (id: string, body: AccountPayload) =>
    request<FamilyAccount>(`/auth/accounts/${id}`, json("PUT", body)),
  deleteAccount: (id: string) =>
    request<{ deleted: string }>(`/auth/accounts/${id}`, { method: "DELETE" }),
  bootstrap: () => request<AppData>("/bootstrap"),
  createRecord: (body: {
    title: string;
    category: string;
    child_quote: string;
  }) =>
    request<GrowthRecord>("/records", {
      ...json("POST", body),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
    }),
  updateRecord: (
    id: string,
    body: { title: string; category: string; child_quote: string },
  ) => request<GrowthRecord>(`/records/${id}`, json("PUT", body)),
  deleteRecord: (id: string) =>
    request<{ ok: boolean }>(`/records/${id}`, { method: "DELETE" }),
  toFollowUp: (id: string) =>
    request<FollowUp>(`/records/${id}/follow-up`, { method: "POST" }),
  updateChild: (body: Child) => request<Child>("/child", json("PUT", body)),
  createHomework: (body: Omit<Homework, "id" | "status">) =>
    request<Homework>("/homework", json("POST", body)),
  editHomework: (id: string, body: Omit<Homework, "id" | "status">) =>
    request<Homework>(`/homework/${id}`, json("PUT", body)),
  deleteHomework: (id: string) =>
    request<{ ok: boolean }>(`/homework/${id}`, { method: "DELETE" }),
  updateSchedulePlan: (body: SchedulePlan) =>
    request<SchedulePlan>("/schedule/plan", json("PUT", body)),
  createScheduleEntry: (body: Omit<ScheduleEntry, "id">) =>
    request<ScheduleEntry>("/schedule/entries", json("POST", body)),
  editScheduleEntry: (id: string, body: Omit<ScheduleEntry, "id">) =>
    request<ScheduleEntry>(`/schedule/entries/${id}`, json("PUT", body)),
  deleteScheduleEntry: (id: string) =>
    request<{ ok: boolean }>(`/schedule/entries/${id}`, {
      method: "DELETE",
    }),
  updateHomeworkStatus: (id: string, status: string) =>
    request<Homework>(`/homework/${id}/status`, json("PATCH", { status })),
  createFollowUp: (
    body: Omit<FollowUp, "id" | "status" | "conclusion" | "source_record_id">,
  ) => request<FollowUp>("/follow-ups", json("POST", body)),
  editFollowUp: (
    id: string,
    body: Omit<FollowUp, "id" | "status" | "conclusion" | "source_record_id">,
  ) => request<FollowUp>(`/follow-ups/${id}`, json("PUT", body)),
  deleteFollowUp: (id: string) =>
    request<{ ok: boolean }>(`/follow-ups/${id}`, { method: "DELETE" }),
  updateFollowUpStatus: (id: string, status: string, conclusion = "") =>
    request<FollowUp>(
      `/follow-ups/${id}/status`,
      json("PATCH", { status, conclusion }),
    ),
  createGoal: (body: Omit<Goal, "id" | "status">) =>
    request<Goal>("/goals", json("POST", body)),
  editGoal: (id: string, body: Omit<Goal, "id" | "status">) =>
    request<Goal>(`/goals/${id}`, json("PUT", body)),
  deleteGoal: (id: string) =>
    request<{ ok: boolean }>(`/goals/${id}`, { method: "DELETE" }),
  updateGoalStatus: (id: string, status: string) =>
    request<Goal>(`/goals/${id}/status`, json("PATCH", { status })),
  updateFamily: (body: Family) => request<Family>("/family", json("PUT", body)),
};
