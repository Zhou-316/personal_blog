from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import time
from http.cookies import CookieError, SimpleCookie
from urllib import error, parse, request

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.db.database import get_connection


COOKIE_NAME = "blog_music_browser"
SESSION_SECONDS = 30 * 24 * 60 * 60
LINK_HOSTS = {"music.163.com", "y.music.163.com", "163cn.tv", "www.163cn.tv"}
UPSTREAM = os.getenv("BLOG_MUSIC_API_URL", "http://127.0.0.1:3001").rstrip("/")
PROVIDER_COOKIE_NAMES = {"MUSIC_U", "__csrf", "MUSIC_A", "_ntes_nuid", "NMTID", "WNMCID"}


def authorization_cookie(result: dict) -> str:
    """Extract cookie pairs, ignoring Set-Cookie attributes and empty separators.

    Joining headers ending in ';' produces ';;'. SimpleCookie.load() stops at
    that separator, silently dropping later cookies, including MUSIC_U.
    """
    headers = []
    for field in ("cookie", "cookies"):
        value = result.get(field)
        if isinstance(value, str):
            headers.append(value)
        elif isinstance(value, list):
            headers.extend(item for item in value if isinstance(item, str))
    values = {}
    for header in headers:
        for part in header.split(";"):
            name, separator, value = part.strip().partition("=")
            if not separator or name not in PROVIDER_COOKIE_NAMES or not value.strip():
                continue
            cookie = SimpleCookie()
            try:
                cookie.load(f"{name}={value.strip()}")
            except CookieError:
                continue
            if name in cookie and cookie[name].value:
                values[name] = cookie[name].value
    if not values.get("MUSIC_U"):
        return ""
    return "; ".join(f"{name}={value}" for name, value in values.items())


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/api/music", tags=["music"], dependencies=[Depends(private_response)])


