import React, { useEffect, useRef, useState } from "react";
import { json, request } from "./api";
import "./ai-support.css";

type Source = { id: string; title?: string; content?: string; subject?: string; [key: string]: unknown };
type Advice = { goal: string; steps: string[]; frequency: string; review: string; source_ids: string[] };
type Item = { id: string; advice: Advice; status: string; version: number; target_kind: string; target_id: string };
type Fact = { text: string; source_ids: string[] };
type TutoringPlan = { source_id: string; task_summary: string; objectives: string[]; plan: string[]; solution_approach: string[]; parent_prompts: string[]; self_check: string[] };
type Analysis = { id: string; created_at: string; model: string; items: Item[]; changed?: boolean; deleted?: boolean; current_hash?: string;
  current_snapshot?: Preview["snapshot"];
  snapshot?: { sources: Source[]; context: Record<string, unknown> }; result?: { facts: Fact[]; strengths: Fact[]; questions: string[]; hypotheses: Fact[]; tutoring?: TutoringPlan | null } };
type Preview = { hash: string; snapshot: { sources: Source[]; context: Record<string, unknown> } };
const subjects = ["语文", "数学", "英语", "体育", "自然", "人文", "积木", "其他"];
const statusNames: Record<string, string> = { pending: "待审核", accepted: "已采纳", rejected: "未采纳" };
const newRequestId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join("-");

