from __future__ import annotations

import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Annotated
from urllib import error, request

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.db.database import get_connection, now_iso


router = APIRouter(prefix="/api")

OWNER_CATEGORIES = ("小说随笔", "旅行日记", "技术笔记", "课程笔记与资料")


class UserPublic(BaseModel):
    id: int
    username: str
    email: str
    bio: str = ""
    role: str = "member"
    created_at: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    email: str = Field(min_length=5, max_length=100)
    password: str = Field(min_length=8, max_length=72)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or "." not in normalized.split("@")[-1]:
            raise ValueError("invalid email")
        return normalized

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        return value.strip()


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    user: UserPublic
    access_token: str


class PostCreate(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    excerpt: str = Field(default="", max_length=220)
    content: str = Field(min_length=1)
    mood: str = Field(default="随笔", max_length=24)
    category: str = Field(default="", max_length=24)


class PostUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    excerpt: str = Field(default="", max_length=220)
    content: str = Field(min_length=1)
    mood: str = Field(default="随笔", max_length=24)
    category: str = Field(default="", max_length=24)


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=800)


class SummaryResponse(BaseModel):
    summary: str


PROJECT_ROOT = Path(__file__).resolve().parents[3]
API_DOC_PATH = PROJECT_ROOT / 'api.md'


def row_to_user(row: sqlite3.Row) -> UserPublic:
    return UserPublic(
        id=row["id"],
        username=row["username"],
        email=row["email"],
        bio=row["bio"],
        role=row["role"],
        created_at=row["created_at"],
    )


def get_authorization_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return None
    return authorization[len(prefix) :].strip()


def user_from_authorization(authorization: str | None) -> sqlite3.Row | None:
    token = get_authorization_token(authorization)
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    with get_connection() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (int(payload["sub"]),)).fetchone()


def require_user(authorization: Annotated[str | None, Header()] = None) -> sqlite3.Row:
    user = user_from_authorization(authorization)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    return user


def is_admin(user: sqlite3.Row) -> bool:
    return user["role"] == "admin"


def category_for_user(value: str, user: sqlite3.Row) -> str:
    if not is_admin(user):
        return ""
    category = value.strip()
    if category not in OWNER_CATEGORIES:
        raise HTTPException(status_code=422, detail="请选择有效的云纸之上栏目")
    return category


def build_post_payload(conn: sqlite3.Connection, row: sqlite3.Row, viewer_id: int | None = None) -> dict:
    author = conn.execute("SELECT * FROM users WHERE id = ?", (row["author_id"],)).fetchone()
    comment_count = conn.execute("SELECT COUNT(*) FROM comments WHERE post_id = ?", (row["id"],)).fetchone()[0]
    like_count = conn.execute(
        "SELECT COUNT(*) FROM likes WHERE target_type = 'post' AND target_id = ?",
        (row["id"],),
    ).fetchone()[0]
    liked_by_me = False
    if viewer_id:
        liked_by_me = (
            conn.execute(
                """
                SELECT 1 FROM likes
                WHERE user_id = ? AND target_type = 'post' AND target_id = ?
                """,
                (viewer_id, row["id"]),
            ).fetchone()
            is not None
        )

    return {
        "id": row["id"],
        "title": row["title"],
        "excerpt": row["excerpt"],
        "content": row["content"],
        "mood": row["mood"],
        
        "category": row["category"],
        "author": row_to_user(author).model_dump(),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "comment_count": comment_count,
        "like_count": like_count,
        "liked_by_me": liked_by_me,
    }


def build_comment_payload(conn: sqlite3.Connection, row: sqlite3.Row, viewer_id: int | None = None) -> dict:
    author = conn.execute("SELECT * FROM users WHERE id = ?", (row["author_id"],)).fetchone()
    like_count = conn.execute(
        "SELECT COUNT(*) FROM likes WHERE target_type = 'comment' AND target_id = ?",
        (row["id"],),
    ).fetchone()[0]
    liked_by_me = False
    if viewer_id:
        liked_by_me = (
            conn.execute(
                """
                SELECT 1 FROM likes
                WHERE user_id = ? AND target_type = 'comment' AND target_id = ?
                """,
                (viewer_id, row["id"]),
            ).fetchone()
            is not None
        )

    return {
        "id": row["id"],
        "post_id": row["post_id"],
        "content": row["content"],
        "author": row_to_user(author).model_dump(),
        "created_at": row["created_at"],
        "like_count": like_count,
        "liked_by_me": liked_by_me,
    }



