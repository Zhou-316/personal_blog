"""Integration checks for persisted comment threads, ranking and permissions."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
(ROOT / ".dist").mkdir(exist_ok=True)
os.environ.setdefault("BLOG_UPLOADS_DIR", str(ROOT / ".dist" / "comment-test-uploads"))
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient
from app.core.security import create_access_token
from app.db import database
from app.main import app


class ThreadedCommentTests(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.TemporaryDirectory(prefix="comment-tests-", dir=ROOT / ".dist")
        self.db_patch = patch.object(database, "DB_PATH", Path(self.state.name) / "test.db")
        self.db_patch.start()
        self.client = TestClient(app)
        self.client.__enter__()
        with database.get_connection() as conn:
            for username in ("reader", "other", "admin"):
                conn.execute(
                    "INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, '', ?, ?)",
                    (username, f"{username}@test.local", "admin" if username == "admin" else "member", database.now_iso()),
                )
            self.post_id = conn.execute("SELECT id FROM posts ORDER BY id LIMIT 1").fetchone()[0]
        self.owner = self.headers(1)
        self.reader = self.headers(2)
        self.other = self.headers(3)
        self.admin = self.headers(4)

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.db_patch.stop()
        if not Path(self.state.name).resolve().is_relative_to((ROOT / ".dist").resolve()):
            raise RuntimeError("Refusing to clean a test directory outside .dist")
        self.state.cleanup()

    @staticmethod
    def headers(user_id):
        return {"Authorization": f"Bearer {create_access_token(user_id)}"}

    def create(self, content="一条评论", parent_id=None, headers=None, post_id=None):
        response = self.client.post(
            f"/api/posts/{post_id or self.post_id}/comments",
            headers=headers or self.reader,
            json={"content": content, "parent_id": parent_id},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def comments(self, headers=None):
        response = self.client.get(f"/api/posts/{self.post_id}/comments", headers=headers or self.reader)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def like(self, comment_id, headers=None):
        response = self.client.post(f"/api/comments/{comment_id}/likes", headers=headers or self.reader)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_replies_to_replies_keep_one_root_and_count_all_descendants(self):
        root = self.create("主评论")
        reply = self.create("第一条回复", root["id"])
        nested = self.create("回复的回复", reply["id"], self.other)
        items = {item["id"]: item for item in self.comments()}
        self.assertIsNone(items[root["id"]]["parent_id"])
        self.assertIsNone(items[root["id"]]["root_id"])
        self.assertEqual(items[reply["id"]]["root_id"], root["id"])
        self.assertEqual(items[nested["id"]]["root_id"], root["id"])
        self.assertEqual(items[nested["id"]]["parent_id"], reply["id"])
        self.assertEqual(items[root["id"]]["reply_count"], 2)
        self.assertEqual(items[reply["id"]]["reply_count"], 1)
        self.assertEqual(items[nested["id"]]["reply_count"], 0)
        self.assertEqual(self.client.get(f"/api/posts/{self.post_id}").json()["comment_count"], 3)

    def test_heat_uses_likes_plus_twice_all_replies_and_ties_favor_earlier_time(self):
        older = self.create("较早的两赞评论")
        newer = self.create("较晚但有一条回复")
        child = self.create("后续回复", newer["id"])
        self.like(older["id"])
        self.like(older["id"], self.other)
        with database.get_connection() as conn:
            conn.execute("UPDATE comments SET created_at = '2026-10-23T01:00:00+00:00' WHERE id = ?", (older["id"],))
            conn.execute("UPDATE comments SET created_at = '2026-10-23T02:00:00+00:00' WHERE id = ?", (newer["id"],))
        roots = [item for item in self.comments() if item["root_id"] is None]
        self.assertEqual([item["id"] for item in roots], [older["id"], newer["id"]])
        self.create("更深一层", child["id"])
        roots = [item for item in self.comments() if item["root_id"] is None]
        self.assertEqual(roots[0]["id"], newer["id"])
        self.assertEqual(roots[0]["reply_count"], 2)
        self.like(older["id"])
        self.assertEqual({item["id"]: item for item in self.comments()}[older["id"]]["like_count"], 1)

    def test_replies_also_sort_by_heat_then_earlier_time(self):
        root = self.create()
        first = self.create("先发布", root["id"])
        second = self.create("后发布", root["id"])
        self.assertEqual([item["id"] for item in self.comments() if item["root_id"]], [first["id"], second["id"]])
        self.like(second["id"])
        replies = [item for item in self.comments() if item["root_id"]]
        self.assertEqual(replies[0]["id"], second["id"])
        self.create("回复的回复", first["id"])
        replies = [item for item in self.comments() if item["root_id"]]
        self.assertEqual(replies[0]["id"], first["id"])

    def test_reply_notifications_reach_parent_author_and_post_author_once(self):
        root = self.create(headers=self.reader)
        with database.get_connection() as conn:
            conn.execute("DELETE FROM notifications")
        reply = self.create(parent_id=root["id"], headers=self.other)
        with database.get_connection() as conn:
            recipients = [row[0] for row in conn.execute("SELECT user_id FROM notifications WHERE comment_id = ?", (reply["id"],))]
        self.assertEqual(sorted(recipients), [1, 2])
        own_reply = self.create(parent_id=root["id"], headers=self.reader)
        with database.get_connection() as conn:
            recipients = [row[0] for row in conn.execute("SELECT user_id FROM notifications WHERE comment_id = ?", (own_reply["id"],))]
        self.assertEqual(recipients, [1])

    def test_deleting_parent_removes_content_but_preserves_conversation(self):
        root = self.create("将被删除的内容")
        reply = self.create("保留的回复", root["id"], self.other)
        self.like(root["id"])
        response = self.client.delete(f"/api/comments/{root['id']}", headers=self.reader)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["retained"])
        items = {item["id"]: item for item in self.comments()}
        self.assertEqual(items[root["id"]]["content"], "")
        self.assertTrue(items[root["id"]]["is_deleted"])
        self.assertEqual(items[root["id"]]["like_count"], 0)
        self.assertEqual(items[reply["id"]]["content"], "保留的回复")
        self.assertEqual(self.client.get(f"/api/posts/{self.post_id}").json()["comment_count"], 1)
        self.assertEqual(self.client.post(f"/api/comments/{root['id']}/likes", headers=self.other).status_code, 404)
        self.assertEqual(self.client.post(f"/api/posts/{self.post_id}/comments", headers=self.other,
            json={"content": "回复", "parent_id": root["id"]}).status_code, 404)
        self.create("继续回复", reply["id"], self.reader)

    def test_deleting_nested_reply_updates_ancestor_counts_and_cleans_likes(self):
        root = self.create()
        reply = self.create(parent_id=root["id"])
        nested = self.create(parent_id=reply["id"])
        self.like(nested["id"])
        response = self.client.delete(f"/api/comments/{nested['id']}", headers=self.reader)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["retained"])
        items = {item["id"]: item for item in self.comments()}
        self.assertEqual(items[root["id"]]["reply_count"], 1)
        self.assertEqual(items[reply["id"]]["reply_count"], 0)
        self.assertNotIn(nested["id"], items)
        with database.get_connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM likes WHERE target_type = 'comment' AND target_id = ?", (nested["id"],)).fetchone()[0], 0)

    def test_auth_permissions_and_invalid_replies(self):
        root = self.create()
        self.assertEqual(self.client.post(f"/api/posts/{self.post_id}/comments", json={"content": "匿名评论"}).status_code, 401)
        self.assertEqual(self.client.delete(f"/api/comments/{root['id']}", headers=self.other).status_code, 403)
        for payload in ({"content": "  \n "}, {"content": "x" * 801}, {"content": "回复", "parent_id": -1}):
            self.assertEqual(self.client.post(f"/api/posts/{self.post_id}/comments", headers=self.reader, json=payload).status_code, 422)
        self.assertEqual(self.client.post(f"/api/posts/{self.post_id}/comments", headers=self.reader,
            json={"content": "回复", "parent_id": 999999}).status_code, 404)
        with database.get_connection() as conn:
            other_post = conn.execute("SELECT id FROM posts WHERE id != ? LIMIT 1", (self.post_id,)).fetchone()[0]
        self.assertEqual(self.client.post(f"/api/posts/{other_post}/comments", headers=self.reader,
            json={"content": "跨文章回复", "parent_id": root["id"]}).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/comments/{root['id']}", headers=self.admin).status_code, 200)

    def test_deleting_post_cascades_through_nested_threads(self):
        root = self.create()
        reply = self.create(parent_id=root["id"])
        self.create(parent_id=reply["id"])
        response = self.client.delete(f"/api/posts/{self.post_id}", headers=self.owner)
        self.assertEqual(response.status_code, 200, response.text)
        with database.get_connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM comments WHERE post_id = ?", (self.post_id,)).fetchone()[0], 0)

    def test_existing_comments_migrate_without_losing_content(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            conn.executescript("""
                CREATE TABLE users (id INTEGER PRIMARY KEY);
                CREATE TABLE posts (id INTEGER PRIMARY KEY);
                CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER, author_id INTEGER, content TEXT, created_at TEXT);
                INSERT INTO comments VALUES (1, 1, 1, '旧评论正文', '2026-01-01');
            """)
            database.ensure_schema(conn)
            database.ensure_schema(conn)
            row = conn.execute("SELECT * FROM comments WHERE id = 1").fetchone()
            self.assertEqual(row["content"], "旧评论正文")
            self.assertIsNone(row["parent_id"])
            self.assertIsNone(row["root_id"])
            self.assertIsNone(row["deleted_at"])


if __name__ == "__main__":
    unittest.main()
