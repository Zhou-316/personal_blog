import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { musicApi } from "../api";
import type { MusicQr, MusicSession } from "../types";
import { Modal } from "./Modal";

export function MusicLoginDialog({ onClose, onAuthorized }: { onClose: () => void; onAuthorized: () => void }) {
  const [session, setSession] = useState<MusicSession | null>(null);
  const [qr, setQr] = useState<MusicQr | null>(null);
  const [status, setStatus] = useState("正在检查登录状态…");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [pollStopped, setPollStopped] = useState(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const authorized = useRef(onAuthorized);
  authorized.current = onAuthorized;

  async function refreshQr() {
    const current = ++generation.current;
    setBusy(true); setError(""); setQr(null); setExpired(false); setPollStopped(false);
    try {
      const result = await musicApi.createQr();
      if (alive.current && current === generation.current) { setQr(result); setStatus("打开网易云音乐，使用“扫一扫”授权登录。"); }
    } catch (cause) {
      if (alive.current && current === generation.current) setError(cause instanceof Error ? cause.message : "暂时无法生成二维码");
    } finally { if (alive.current && current === generation.current) setBusy(false); }
  }

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    musicApi.session().then((result) => {
      if (cancelled) return;
      setSession(result);
      if (result.logged_in) { setBusy(false); setStatus("当前浏览器已记住此网易云账号。"); }
      else void refreshQr();
    }).catch((cause: Error) => { if (!cancelled) { setBusy(false); setError(cause.message); } });
    return () => { cancelled = true; alive.current = false; };
  }, []);

  useEffect(() => {
    if (!qr || expired || pollStopped) return;
    let cancelled = false;
    const current = generation.current;
    const active = () => !cancelled && current === generation.current;
    let timer: number;
    let consecutiveErrors = 0;
    let authorizingSince = 0;
    const expiresAt = Date.now() + qr.expires_in * 1000;
    async function poll() {
      try {
        if (Date.now() >= expiresAt) { if (active()) setExpired(true); return; }
        const result = await musicApi.checkQr();
        if (!active()) return;
        consecutiveErrors = 0;
        setError("");
        if (result.status === "authorized") { authorized.current(); return; }
        if (result.status === "expired") { setExpired(true); return; }
        if (result.status === "superseded") {
          setStatus("此二维码已被刷新，请重新获取二维码。"); setPollStopped(true); return;
        }
        if (result.status === "authorizing") {
          authorizingSince ||= Date.now();
          setStatus("手机已确认授权，正在同步登录状态…");
          if (Date.now() - authorizingSince >= 20000) {
            setError("网易云已确认授权，但登录信息暂未同步成功，请刷新二维码重试。"); setPollStopped(true); return;
          }
        } else {
          setStatus(result.status === "confirming" ? "已扫码，请在网易云音乐中确认授权。" : "等待扫码授权…");
        }
        timer = window.setTimeout(poll, 3000);
      } catch (cause) {
        if (!active()) return;
        setError(cause instanceof Error ? cause.message : "登录状态检查失败");
        if (++consecutiveErrors < 3) {
          setStatus("连接暂时中断，正在重试…"); timer = window.setTimeout(poll, 3000);
        } else { setStatus("暂时无法检查授权状态，请刷新二维码重试。"); setPollStopped(true); }
      }
    }
    timer = window.setTimeout(poll, 2000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [qr, expired, pollStopped]);

  async function logout() {
    setBusy(true); setError("");
    try {
      await musicApi.logout();
      if (alive.current) { setSession({ logged_in: false }); await refreshQr(); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "退出失败"); }
    finally { if (alive.current) setBusy(false); }
  }

  return <Modal title="网易云音乐授权" onClose={onClose}>
    <p className="mediaHelp">VIP 歌曲使用你本人的网易云账号验证播放权限。登录状态仅用于当前设备和浏览器，失效后需重新授权。</p>
    {busy && <p className="mediaStatus" role="status"><Loader2 size={18} className="spinning" />正在连接网易云…</p>}
    {session?.logged_in ? <div className="musicAccount">
      <strong>{session.profile?.nickname}</strong>
      <p>{status}</p>
      <button type="button" className="solidButton" onClick={onAuthorized}>继续收听</button>
      <button type="button" className="textButton" disabled={busy} onClick={logout}>退出此账号／切换账号</button>
    </div> : <>
      {qr && <div className="musicQr">
        <img src={qr.image} alt="网易云音乐登录二维码" width={220} height={220} className={expired ? "expired" : ""} />
        <p role="status">{expired ? "二维码已失效，请刷新后重试。" : status}</p>
        {!expired && <a href={qr.url} target="_blank" rel="noopener noreferrer">在当前手机打开网易云授权页面</a>}
      </div>}
      {!busy && <button type="button" className="ghostButton" onClick={refreshQr}><RefreshCw size={16} />{qr ? "刷新二维码" : "重新连接"}</button>}
    </>}
    {error && <p className="mediaError" role="alert">{error}</p>}
  </Modal>;
}
