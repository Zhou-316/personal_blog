from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.core.security import hash_password


BASE_DIR = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("BLOG_DATABASE_PATH", BASE_DIR / "blog.db"))
OWNER_EMAIL = "wenzhenxiansheng@163.com"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BlogConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, factory=BlogConnection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                bio TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'member',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                excerpt TEXT NOT NULL,
                content TEXT NOT NULL,
                mood TEXT NOT NULL DEFAULT '随笔',
                category TEXT NOT NULL DEFAULT '',
                author_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                parent_id INTEGER REFERENCES comments(id),
                root_id INTEGER REFERENCES comments(id),
                deleted_at TEXT,
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS likes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment')),
                target_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (user_id, target_type, target_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                actor_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('comment')),
                post_id INTEGER,
                comment_id INTEGER,
                read_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS direct_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER NOT NULL,
                recipient_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                read_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
            CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
            CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
            CREATE INDEX IF NOT EXISTS idx_direct_messages_pair ON direct_messages(sender_id, recipient_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient ON direct_messages(recipient_id, read_at);
            """
        )
        ensure_schema(conn)
        seed_demo_data(conn)
        grant_owner(conn)


def ensure_schema(conn: sqlite3.Connection) -> None:
    user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "role" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'")

    post_columns = {row["name"] for row in conn.execute("PRAGMA table_info(posts)").fetchall()}
    if "category" not in post_columns:
        conn.execute("ALTER TABLE posts ADD COLUMN category TEXT NOT NULL DEFAULT ''")

    comment_columns = {row["name"] for row in conn.execute("PRAGMA table_info(comments)").fetchall()}
    for name in ("parent_id", "root_id"):
        if name not in comment_columns:
            conn.execute(f"ALTER TABLE comments ADD COLUMN {name} INTEGER REFERENCES comments(id)")
    if "deleted_at" not in comment_columns:
        conn.execute("ALTER TABLE comments ADD COLUMN deleted_at TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_root_id ON comments(root_id)")


def grant_owner(conn: sqlite3.Connection) -> None:
    conn.execute("UPDATE users SET role = 'member' WHERE role IS NULL OR role = ''")
    conn.execute("UPDATE users SET role = 'admin' WHERE lower(email) = ?", (OWNER_EMAIL,))
    conn.execute(
        """
        UPDATE posts
        SET category = '小说随笔'
        WHERE (category IS NULL OR category = '')
          AND author_id IN (SELECT id FROM users WHERE role = 'admin')
        """
    )


def seed_demo_data(conn: sqlite3.Connection) -> None:
    user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if user_count:
        return

    timestamp = now_iso()
    cursor = conn.execute(
        """
        INSERT INTO users (username, email, password_hash, bio, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            "river",
            "river@example.com",
            hash_password("password123"),
            "写代码，也写花开时的风。",
            "member",
            timestamp,
        ),
    )
    user_id = cursor.lastrowid

    posts = [
        (
            "晨光里的第一篇札记",
            "把新的项目放在窗边，让它先晒一会儿太阳。",
            """## 今天的开场

我想把这个博客写成一个温柔但认真工作的地方。

- 记录项目推进
- 收藏沿途的灵感
- 留下可以回看的技术笔记

当页面能被打开，文章能被保存，评论能被回应，一件小事就开始有了生命。""",
            "清晨",
        ),
        (
            "在花园边调试接口",
            "接口返回 200 的瞬间，像风穿过薄荷叶。",
            """## API 小记

后端先保持清晰：用户、文章、评论、点赞。

前端不急着堆功能，先让每一次阅读和书写都顺手。下一步再考虑搜索、统计和 AI 摘要。""",
            "花园",
        ),
    ]

    for title, excerpt, content, mood in posts:
        conn.execute(
            """
            INSERT INTO posts (title, excerpt, content, mood, category, author_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (title, excerpt, content, mood, "", user_id, timestamp, timestamp),
        )
