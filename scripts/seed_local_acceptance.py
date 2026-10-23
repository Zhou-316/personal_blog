"""Idempotent sample content for the isolated, local-only acceptance database."""
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
database = Path(os.environ["BLOG_DATABASE_PATH"]).resolve()
if not database.is_relative_to(ROOT / ".dist" / "local-acceptance"):
    raise RuntimeError("Sample data may only be created in .dist/local-acceptance")

from app.core.security import hash_password
from app.db.database import get_connection, init_db, now_iso

init_db()
with get_connection() as conn:
    accounts = [
        ("纸上尘", "owner@local.test", "GlassLocal2026!", "admin", "记录一些走过的路，和还没想明白的事。"),
        ("山间来信", "reader@local.test", "ReaderLocal2026!", "member", "读书，散步，偶尔写一点。"),
    ]
    for username, email, password, role, bio in accounts:
        if not conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
            conn.execute("INSERT INTO users (username,email,password_hash,bio,role,created_at) VALUES (?,?,?,?,?,?)",
                         (username, email, hash_password(password), bio, role, now_iso()))
    owner_id = conn.execute("SELECT id FROM users WHERE email='owner@local.test'").fetchone()[0]
    reader_id = conn.execute("SELECT id FROM users WHERE email='reader@local.test'").fetchone()[0]
    articles = [
        ("风从山的那边来", "小说随笔", "写给那些没有赶路的下午，也写给慢慢经过的风。", "傍晚"),
        ("留一盏灯给晚归的人", "小说随笔", "关于一条旧街、一家书店，以及一个始终没有写完的故事。", "随笔"),
        ("沿着海岸线，慢慢走", "旅行日记", "从清晨的第一班车开始，把一天交给海边的小路。", "在路上"),
        ("在山里住了三天", "旅行日记", "没有安排满的行程，只有晨雾、溪水和热茶。", "山野"),
        ("把一个问题写清楚", "技术笔记", "从一次接口调试说起：如何留下以后还能看懂的开发记录。", "开发"),
        ("React 组件中的状态与边界", "技术笔记", "什么时候提取组件，什么时候保持简单，以及一次小小的重构。", "学习"),
        ("线性代数：从向量到空间", "课程笔记与资料", "用几个直观例子理解线性组合、基与维度。", "课堂"),
        ("把课程里的问题带回生活：一份关于观察、记录与理解的学习笔记", "课程笔记与资料", "整理本周的课堂记录，附上值得再想一次的问题。", "整理"),
    ]
    for index, (title, category, excerpt, mood) in enumerate(articles):
        if conn.execute("SELECT id FROM posts WHERE author_id=? AND title=?", (owner_id, title)).fetchone():
            continue
        content = f"""## {title}

{excerpt}

有时，把脚步放慢一点，才会注意到原先错过的东西。窗边的光落在书页上，山的轮廓在远处一点点变清楚。这些片刻值得留下来。

### 记下来的几件事

- 先认真观察，再试着解释。
- 把复杂的问题拆成可以动手的小步。
- 给明天留一点空白，也留下一点线索。

> 不急着得出结论。让问题在纸上多停留一会儿。

### 一段记录

```typescript
const notes = ["观察", "记录", "理解"];
for (const note of notes) {{
  console.log(note);
}}
```

| 主题 | 记录方式 | 下一步 |
| --- | --- | --- |
| 阅读 | 摘录与批注 | 写下自己的解释 |
| 实践 | 问题与过程 | 留下可复用的经验 |

![远处的雪山](/snow-mountain-bg.jpg)

### 写在最后

等到下一次回看，希望还能记起此刻的心情。也欢迎在评论里留下你的想法。
"""
        stamp = f"2026-10-{22 - index:02d}T09:00:00+00:00"
        conn.execute("INSERT INTO posts (title,excerpt,content,mood,category,author_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                     (title, excerpt, content, mood, category, owner_id, stamp, stamp))
    post_id = conn.execute("SELECT id FROM posts WHERE author_id=? ORDER BY id LIMIT 1", (owner_id,)).fetchone()[0]
    if not conn.execute("SELECT id FROM comments WHERE post_id=? AND author_id=?", (post_id, reader_id)).fetchone():
        comment_id = conn.execute("INSERT INTO comments (post_id,author_id,content,created_at) VALUES (?,?,?,?)",
                                 (post_id, reader_id, "喜欢这样的记录。读完也想找一个安静的下午出去走走。", now_iso())).lastrowid
        conn.execute("INSERT INTO notifications (user_id,actor_id,type,post_id,comment_id,created_at) VALUES (?,?,'comment',?,?,?)",
                     (owner_id, reader_id, post_id, comment_id, now_iso()))
    conn.execute("INSERT OR IGNORE INTO likes (user_id,target_type,target_id,created_at) VALUES (?,'post',?,?)", (reader_id, post_id, now_iso()))
    if not conn.execute("SELECT id FROM direct_messages WHERE sender_id=? AND recipient_id=?", (reader_id, owner_id)).fetchone():
        conn.execute("INSERT INTO direct_messages (sender_id,recipient_id,content,created_at) VALUES (?,?,?,?)",
                     (reader_id, owner_id, "你好，读到了你的旅行日记。下次也想去看看那片海。", now_iso()))
print("Local sample data ready. Owner: owner@local.test / GlassLocal2026!")
print("Reader: reader@local.test / ReaderLocal2026!")
