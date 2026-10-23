"""Run with the project's Python dependencies: python -m unittest discover -s backend/tests."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest
from io import BytesIO
from http.cookies import SimpleCookie
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
(ROOT / ".dist").mkdir(exist_ok=True)
STATE = tempfile.TemporaryDirectory(prefix="editor-media-tests-", dir=ROOT / ".dist")
STATE_PATH = Path(STATE.name).resolve()
os.environ["BLOG_DATABASE_PATH"] = str(STATE_PATH / "test.db")
os.environ["BLOG_UPLOADS_DIR"] = str(STATE_PATH / "uploads")
sys.path.insert(0, str(ROOT / "backend"))

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from app.api import music, routes
from app.db.database import get_connection
from app.main import app


def tearDownModule():
    if not STATE_PATH.is_relative_to((ROOT / ".dist").resolve()):
        raise RuntimeError("Refusing to clean a test directory outside .dist")
    STATE.cleanup()


class EditorMediaTests(unittest.TestCase):
    def setUp(self):
        self.fee = 0
        self.trial = None
        self.qr_code = 803
        self.qr_cookie_headers = None
        self.expired_account = False
        self.patcher = patch.object(music, "upstream", side_effect=self.upstream)
        self.mock_upstream = self.patcher.start()
        app.dependency_overrides[routes.require_user] = lambda: {"id": 1, "role": "member"}
        self.client = TestClient(app, base_url="https://blog.test")
        self.client.__enter__()
        with get_connection() as conn:
            conn.execute("DELETE FROM music_browser_sessions")

    def tearDown(self):
        self.client.__exit__(None, None, None)
        app.dependency_overrides.clear()
        self.patcher.stop()

    def upstream(self, path, data=None):
        if path == "/song/detail":
            return {"songs": [{"id": 123, "name": "测试配乐", "ar": [{"name": "歌手"}],
                               "al": {"picUrl": "https://p1.music.126.net/cover.jpg"}, "dt": 180000, "fee": self.fee}]}
        if path == "/song/url":
            return {"data": [{"id": 123, "url": "http://m801.music.126.net/test.mp3", "expi": 1200,
                              "fee": self.fee, "freeTrialInfo": self.trial}]}
        if path == "/login/qr/key":
            return {"data": {"unikey": "test-qr-key"}}
        if path == "/login/qr/create":
            return {"data": {"qrimg": "data:image/png;base64,AA==", "qrurl": "https://music.163.com/login?codekey=test"}}
        if path == "/login/qr/check":
            if self.qr_cookie_headers is not None:
                return {"code": self.qr_code, "cookie": ";".join(self.qr_cookie_headers), "cookies": self.qr_cookie_headers}
            return {"code": self.qr_code, "cookie": "MUSIC_U=listener-only; __csrf=csrf; Path=/; HttpOnly"}
        if path == "/login/status":
            return {"data": {"profile": None if self.expired_account else {"userId": 7, "nickname": "当前听众", "vipType": 11}}}
        raise AssertionError(f"Unexpected upstream operation: {path}")

    def post(self, path, **kwargs):
        return self.client.post("/api/music" + path, headers={"X-Music-Request": "1"}, **kwargs)

    def authorize(self):
        created = self.post("/auth/qr")
        self.assertEqual(created.status_code, 200)
        self.assertIn("HttpOnly", created.headers["set-cookie"])
        self.assertIn("SameSite=lax", created.headers["set-cookie"])
        self.assertIn("Secure", created.headers["set-cookie"])
        checked = self.post("/auth/qr/check")
        self.assertEqual(checked.json()["status"], "authorized")
        self.assertNotIn("listener-only", checked.text)
        return checked

    def test_upload_requires_blog_login(self):
        app.dependency_overrides.clear()
        response = self.client.post("/api/upload", files={"file": ("photo.jpg", b"x", "image/jpeg")})
        self.assertEqual(response.status_code, 401)

    def test_database_connection_closes_after_context(self):
        with get_connection() as conn:
            self.assertEqual(conn.execute("SELECT 1").fetchone()[0], 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute("SELECT 1")

    def test_generated_excerpt_does_not_expose_music_or_image_markup(self):
        content = '[网易云音乐](https://music.163.com/song?id=123 "blog-music")\n\n![image_1](/uploads/image_123.jpg)\n\n## 正文标题\n\n这是真正的文章内容。'
        response = self.client.post("/api/posts", json={"title": "配乐摘要测试", "content": content})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["excerpt"], "正文标题 这是真正的文章内容。")

    def test_upload_jpg_and_png_have_no_original_filename(self):
        for fmt, ext in [("JPEG", "jpg"), ("PNG", "png")]:
            image = BytesIO()
            Image.new("RGB", (32, 16), "blue").save(image, fmt)
            response = self.client.post("/api/upload", files={"file": ("private-original-name." + ext, image.getvalue(), "image/" + ext)})
            self.assertEqual(response.status_code, 200)
            self.assertRegex(response.json()["filename"], r"^image_\d+\." + ext + "$")
            self.assertNotIn("private-original-name", response.text)
            served = self.client.get(response.json()["url"])
            self.assertEqual(served.status_code, 200)
            self.assertEqual(served.headers["x-content-type-options"], "nosniff")

    def test_heic_is_converted_to_displayable_jpeg(self):
        image = BytesIO()
        Image.new("RGB", (32, 16), "red").save(image, "HEIF")
        response = self.client.post("/api/upload", files={"file": ("IMG_1234.HEIC", image.getvalue(), "application/octet-stream")})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["filename"].endswith(".jpg"))
        with Image.open(BytesIO(self.client.get(response.json()["url"]).content)) as converted:
            self.assertEqual(converted.format, "JPEG")
            self.assertEqual(converted.size, (32, 16))

    def test_corrupt_empty_and_oversize_images_are_rejected(self):
        for filename, content in [("x.jpg", b""), ("x.heic", b"broken"), ("x.png", b"x" * (routes.MAX_UPLOAD_BYTES + 1))]:
            response = self.client.post("/api/upload", files={"file": (filename, content, "image/png")})
            self.assertEqual(response.status_code, 422)

    def test_desktop_mobile_and_shared_song_links(self):
        for link in ["https://music.163.com/song?id=123", "https://music.163.com/#/song?id=123&userid=7",
                     "分享一首歌：https://y.music.163.com/m/song?id=123&app_version=9", "https://music.163.com/song/123"]:
            self.assertEqual(music.song_id_from_link(link), "123")

    def test_unsafe_hosts_ports_and_non_song_links_are_rejected(self):
        for link in ["https://evil.test/song?id=123", "https://music.163.com.evil.test/song?id=123",
                     "https://music.163.com:bad/song?id=123", "https://music.163.com:8000/song?id=123",
                     "https://user:password@music.163.com/song?id=123", "https://music.163.com/playlist?id=123"]:
            with self.assertRaises(HTTPException):
                music.song_id_from_link(link)

    def test_short_link_redirect_cannot_leave_netease_hosts(self):
        with self.assertRaises(HTTPException):
            music.SafeMusicRedirect().redirect_request(None, None, 302, "", {}, "http://127.0.0.1/private")

    def test_add_song_needs_no_netease_login(self):
        self.fee = 1
        response = self.post("/resolve", json={"link": "https://music.163.com/song?id=123"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "123")

    def test_cross_origin_form_cannot_create_authorization(self):
        self.assertEqual(self.client.post("/api/music/auth/qr").status_code, 403)

    def test_free_song_can_play_as_a_guest(self):
        response = self.post("/songs/123/play")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["url"].startswith("https://"))
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_vip_song_requires_listener_authorization(self):
        self.fee = 1
        response = self.post("/songs/123/play")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "netease_login_required")
        self.assertFalse(any(call.args[0] == "/song/url" for call in self.mock_upstream.call_args_list))

    def test_authorized_listener_can_play_vip_but_other_browser_cannot(self):
        self.authorize()
        self.fee = 1
        self.assertEqual(self.post("/songs/123/play").status_code, 200)
        other = TestClient(app, base_url="https://blog.test")
        self.assertEqual(other.post("/api/music/songs/123/play", headers={"X-Music-Request": "1"}).status_code, 401)

    def test_multiple_set_cookie_headers_do_not_drop_music_u(self):
        self.qr_cookie_headers = ["__csrf=csrf; Path=/; HttpOnly;"] + [
            f"unused_{index}=guest; Expires=Fri, 06 Nov 2026 12:00:00 GMT; Path=/; HttpOnly;"
            for index in range(24)
        ] + ["MUSIC_U=listener-only; Max-Age=1296000; Path=/; HttpOnly;", "MUSIC_A=; Max-Age=0; Path=/;"]
        previous_parser = SimpleCookie()
        previous_parser.load(";".join(self.qr_cookie_headers))
        self.assertNotIn("MUSIC_U", previous_parser)  # Reproduces the original failure.
        self.authorize()
        with get_connection() as conn:
            cookie = conn.execute("SELECT provider_cookie FROM music_browser_sessions").fetchone()[0]
        self.assertIn("MUSIC_U=listener-only", cookie)
        self.assertNotIn("unused_", cookie)
        self.assertNotIn("Max-Age", cookie)
        self.fee = 1
        self.assertEqual(self.post("/songs/123/play").status_code, 200)

    def test_authorization_cookie_accepts_header_arrays_and_discards_attributes(self):
        for field in ("cookie", "cookies"):
            value = music.authorization_cookie({field: [
                "__csrf=csrf; Path=/; HttpOnly;", "MUSIC_U=listener-only; Path=/; Secure; SameSite=None;",
            ]})
            self.assertEqual(value, "__csrf=csrf; MUSIC_U=listener-only")
        self.assertEqual(music.authorization_cookie({"cookie": {"MUSIC_U": "untrusted-shape"}}), "")
        self.assertEqual(music.authorization_cookie({"cookie": "MUSIC_A=guest; Path=/;"}), "")

    def test_confirmed_qr_waits_for_credentials_instead_of_expiring(self):
        self.post("/auth/qr")
        self.qr_cookie_headers = []
        self.assertEqual(self.post("/auth/qr/check").json()["status"], "authorizing")
        self.assertFalse(self.client.get("/api/music/session").json()["logged_in"])
        self.qr_cookie_headers = ["MUSIC_U=listener-only; Path=/; HttpOnly;"]
        self.assertEqual(self.post("/auth/qr/check").json()["status"], "authorized")

    def test_confirmed_qr_retries_while_profile_is_propagating(self):
        self.post("/auth/qr")
        self.expired_account = True
        self.assertEqual(self.post("/auth/qr/check").json()["status"], "authorizing")
        self.expired_account = False
        self.assertEqual(self.post("/auth/qr/check").json()["status"], "authorized")

    def test_completed_qr_check_is_idempotent(self):
        self.authorize()
        self.mock_upstream.reset_mock()
        self.assertEqual(self.post("/auth/qr/check").json()["status"], "authorized")
        self.assertFalse(any(call.args[0] == "/login/qr/check" for call in self.mock_upstream.call_args_list))

    def test_refreshed_qr_cannot_be_overwritten_by_an_old_poll(self):
        self.post("/auth/qr")
        def racing_upstream(path, data=None):
            if path == "/login/status":
                with get_connection() as conn:
                    conn.execute("UPDATE music_browser_sessions SET qr_key = 'new-qr-key'")
            return self.upstream(path, data)
        self.mock_upstream.side_effect = racing_upstream
        self.assertEqual(self.post("/auth/qr/check").json()["status"], "superseded")
        with get_connection() as conn:
            self.assertEqual(conn.execute("SELECT provider_cookie FROM music_browser_sessions").fetchone()[0], "")

    def test_login_is_remembered_in_same_browser_and_can_be_removed(self):
        self.authorize()
        reopened = TestClient(app, base_url="https://blog.test", cookies=self.client.cookies)
        self.assertTrue(reopened.get("/api/music/session").json()["logged_in"])
        response = reopened.delete("/api/music/session", headers={"X-Music-Request": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.client.get("/api/music/session").json()["logged_in"])

    def test_trial_fragment_is_never_presented_as_full_vip_track(self):
        self.authorize()
        self.fee = 1
        self.trial = {"start": 0, "end": 30}
        response = self.post("/songs/123/play")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["code"], "vip_required")

    def test_expired_netease_session_requires_new_authorization(self):
        self.authorize()
        self.expired_account = True
        self.fee = 1
        response = self.post("/songs/123/play")
        self.assertEqual(response.status_code, 401)
        self.assertFalse(self.client.get("/api/music/session").json()["logged_in"])

    def test_expired_qr_is_not_polled_upstream(self):
        self.post("/auth/qr")
        with get_connection() as conn:
            conn.execute("UPDATE music_browser_sessions SET qr_expires = 0")
        self.mock_upstream.reset_mock()
        self.assertEqual(self.post("/auth/qr/check").json()["status"], "expired")
        self.mock_upstream.assert_not_called()


if __name__ == "__main__":
    unittest.main()