export function AiSupport({ guardian, single, onOpen }: {
  guardian: boolean; single: { key: string; nonce: number } | null;
  onOpen: (kind: string, id: string) => Promise<void>;
}) {
  const root = useRef<HTMLElement>(null);
  const actionForm = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"closed" | "select" | "history" | "result">("closed");
  const [days, setDays] = useState(7);
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [context, setContext] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [requestId, setRequestId] = useState("");
  const [action, setAction] = useState<{ item: Item; kind: string } | null>(null);
  useEffect(() => { if (action) actionForm.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [action]);
  const execute = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof TypeError ? "网络连接失败，填写内容已保留，请检查网络后重试" : e instanceof Error ? e.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  };
  const loadCandidates = async (range: number) => {
    const data = await request<{ sources: Source[]; enabled: boolean }>(`/ai/candidates?days=${range}`);
    setSources(data.sources); setSelected(data.sources.slice(0, 50).map(x => x.id));
    setEnabled(data.enabled); setPreview(null); setContext([]);
  };
  useEffect(() => {
    if (!single || !guardian) return;
    root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMode("select"); setAction(null);
    void execute(async () => {
      const p = await request<Preview>("/ai/preview", json("POST", { sources: [single.key], context: [] }));
      setSources(p.snapshot.sources); setSelected([single.key]); setContext([]); setPreview(p);
      setRequestId(newRequestId());
      const state = await request<{ enabled: boolean }>("/ai/candidates?days=7"); setEnabled(state.enabled);
    });
  }, [single?.nonce]);
  const changeSelection = (ids: string[]) => { setSelected(ids); setPreview(null); };
  const showAnalysis = (a: Analysis) => { setAnalysis(a); setMode("result"); setAction(null); };
  const review = async (item: Item, advice: Advice, status: string) => {
    const a = await request<Analysis>(`/ai/suggestions/${item.id}`, json("PUT", { version: item.version, advice, status }));
    setAnalysis(a);
  };

  return <section ref={root} className="ai-support panel" aria-label="AI 梳理">
    <div className="ai-toolbar">
      <strong>AI 梳理 · 家长决定是否采纳</strong>
      {guardian && <button disabled={busy} onClick={() => { setMode("select"); void execute(() => loadCandidates(days)); }}>阶段梳理</button>}
      <button disabled={busy} onClick={() => void execute(async () => {
        setHistory(await request<Analysis[]>("/ai/analyses")); setMode("history");
      })}>建议历史</button>
      {mode !== "closed" && <button disabled={busy} onClick={() => setMode("closed")}>收起</button>}
    </div>
    {error && <p role="alert" className="ai-error">{error}</p>}
    {busy && <p role="status">正在处理，请稍候。生成最多等待约一分钟。</p>}
    {mode === "select" && guardian && <fieldset disabled={busy} className="ai-fields">
      <label>阶段范围<select value={days} onChange={e => { const n = Number(e.target.value); setDays(n); void execute(() => loadCandidates(n)); }}>
        <option value={7}>近7天</option><option value={30}>近30天</option>
      </select></label>
      <p className="hint">按北京时间：成长记录按记录时间，辅导安排按创建时间筛选。课程表不参与。最多50条、20000字。</p>
      {!enabled && <p role="status">服务器尚未启用 AI 或未配置密钥，可先预览资料。</p>}
      <div className="ai-toolbar">
        <button onClick={() => changeSelection(sources.slice(0, 50).map(x => x.id))}>选择前50条</button>
        <button onClick={() => changeSelection([])}>清空选择</button>
        <span>已选 {selected.length} 条</span>
      </div>
      <div className="ai-sources">{sources.map(s => <label className="ai-check" key={s.id}>
        <input type="checkbox" checked={selected.includes(s.id)} onChange={e => changeSelection(e.target.checked ? [...selected, s.id] : selected.filter(x => x !== s.id))} />
        <span>{s.id.startsWith("record:") ? "成长记录" : "辅导安排"} · {s.title || `${s.subject}：${s.content}`}</span>
      </label>)}</div>
      {!sources.length && <p>此范围暂无资料，请扩大范围或先新增记录。</p>}
      <p>默认仅附年龄、年级。以下背景资料可选：</p>
      {[["interests", "兴趣"], ["support_note", "当前支持方式"], ["traits", "身心特征（含参考资料，不等同实际表现）"]].map(([key, label]) => <label className="ai-check" key={key}>
        <input type="checkbox" checked={context.includes(key)} onChange={e => { setContext(e.target.checked ? [...context, key] : context.filter(x => x !== key)); setPreview(null); }} />{label}
      </label>)}
      <button disabled={!selected.length || selected.length > 50} onClick={() => void execute(async () => {
        setPreview(await request<Preview>("/ai/preview", json("POST", { sources: selected, context })));
        setRequestId(newRequestId());
      })}>预览发送内容</button>
      {preview && <div>
        <p><strong>以下内容将发送至 DeepSeek。</strong>请检查正文是否包含不希望分享的信息；可返回取消选择。</p>
        <details open><summary>资料预览</summary><SourcePreview snapshot={preview.snapshot} /></details>
        <button disabled={!enabled} onClick={() => void execute(async () => {
          const a = await request<Analysis>("/ai/analyses", json("POST", { sources: selected, context, preview_hash: preview.hash, request_id: requestId }));
          showAnalysis(a);
        })}>确认发送并生成建议</button>
      </div>}
    </fieldset>}
    {mode === "history" && <div>{!history.length && <p>暂无可查看的建议。</p>}{history.map(a => <button key={a.id} disabled={busy} onClick={() => void execute(async () => showAnalysis(await request<Analysis>(`/ai/analyses/${a.id}`)))}>
      {new Date(a.created_at).toLocaleString("zh-CN")} · {a.items.length}条建议
    </button>)}</div>}
    {mode === "result" && analysis && <div>
      <p className="hint">AI 生成，仅供家长参考；请结合实际观察。模型：{analysis.model}</p>
      {analysis.changed && <p role="status">资料已更新{analysis.deleted ? "或已删除，禁止转为行动。" : "，转为行动前请重新核对。"}</p>}
      {analysis.result && <>
        {analysis.result.tutoring && <section className="ai-tutoring">
          <h3>作业辅导计划与解决思路</h3>
          <p>{analysis.result.tutoring.task_summary}</p>
          {([['objectives', '学习目标'], ['plan', '辅导计划'], ['solution_approach', '解决思路'], ['parent_prompts', '家长引导提问'], ['self_check', '孩子自查清单']] as const).map(([key, title]) => <section key={key}>
            <h4>{title}</h4><ol>{analysis.result!.tutoring![key].map((line, i) => <li key={i}>{line}</li>)}</ol>
          </section>)}
          <p className="hint">以下建议可逐条编辑和采纳，不会自动修改作业或创建行动。</p>
        </section>}
        {([['facts', '事实摘要'], ['strengths', '优势与进展'], ['hypotheses', '可能原因（推测，不是事实）']] as const).map(([key, title]) => <section key={key}>
          <h4>{title}</h4>{analysis.result![key].map((f, i) => <p key={i}>{f.text}<small className="ai-citations">依据：{f.source_ids.map(id => analysis.snapshot?.sources.find(s => s.id === id)?.title || analysis.snapshot?.sources.find(s => s.id === id)?.content || id).join("；")}</small></p>)}
        </section>)}
        <h4>需要进一步了解</h4><ul>{analysis.result.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
      </>}
      {analysis.items.map(item => <AdviceCard key={`${item.id}:${item.version}`} item={item} guardian={guardian} busy={busy} deleted={Boolean(analysis.deleted)}
        onReview={(advice, status) => void execute(() => review(item, advice, status))}
        onAction={kind => void execute(async () => {
          const fresh = await request<Analysis>(`/ai/analyses/${analysis.id}`); setAnalysis(fresh);
          const current = fresh.items.find(x => x.id === item.id)!;
          if (current.target_id) { await onOpen(current.target_kind, current.target_id); return; }
          if (fresh.deleted) throw new Error("来源已删除，请重新生成建议");
          setAction({ item: current, kind });
        })} onOpen={() => void execute(() => onOpen(item.target_kind, item.target_id))} />)}
      {guardian && action && <form ref={actionForm} className="ai-action" onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        void execute(async () => {
          const target = await request<{ kind: string; id: string }>(`/ai/suggestions/${action.item.id}/action`, json("POST", {
            ...Object.fromEntries(f), kind: action.kind, version: action.item.version, current_hash: analysis.current_hash,
          }));
          setAnalysis(await request<Analysis>(`/ai/analyses/${analysis.id}`)); setAction(null); await onOpen(target.kind, target.id);
        });
      }}>
        <h4>确认创建{action.kind === "followup" ? "共同跟进" : "辅导安排"}</h4>
        {analysis.current_snapshot && <details open><summary>更新后的资料，请核对</summary><SourcePreview snapshot={analysis.current_snapshot} /></details>}
        {analysis.changed && <label className="ai-check"><input name="confirm_updated" type="checkbox" required />我已核对更新后的资料，仍采纳此方案</label>}
        <label>目标<input name="title" required maxLength={300} defaultValue={action.item.advice.goal} /></label>
        <label>行动内容<textarea name="content" required maxLength={1000} defaultValue={`${action.item.advice.goal}\n${action.item.advice.steps.join("\n")}\n频次：${action.item.advice.frequency}\n回顾：${action.item.advice.review}`} /></label>
        {action.kind === "followup" ? <>
          <label>负责人<input name="owner" required maxLength={80} /></label>
          <label>回顾日期<input name="review_date" type="date" required /></label>
        </> : <>
          <label>类型<select name="type">{["家庭作业", "课外项目", "其他"].map(x => <option key={x}>{x}</option>)}</select></label>
          <label>科目<select name="subject">{subjects.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>截止时间<input name="due_label" type="datetime-local" required /></label>
          <label>支持方式<select name="support_mode">{["自己完成", "需要提示", "需要陪伴", "需要向老师求助"].map(x => <option key={x}>{x}</option>)}</select></label>
        </>}
        <button disabled={busy}>确认创建</button><button type="button" disabled={busy} onClick={() => setAction(null)}>取消</button>
      </form>}
      {guardian && analysis.snapshot && <details><summary>生成时的资料快照</summary><SourcePreview snapshot={analysis.snapshot} /></details>}
    </div>}
  </section>;
}