def read_ai_config() -> tuple[str, str, str]:
    raw = API_DOC_PATH.read_text(encoding="utf-8") if API_DOC_PATH.exists() else ""
    api_key = os.getenv("BLOG_AI_API_KEY", "").strip()
    base_url = os.getenv("BLOG_AI_BASE_URL", "").strip()
    model = os.getenv("BLOG_AI_MODEL", "").strip()

    if not api_key:
        key_match = re.search(r"sk-[A-Za-z0-9_\-]+", raw)
        api_key = key_match.group(0) if key_match else ""

    if not base_url:
        base_match = re.search(r"https?://[^\s`\"'<>，。]+/compatible-mode/v1", raw)
        base_url = base_match.group(0) if base_match else ""

    if not model:
        model_match = re.search(r"(?:model|模型)[:：\s`\"']+([A-Za-z0-9_.\-]+)", raw, re.IGNORECASE)
        if not model_match:
            model_match = re.search(r"(qwen[-\w.]+|deepseek[-\w.]+|gpt[-\w.]+|glm[-\w.]+|kimi[-\w.]+)", raw, re.IGNORECASE)
        model = model_match.group(1) if model_match and model_match.lastindex else model_match.group(0) if model_match else ""

    if not api_key or not base_url or not model:
        raise HTTPException(status_code=500, detail="AI 配置不完整，请检查 api.md")

    return api_key, base_url.rstrip("/"), model


def summarize_with_ai(row: sqlite3.Row) -> str:
    api_key, base_url, model = read_ai_config()
    content = row["content"].strip()
    if len(content) > 12000:
        content = f"{content[:12000]}\n\n（文章后半部分因长度限制已省略，请只根据以上内容总结。）"

    user_prompt = f"""请为下面这篇博客生成中文分点总结。要求：
1. 全文必须使用简体中文。
2. 分点阐述，条理清晰。
3. 总长度不超过3000字。
4. 不编造原文没有的信息。
5. 如果文章包含技术步骤、旅行记录、小说随笔或课程资料，请分别提炼关键内容。

标题：{row['title']}
摘要：{row['excerpt']}
正文：
{content}
"""
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "你是个人博客的中文阅读助手。你只输出简体中文，用分点形式总结文章，保持温和、清晰、克制。",
            },
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 2600,
        "stream": False,
    }
    req = request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=70) as response:
            data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500]
        raise HTTPException(status_code=502, detail=f"AI 总结服务返回错误：{detail or exc.reason}") from None
    except (error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=f"AI 总结服务暂时不可用：{exc}") from None

    try:
        summary = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        raise HTTPException(status_code=502, detail="AI 总结服务返回格式异常") from None

    if not summary:
        raise HTTPException(status_code=502, detail="AI 总结服务没有返回内容")

    return summary[:3000]

@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/register", response_model=AuthResponse)
def register(payload: RegisterRequest) -> AuthResponse:
    timestamp = now_iso()
    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO users (username, email, password_hash, role, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (payload.username, payload.email, hash_password(payload.password), "member", timestamp),
            )
            user = conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="用户名或邮箱已被使用") from None

    return AuthResponse(user=row_to_user(user), access_token=create_access_token(user["id"]))


@router.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest) -> AuthResponse:
    with get_connection() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (payload.email.strip().lower(),)).fetchone()
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    return AuthResponse(user=row_to_user(user), access_token=create_access_token(user["id"]))


@router.get("/users/me", response_model=UserPublic)
def me(user: Annotated[sqlite3.Row, Depends(require_user)]) -> UserPublic:
    return row_to_user(user)


@router.get("/posts")
def list_posts(
    q: Annotated[str | None, Query(max_length=80)] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> list[dict]:
    viewer = user_from_authorization(authorization)
    viewer_id = viewer["id"] if viewer else None

    with get_connection() as conn:
        if q:
            keyword = f"%{q.strip()}%"
            rows = conn.execute(
                """
                SELECT * FROM posts
                WHERE title LIKE ? OR excerpt LIKE ? OR content LIKE ?
                ORDER BY updated_at DESC
                """,
                (keyword, keyword, keyword),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM posts ORDER BY updated_at DESC").fetchall()
        return [build_post_payload(conn, row, viewer_id) for row in rows]


@router.post("/posts", status_code=201)
def create_post(payload: PostCreate, user: Annotated[sqlite3.Row, Depends(require_user)]) -> dict:
    timestamp = now_iso()
    excerpt = payload.excerpt.strip() or payload.content.strip().replace("\n", " ")[:120]
    category = category_for_user(payload.category, user)
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO posts (title, excerpt, content, mood, category, author_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.title.strip(),
                excerpt,
                payload.content.strip(),
                payload.mood.strip() or "随笔",
                category,
                user["id"],
                timestamp,
                timestamp,
            ),
        )
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return build_post_payload(conn, row, user["id"])


@router.get("/posts/{post_id}")
def get_post(post_id: int, authorization: Annotated[str | None, Header()] = None) -> dict:
    viewer = user_from_authorization(authorization)
    viewer_id = viewer["id"] if viewer else None
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="文章不存在")
        return build_post_payload(conn, row, viewer_id)



