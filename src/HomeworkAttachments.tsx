import { useEffect, useRef, useState } from "react";
import { api, downloadAttachment, type Attachment } from "./api";
import "./attachments.css";

const accept = ".doc,.docx,.pdf,.jpg,.jpeg,.png,.gif,.webp";
type AttachmentProps = { files: Attachment[]; disabled?: boolean } & (
  { readOnly: true; onChange?: never; onBusy?: never } |
  { readOnly?: false; onChange: (files: Attachment[]) => void; onBusy: (busy: boolean) => void }
);
export function HomeworkAttachments({ files, onChange, onBusy, disabled = false, readOnly = false }: AttachmentProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const temporary = useRef(new Set<string>());
  const lock = useRef(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const work = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof TypeError ? (readOnly ? "网络连接失败，请检查网络后重试。" : "网络连接失败，请重试；已上传附件已保留。") : e instanceof Error ? e.message : "附件操作失败"); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  return <section className="homework-attachments" aria-label={readOnly ? "附件" : "附件上传"}>
    {readOnly ? <strong>附件</strong> : <><label>附件上传（Word、PDF、图片）
      <input type="file" accept={accept} multiple disabled={disabled || busy || files.length >= 5} onChange={e => {
        const selected = Array.from(e.target.files || []); e.target.value = "";
        void work(async () => {
          if (files.length + selected.length > 5) throw new Error("每次安排最多5个附件，请减少选择");
          for (const f of selected) {
            if (!/\.(docx?|pdf|jpe?g|png|gif|webp)$/i.test(f.name)) throw new Error(`${f.name}：不支持的文件类型`);
            if (!f.size || f.size > 10 * 1024 * 1024) throw new Error(`${f.name}：文件不能为空或超过10MB`);
          }
          const uploaded = [...files];
          for (const f of selected) {
            const saved = await api.uploadAttachment(f); temporary.current.add(saved.id);
            uploaded.push(saved); onChange?.([...uploaded]);
          }
        });
      }} />
    </label>
    <p className="hint">最多5个，每个不超过10MB。保存安排后关联附件。附件暂不自动参与 AI 分析，请将关键题目和要求写入安排内容。</p></>}
    {busy && <p role="status">正在处理附件，请稍候…</p>}
    {error && <p role="alert" className="ai-error">{error}</p>}
    <ul>{files.map(f => <li key={f.id}>
      <span>{f.filename} <small>（{Math.max(1, Math.ceil(f.size / 1024))} KB）</small></span>
      <div>
        {f.content_type.startsWith("image/") && <button type="button" disabled={disabled || busy} onClick={() => void work(async () => {
          const blob = await downloadAttachment(f.id); setPreview({ url: URL.createObjectURL(blob), name: f.filename });
        })}>预览</button>}
        <button type="button" disabled={disabled || busy} onClick={() => void work(async () => {
          const blob = await downloadAttachment(f.id); const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = f.filename; a.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        })}>下载</button>
        {!readOnly && <button type="button" disabled={disabled || busy} onClick={() => void work(async () => {
          if (temporary.current.has(f.id)) { await api.discardAttachment(f.id); temporary.current.delete(f.id); }
          onChange?.(files.filter(x => x.id !== f.id));
          if (preview?.name === f.filename) setPreview(null);
        })}>移除</button>}
      </div>
    </li>)}</ul>
    {preview && <div className="attachment-preview"><button type="button" onClick={() => setPreview(null)}>关闭预览</button><img src={preview.url} alt={preview.name} /></div>}
    {!readOnly && files.length > 0 && <small>附件移除后需保存安排才生效；未保存的新上传文件会在后续上传时清理（保留24小时）。</small>}
  </section>;
}
