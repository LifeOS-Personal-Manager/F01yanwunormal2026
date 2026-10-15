import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { request, type Homework } from "./api";
import { HomeworkAttachments } from "./HomeworkAttachments";

type SavedAnalysis = { items: { status: string; target_id: string; advice: { steps: string[] } }[] };

export function HomeworkDetails({ item, guardian, onClose }: {
  item: Homework; guardian: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [advice, setAdvice] = useState("");
  const [loading, setLoading] = useState(guardian);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!guardian) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void request<SavedAnalysis[]>(`/ai/analyses?source_id=${encodeURIComponent(`homework:${item.id}`)}`, { signal: controller.signal })
      .then(rows => {
        if (controller.signal.aborted) return;
        const saved = rows.flatMap(row => row.items).find(entry => entry.status === "accepted" && !entry.target_id);
        setAdvice(saved?.advice.steps.join("\n") || "");
      })
      .catch(() => { if (!controller.signal.aborted) setError("暂时无法读取已保存的 AI 建议"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [item.id, guardian, attempt]);

  return <dialog ref={dialog} className="homework-detail-dialog" aria-label="安排详情" onClose={onClose}>
    <div className="homework-detail-head">
      <h2>{item.status === "已完成" ? "历史任务详情" : "安排详情"}</h2>
      <button type="button" className="icon-btn" aria-label="关闭安排详情" title="关闭" onClick={() => dialog.current?.close()}><X size={20} /></button>
    </div>
    <dl className="homework-detail-meta">
      {[["类型", item.type || "家庭作业"], ["科目", item.subject], ["状态", item.status], ["截止时间", item.due_label.replace("T", " ")],
        ["支持方式", item.support_mode], ["家长检查", item.check_required ? "需要" : "不需要"]].map(([label, value]) => <div key={label}>
        <dt>{label}</dt><dd>{value || "未填写"}</dd>
      </div>)}
    </dl>
    <section><h3>安排内容</h3><p className="homework-detail-text">{item.content}</p></section>
    {!!item.attachments?.length && <HomeworkAttachments files={item.attachments} readOnly />}
    {guardian && <section>
      <h3>已保存的 AI 建议</h3>
      {loading ? <p role="status">正在读取…</p> : error ? <>
        <p role="alert">{error}</p><button className="btn ghost" type="button" onClick={() => setAttempt(n => n + 1)}>重试</button>
      </> : <p className="homework-detail-text">{advice || "暂无已保存的建议"}</p>}
    </section>}
  </dialog>;
}