@router.post("/posts/{post_id}/summary", response_model=SummaryResponse)
def summarize_post(post_id: int) -> SummaryResponse:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="文章不存在")
    return SummaryResponse(summary=summarize_with_ai(row))

@router.put("/posts/{post_id}")
def update_post(post_id: int, payload: PostUpdate, user: Annotated[sqlite3.Row, Depends(require_user)]) -> dict:
    timestamp = now_iso()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="文章不存在")
        if row["author_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="只能编辑自己的文章")

        excerpt = payload.excerpt.strip() or payload.content.strip().replace("\n", " ")[:120]
        category = category_for_user(payload.category, user)
        conn.execute(
            """
            UPDATE posts
            SET title = ?, excerpt = ?, content = ?, mood = ?, category = ?, updated_at = ?
            WHERE id = ?
            """,
            (payload.title.strip(), excerpt, payload.content.strip(), payload.mood.strip(), category, timestamp, post_id),
        )
        updated = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        return build_post_payload(conn, updated, user["id"])


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: Annotated[sqlite3.Row, Depends(require_user)]) -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="文章不存在")
        if row["author_id"] != user["id"] and not is_admin(user):
            raise HTTPException(status_code=403, detail="只能删除自己的文章")
        conn.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        return {"deleted": True}


@router.post("/posts/{post_id}/likes")
def toggle_post_like(post_id: int, user: Annotated[sqlite3.Row, Depends(require_user)]) -> dict:
    with get_connection() as conn:
        post = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="文章不存在")
        existing = conn.execute(
            "SELECT id FROM likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?",
            (user["id"], post_id),
        ).fetchone()
        if existing:
            conn.execute("DELETE FROM likes WHERE id = ?", (existing["id"],))
            liked = False
        else:
            conn.execute(
                "INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, 'post', ?, ?)",
                (user["id"], post_id, now_iso()),
            )
            liked = True
        count = conn.execute(
            "SELECT COUNT(*) FROM likes WHERE target_type = 'post' AND target_id = ?",
            (post_id,),
        ).fetchone()[0]
        return {"liked": liked, "like_count": count}


@router.get("/posts/{post_id}/comments")
def list_comments(post_id: int, authorization: Annotated[str | None, Header()] = None) -> list[dict]:
    viewer = user_from_authorization(authorization)
    viewer_id = viewer["id"] if viewer else None
    with get_connection() as conn:
        post = conn.execute("SELECT id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="文章不存在")
        rows = conn.execute(
            "SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC",
            (post_id,),
        ).fetchall()
        return [build_comment_payload(conn, row, viewer_id) for row in rows]


@router.post("/posts/{post_id}/comments", status_code=201)
def create_comment(
    post_id: int,
    payload: CommentCreate,
    user: Annotated[sqlite3.Row, Depends(require_user)],
) -> dict:
    with get_connection() as conn:
        post = conn.execute("SELECT id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="文章不存在")
        cursor = conn.execute(
            """
            INSERT INTO comments (post_id, author_id, content, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (post_id, user["id"], payload.content.strip(), now_iso()),
        )
        row = conn.execute("SELECT * FROM comments WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return build_comment_payload(conn, row, user["id"])


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, user: Annotated[sqlite3.Row, Depends(require_user)]) -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM comments WHERE id = ?", (comment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="评论不存在")
        can_delete = row["author_id"] == user["id"] or is_admin(user)
        if not can_delete:
            raise HTTPException(status_code=403, detail="只能删除自己的评论")
        conn.execute("DELETE FROM comments WHERE id = ?", (comment_id,))
        return {"deleted": True}


@router.post("/comments/{comment_id}/likes")
def toggle_comment_like(comment_id: int, user: Annotated[sqlite3.Row, Depends(require_user)]) -> dict:
    with get_connection() as conn:
        comment = conn.execute("SELECT * FROM comments WHERE id = ?", (comment_id,)).fetchone()
        if not comment:
            raise HTTPException(status_code=404, detail="评论不存在")
        existing = conn.execute(
            "SELECT id FROM likes WHERE user_id = ? AND target_type = 'comment' AND target_id = ?",
            (user["id"], comment_id),
        ).fetchone()
        if existing:
            conn.execute("DELETE FROM likes WHERE id = ?", (existing["id"],))
            liked = False
        else:
            conn.execute(
                "INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, 'comment', ?, ?)",
                (user["id"], comment_id, now_iso()),
            )
            liked = True
        count = conn.execute(
            "SELECT COUNT(*) FROM likes WHERE target_type = 'comment' AND target_id = ?",
            (comment_id,),
        ).fetchone()[0]
        return {"liked": liked, "like_count": count}