function SourcePreview({ snapshot }: { snapshot: Preview["snapshot"] }) {
  const labels: Record<string, string> = { age: "年龄", grade: "年级", interests: "兴趣", support_note: "支持方式", traits: "身心特征", traits_note: "资料说明", title: "内容", content: "内容", category: "分类", child_quote: "孩子原话", occurred_at: "记录时间", created_at: "创建时间", type: "类型", subject: "科目", due_label: "截止时间", support_mode: "支持方式", status: "状态", check_required: "需家长检查", version: "版本" };
  const fields = (data: Record<string, unknown>) => Object.entries(data).filter(([k]) => k !== "id").map(([k, v]) => <p key={k}><b>{labels[k] || k}：</b>{String(v)}</p>);
  return <div className="ai-preview">{fields(snapshot.context)}{snapshot.sources.map((s, i) => <section key={s.id}><h4>资料 {i + 1}</h4>{fields(s)}</section>)}</div>;
}

function AdviceCard({ item, guardian, busy, deleted, onReview, onAction, onOpen }: {
  item: Item; guardian: boolean; busy: boolean; deleted: boolean;
  onReview: (a: Advice, s: string) => void; onAction: (kind: string) => void; onOpen: () => void;
}) {
  const [advice, setAdvice] = useState(item.advice);
  const dirty = JSON.stringify(advice) !== JSON.stringify(item.advice);
  const field = (key: "goal" | "frequency" | "review", label: string) => <label>{label}<textarea required maxLength={key === "goal" ? 300 : key === "frequency" ? 200 : 500} value={advice[key]} onChange={e => setAdvice({ ...advice, [key]: e.target.value })} /></label>;
  return <article className="ai-advice"><strong>{statusNames[item.status]}</strong>
    {guardian && !item.target_id ? <form onSubmit={e => { e.preventDefault(); const status = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-status") || "pending"; onReview(advice, status); }}>
      <fieldset disabled={busy}>{field("goal", "目标")}
        <label>支持步骤（每行一步，最多8步）<textarea required value={advice.steps.join("\n")} onChange={e => setAdvice({ ...advice, steps: e.target.value.split("\n") })} /></label>
        {field("frequency", "建议频次")}{field("review", "回顾要点")}
        <div className="ai-toolbar"><button data-status="pending">保存编辑／待审核</button><button data-status="accepted">采纳</button><button data-status="rejected">不采纳</button></div>
      </fieldset>
    </form> : <><h4>{advice.goal}</h4><ol>{advice.steps.map((s, i) => <li key={i}>{s}</li>)}</ol><p>频次：{advice.frequency}</p><p>回顾：{advice.review}</p></>}
    {item.target_id ? <button onClick={onOpen}>查看已创建行动</button> : guardian && item.status === "accepted" && <div className="ai-toolbar">
      <button disabled={busy || dirty || deleted} onClick={() => onAction("followup")}>转为共同跟进</button>
      <button disabled={busy || dirty || deleted} onClick={() => onAction("homework")}>转为辅导安排</button>
      {dirty && <small>请先保存并重新采纳修改后的建议。</small>}
    </div>}
  </article>;
}
