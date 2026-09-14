import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Baby,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  Compass,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Pencil,
  Plus,
  Settings,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import {
  api,
  type AccountPayload,
  type AppData,
  type Child,
  type Family,
  type FamilyAccount,
  type FollowUp,
  type Goal,
  type GrowthRecord,
  type Homework,
  type ScheduleEntry,
  type SchedulePlan,
} from "./api";
import "./styles.css";

type View =
  | "home"
  | "child"
  | "records"
  | "learning"
  | "followups"
  | "goals"
  | "settings";
type Modal =
  | "record"
  | "homework"
  | "schedulePlan"
  | "scheduleEntry"
  | "followup"
  | "completeFollowup"
  | "goal"
  | "child"
  | "family"
  | "account"
  | null;
const paths: Record<View, string> = {
  home: "/",
  child: "/child",
  records: "/records",
  learning: "/learning",
  followups: "/follow-ups",
  goals: "/goals",
  settings: "/settings/family",
};
const nav: { id: View; label: string; icon: React.ElementType }[] = [
  { id: "home", label: "总览", icon: LayoutDashboard },
  { id: "child", label: "孩子档案", icon: Baby },
  { id: "records", label: "成长记录", icon: ClipboardList },
  { id: "learning", label: "日常安排", icon: BookOpen },
  { id: "followups", label: "共同跟进", icon: MessageCircle },
  { id: "goals", label: "成长方向", icon: Compass },
];
const fromPath = (): View =>
  (Object.entries(paths).find(
    ([, p]) => location.pathname === p,
  )?.[0] as View) || "home";
const nextFollow: Record<string, string> = {
  待了解: "行动中",
  行动中: "待回顾",
  待回顾: "已结束",
  已结束: "待了解",
};

