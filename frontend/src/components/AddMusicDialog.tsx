import { useEffect, useRef, useState } from "react";
import { Loader2, Music2, Trash2 } from "lucide-react";
import { musicApi } from "../api";
import { Modal } from "./Modal";

export function AddMusicDialog({ currentId, onAdd, onRemove, onClose }: {
  currentId: string | null; onAdd: (id: string) => void; onRemove: () => void; onClose: () => void;
}) {
  const [link, setLink] = useState(currentId ? `https://music.163.com/song?id=${currentId}` : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);
  function close() { requestId.current++; onClose(); }
  return <Modal title={currentId ? "更换文章配乐" : "添加文章配乐"} onClose={close}>
    <p className="mediaHelp">粘贴网易云单曲链接或分享文字。每篇文章保留一首，播放器会显示在正文开头，由读者手动播放。</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (!link.trim() || busy) return;
      const id = ++requestId.current;
      setBusy(true); setError("");
      try { const song = await musicApi.resolve(link.trim()); if (id === requestId.current) onAdd(song.id); }
      catch (cause) { if (id === requestId.current) setError(cause instanceof Error ? cause.message : "解析失败，请检查链接"); }
      finally { if (id === requestId.current) setBusy(false); }
    }}>
      <label>网易云歌曲链接<textarea rows={3} autoFocus value={link} maxLength={2000} placeholder="https://music.163.com/song?id=…"
        onChange={(event) => setLink(event.target.value)} required /></label>
      {error && <p className="mediaError" role="alert">{error}</p>}
      <div className="mediaDialogActions">
        {currentId && <button type="button" className="textButton dangerText" disabled={busy} onClick={onRemove}><Trash2 size={16} />移除配乐</button>}
        <button type="submit" className="solidButton" disabled={busy || !link.trim()}>{busy ? <Loader2 size={17} className="spinning" /> : <Music2 size={17} />}{busy ? "正在解析…" : currentId ? "替换配乐" : "添加配乐"}</button>
      </div>
    </form>
  </Modal>;
}