def init_music_sessions() -> None:
    with get_connection() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS music_browser_sessions (
            browser_hash TEXT PRIMARY KEY,
            provider_cookie TEXT NOT NULL DEFAULT '',
            qr_key TEXT NOT NULL DEFAULT '',
            qr_expires INTEGER NOT NULL DEFAULT 0,
            expires_at INTEGER NOT NULL
        )""")
        conn.execute("DELETE FROM music_browser_sessions WHERE expires_at < ?", (int(time.time()),))


def fail(code: str, message: str, status: int = 502) -> None:
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def require_music_request(x_music_request: str | None = Header(default=None)) -> None:
    # A custom header requires a successful CORS preflight for other origins.
    if x_music_request != "1":
        fail("invalid_request", "请从博客页面进行此操作", 403)


def upstream(path: str, data: dict | None = None) -> dict:
    body = json.dumps(data or {}).encode("utf-8")
    req = request.Request(f"{UPSTREAM}{path}", data=body, headers={"Content-Type": "application/json"})
    try:
        with request.build_opener(request.ProxyHandler({})).open(req, timeout=16) as response:
            result = json.loads(response.read(2 * 1024 * 1024))
        if not isinstance(result, dict):
            raise ValueError("invalid response")
        return result
    except (OSError, ValueError, error.URLError):
        fail("music_unavailable", "音乐服务暂时无法连接，请稍后重试")


def browser_session(req: Request):
    browser_id = req.cookies.get(COOKIE_NAME, "")
    if not re.fullmatch(r"[a-f0-9]{64}", browser_id):
        return None
    browser_hash = hashlib.sha256(browser_id.encode()).hexdigest()
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM music_browser_sessions WHERE browser_hash = ? AND expires_at > ?",
            (browser_hash, int(time.time())),
        ).fetchone()


def set_browser_cookie(req: Request, res: Response, browser_id: str) -> None:
    secure = os.getenv("BLOG_MUSIC_COOKIE_SECURE", "").lower() == "true" or req.url.scheme == "https"
    res.set_cookie(COOKIE_NAME, browser_id, max_age=SESSION_SECONDS, httponly=True,
                   secure=secure, samesite="lax", path="/api/music")


def profile_for(cookie: str) -> dict | None:
    if not cookie:
        return None
    data = upstream("/login/status", {"cookie": cookie}).get("data", {})
    profile = data.get("profile") if isinstance(data, dict) else None
    if not profile or not profile.get("userId"):
        return None
    return {"nickname": profile.get("nickname", "网易云用户"), "vip": bool(profile.get("vipType"))}


def valid_listener_cookie(req: Request) -> str:
    session = browser_session(req)
    if not session or not session["provider_cookie"]:
        return ""
    cookie = session["provider_cookie"]
    if profile_for(cookie):
        return cookie
    with get_connection() as conn:
        conn.execute("UPDATE music_browser_sessions SET provider_cookie = '' WHERE browser_hash = ?",
                     (session["browser_hash"],))
    return ""


def validate_share_url(value: str) -> parse.ParseResult:
    try:
        parsed = parse.urlparse(value)
        valid = (parsed.scheme in {"http", "https"} and parsed.hostname in LINK_HOSTS
                 and not parsed.username and not parsed.password and parsed.port in {None, 80, 443})
    except ValueError:
        valid = False
    if not valid:
        fail("invalid_link", "请粘贴网易云音乐的单曲分享链接", 422)
    return parsed


class SafeMusicRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_share_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def song_id_from_link(text: str) -> str:
    urls = re.findall(r"https?://[^\s<>\"'，。]+", text)
    if not urls:
        fail("invalid_link", "请粘贴网易云音乐的单曲分享链接", 422)
    url = urls[0].rstrip(").,，。")
    parsed = validate_share_url(url)
    if parsed.hostname in {"163cn.tv", "www.163cn.tv"}:
        try:
            opener = request.build_opener(request.ProxyHandler({}), SafeMusicRedirect())
            with opener.open(url, timeout=8) as response:
                parsed = validate_share_url(response.geturl())
        except (OSError, error.URLError):
            fail("link_unavailable", "短链接暂时无法解析，请使用网易云歌曲页面的完整链接", 422)
    path = parsed.path
    query = parsed.query
    if parsed.fragment.startswith("/"):
        path, _, query = parsed.fragment.partition("?")
    song_id = None
    if re.fullmatch(r"/(?:m/)?song/?", path):
        song_id = parse.parse_qs(query).get("id", [None])[0]
    else:
        match = re.fullmatch(r"/(?:m/)?song/(\d+)/?", path)
        song_id = match.group(1) if match else None
    if not song_id or not re.fullmatch(r"[1-9]\d{0,19}", song_id):
        fail("invalid_link", "目前支持单曲链接，请检查链接是否指向歌曲", 422)
    return song_id


def song_details(song_id: str) -> dict:
    if not re.fullmatch(r"[1-9]\d{0,19}", song_id):
        fail("invalid_song", "歌曲编号无效", 422)
    result = upstream("/song/detail", {"ids": song_id})
    songs = result.get("songs") or []
    if not songs:
        fail("song_missing", "没有找到这首歌曲，请检查链接", 404)
    song = songs[0]
    return {
        "id": str(song["id"]), "title": song.get("name", "未命名歌曲"),
        "artist": " / ".join(artist.get("name", "") for artist in song.get("ar", [])),
        "cover": (song.get("al") or {}).get("picUrl", "").replace("http://", "https://", 1),
        "duration": round(song.get("dt", 0) / 1000), "fee": song.get("fee", 0),
    }


class ResolveRequest(BaseModel):
    link: str = Field(min_length=1, max_length=2000)


@router.post("/resolve", dependencies=[Depends(require_music_request)])
def resolve_song(payload: ResolveRequest) -> dict:
    return song_details(song_id_from_link(payload.link))


@router.get("/songs/{song_id}")
def get_song(song_id: str) -> dict:
    return song_details(song_id)


@router.post("/songs/{song_id}/play", dependencies=[Depends(require_music_request)])
def play_song(song_id: str, req: Request) -> dict:
    song = song_details(song_id)
    cookie = valid_listener_cookie(req)
    if song["fee"] in {1, 4} and not cookie:
        fail("netease_login_required", "这首歌曲需要播放权限，请先登录你本人的网易云音乐账号", 401)
    result = upstream("/song/url", {"id": song_id, "cookie": cookie})
    entries = result.get("data") or []
    track = entries[0] if entries else {}
    # A trial fragment must never be presented as the full VIP track.
    if track.get("freeTrialInfo") or (track.get("fee") in {1, 4} and not cookie):
        if not cookie:
            fail("netease_login_required", "请登录你本人的网易云账号，验证歌曲播放权限", 401)
        fail("vip_required", "当前网易云账号没有这首歌曲的完整播放权限，请检查 VIP 或单曲购买状态", 403)
    url = track.get("url")
    if not url:
        fail("song_unavailable", "这首歌曲暂时无法播放，可能受账号权限、地区或歌曲状态限制", 403)
    parsed = parse.urlparse(url)
    host = parsed.hostname or ""
    if parsed.scheme not in {"http", "https"} or not (
        host == "music.126.net" or host.endswith(".music.126.net")
        or host == "music.163.com" or host.endswith(".music.163.com")
    ):
        fail("invalid_audio", "歌曲播放地址暂时不可用")
    return {"url": parsed._replace(scheme="https").geturl(), "expires_in": track.get("expi", 1200)}


@router.get("/session")
def get_music_session(req: Request) -> dict:
    session = browser_session(req)
    profile = profile_for(session["provider_cookie"]) if session and session["provider_cookie"] else None
    if session and not profile:
        with get_connection() as conn:
            conn.execute("UPDATE music_browser_sessions SET provider_cookie = '' WHERE browser_hash = ?", (session["browser_hash"],))
    return {"logged_in": bool(profile), "profile": profile}


@router.post("/auth/qr", dependencies=[Depends(require_music_request)])
def create_qr(req: Request, res: Response) -> dict:
    key = (upstream("/login/qr/key").get("data") or {}).get("unikey")
    if not key:
        fail("qr_unavailable", "暂时无法生成登录二维码，请稍后重试")
    qr = (upstream("/login/qr/create", {"key": key}).get("data") or {})
    if not str(qr.get("qrimg", "")).startswith("data:image/png;base64,"):
        fail("qr_unavailable", "暂时无法生成登录二维码，请稍后重试")
    qr_url = qr.get("qrurl", "")
    validate_share_url(qr_url)
    session = browser_session(req)
    with get_connection() as conn:
        if session:
            browser_hash = session["browser_hash"]
        else:
            browser_id = secrets.token_hex(32)
            browser_hash = hashlib.sha256(browser_id.encode()).hexdigest()
            conn.execute("INSERT INTO music_browser_sessions (browser_hash, expires_at) VALUES (?, ?)",
                         (browser_hash, int(time.time()) + SESSION_SECONDS))
            set_browser_cookie(req, res, browser_id)
        conn.execute("UPDATE music_browser_sessions SET qr_key = ?, qr_expires = ? WHERE browser_hash = ?",
                     (key, int(time.time()) + 180, browser_hash))
        conn.execute("DELETE FROM music_browser_sessions WHERE expires_at < ?", (int(time.time()),))
    return {"image": qr["qrimg"], "url": qr_url, "expires_in": 180}


@router.post("/auth/qr/check", dependencies=[Depends(require_music_request)])
def check_qr(req: Request, res: Response) -> dict:
    session = browser_session(req)
    if not session:
        return {"status": "expired"}
    if not session["qr_key"] and session["provider_cookie"]:
        profile = profile_for(session["provider_cookie"])
        if profile:
            return {"status": "authorized", "profile": profile}
    if not session["qr_key"] or session["qr_expires"] < time.time():
        return {"status": "expired"}
    result = upstream("/login/qr/check", {"key": session["qr_key"]})
    code = result.get("code")
    if code == 803:
        cookie = authorization_cookie(result)
        if not cookie:
            return {"status": "authorizing"}
        profile = profile_for(cookie)
        if not profile:
            return {"status": "authorizing"}
        with get_connection() as conn:
            updated = conn.execute("""UPDATE music_browser_sessions SET provider_cookie = ?, qr_key = '', qr_expires = 0, expires_at = ?
                         WHERE browser_hash = ? AND qr_key = ?""",
                         (cookie, int(time.time()) + SESSION_SECONDS, session["browser_hash"], session["qr_key"]))
            if not updated.rowcount:
                return {"status": "superseded"}
        set_browser_cookie(req, res, req.cookies[COOKIE_NAME])
        return {"status": "authorized", "profile": profile}
    statuses = {800: "expired", 801: "waiting", 802: "confirming"}
    if code not in statuses:
        fail("login_failed", "网易云暂时未返回登录状态，请刷新二维码重试")
    return {"status": statuses[code]}


@router.delete("/session", dependencies=[Depends(require_music_request)])
def delete_music_session(req: Request, res: Response) -> dict:
    session = browser_session(req)
    if session:
        with get_connection() as conn:
            conn.execute("DELETE FROM music_browser_sessions WHERE browser_hash = ?", (session["browser_hash"],))
    res.delete_cookie(COOKIE_NAME, path="/api/music")
    return {"logged_in": False}