function App() {
  const [view, setViewState] = useState<View>(fromPath);
  const [data, setData] = useState<AppData | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [editTarget, setEditTarget] = useState<
    GrowthRecord | Homework | ScheduleEntry | FollowUp | Goal | FamilyAccount | null
  >(null);
  const [authReady, setAuthReady] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("全部");
  const load = async () => {
    try {
      setError("");
      setData(await api.bootstrap());
    } catch (e) {
      const message = e instanceof Error ? e.message : "无法连接本地 API";
      if (message.includes("登录")) api.clearToken();
      setError(message);
    }
  };
  useEffect(() => {
    const initialize = async () => {
      try {
        const status = await api.authStatus();
        setNeedsSetup(!status.has_accounts);
        if (status.has_accounts && api.hasToken()) await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "无法连接本地 API");
      } finally {
        setAuthReady(true);
      }
    };
    initialize();
    const pop = () => setViewState(fromPath());
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!data) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const interval = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [Boolean(data)]);
  const go = (v: View) => {
    history.pushState({}, "", paths[v]);
    setViewState(v);
    setDrawer(false);
  };
  const run = async (action: Promise<unknown>, message: string) => {
    try {
      setError("");
      await action;
      await load();
      setModal(null);
      setEditTarget(null);
      setToast(message);
      setTimeout(() => setToast(""), 2400);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      return false;
    }
  };
  const edit = (
    kind: Exclude<Modal, null>,
    target: GrowthRecord | Homework | ScheduleEntry | FollowUp | Goal | FamilyAccount,
  ) => {
    setEditTarget(target);
    setModal(kind);
  };
  const create = (kind: Exclude<Modal, null>) => {
    setEditTarget(null);
    setModal(kind);
  };
  const remove = async (
    label: string,
    action: () => Promise<unknown>,
  ) => {
    if (!window.confirm(`确定删除“${label}”吗？删除后无法恢复。`)) return;
    await run(action(), "已删除");
  };
  const authenticate = async (
    setup: boolean,
    payload: AccountPayload,
  ) => {
    try {
      setError("");
      const result = setup
        ? await api.setupAccount(payload)
        : await api.login({ username: payload.username, password: payload.password });
      api.setToken(result.token);
      setNeedsSetup(false);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
      return false;
    }
  };
  const logout = async () => {
    try {
      await api.logout();
    } finally {
      api.clearToken();
      setData(null);
      setError("");
    }
  };
  if (!authReady)
    return (
      <div className="boot-state">
        <span className="brand-mark">言</span>
        <h1>言午</h1>
        <p>正在连接家庭空间...</p>
      </div>
    );
  if (!data)
    return (
      <AuthPage
        setup={needsSetup}
        error={error}
        submit={(payload) => authenticate(needsSetup, payload)}
      />
    );
  const currentAccount =
    data.accounts.find((account) => account.id === data.current_account_id) ||
    data.accounts[0];
  const canManageFamily = currentAccount?.role === "监护人";
  const title =
    view === "home"
      ? `早上好，${currentAccount?.display_name || "家长"}`
      : view === "settings"
        ? "家庭设置"
        : nav.find((x) => x.id === view)?.label;
  return (
    <div className="app">
      <aside className={drawer ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <span className="brand-mark">言</span>
          <div>
            <strong>言午</strong>
            <small>GrowTogether</small>
          </div>
          <button
            aria-label="关闭导航"
            className="close"
            onClick={() => setDrawer(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="family-switch">
          <span className="avatar">家</span>
          <div>
            <b>{data.family.name}</b>
            <small>1 位孩子 · {data.family.members.length} 位成员</small>
          </div>
          <ChevronRight size={16} />
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "followups" && (
                <i>
                  {data.followups.filter((x) => x.status !== "已结束").length}
                </i>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => go("settings")}
          >
            <Settings size={18} />
            家庭设置
          </button>
          <div className="user">
            <CircleUserRound size={24} />
            <div>
              <b>{currentAccount?.display_name}</b>
              <small>{currentAccount?.role}</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <button
            aria-label="打开导航"
            className="mobile-menu"
            onClick={() => setDrawer(true)}
          >
            <Menu />
          </button>
          <div>
            <span className="eyebrow">家庭协作空间</span>
            <h1>{title}</h1>
          </div>
          <div className="header-actions">
            <span className="sync">
              <span className="dot" />
              数据已同步
            </span>
            <button
              aria-label="退出登录"
              title="退出登录"
              className="icon-btn"
              onClick={logout}
            >
              <CircleUserRound size={24} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {view === "home" && (
          <Home data={data} go={go} add={() => create("record")} />
        )}
        {view === "child" && (
          <ChildPage child={data.child} edit={() => setModal("child")} />
        )}
        {view === "records" && (
          <RecordsPage
            records={data.records}
            filter={filter}
            setFilter={setFilter}
            add={() => create("record")}
            edit={(record) => edit("record", record)}
            remove={(record) => remove(record.title, () => api.deleteRecord(record.id))}
            convert={(r) => run(api.toFollowUp(r.id), "已转为共同跟进")}
          />
        )}
        {view === "learning" && (
          <LearningPage
            plan={data.schedule_plan}
            entries={data.schedule_entries}
            items={data.homework}
            add={() => create("homework")}
            editPlan={() => setModal("schedulePlan")}
            addEntry={() => create("scheduleEntry")}
            editItem={(item) => edit("homework", item)}
            removeItem={(item) =>
              remove(`${item.subject} · ${item.content}`, () => api.deleteHomework(item.id))
            }
            editEntry={(item) => edit("scheduleEntry", item)}
            removeEntry={(item) =>
              remove(item.content, () => api.deleteScheduleEntry(item.id))
            }
            updateStatus={(item, status) =>
              run(api.updateHomeworkStatus(item.id, status), "安排状态已更新")
            }
          />
        )}
        {view === "followups" && (
          <FollowupsPage
            items={data.followups}
            add={() => create("followup")}
            edit={(item) => edit("followup", item)}
            remove={(item) =>
              remove(item.title, () => api.deleteFollowUp(item.id))
            }
            advance={async (item) => {
              const next = nextFollow[item.status];
              let conclusion = "";
              if (next === "已结束") {
                conclusion = window.prompt("写下本轮回顾结论") || "";
                if (!conclusion) return;
              }
              await run(
                api.updateFollowUpStatus(item.id, next, conclusion),
                "跟进状态已更新",
              );
            }}
            complete={(item) => edit("completeFollowup", item)}
          />
        )}
        {view === "goals" && (
          <GoalsPage
            items={data.goals}
            add={() => create("goal")}
            edit={(item) => edit("goal", item)}
            remove={(item) => remove(item.title, () => api.deleteGoal(item.id))}
            update={(item, status) =>
              run(api.updateGoalStatus(item.id, status), "目标状态已更新")
            }
          />
        )}
        {view === "settings" && (
          <SettingsPage
            family={data.family}
            accounts={data.accounts}
            currentAccountId={data.current_account_id}
            canManage={canManageFamily}
            dataLocation={data.data_location}
            edit={() => setModal("family")}
            addAccount={() => create("account")}
            editAccount={(account) => edit("account", account)}
            removeAccount={(account) =>
              remove(account.display_name, () => api.deleteAccount(account.id))
            }
          />
        )}
      </main>
      <div className="bottom-nav">
        {nav
          .filter((n) =>
            ["home", "records", "learning", "followups"].includes(n.id),
          )
          .map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              onClick={() => go(n.id)}
            >
              <n.icon size={20} />
              <span>{n.label}</span>
            </button>
          ))}
        <button onClick={() => setDrawer(true)}>
          <Menu size={20} />
          <span>更多</span>
        </button>
      </div>
      {modal && (
        <Editor
          modal={modal}
          data={data}
          target={editTarget}
          close={() => {
            setModal(null);
            setEditTarget(null);
          }}
          submit={(kind, payload, id) => {
            if (kind === "record")
              return run(
                id
                  ? api.updateRecord(id, payload as any)
                  : api.createRecord(payload as any),
                id ? "成长记录已更新" : "成长记录已保存",
              );
            if (kind === "homework")
              return run(
                id
                  ? api.editHomework(id, payload as any)
                  : api.createHomework(payload as any),
                id ? "单次安排已更新" : "单次安排已添加",
              );
            if (kind === "schedulePlan")
              return run(
                api.updateSchedulePlan(payload as SchedulePlan),
                "计划周期已更新",
              );
            if (kind === "scheduleEntry")
              return run(
                id
                  ? api.editScheduleEntry(
                      id,
                      payload as Omit<ScheduleEntry, "id">,
                    )
                  : api.createScheduleEntry(
                      payload as Omit<ScheduleEntry, "id">,
                    ),
                id ? "周安排已更新" : "周安排已添加",
              );
            if (kind === "followup")
              return run(
                id
                  ? api.editFollowUp(id, payload as any)
                  : api.createFollowUp(payload as any),
                id ? "共同跟进已更新" : "共同跟进已创建",
              );
            if (kind === "completeFollowup")
              return run(
                api.updateFollowUpStatus(
                  id!,
                  "已结束",
                  (payload as { conclusion: string }).conclusion,
                ),
                "跟进已完成，并移入历史记录",
              );
            if (kind === "goal")
              return run(
                id ? api.editGoal(id, payload as any) : api.createGoal(payload as any),
                id ? "阶段目标已更新" : "阶段目标已创建",
              );
            if (kind === "child")
              return run(api.updateChild(payload as Child), "孩子档案已更新");
            if (kind === "account")
              return run(
                id
                  ? api.updateAccount(id, payload as AccountPayload)
                  : api.createAccount(payload as AccountPayload),
                id ? "家庭账户已更新" : "家庭账户已创建",
              );
            return run(api.updateFamily(payload as Family), "家庭设置已更新");
          }}
        />
      )}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

function AuthPage({
  setup,
  error,
  submit,
}: {
  setup: boolean;
  error: string;
  submit: (payload: AccountPayload) => Promise<boolean>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    await submit({
      username: String(form.get("username")),
      password: String(form.get("password")),
      display_name: setup ? String(form.get("display_name")) : "登录用户",
      role: setup ? "监护人" : "家庭成员",
    });
    setSubmitting(false);
  };
  return (
    <div className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <span className="brand-mark">言</span>
          <div><strong>言午</strong><small>GrowTogether</small></div>
        </div>
        <span className="eyebrow">家庭成长协作空间</span>
        <h1>{setup ? "设置家庭账户" : "登录家庭账户"}</h1>
        <p>{setup ? "创建第一个账户后，家庭数据将需要登录才能访问。" : "使用家庭账户进入共同成长空间。"}</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={send}>
          {setup && (
            <label>显示名称<input name="display_name" required autoComplete="name" placeholder="例如：妈妈" /></label>
          )}
          <label>登录账号<input name="username" required minLength={3} autoComplete="username" placeholder="至少 3 位" /></label>
          <label>登录密码<input name="password" required minLength={8} type="password" autoComplete={setup ? "new-password" : "current-password"} placeholder="至少 8 位" /></label>
          {setup && (
            <p className="setup-role">首个账户角色：监护人</p>
          )}
          <button className="btn primary" disabled={submitting}>
            {submitting ? "正在处理..." : setup ? "创建并进入" : "登录"}
          </button>
        </form>
      </section>
    </div>
  );
}

function Home({
  data,
  go,
  add,
}: {
  data: AppData;
  go: (v: View) => void;
  add: () => void;
}) {
  const active = data.followups.filter((x) => x.status !== "已结束");
  const pending = data.homework.filter((x) => x.status !== "已完成");
  return (
    <div className="content">
      <section className="hero-row">
        <div>
          <p className="muted">今天先照顾好一件小事</p>
          <h2 className="hero-title">
            让孩子感受到，
            <br />
            <span>有人和他站在一起。</span>
          </h2>
          <p className="hero-copy">把观察变成支持，把分工留在同一个地方。</p>
        </div>
        <div className="child-chip" onClick={() => go("child")}>
          <div className="child-avatar">{data.child.nickname.slice(-1)}</div>
          <div>
            <b>{data.child.nickname}</b>
            <small>
              {data.child.grade} · {data.child.age}岁
            </small>
          </div>
          <ChevronRight size={17} />
        </div>
      </section>
      <section className="grid two">
        <div className="panel focus">
          <div className="panel-head">
            <div>
              <span className="kicker">TODAY</span>
              <h3>今日重点</h3>
            </div>
            <button className="text-btn" onClick={() => go("learning")}>
              查看日常安排 <ChevronRight size={15} />
            </button>
          </div>
          {pending.slice(0, 2).map((x) => (
            <div className="task" key={x.id}>
              <div className="task-icon amber">
                <BookOpen size={18} />
              </div>
              <div className="task-main">
                <b>
                  {x.subject} · {x.content}
                </b>
                <span>
                  {x.due_label} · {x.support_mode}
                </span>
              </div>
              <span className="tag warning">{x.status}</span>
            </div>
          ))}
          {!pending.length && <p className="empty">今天暂无待完成安排</p>}
          <button className="add-dashed" onClick={add}>
            <Plus size={17} />
            记录今天的新发现
          </button>
        </div>
        <div className="panel pending">
          <div className="panel-head">
            <div>
              <span className="kicker">TOGETHER</span>
              <h3>共同跟进</h3>
            </div>
            <span className="count-badge">{active.length}</span>
          </div>
          {active.slice(0, 2).map((x) => (
            <div className="decision" key={x.id}>
              <div className="decision-avatar">{x.owner.slice(0, 1)}</div>
              <div>
                <b>{x.title}</b>
                <span>
                  {x.owner}负责 · {x.status}
                </span>
              </div>
              <button
                aria-label="查看共同跟进"
                className="round-arrow"
                onClick={() => go("followups")}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          ))}
          <button className="link-btn" onClick={() => go("followups")}>
            查看全部跟进 <ChevronRight size={15} />
          </button>
        </div>
      </section>
      <section className="grid three">
        <div className="panel support">
          <div className="panel-head">
            <div>
              <span className="kicker">SUPPORT</span>
              <h3>近期需要支持</h3>
            </div>
            <span className="soft-count">{active.length} 件</span>
          </div>
          {active.slice(0, 2).map((x) => (
            <div className="support-item" key={x.id}>
              <span
                className={
                  "priority " +
                  (x.priority === "高"
                    ? "high"
                    : x.priority === "中"
                      ? "normal"
                      : "low")
                }
              >
                {x.priority}
              </span>
              <div>
                <b>{x.title}</b>
                <span>{x.review_label}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="panel change">
          <div className="panel-head">
            <div>
              <span className="kicker">A SMALL CHANGE</span>
              <h3>最近的变化</h3>
            </div>
            <TrendingUp size={19} color="#3b8171" />
          </div>
          <div className="metric">
            <strong>{data.records.length}</strong>
            <div>
              <b>成长记录</b>
              <span>来自家庭共同记录</span>
            </div>
          </div>
          <div className="metric">
            <strong>
              {data.goals.filter((x) => x.status === "已完成").length}
            </strong>
            <div>
              <b>已完成目标</b>
              <span>不作为孩子评价</span>
            </div>
          </div>
        </div>
        <div className="panel activity">
          <div className="panel-head">
            <div>
              <span className="kicker">ACTIVITY</span>
              <h3>家庭动态</h3>
            </div>
          </div>
          {data.records.slice(0, 3).map((r) => (
            <div className="activity-row" key={r.id}>
              <span className={"activity-dot " + r.tone} />
              <div>
                <b>家庭记录了一个新发现</b>
                <span>
                  {r.title} · {r.time}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChildPage({ child, edit }: { child: Child; edit: () => void }) {
  return (
    <div className="content">
      <div className="profile-head">
        <div className="large-avatar">{child.nickname.slice(-1)}</div>
        <div>
          <p className="muted">孩子档案</p>
          <h2>{child.nickname}</h2>
          <span className="profile-sub">
            {child.age} 岁 · {child.grade}
          </span>
        </div>
        <div className="profile-details">
          <div><span>身高</span><b>{child.height || "未记录"}</b></div>
          <div><span>体重</span><b>{child.weight || "未记录"}</b></div>
        </div>
        <button className="btn ghost" onClick={edit}>
          编辑资料
        </button>
      </div>
      <div className="grid two">
        <div className="panel">
          <div className="panel-head">
            <h3>兴趣与优势</h3>
          </div>
          <div className="pill-list">
            {child.interests.map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          <p className="note">
            基于家庭观察记录，随时间更新，不代表固定能力等级。
          </p>
        </div>
        <div className="panel voice">
          <div className="panel-head">
            <h3>孩子的声音</h3>
            <MessageCircle size={18} />
          </div>
          <blockquote>
            “我想把天空涂成橙色，因为今天的云就是这个颜色。”
          </blockquote>
          <span className="quote-source">由家长转录</span>
        </div>
      </div>
      <div className="panel support-note">
        <div className="panel-head">
          <h3>当前支持方式</h3>
          <span className="tag">进行中</span>
        </div>
        <p>{child.support_note}</p>
      </div>
      <div className="panel traits-panel">
        <div className="panel-head">
          <div>
            <span className="kicker">WELLBEING</span>
            <h3>身心特征</h3>
          </div>
        </div>
        {child.traits ? (
          <p>{child.traits}</p>
        ) : (
          <p className="empty-state">尚未记录身心特征，可通过“编辑资料”补充。</p>
        )}
      </div>
    </div>
  );
}

function RecordsPage({
  records,
  filter,
  setFilter,
  add,
  edit,
  remove,
  convert,
}: {
  records: GrowthRecord[];
  filter: string;
  setFilter: (s: string) => void;
  add: () => void;
  edit: (r: GrowthRecord) => void;
  remove: (r: GrowthRecord) => void;
  convert: (r: GrowthRecord) => void;
}) {
  const list =
    filter === "全部" ? records : records.filter((x) => x.cat === filter);
  return (
    <div className="content">
      <PageHead
        hint="把日常的小事留下来"
        title="成长记录"
        action="新增记录"
        onClick={add}
      />
      <div className="filter-row">
        {["全部", "学习", "生活习惯", "兴趣活动", "亲子沟通"].map((x) => (
          <button
            key={x}
            className={"filter " + (filter === x ? "active" : "")}
            onClick={() => setFilter(x)}
          >
            {x}
          </button>
        ))}
      </div>
      <div className="timeline">
        {list.map((r) => (
          <article className="record-card" key={r.id}>
            <div className={"record-marker " + r.tone} />
            <div className="record-body">
              <div className="record-meta">
                <span>{r.cat}</span>
                <time>{r.time}</time>
              </div>
              <h3>{r.title}</h3>
              <p className="quote">“{r.quote}”</p>
              <div className="record-footer">
                <span>记录人：家庭成员 · 版本 {r.version}</span>
                <div className="row-actions">
                  <button className="text-btn" onClick={() => edit(r)}>
                    <Pencil size={13} /> 编辑
                  </button>
                  <button className="text-btn danger" onClick={() => remove(r)}>
                    <Trash2 size={13} /> 删除
                  </button>
                  <button className="text-btn" onClick={() => convert(r)}>
                    转为跟进 <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </article>
        ))}
        {!list.length && <p className="empty">该分类还没有记录</p>}
      </div>
    </div>
  );
}

function LearningPage({
  plan,
  entries,
  items,
  add,
  editPlan,
  addEntry,
  editItem,
  removeItem,
  editEntry,
  removeEntry,
  updateStatus,
}: {
  plan: SchedulePlan;
  entries: ScheduleEntry[];
  items: Homework[];
  add: () => void;
  editPlan: () => void;
  addEntry: () => void;
  editItem: (x: Homework) => void;
  removeItem: (x: Homework) => void;
  editEntry: (x: ScheduleEntry) => void;
  removeEntry: (x: ScheduleEntry) => void;
  updateStatus: (x: Homework, status: string) => void;
}) {
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const rows = useMemo(() => {
    const presetKeys = [
      ...Array.from({ length: 6 }, (_, i) => `课程表|第${i + 1}节`),
      "饮食|早餐",
      "饮食|午餐",
      "饮食|晚餐",
    ];
    const keys = [
      ...presetKeys,
      ...new Set(
        entries
          .map((x) => `${x.category}|${x.module}`)
          .filter((key) => !presetKeys.includes(key)),
      ),
    ];
    return keys.map((key) => {
      const [category, module] = key.split("|");
      return {
        category,
        module,
        byDay: days.map((_, i) =>
          entries.filter(
            (x) =>
              x.category === category &&
              x.module === module &&
              x.weekday === i + 1,
          ),
        ),
      };
    });
  }, [entries]);
  const week = getScheduleWeek(plan);
  const activeItems = items.filter((x) => x.status !== "已完成");
  const completedItems = items.filter((x) => x.status === "已完成");
  const renderItem = (x: Homework) => (
    <div className="homework-row" key={x.id}>
      <div className={"check-circle " + (x.status === "已完成" ? "done" : "")}>
        {x.status === "已完成" && <CheckCircle2 size={19} />}
      </div>
      <div className="hw-content">
        <b>{x.subject} · {x.content}</b>
        <span>
          {x.due_label} · {x.support_mode}
          {x.check_required ? " · 需要检查" : ""}
        </span>
      </div>
      <div className="row-actions">
        <button className="icon-action" title="编辑" aria-label="编辑" onClick={() => editItem(x)}>
          <Pencil size={15} />
        </button>
        <button className="icon-action danger" title="删除" aria-label="删除" onClick={() => removeItem(x)}>
          <Trash2 size={15} />
        </button>
        <label className="status-editor">
          <span>编辑状态</span>
          <select
            aria-label={`编辑“${x.subject} · ${x.content}”的状态`}
            value={x.status}
            onChange={(event) => updateStatus(x, event.target.value)}
          >
            <option value="未开始">未开始</option>
            <option value="进行中">进行中</option>
            <option value="已完成">已完成</option>
          </select>
        </label>
      </div>
    </div>
  );
  return (
    <div className="content">
      <PageHead
        hint="周期计划与单次事项"
        title="日常安排"
        action="新增单次安排"
        onClick={add}
      />
      <div className="subsection-head">
        <div>
          <span className="kicker">ONE-TIME ITEMS</span>
          <h3>单次安排</h3>
        </div>
        <span>{activeItems.length} 项进行中</span>
      </div>
      <div className="panel homework-panel">
        <div className="section-label">近期事项</div>
        {activeItems.map(renderItem)}
        {!activeItems.length && <p className="empty">当前没有待完成安排</p>}
      </div>
      {!!completedItems.length && (
        <details className="archive-panel schedule-archive">
          <summary>历史完成 · {completedItems.length} 项</summary>
          <div className="panel homework-panel">{completedItems.map(renderItem)}</div>
        </details>
      )}
      <section className="schedule-section">
        <div className="schedule-heading">
          <div>
            <span className="kicker">{plan.name}</span>
            <h3>本周安排，第{week.number}周</h3>
            <p>（{formatDate(week.start)}-{formatDate(week.end)}）</p>
          </div>
          <div className="inline-actions">
            <button className="btn ghost" onClick={editPlan}>
              编辑周期
            </button>
            <button className="btn primary" onClick={addEntry}>
              <Plus size={16} />
              录入周安排
            </button>
          </div>
        </div>
        <div className="schedule-scroll">
          <table className="schedule-table">
            <thead>
              <tr>
                <th>日常安排</th>
                <th>主要模块</th>
                {days.map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const firstInGroup =
                  rowIndex === 0 || rows[rowIndex - 1].category !== row.category;
                let rowSpan = 1;
                while (
                  rowIndex + rowSpan < rows.length &&
                  rows[rowIndex + rowSpan].category === row.category
                ) {
                  rowSpan += 1;
                }
                return (
                  <tr key={`${row.category}-${row.module}`}>
                    {firstInGroup && <th rowSpan={rowSpan}>{row.category}</th>}
                    <td className="schedule-module">{row.module}</td>
                    {row.byDay.map((list, i) => (
                      <td key={i}>
                        {list.map((x) => (
                          <div className="schedule-cell" key={x.id}>
                            {x.time_label && <time>{x.time_label}</time>}
                            <span>{x.content}</span>
                            <div className="schedule-actions">
                              <button title="编辑" aria-label="编辑周安排" onClick={() => editEntry(x)}>
                                <Pencil size={12} />
                              </button>
                              <button title="删除" aria-label="删除周安排" onClick={() => removeEntry(x)}>
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function getScheduleWeek(plan: SchedulePlan) {
  const parse = (value: string) => new Date(`${value}T00:00:00`);
  const start = parse(plan.period_start);
  const end = parse(plan.period_end);
  const today = new Date();
  const reference = today < start ? start : today > end ? end : today;
  const monday = (value: Date) => {
    const result = new Date(value);
    const offset = (result.getDay() + 6) % 7;
    result.setDate(result.getDate() - offset);
    result.setHours(0, 0, 0, 0);
    return result;
  };
  const firstMonday = monday(start);
  const currentMonday = monday(reference);
  const number = Math.floor(
    (currentMonday.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000),
  ) + 1;
  const weekEnd = new Date(currentMonday);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const iso = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  return { number, start: iso(currentMonday), end: iso(weekEnd) };
}

function FollowupsPage({
  items,
  add,
  edit,
  remove,
  advance,
  complete,
}: {
  items: FollowUp[];
  add: () => void;
  edit: (x: FollowUp) => void;
  remove: (x: FollowUp) => void;
  advance: (x: FollowUp) => void;
  complete: (x: FollowUp) => void;
}) {
  const active = items.filter((x) => x.status !== "已结束");
  const completed = items.filter((x) => x.status === "已结束");
  const renderCard = (x: FollowUp) => (
    <article className="follow-card" key={x.id}>
      <div className="follow-top">
        <span className={"priority " + (x.priority === "高" ? "high" : x.priority === "中" ? "normal" : "low")}>
          {x.priority}
        </span>
        <span className="tag teal-tag">{x.status}</span>
      </div>
      <h3>{x.title}</h3>
      <p>{x.fact}</p>
      {x.conclusion && <p className="conclusion">回顾：{x.conclusion}</p>}
      <div className="follow-bottom">
        <span>负责人：{x.owner}</span>
        <span>{x.review_label}</span>
        <div className="row-actions">
          <button className="icon-action" title="编辑" aria-label="编辑" onClick={() => edit(x)}><Pencil size={14} /></button>
          <button className="icon-action danger" title="删除" aria-label="删除" onClick={() => remove(x)}><Trash2 size={14} /></button>
          {x.status !== "已结束" && (
            <button className="text-btn complete-action" onClick={() => complete(x)}>
              <CheckCircle2 size={14} /> 完成跟进
            </button>
          )}
          <button className="text-btn" onClick={() => advance(x)}>
            {x.status === "已结束" ? "重新开启" : "推进状态"} <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </article>
  );
  return (
    <div className="content">
      <PageHead
        hint="一起看见，一起行动"
        title="共同跟进"
        action="新建跟进"
        onClick={add}
      />
      <div className="tabs">
        <button className="active">
          进行中 <b>{active.length}</b>
        </button>
      </div>
      <div className="follow-grid">
        {active.map(renderCard)}
        {!active.length && <p className="empty">当前没有进行中的共同跟进</p>}
      </div>
      {!!completed.length && (
        <details className="archive-panel">
          <summary>历史完成 · {completed.length} 项</summary>
          <div className="follow-grid archive-content">{completed.map(renderCard)}</div>
        </details>
      )}
    </div>
  );
}

function GoalsPage({
  items,
  add,
  edit,
  remove,
  update,
}: {
  items: Goal[];
  add: () => void;
  edit: (x: Goal) => void;
  remove: (x: Goal) => void;
  update: (x: Goal, s: string) => void;
}) {
  const active = items.filter((x) => x.status !== "已完成");
  const completed = items.filter((x) => x.status === "已完成");
  const renderGoal = (x: Goal) => (
    <article className="goal-card" key={x.id}>
      <div className="goal-icon teal"><Compass size={19} /></div>
      <div>
        <span className="kicker">{x.category} · {x.status}</span>
        <h3>{x.title}</h3>
        <p>孩子{x.child_agreement} · 家长支持：{x.parent_support || "待补充"}</p>
        <div className="goal-foot">
          <span>下一次回顾：{x.review_label}</span>
          <div className="row-actions">
            <button className="icon-action" title="编辑" aria-label="编辑" onClick={() => edit(x)}><Pencil size={14} /></button>
            <button className="icon-action danger" title="删除" aria-label="删除" onClick={() => remove(x)}><Trash2 size={14} /></button>
            <button className="text-btn" onClick={() => update(x, x.status === "已完成" ? "进行中" : "已完成")}>
              {x.status === "已完成" ? "重新开始" : "标记完成"}
            </button>
            {x.status !== "已完成" && (
              <button className="text-btn" onClick={() => update(x, "已暂停")}>暂停</button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
  return (
    <div className="content">
      <PageHead
        hint="不急着变得更好，先找到方向"
        title="成长方向"
        action="新增目标"
        onClick={add}
      />
      <div className="direction-banner">
        <Compass size={21} />
        <div>
          <b>长期方向</b>
          <p>成为一个愿意探索、能够表达、也能照顾自己的孩子。</p>
        </div>
      </div>
      <div className="section-title">
        <h3>阶段目标</h3>
        <span>{active.length} 个进行中</span>
      </div>
      <div className="goal-list">
        {active.map(renderGoal)}
        {!active.length && <p className="empty">当前没有进行中的阶段目标</p>}
      </div>
      {!!completed.length && (
        <details className="archive-panel">
          <summary>历史完成 · {completed.length} 项</summary>
          <div className="goal-list archive-content">{completed.map(renderGoal)}</div>
        </details>
      )}
    </div>
  );
}

function SettingsPage({
  family,
  accounts,
  currentAccountId,
  canManage,
  dataLocation,
  edit,
  addAccount,
  editAccount,
  removeAccount,
}: {
  family: Family;
  accounts: FamilyAccount[];
  currentAccountId: string;
  canManage: boolean;
  dataLocation: string;
  edit: () => void;
  addAccount: () => void;
  editAccount: (account: FamilyAccount) => void;
  removeAccount: (account: FamilyAccount) => void;
}) {
  return (
    <div className="content">
      <PageHead
        hint="家庭与协作"
        title="家庭设置"
        action={canManage ? "编辑设置" : undefined}
        onClick={canManage ? edit : undefined}
      />
      <div className="grid two">
        <div className="panel">
          <h3>家庭空间</h3>
          <dl className="detail-list">
            <div>
              <dt>名称</dt>
              <dd>{family.name}</dd>
            </div>
            <div>
              <dt>家庭时区</dt>
              <dd>{family.timezone}</dd>
            </div>
            <div>
              <dt>数据位置</dt>
              <dd>{dataLocation}</dd>
            </div>
          </dl>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>家庭登录账户</h3>
            {canManage && <button className="btn compact" onClick={addAccount}><Plus size={14} />新增账户</button>}
          </div>
          {accounts.map((account) => (
            <div className="member-row account-row" key={account.id}>
              <span className="decision-avatar">{account.display_name.slice(0, 1)}</span>
              <div>
                <b>{account.display_name}</b>
                <small>@{account.username} · {account.role}{account.id === currentAccountId ? " · 当前账户" : ""}</small>
              </div>
              {canManage && <button className="icon-action" title="编辑账户" aria-label="编辑账户" onClick={() => editAccount(account)}><Pencil size={14} /></button>}
              {canManage && account.id !== currentAccountId && (
                <button className="icon-action danger" title="删除账户" aria-label="删除账户" onClick={() => removeAccount(account)}><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PageHead({
  hint,
  title,
  action,
  onClick,
}: {
  hint: string;
  title: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="page-toolbar">
      <div>
        <p className="muted">{hint}</p>
        <h2>{title}</h2>
      </div>
      {action && onClick && (
        <button className="btn primary" onClick={onClick}>
          <Plus size={17} />
          {action}
        </button>
      )}
    </div>
  );
}

function Editor({
  modal,
  data,
  target,
  close,
  submit,
}: {
  modal: Exclude<Modal, null>;
  data: AppData;
  target: GrowthRecord | Homework | ScheduleEntry | FollowUp | Goal | FamilyAccount | null;
  close: () => void;
  submit: (kind: Exclude<Modal, null>, payload: unknown, id?: string) => Promise<boolean>;
}) {
  const record = modal === "record" ? (target as GrowthRecord | null) : null;
  const homework = modal === "homework" ? (target as Homework | null) : null;
  const entry = modal === "scheduleEntry" ? (target as ScheduleEntry | null) : null;
  const followup = modal === "followup" ? (target as FollowUp | null) : null;
  const completing = modal === "completeFollowup" ? (target as FollowUp | null) : null;
  const goal = modal === "goal" ? (target as Goal | null) : null;
  const account = modal === "account" ? (target as FamilyAccount | null) : null;
  const send = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (modal === "record")
      submit(modal, {
        title: f.get("title"),
        category: f.get("category"),
        child_quote: f.get("quote"),
      }, target?.id);
    if (modal === "homework")
      submit(modal, {
        subject: f.get("subject"),
        content: f.get("content"),
        due_label: f.get("due"),
        support_mode: f.get("support"),
        check_required: f.get("check") === "on",
      }, target?.id);
    if (modal === "schedulePlan")
      submit(modal, {
        name: f.get("name"),
        period_start: f.get("start"),
        period_end: f.get("end"),
      }, target?.id);
    if (modal === "scheduleEntry")
      submit(modal, {
        category: f.get("category"),
        module: f.get("module"),
        weekday: Number(f.get("weekday")),
        time_label: f.get("time"),
        content: f.get("content"),
      }, target?.id);
    if (modal === "followup")
      submit(modal, {
        title: f.get("title"),
        fact: f.get("fact"),
        owner: f.get("owner"),
        review_label: f.get("review"),
        priority: f.get("priority"),
      }, target?.id);
    if (modal === "completeFollowup")
      submit(modal, {
        conclusion: f.get("conclusion"),
      }, target?.id);
    if (modal === "goal")
      submit(modal, {
        title: f.get("title"),
        category: f.get("category"),
        child_agreement: f.get("agreement"),
        parent_support: f.get("support"),
        review_label: f.get("review"),
      }, target?.id);
    if (modal === "account")
      submit(modal, {
        username: f.get("username"),
        password: f.get("password"),
        display_name: f.get("display_name"),
        role: f.get("role"),
      }, target?.id);
      if (modal === "child")
        submit(modal, {
          nickname: f.get("nickname"),
          age: Number(f.get("age")),
          grade: f.get("grade"),
          height: f.get("height"),
          weight: f.get("weight"),
          traits: f.get("traits"),
          focus_direction: f.get("focus_direction"),
          interests: String(f.get("interests")).split(/[，,]/),
          support_note: f.get("support"),
      });
    if (modal === "family")
      submit(modal, {
        name: f.get("name"),
        timezone: f.get("timezone"),
        members: String(f.get("members")).split(/[，,]/),
      });
  };
  const titles = {
    record: "记录孩子的今天",
    homework: "新增单次安排",
    schedulePlan: "编辑周期计划",
    scheduleEntry: "录入周安排",
    followup: "建立共同跟进",
    completeFollowup: "完成跟进",
    goal: "新增阶段目标",
    child: "编辑孩子档案",
    family: "编辑家庭设置",
    account: "家庭登录账户",
  };
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">安全保存</span>
            <h2>
              {target && modal !== "completeFollowup"
                ? `编辑：${titles[modal]}`
                : titles[modal]}
            </h2>
          </div>
          <button aria-label="关闭表单" className="icon-btn" onClick={close}>
            <X />
          </button>
        </div>
        <form onSubmit={send}>
          {modal === "record" && (
            <>
              <Field
                name="title"
                label="发生了什么"
                placeholder="写下看到的事实"
                defaultValue={record?.title}
              />
              <Select
                name="category"
                label="分类"
                values={[
                  "学习",
                  "生活习惯",
                  "兴趣活动",
                  "亲子沟通",
                  "其他观察",
                ]}
                defaultValue={record?.cat}
              />
              <Field
                name="quote"
                label="孩子怎么说"
                placeholder="记录孩子原话，可选"
                optional
                defaultValue={record?.quote}
              />
            </>
          )}
          {modal === "homework" && (
            <>
              <Field name="subject" label="科目" placeholder="例如：数学" defaultValue={homework?.subject} />
              <Field
                name="content"
                label="安排内容"
                placeholder="具体要完成什么"
                defaultValue={homework?.content}
              />
              <Field
                name="due"
                label="截止时间"
                placeholder="例如：明天 20:00"
                defaultValue={homework?.due_label}
              />
              <Select
                name="support"
                label="支持方式"
                values={["自己完成", "需要提示", "需要陪伴", "需要向老师求助"]}
                defaultValue={homework?.support_mode}
              />
              <label className="check-label">
                <input type="checkbox" name="check" defaultChecked={homework?.check_required || false} />
                完成后需要家长检查
              </label>
            </>
          )}
          {modal === "schedulePlan" && (
            <>
              <Field
                name="name"
                label="计划名称"
                defaultValue={data.schedule_plan.name}
              />
              <Field
                name="start"
                label="开始日期"
                type="date"
                defaultValue={data.schedule_plan.period_start}
              />
              <Field
                name="end"
                label="结束日期"
                type="date"
                defaultValue={data.schedule_plan.period_end}
              />
            </>
          )}
          {modal === "scheduleEntry" && (
            <>
              <ScheduleEntryFields entry={entry} />
              <Select
                name="weekday"
                label="星期"
                values={["1", "2", "3", "4", "5", "6", "7"]}
                defaultValue={entry ? String(entry.weekday) : undefined}
              />
              <Field
                name="time"
                label="时间段"
                placeholder="例如：12:00、20:30、白天"
                defaultValue={entry?.time_label}
              />
              <Field
                name="content"
                label="具体安排"
                placeholder="填写本日的内容"
                defaultValue={entry?.content}
              />
            </>
          )}
          {modal === "followup" && (
            <>
              <Field
                name="title"
                label="跟进主题"
                placeholder="需要共同支持的事项"
                defaultValue={followup?.title}
              />
              <Area name="fact" label="已经观察到的事实" defaultValue={followup?.fact} />
              <Field name="owner" label="主要负责人" defaultValue={followup?.owner || "妈妈"} />
              <Field name="review" label="回顾时间" defaultValue={followup?.review_label || "一周后回顾"} />
              <Select
                name="priority"
                label="影响程度"
                values={["中", "高", "低"]}
                defaultValue={followup?.priority}
              />
            </>
          )}
          {modal === "completeFollowup" && (
            <>
              <div className="completion-topic">
                <span>跟进项目</span>
                <strong>{completing?.title}</strong>
                <p>{completing?.fact}</p>
              </div>
              <Area
                name="conclusion"
                label="本轮回顾结论"
                placeholder="记录发生了什么变化、哪些方式有效，以及下一步建议"
              />
            </>
          )}
          {modal === "goal" && (
            <>
              <Field
                name="title"
                label="阶段目标"
                placeholder="具体、可回顾的方向"
                defaultValue={goal?.title}
              />
              <Field name="category" label="目标领域" defaultValue={goal?.category || "成长探索"} />
              <Select
                name="agreement"
                label="孩子是否认可"
                values={["待讨论", "认可", "不同意"]}
                defaultValue={goal?.child_agreement}
              />
              <Area name="support" label="家长支持方式" defaultValue={goal?.parent_support} />
              <Field name="review" label="回顾时间" defaultValue={goal?.review_label || "本月回顾"} />
            </>
          )}
          {modal === "account" && (
            <>
              <Field name="display_name" label="显示名称" placeholder="例如：爸爸" defaultValue={account?.display_name} />
              <Field name="username" label="登录账号" placeholder="至少 3 位" defaultValue={account?.username} />
              <Field
                name="password"
                label={account ? "新密码" : "登录密码"}
                placeholder={account ? "留空则不修改密码" : "至少 8 位"}
                type="password"
                optional={Boolean(account)}
              />
              <Select
                name="role"
                label="家庭角色"
                values={["监护人", "家庭成员", "照护者"]}
                defaultValue={account?.role || "家庭成员"}
              />
            </>
          )}
          {modal === "child" && (
            <>
              <Field
                name="nickname"
                label="昵称"
                defaultValue={data.child.nickname}
              />
              <Field
                name="age"
                label="年龄"
                type="number"
                defaultValue={String(data.child.age)}
              />
            <Field
              name="grade"
              label="年级"
              defaultValue={data.child.grade}
            />
            <Field
              name="height"
              label="身高"
              placeholder="例如：125 cm"
              defaultValue={data.child.height}
            />
            <Field
              name="weight"
              label="体重"
              placeholder="例如：25 kg"
              defaultValue={data.child.weight}
            />
            <Area
              name="traits"
              label="身心特征"
              placeholder="记录观察到的身心特点"
              defaultValue={data.child.traits}
            />
            <Area
              name="focus_direction"
              label="重点方向"
              placeholder="填写当前希望重点支持的方向"
              defaultValue={data.child.focus_direction}
            />
            <Area
                name="interests"
                label="兴趣与优势（逗号分隔）"
                defaultValue={data.child.interests.join("，")}
              />
              <Area
                name="support"
                label="当前支持方式"
                defaultValue={data.child.support_note}
              />
            </>
          )}
          {modal === "family" && (
            <>
              <Field
                name="name"
                label="家庭空间名称"
                defaultValue={data.family.name}
              />
              <Field
                name="timezone"
                label="家庭时区"
                defaultValue={data.family.timezone}
              />
              <Area
                name="members"
                label="家庭成员（逗号分隔）"
                defaultValue={data.family.members.join("，")}
              />
            </>
          )}
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={close}>
              取消
            </button>
            <button className="btn primary" type="submit">
              <CheckCircle2 size={17} />
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function Field(p: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  optional?: boolean;
  type?: string;
}) {
  return (
    <label>
      {p.label}
      {p.optional && <span className="hint">可选</span>}
      <input
        required={!p.optional}
        name={p.name}
        type={p.type || "text"}
        placeholder={p.placeholder}
        defaultValue={p.defaultValue}
      />
    </label>
  );
}
function Area(p: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label>
      {p.label}
      <textarea
        required
        name={p.name}
        defaultValue={p.defaultValue}
        placeholder={p.placeholder}
      />
    </label>
  );
}
function Select({
  name,
  label,
  values,
  defaultValue,
  onChange,
}: {
  name: string;
  label: string;
  values: string[];
  defaultValue?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
}) {
  const dayNames: Record<string, string> = {
    "1": "周一",
    "2": "周二",
    "3": "周三",
    "4": "周四",
    "5": "周五",
    "6": "周六",
    "7": "周日",
  };
  return (
    <label>
      {label}
      <select name={name} defaultValue={defaultValue} onChange={onChange}>
        {values.map((x) => (
          <option key={x} value={x}>
            {name === "weekday" ? dayNames[x] : x}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScheduleEntryFields({ entry }: { entry: ScheduleEntry | null }) {
  const [category, setCategory] = useState(entry?.category || "课程表");
  const options: Record<string, string[]> = {
    课程表: ["第1节", "第2节", "第3节", "第4节", "第5节", "第6节"],
    饮食: ["早餐", "午餐", "晚餐"],
    运动: ["校内活动", "户外活动", "自主运动"],
    睡眠: ["午休", "夜间睡眠"],
    睡前时光: ["故事 / 反思"],
    其他: ["其他"],
  };
  const moduleOptions = options[category] || options.其他;
  if (entry?.category === category && !moduleOptions.includes(entry.module)) {
    moduleOptions.push(entry.module);
  }
  return (
    <>
      <Select
        name="category"
        label="日常安排"
        values={["课程表", "饮食", "运动", "睡眠", "睡前时光", "其他"]}
        defaultValue={category}
        onChange={(event) => setCategory(event.target.value)}
      />
      <Select
        key={category}
        name="module"
        label="主要模块"
        values={moduleOptions}
        defaultValue={entry?.category === category ? entry.module : moduleOptions[0]}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
