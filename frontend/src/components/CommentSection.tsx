import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Heart, Loader2, MessageCircle, Send, Trash2, X } from "lucide-react";
import { api } from "../api";
import type { CommentItem, User } from "../types";

type Props = {
  postId: number;
  user: User | null;
  token: string | null;
  onRequireLogin: () => boolean;
  onCountChange: (postId: number, count: number) => void;
};

const commentDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
});

function byHeat(left: CommentItem, right: CommentItem) {
  return (right.like_count + right.reply_count * 2) - (left.like_count + left.reply_count * 2)
    || Date.parse(left.created_at) - Date.parse(right.created_at)
    || left.id - right.id;
}

export function CommentSection({ postId, user, token, onRequireLogin, onCountChange }: Props) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const pending = useRef(new Set<number>());
  const submitLock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoaded(false);
    setError("");
    api.comments(postId, token).then((items) => {
      if (!cancelled) { setComments(items); setLoaded(true); }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "评论加载失败，请重试。");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [postId, token, refresh]);

  const commentCount = comments.filter((comment) => !comment.is_deleted).length;
  useEffect(() => {
    if (loaded) onCountChange(postId, commentCount);
  }, [postId, loaded, commentCount, onCountChange]);

  const { threads, byId } = useMemo(() => {
    // Recount descendants after local additions/deletions so ranking updates
    // immediately, without losing a draft to an extra network request.
    const byId = new Map(comments.map((comment) => [comment.id, { ...comment, reply_count: 0 }]));
    for (const comment of [...byId.values()].sort((a, b) => b.id - a.id)) {
      const parent = comment.parent_id === null ? null : byId.get(comment.parent_id);
      if (parent) parent.reply_count += comment.reply_count + Number(!comment.is_deleted);
    }
    const visible = [...byId.values()].filter((comment) => !comment.is_deleted || comment.reply_count > 0);
    const threads = visible.filter((comment) => comment.root_id === null)
      .sort(byHeat).map((comment) => ({ comment, replies: [] as CommentItem[] }));
    const roots = new Map(threads.map((thread) => [thread.comment.id, thread]));
    for (const comment of visible) {
      if (comment.root_id !== null) roots.get(comment.root_id)?.replies.push(comment);
    }
    for (const thread of threads) thread.replies.sort(byHeat);
    return { threads, byId };
  }, [comments]);

  async function submitComment(event: FormEvent, parentId: number | null = null) {
    event.preventDefault();
    if (!token || !user) { onRequireLogin(); return; }
    const content = (parentId === null ? commentText : replyText).trim();
    if (!content || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      const created = await api.createComment(postId, content, token, parentId);
      setComments((items) => [...items, created]);
      if (parentId === null) setCommentText("");
      else { setReplyTo(null); setReplyText(""); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "评论发送失败，请重试。");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  async function updateComment(comment: CommentItem, action: "like" | "delete") {
    if (!token || !user) { onRequireLogin(); return; }
    if (pending.current.has(comment.id)) return;
    pending.current.add(comment.id);
    setPendingIds([...pending.current]);
    setError("");
    try {
      if (action === "like") {
        const result = await api.toggleCommentLike(comment.id, token);
        setComments((items) => items.map((item) => item.id === comment.id
          ? { ...item, like_count: result.like_count, liked_by_me: result.liked } : item));
      } else {
        const result = await api.deleteComment(comment.id, token);
        setComments((items) => result.retained ? items.map((item) => item.id === comment.id
          ? { ...item, content: "", is_deleted: true, like_count: 0, liked_by_me: false } : item)
          : items.filter((item) => item.id !== comment.id));
        if (replyTo === comment.id) { setReplyTo(null); setReplyText(""); }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      pending.current.delete(comment.id);
      setPendingIds([...pending.current]);
    }
  }

  function startReply(comment: CommentItem) {
    if (!user || !token) { onRequireLogin(); return; }
    setReplyTo(comment.id);
    setReplyText("");
  }

  function renderComment(comment: CommentItem, isReply = false) {
    const parent = comment.parent_id === null ? null : byId.get(comment.parent_id);
    const busy = pendingIds.includes(comment.id);
    return (
      <article id={`comment-${comment.id}`} key={comment.id} className={`commentEntry${isReply ? " commentReply" : ""}`}>
        <div className="commentAvatar" aria-hidden="true">{comment.is_deleted ? "·" : Array.from(comment.author.username)[0]}</div>
        <div className="commentBody">
          {comment.is_deleted ? <p className="commentDeleted">该评论已删除</p> : <>
            <strong className="commentAuthor">{comment.author.username}</strong>
            {parent && <p className="commentReplyContext">回复 <a href={`#comment-${parent.id}`}>@{parent.author.username}</a></p>}
            <p className="commentContent">{comment.content}</p>
            <time className="commentTime" dateTime={comment.created_at}>{commentDate.format(new Date(comment.created_at))}</time>
            <div className="commentEntryActions">
              <button type="button" className={`commentAction${comment.liked_by_me ? " liked" : ""}`} aria-label={`点赞 ${comment.author.username} 的评论`}
                aria-pressed={comment.liked_by_me} disabled={busy} onClick={() => void updateComment(comment, "like")}>
                <Heart size={16} fill={comment.liked_by_me ? "currentColor" : "none"} /><span>{comment.like_count}</span>
              </button>
              <button type="button" className="commentAction" aria-label={`回复 ${comment.author.username} 的评论`}
                aria-expanded={replyTo === comment.id} aria-controls={replyTo === comment.id ? `reply-form-${comment.id}` : undefined}
                disabled={busy || submitting} onClick={() => startReply(comment)}>
                <MessageCircle size={16} /><span>回复{comment.reply_count > 0 ? ` ${comment.reply_count}` : ""}</span>
              </button>
              {(user?.id === comment.author.id || user?.role === "admin") && (
                <button type="button" className="commentAction commentDeleteAction" aria-label={`删除 ${comment.author.username} 的评论`}
                  disabled={busy || submitting} onClick={() => void updateComment(comment, "delete")}><Trash2 size={15} /></button>
              )}
            </div>
          </>}
          {replyTo === comment.id && !comment.is_deleted && (
            <form id={`reply-form-${comment.id}`} className="commentReplyForm" onSubmit={(event) => void submitComment(event, comment.id)}>
              <div className="commentReplyFormHeader"><span>回复 @{comment.author.username}</span>
                <button type="button" className="commentAction" aria-label="取消回复" disabled={submitting} onClick={() => { setReplyTo(null); setReplyText(""); }}><X size={16} /></button>
              </div>
              <textarea aria-label={`回复 ${comment.author.username}`} placeholder="写下你的回复..." autoFocus maxLength={800} required
                value={replyText} onChange={(event) => setReplyText(event.target.value)} disabled={submitting} />
              <button className="solidButton commentSendButton" disabled={submitting || !replyText.trim()}>
                {submitting ? <Loader2 size={15} className="spinning" /> : <Send size={15} />}发送回复
              </button>
            </form>
          )}
        </div>
      </article>
    );
  }

  return (
    <section id="article-comments" className="articleComments" tabIndex={-1} aria-labelledby="comments-heading" aria-busy={loading}>
      <div className="commentsHeader"><h2 id="comments-heading">评论区 <span>{loaded ? commentCount : ""}</span></h2><span>按热度排序</span></div>
      <form className="articleCommentForm" onSubmit={(event) => void submitComment(event)}>
        <textarea aria-label="发表评论" placeholder={user ? "写下你的想法..." : "登录后参与讨论"} maxLength={800} required
          value={commentText} onChange={(event) => setCommentText(event.target.value)} disabled={!user || submitting || loading} />
        {user ? <button className="solidButton commentSendButton" disabled={!commentText.trim() || submitting || loading}>
          {submitting ? <Loader2 size={16} className="spinning" /> : <Send size={16} />}发表评论
        </button> : <button type="button" className="solidButton commentSendButton" onClick={onRequireLogin}>登录后评论</button>}
      </form>
      {error && <div className="commentError" role="alert"><p>{error}</p>
        {!loaded && <button type="button" className="textButton" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>重新加载</button>}
      </div>}
      {loading ? <p className="commentsEmpty" role="status">正在加载评论…</p> : loaded && threads.length === 0 ? (
        <p className="commentsEmpty">还没有评论，来聊聊你的想法。</p>
      ) : (
        <div className="commentThreadList">{threads.map(({ comment, replies }) => (
          <div className="commentThread" key={comment.id}>
            {renderComment(comment)}
            {replies.length > 0 && <div className="commentReplyList" aria-label={`${comment.author.username} 的评论下的回复`}>{replies.map((reply) => renderComment(reply, true))}</div>}
          </div>
        ))}</div>
      )}
    </section>
  );
}
