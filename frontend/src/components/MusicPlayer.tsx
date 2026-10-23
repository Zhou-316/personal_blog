import { useEffect, useRef, useState } from "react";
import { Loader2, Music2, Pause, Play, UserRound } from "lucide-react";
import { ApiError, musicApi } from "../api";
import type { MusicSong } from "../types";
import { MusicLoginDialog } from "./MusicLoginDialog";

function clock(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function MusicPlayer({ songId }: { songId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const alive = useRef(true);
  const sourceExpires = useRef(0);
  const [song, setSong] = useState<MusicSong | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setSong(null); setError(""); setCurrent(0); setDuration(0); setPlaying(false);
    sourceExpires.current = 0;
    musicApi.song(songId).then((result) => { if (!cancelled) { setSong(result); setDuration(result.duration); } })
      .catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; alive.current = false; audioRef.current?.pause(); };
  }, [songId]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || busy) return;
    if (!audio.paused) { audio.pause(); return; }
    setBusy(true); setError("");
    try {
      if (!audio.getAttribute("src") || Date.now() >= sourceExpires.current) {
        const result = await musicApi.play(songId);
        if (!alive.current) return;
        audio.src = result.url;
        sourceExpires.current = Date.now() + Math.max(0, result.expires_in - 30) * 1000;
      }
      await audio.play();
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof ApiError && cause.code === "netease_login_required") setLoginOpen(true);
      else if (cause instanceof DOMException && cause.name === "NotAllowedError") setError("音频已准备好，请再次点击播放。");
      else setError(cause instanceof Error ? cause.message : "播放失败，请重试");
    } finally { if (alive.current) setBusy(false); }
  }

  return <section className="musicPlayer" aria-label="文章音乐播放器">
    <div className="musicPlayerMain">
      <div className="musicCover">{song?.cover ? <img src={`${song.cover}?param=120y120`} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Music2 size={26} />}</div>
      <div className="musicTrack"><strong>{song?.title ?? "文章配乐"}</strong><span>{song?.artist || "网易云音乐"}</span></div>
      <button type="button" className="musicPlayButton" disabled={busy} onClick={togglePlayback} aria-label={playing ? "暂停音乐" : "播放音乐"}>
        {busy ? <Loader2 size={20} className="spinning" /> : playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
    </div>
    <div className="musicProgress">
      <span>{clock(current)}</span>
      <input aria-label="音乐播放进度" type="range" min={0} max={Math.max(1, duration)} step={1} value={Math.min(current, duration)}
        disabled={!audioRef.current?.getAttribute("src") || !duration}
        onChange={(event) => { if (audioRef.current) { audioRef.current.currentTime = Number(event.target.value); setCurrent(Number(event.target.value)); } }} />
      <span>{clock(duration)}</span>
    </div>
    <div className="musicPlayerFooter"><small>点击播放 · 网易云音乐</small>
      <button type="button" className="textButton" onClick={() => setLoginOpen(true)}><UserRound size={14} />网易云账号</button>
    </div>
    {error && <p className="mediaError" role="alert">{error}</p>}
    <audio ref={audioRef} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onEnded={() => setPlaying(false)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
      onDurationChange={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }}
      onError={() => { sourceExpires.current = 0; setPlaying(false); setError("音频加载失败，请点击播放重试。"); }} />
    {loginOpen && <MusicLoginDialog onClose={() => setLoginOpen(false)} onAuthorized={() => { setLoginOpen(false); sourceExpires.current = 0; void togglePlayback(); }} />}
  </section>;
}
