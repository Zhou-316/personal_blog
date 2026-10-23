import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bell,
  BookOpen,
  Check,
  Cloud,
  Edit3,
  Flame,
  Heart,
  Inbox,
  Leaf,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MessageCircle,
  Music2,
  PenLine,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { api } from "./api";
import { ArticleContent } from "./components/ArticleContent";
import { AddMusicDialog } from "./components/AddMusicDialog";
import { splitArticleMusic, withArticleMusic } from "./lib/articleMusic";
import { GlassBackdrop } from "./components/glass/GlassBackdrop";
import { useGlassCapabilities } from "./hooks/useGlassCapabilities";
import type { AuthResponse, CommentItem, DirectMessage, MessageThread, Post, PostInput, User, UserCenter } from "./types";

type Screen = "home" | "detail" | "compose" | "category" | "water" | "profile";
type OwnerCategory = "小说随笔" | "旅行日记" | "技术笔记" | "课程笔记与资料";
type AuthMode = "login" | "register";
type ProfileTab = "posts" | "messages" | "info";
const heroTitle = "云山苍苍，江水泱泱";
const heroTitleChars = Array.from(heroTitle);
const ownerCategories: Array<{ name: OwnerCategory; subtitle: string; description: string }> = [
  { name: "小说随笔", subtitle: "Fiction & Essays", description: "故事、短章、人物与生活里的细小光影。" },
  { name: "旅行日记", subtitle: "Travel Notes", description: "山海路途、城市片刻和抵达之前的风。" },
  { name: "技术笔记", subtitle: "Tech Notes", description: "开发记录、问题复盘和可复用的技术片段。" },
  { name: "课程笔记与资料", subtitle: "Course Archive", description: "课程资料、实验记录和学习路径整理。" }
];

const emptyDraft: PostInput = {
  title: "",
  excerpt: "",
  content: "## 今天想写下\n\n",
  mood: "随笔",
  category: "小说随笔"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function App() {
  const { enabled: glassEnabled, canAnimate, reducedMotion, toggle: toggleGlass } = useGlassCapabilities();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("blog_token"));
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [activePost, setActivePost] = useState<Post | null>(null);
  const [activeCategory, setActiveCategory] = useState<OwnerCategory | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [screen, setScreen] = useState<Screen>("home");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<PostInput>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [summaryMode, setSummaryMode] = useState<"prompt" | "summary" | "dismissed">("prompt");
  const [summaryText, setSummaryText] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const [composeTab, setComposeTab] = useState<"edit" | "preview">("edit");
  const [musicDialogOpen, setMusicDialogOpen] = useState(false);
  const uploadLock = useRef(false);
  const composeGeneration = useRef(0);
  const [profileTab, setProfileTab] = useState<ProfileTab>("posts");
  const [profileData, setProfileData] = useState<UserCenter | null>(null);
  const [messageUsers, setMessageUsers] = useState<User[]>([]);
  const [messageThreads, setMessageThreads] = useState<MessageThread[]>([]);
  const [activeMessageUser, setActiveMessageUser] = useState<User | null>(null);
  const [activeMessages, setActiveMessages] = useState<DirectMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [selectedRecipientId, setSelectedRecipientId] = useState("");
  const [heroTypedCount, setHeroTypedCount] = useState(0);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  const ownerPosts = useMemo(() => posts.filter((post) => post.author.role === "admin"), [posts]);
  const waterPosts = useMemo(() => posts.filter((post) => post.author.role !== "admin"), [posts]);
  const activeCategoryMeta = useMemo(
    () => ownerCategories.find((category) => category.name === activeCategory) ?? ownerCategories[0],
    [activeCategory]
  );

  const activeCategoryPosts = useMemo(() => {
    if (!activeCategory) return [];
    return ownerPosts.filter((post) => (post.category || "小说随笔") === activeCategory);
  }, [activeCategory, ownerPosts]);
  const hotPosts = useMemo(() => {
    return [...posts]
      .sort((left, right) => {
        const rightHeat = right.like_count + right.comment_count * 2;
        const leftHeat = left.like_count + left.comment_count * 2;
        if (rightHeat !== leftHeat) return rightHeat - leftHeat;
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      })
      .slice(0, 5);
  }, [posts]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchMatches = useMemo(() => {
    if (!normalizedQuery) return [];
    return posts
      .filter((post) =>
        [post.title, post.excerpt, post.author.username]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
      .slice(0, 8);
  }, [normalizedQuery, posts]);
  const showSearchResults = searchFocused && normalizedQuery.length > 0;
  const unreadCommentCount = profileData?.unread_comment_count ?? 0;
  const unreadMessageCount = profileData?.unread_message_count ?? 0;
  const profileUnreadCount = unreadCommentCount + unreadMessageCount;

  async function loadPosts() {
    const data = await api.posts("", token);
    setPosts(data);
  }

  async function loadMe(currentToken = token) {
    if (!currentToken) {
      setUser(null);
      setProfileData(null);
      setMessageUsers([]);
      setMessageThreads([]);
      setActiveMessageUser(null);
      setActiveMessages([]);
      return;
    }
    try {
      const currentUser = await api.me(currentToken);
      setUser(currentUser);
      setProfileData(await api.userCenter(currentToken));
    } catch {
      localStorage.removeItem("blog_token");
      setToken(null);
      setUser(null);
      setProfileData(null);
    }
  }

  async function refreshProfileData(currentToken = token) {
    if (!currentToken) return null;
    const data = await api.userCenter(currentToken);
    setProfileData(data);
    return data;
  }

  async function refreshMessageMeta(currentToken = token) {
    if (!currentToken) return;
    const [usersData, threadData] = await Promise.all([
      api.users(currentToken),
      api.messageThreads(currentToken)
    ]);
    setMessageUsers(usersData);
    setMessageThreads(threadData);
    if (!selectedRecipientId && usersData[0]) {
      setSelectedRecipientId(String(usersData[0].id));
    }
  }

  async function markCommentNotificationsRead() {
    if (!token) return;
    const counts = await api.markNotificationsRead(token);
    setProfileData((current) =>
      current
        ? {
            ...current,
            comment_notifications: current.comment_notifications.map((item) => ({ ...item, read: true })),
            unread_comment_count: counts.unread_comment_count,
            unread_message_count: counts.unread_message_count
          }
        : current
    );
  }

  async function openProfile(tab: ProfileTab = "posts") {
    if (!requireLogin()) return;
    setProfileTab(tab);
    setScreen("profile");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (!token) return;
    try {
      await Promise.all([refreshProfileData(token), refreshMessageMeta(token)]);
      if (tab === "posts") {
        await markCommentNotificationsRead();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "个人中心加载失败");
    }
  }

  async function switchProfileTab(tab: ProfileTab) {
    setProfileTab(tab);
    if (tab === "posts") {
      markCommentNotificationsRead().catch((error) =>
        setNotice(error instanceof Error ? error.message : "通知更新失败")
      );
    }
    if (tab === "messages") {
      refreshMessageMeta().catch((error) => setNotice(error instanceof Error ? error.message : "私信加载失败"));
    }
  }

  async function openMessageThread(userId: number) {
    if (!token) return;
    try {
      const detail = await api.messageThread(userId, token);
      setActiveMessageUser(detail.user);
      setActiveMessages(detail.messages);
      setSelectedRecipientId(String(detail.user.id));
      setProfileData((current) =>
        current ? { ...current, unread_message_count: detail.unread_message_count } : current
      );
      await refreshMessageMeta(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "云朵消息加载失败");
    }
  }

  async function sendCloudMessage(event: FormEvent) {
    event.preventDefault();
    if (!token || !messageText.trim()) return;
    const recipientId = activeMessageUser?.id ?? Number(selectedRecipientId);
    if (!recipientId) {
      setNotice("请选择收信人");
      return;
    }
    try {
      await api.sendMessage(recipientId, messageText, token);
      setMessageText("");
      await openMessageThread(recipientId);
      await refreshProfileData(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "云朵消息发送失败");
    }
  }

  async function openPost(postId: number) {
    const [postData, commentData] = await Promise.all([
      api.post(postId, token),
      api.comments(postId, token)
    ]);
    setActivePost(postData);
    setComments(commentData);
    setScreen("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goHome(scrollToLetters = false) {
    setScreen("home");
    window.setTimeout(() => {
      if (scrollToLetters) {
        document.getElementById("letters")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 0);
  }

  function requireLogin() {
    if (token && user) {
      return true;
    }
    setAuthMode("login");
    setAuthOpen(true);
    return false;
  }

  function startCompose(post?: Post) {
    if (!requireLogin()) return;
    composeGeneration.current++;
    uploadLock.current = false;
    setImageUploading(false);
    setComposeTab("edit");
    setMusicDialogOpen(false);
    if (post) {
      setEditingId(post.id);
      setDraft({
        title: post.title,
        excerpt: post.excerpt,
        content: post.content,
        mood: post.mood,
        category: (post.category || "小说随笔") as OwnerCategory
      });
    } else {
      setEditingId(null);
      setDraft(emptyDraft);
    }
    setScreen("compose");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    if (searchMatches[0]) {
      openSearchResult(searchMatches[0]);
    } else if (normalizedQuery) {
      setNotice("没有匹配的博客");
    }
  }

  function openSearchResult(post: Post) {
    setSearchFocused(false);
    setQuery("");
    openPost(post.id);
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      username: String(form.get("username") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? "")
    };
    setLoading(true);
    setNotice("");
    try {
      const response: AuthResponse =
        authMode === "register"
          ? await api.register(payload)
          : await api.login({ email: payload.email, password: payload.password });
      localStorage.setItem("blog_token", response.access_token);
      setToken(response.access_token);
      setUser(response.user);
      setAuthOpen(false);
      setNotice(`欢迎，${response.user.username}`);
      await loadPosts();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("blog_token");
    setToken(null);
    setUser(null);
    setNotice("已退出登录");
    loadPosts();
  }

  async function savePost(event: FormEvent) {
    event.preventDefault();
    if (uploadLock.current) { setNotice("请等待图片上传完成后再保存"); return; }
    if (!token || !requireLogin()) return;
    setLoading(true);
    setNotice("");
    try {
      const saved = editingId
        ? await api.updatePost(editingId, draft, token)
        : await api.createPost(draft, token);
      await loadPosts();
      await openPost(saved.id);
      setNotice(editingId ? "文章已更新" : "文章已发布");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function deletePost(postId: number) {
    if (!token || !requireLogin()) return;
    setLoading(true);
    try {
      await api.deletePost(postId, token);
      await loadPosts();
      setActivePost(null);
      goHome(true);
      setNotice("文章已删除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    } finally {
      setLoading(false);
    }
  }

  async function togglePostLike(postId: number) {
    if (!token || !requireLogin()) return;
    const result = await api.togglePostLike(postId, token);
    setPosts((items) =>
      items.map((post) =>
        post.id === postId ? { ...post, liked_by_me: result.liked, like_count: result.like_count } : post
      )
    );
    if (activePost?.id === postId) {
      setActivePost({ ...activePost, liked_by_me: result.liked, like_count: result.like_count });
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!activePost || !token || !requireLogin()) return;
    if (!commentText.trim()) return;
    const created = await api.createComment(activePost.id, commentText, token);
    setComments((items) => [...items, created]);
    setActivePost({ ...activePost, comment_count: activePost.comment_count + 1 });
    setCommentText("");
    await loadPosts();
  }

  async function removeComment(commentId: number) {
    if (!token || !activePost) return;
    await api.deleteComment(commentId, token);
    setComments((items) => items.filter((comment) => comment.id !== commentId));
    setActivePost({ ...activePost, comment_count: Math.max(0, activePost.comment_count - 1) });
    await loadPosts();
  }

  async function toggleCommentLike(commentId: number) {
    if (!token || !requireLogin()) return;
    const result = await api.toggleCommentLike(commentId, token);
    setComments((items) =>
      items.map((comment) =>
        comment.id === commentId
          ? { ...comment, liked_by_me: result.liked, like_count: result.like_count }
          : comment
      )
    );
  }




  function openWaterArea() {
    setScreen("water");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderWaterAreaCard() {
    const recentWaterPosts = waterPosts.slice(0, 3);

    return (
      <article className="ownerCategoryCard waterAreaCard">
        <button type="button" className="categoryTitleBar" onClick={openWaterArea}>
          <span>
            <strong>灌水区</strong>
            <small>Commons</small>
          </span>
          <span className="categoryCount">{waterPosts.length}</span>
        </button>
        <p>灌水聊天局，普通用户的公开发帖会汇在这里。</p>
        {recentWaterPosts.length > 0 ? (
          <div className="categoryPreviewList">
            {recentWaterPosts.map((post) => (
              <button type="button" key={post.id} className="categoryPreviewItem" onClick={() => openPost(post.id)}>
                <span>{post.title}</span>
                <small>@{post.author.username} · {formatDate(post.updated_at)}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="categoryPending" aria-label="待更新">
            <span>待</span>
            <span>更</span>
            <span>新</span>
          </div>
        )}
      </article>
    );
  }
  function openCategory(category: OwnerCategory) {
    setActiveCategory(category);
    setScreen("category");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderCategoryCard(category: (typeof ownerCategories)[number]) {
    const categoryPosts = ownerPosts
      .filter((post) => (post.category || "小说随笔") === category.name)
      .slice(0, 3);

    return (
      <article key={category.name} className="ownerCategoryCard">
        <button type="button" className="categoryTitleBar" onClick={() => openCategory(category.name)}>
          <span>
            <strong>{category.name}</strong>
            <small>{category.subtitle}</small>
          </span>
          <span className="categoryCount">{categoryPosts.length}</span>
        </button>
        <p>{category.description}</p>
        {categoryPosts.length > 0 ? (
          <div className="categoryPreviewList">
            {categoryPosts.map((post) => (
              <button type="button" key={post.id} className="categoryPreviewItem" onClick={() => openPost(post.id)}>
                <span>{post.title}</span>
                <small>{formatDate(post.updated_at)}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="categoryPending" aria-label="待更新">
            <span>待</span>
            <span>更</span>
            <span>新</span>
          </div>
        )}
      </article>
    );
  }

  function renderCategoryFeature(post: Post, variant: "cloud" | "water" = "cloud") {
    return (
      <section className="categoryFeatureBlock">
        <div className="sectionHeader compact categoryFeatureHeader">
          <div>
            <p className="eyebrow muted">Featured</p>
            <h2>热推文章</h2>
          </div>
          <span>最近一篇</span>
        </div>
        <div className="postGrid categoryFeatureGrid">
          {renderPostCard(post, variant)}
        </div>
      </section>
    );
  }
  async function requestAiSummary() {
    if (!activePost) return;
    setSummaryMode("summary");
    setSummaryLoading(true);
    setSummaryError("");
    setSummaryText("");
    try {
      const response = await api.summarizePost(activePost.id);
      setSummaryText(response.summary);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "AI 总结生成失败");
    } finally {
      setSummaryLoading(false);
    }
  }

  function renderHomeSidebar() {
    return (
      <aside className="siteSidebar" aria-label="热度排行">
        <section className="sidePanel hotPanel">
          <div className="sideTitle">
            <Flame size={17} />
            热度排行榜
          </div>
          {hotPosts.length > 0 ? (
            <ol className="hotList">
              {hotPosts.map((post, index) => (
                <li key={post.id}>
                  <button type="button" className="hotItem" onClick={() => openPost(post.id)}>
                    <span className={index < 3 ? "rankIndex rankTop" : "rankIndex"}>{index + 1}</span>
                    <span className="hotInfo">
                      <strong>{post.title}</strong>
                      <small>
                        <Heart size={13} />
                        {post.like_count}
                        <MessageCircle size={13} />
                        {post.comment_count}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="rankEmpty">暂无热度数据</div>
          )}
        </section>
      </aside>
    );
  }

  function renderAiSummary() {
    if (summaryMode === "dismissed") return null;

    return (
      <section className="aiSummaryCard">
        {summaryMode === "prompt" ? (
          <>
            <div className="summaryPromptIcon">
              <Sparkles size={18} />
            </div>
            <p>读得有点累了...是否需要AI帮助文章总结？</p>
            <div className="summaryChoices">
              <button type="button" className="choiceButton accept" onClick={requestAiSummary} title="需要总结">
                <Check size={17} />
              </button>
              <button
                type="button"
                className="choiceButton reject"
                onClick={() => setSummaryMode("dismissed")}
                title="暂不需要"
              >
                <X size={17} />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="summaryHeader">
              <h2>
                <Sparkles size={17} />
                AI文章总结
              </h2>
              <button type="button" className="metric" onClick={() => setSummaryMode("dismissed")} title="关闭总结">
                <X size={15} />
              </button>
            </div>
            {summaryLoading && <div className="summaryLoading">正在整理文章脉络...</div>}
            {summaryError && (
              <div className="summaryError">
                <p>{summaryError}</p>
                <button type="button" className="ghostButton" onClick={requestAiSummary}>
                  重新生成
                </button>
              </div>
            )}
            {!summaryLoading && !summaryError && summaryText && (
              <div className="markdown summaryMarkdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryText}</ReactMarkdown>
              </div>
            )}
          </>
        )}
      </section>
    );
  }
  async function uploadImageFiles(files: File[]) {
    if (!token || !requireLogin() || uploadLock.current || files.length === 0) return;
    const supported = files.filter((file) => /\.(jpe?g|png|heic|heif|gif|webp)$/i.test(file.name));
    const valid = supported.filter((file) => file.size > 0 && file.size <= 10 * 1024 * 1024);
    if (valid.length !== files.length) setNotice("仅上传有效的图片文件，每张不超过 10 MB；支持 JPG、PNG、HEIC。");
    else setNotice("");
    if (!valid.length) return;
    uploadLock.current = true;
    setImageUploading(true);
    const generation = composeGeneration.current;
    const textarea = contentRef.current;
    const article = splitArticleMusic(draft.content);
    const bodyStart = article.songId ? draft.content.length - article.body.length : 0;
    const start = Math.max(bodyStart, textarea?.selectionStart ?? draft.content.length);
    const end = Math.max(start, textarea?.selectionEnd ?? draft.content.length);
    const numbers = Array.from(draft.content.matchAll(/!\[image_(\d+)\]/g), (match) => Number(match[1]));
    const firstNumber = Math.max(0, ...numbers) + 1;
    const pending = valid.map((_, index) => ({
      marker: `<!-- image-upload:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${index} -->`,
      label: `image_${firstNumber + index}`
    }));
    const placeholders = `\n\n${pending.map((item) => item.marker).join("\n\n")}\n\n`;
    setDraft((previous) => ({ ...previous, content: previous.content.slice(0, start) + placeholders + previous.content.slice(end) }));
    window.setTimeout(() => {
      if (generation === composeGeneration.current) {
        contentRef.current?.focus();
        contentRef.current?.setSelectionRange(start + placeholders.length, start + placeholders.length);
      }
    }, 0);
    try {
      for (let index = 0; index < valid.length; index++) {
        if (generation !== composeGeneration.current) break;
        const { marker, label } = pending[index];
        try {
          const result = await api.uploadImage(valid[index], token);
          if (generation === composeGeneration.current) setDraft((previous) => ({
            ...previous, content: previous.content.replace(marker, `![${label}](${result.url})`)
          }));
        } catch (error) {
          if (generation === composeGeneration.current) {
            setDraft((previous) => ({ ...previous, content: previous.content.replace(marker, "") }));
            setNotice(error instanceof Error ? error.message : "图片上传失败");
          }
        }
      }
    } finally {
      if (generation === composeGeneration.current) {
        uploadLock.current = false;
        setImageUploading(false);
        setDragOver(false);
      }
    }
  }

  function handleImageDrop(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragOver(false);
    void uploadImageFiles(Array.from(event.dataTransfer.files));
  }

  function handleImageFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    void uploadImageFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function renderPostCard(post: Post, variant: "cloud" | "water" = "water") {
    const adminPost = post.author.role === "admin";
    const open = () => openPost(post.id);
    return (
      <article
        key={post.id}
        className={variant === "cloud" ? "postCard cloudCard" : "postCard"}
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
      >
        <div className="cardTopline">
          <span>{post.mood}</span>
          <div className="cardTopMeta">
            {variant === "water" && (
              <span className="waterAuthorTop">{post.author.username}</span>
            )}
            <time>{formatDate(post.updated_at)}</time>
          </div>
        </div>
        <h3 className="cardTitle">{post.title}</h3>
        <p>{post.excerpt}</p>
        <div className="cardFooter">
          <span className="authorChip">
            <UserRound size={15} />
            {post.author.username}
            {adminPost && <span className="ownerMiniBadge">站主</span>}
          </span>
          <div className="metricGroup">
            <button
              className={post.liked_by_me ? "metric active" : "metric"}
              onClick={(event) => {
                event.stopPropagation();
                togglePostLike(post.id);
              }}
              title="喜欢"
            >
              <Heart size={16} />
              {post.like_count}
            </button>
            <button
              className="metric"
              onClick={(event) => {
                event.stopPropagation();
                open();
              }}
              title="评论"
            >
              <MessageCircle size={16} />
              {post.comment_count}
            </button>
          </div>
        </div>
      </article>
    );
  }

  function renderProfilePosts() {
    const myPosts = profileData?.posts ?? [];
    const commentNotifications = profileData?.comment_notifications ?? [];

    return (
      <div className="profileContentGrid">
        <section className="profileMainPanel">
          <div className="sectionHeader compact profilePanelHeader">
            <div>
              <p className="eyebrow muted">
                <Inbox size={15} />
                My Posts
              </p>
              <h2>我的帖子</h2>
            </div>
            <span>{myPosts.length} 篇</span>
          </div>
          {myPosts.length > 0 ? (
            <div className="postGrid profilePostGrid">
              {myPosts.map((post) => renderPostCard(post, post.author.role === "admin" ? "cloud" : "water"))}
            </div>
          ) : (
            <div className="profileEmpty">
              <Cloud size={34} />
              <p>还没有发过帖子。</p>
              <button type="button" className="solidButton" onClick={() => startCompose()}>
                <PenLine size={16} />
                写札记
              </button>
            </div>
          )}
        </section>

        <aside className="profileSidePanel">
          <div className="sectionHeader compact profilePanelHeader">
            <div>
              <p className="eyebrow muted">
                <Bell size={15} />
                Echoes
              </p>
              <h2>收到评论</h2>
            </div>
          </div>
          {commentNotifications.length > 0 ? (
            <div className="profileNoticeList">
              {commentNotifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.read ? "profileNotice" : "profileNotice unread"}
                  onClick={() => openPost(item.post.id)}
                >
                  <span>
                    <strong>{item.actor.username}</strong>
                    评论了《{item.post.title}》
                  </span>
                  <small>{item.comment.content}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="profileMiniEmpty">新的回声会落在这里。</div>
          )}
        </aside>
      </div>
    );
  }

  function renderProfileMessages() {
    return (
      <section className="cloudMessagePanel">
        <aside className="threadListPanel">
          <div className="threadPanelTitle">
            <div>
              <p className="eyebrow muted">
                <Cloud size={15} />
                Cloud Mail
              </p>
              <h2>云朵私信</h2>
            </div>
          </div>
          <label className="newCloudSelect">
            写给
            <select
              value={selectedRecipientId}
              onChange={(event) => {
                setSelectedRecipientId(event.target.value);
                const nextId = Number(event.target.value);
                if (nextId) openMessageThread(nextId);
              }}
            >
              <option value="">选择一位用户</option>
              {messageUsers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.username}{item.role === "admin" ? "（站主）" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="threadList">
            {messageThreads.length > 0 ? (
              messageThreads.map((thread) => (
                <button
                  key={thread.user.id}
                  type="button"
                  className={activeMessageUser?.id === thread.user.id ? "threadItem active" : "threadItem"}
                  onClick={() => openMessageThread(thread.user.id)}
                >
                  <span className="threadAvatar">{thread.user.username.slice(0, 1).toUpperCase()}</span>
                  <span className="threadSummary">
                    <strong>{thread.user.username}</strong>
                    <small>{thread.last_message.content}</small>
                  </span>
                  {thread.unread_count > 0 && <span className="cloudUnread">{thread.unread_count}</span>}
                </button>
              ))
            ) : (
              <div className="profileMiniEmpty">还没有云朵消息。</div>
            )}
          </div>
        </aside>

        <div className="cloudChatPanel">
          <div className="cloudChatHeader">
            <div>
              <p className="eyebrow muted">
                <Mail size={15} />
                Message
              </p>
              <h2>{activeMessageUser ? activeMessageUser.username : "选择一朵云"}</h2>
            </div>
          </div>
          <div className="cloudMessageStream">
            {activeMessageUser ? (
              activeMessages.length > 0 ? (
                activeMessages.map((message) => (
                  <article
                    key={message.id}
                    className={message.mine ? "cloudBubble mine" : "cloudBubble"}
                  >
                    <div className="cloudBubbleBody">
                      <p>{message.content}</p>
                      <time>{formatDate(message.created_at)}</time>
                    </div>
                  </article>
                ))
              ) : (
                <div className="profileEmpty cloudEmpty">
                  <Cloud size={36} />
                  <p>给 {activeMessageUser.username} 发送第一朵云。</p>
                </div>
              )
            ) : (
              <div className="profileEmpty cloudEmpty">
                <Cloud size={36} />
                <p>从左侧选择用户，开始一段云朵消息。</p>
              </div>
            )}
          </div>
          <form className="cloudComposer" onSubmit={sendCloudMessage}>
            <input
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              placeholder={activeMessageUser ? `写给 ${activeMessageUser.username}` : "先选择收信人"}
              disabled={!activeMessageUser && !selectedRecipientId}
            />
            <button className="solidButton" disabled={!messageText.trim() || (!activeMessageUser && !selectedRecipientId)}>
              <Send size={16} />
              发送
            </button>
          </form>
        </div>
      </section>
    );
  }

  function renderProfileInfo() {
    const joinedDays = user
      ? Math.max(1, Math.ceil((Date.now() - new Date(user.created_at).getTime()) / 86400000))
      : 0;

    return (
      <section className="profileInfoPanel">
        <div className="profileAvatarLarge">{user?.username.slice(0, 1).toUpperCase()}</div>
        <div className="profileInfoBody">
          <p className="eyebrow muted">
            <Settings size={15} />
            Account
          </p>
          <h2>{user?.username}</h2>
          <div className="profileInfoRows">
            <span>邮箱</span>
            <strong>{user?.email}</strong>
            <span>身份</span>
            <strong>{user?.role === "admin" ? "站主" : "普通用户"}</strong>
            <span>来到云纸之上</span>
            <strong>{joinedDays} 天</strong>
            <span>个人简介</span>
            <strong>{user?.bio || "还没有写下简介。"}</strong>
          </div>
          <div className="profileInfoActions">
            <button type="button" className="ghostButton" onClick={() => setNotice("资料编辑将在下一轮开放")}>
              <Edit3 size={16} />
              编辑资料
            </button>
            <button type="button" className="iconTextButton" onClick={logout}>
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        </div>
      </section>
    );
  }

  function renderProfileCenter() {
    return (
      <section className="profileShell">
        <div className="profileHero">
          <button className="textButton" onClick={() => goHome(true)}>
            返回主页
          </button>
          <div className="profileHeroMain">
            <div>
              <p className="eyebrow muted">
                <UserRound size={15} />
                Personal Center
              </p>
              <h1>个人中心</h1>
              <p>管理自己的帖子、云朵私信和个人信息。</p>
            </div>
            <div className="profileHeroBadge">
              <span>{user?.username.slice(0, 1).toUpperCase()}</span>
              <strong>{user?.username}</strong>
              <small>{profileUnreadCount > 0 ? `${profileUnreadCount} 条未读` : "云层清净"}</small>
            </div>
          </div>
          <div className="profileTabs" role="tablist" aria-label="个人中心">
            <button
              type="button"
              className={profileTab === "posts" ? "profileTab active" : "profileTab"}
              onClick={() => switchProfileTab("posts")}
            >
              <Inbox size={16} />
              我的帖子
              {unreadCommentCount > 0 && <span>{unreadCommentCount}</span>}
            </button>
            <button
              type="button"
              className={profileTab === "messages" ? "profileTab active" : "profileTab"}
              onClick={() => switchProfileTab("messages")}
            >
              <Cloud size={16} />
              云朵私信
              {unreadMessageCount > 0 && <span>{unreadMessageCount}</span>}
            </button>
            <button
              type="button"
              className={profileTab === "info" ? "profileTab active" : "profileTab"}
              onClick={() => switchProfileTab("info")}
            >
              <UserRound size={16} />
              个人信息
            </button>
          </div>
        </div>

        {profileTab === "posts" && renderProfilePosts()}
        {profileTab === "messages" && renderProfileMessages()}
        {profileTab === "info" && renderProfileInfo()}
      </section>
    );
  }
  useEffect(() => {
    if (!authOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".authModal");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setAuthOpen(false); return; }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleDialogKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleDialogKey);
      previousFocus?.focus();
    };
  }, [authOpen]);

  useEffect(() => {
    loadMe();
  }, [token]);

  useEffect(() => {
    loadPosts().catch((error) => setNotice(error instanceof Error ? error.message : "文章加载失败"));
  }, []);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => {
      refreshProfileData(token).catch(() => undefined);
      if (screen === "profile" && profileTab === "messages") {
        refreshMessageMeta(token).catch(() => undefined);
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [token, screen, profileTab]);

  useEffect(() => {
    if (screen !== "home") return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setHeroTypedCount(heroTitleChars.length);
      return;
    }

    setHeroTypedCount(0);
    let typingTimer: number | undefined;
    const startTimer = window.setTimeout(() => {
      let index = 0;
      typingTimer = window.setInterval(() => {
        index += 1;
        setHeroTypedCount(index);
        if (index >= heroTitleChars.length && typingTimer) {
          window.clearInterval(typingTimer);
        }
      }, 120);
    }, 220);

    return () => {
      window.clearTimeout(startTimer);
      if (typingTimer) window.clearInterval(typingTimer);
    };
  }, [screen]);

  return (
    <div className="app" data-screen={screen}>
      <header className="topbar">
        <GlassBackdrop />
        <button className="brand" onClick={() => goHome(false)}>
          <span className="brandMark">
            <img src="/site-icon.jpg" alt="" />
          </span>
          <span>海边的西西弗斯</span>
        </button>

        <form className="searchBox" onSubmit={handleSearch}>
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
              placeholder="搜索文章、笔记或作者"
              aria-label="搜索文章标题、摘要或作者"
          />
          {showSearchResults && (
            <div className="searchResults">
              {searchMatches.length > 0 ? (
                searchMatches.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    className="searchResultItem"
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => openSearchResult(post)}
                  >
                    <span className="searchResultMain">
                      <strong>{post.title}</strong>
                      <span>{post.excerpt || post.author.username}</span>
                    </span>
                    <span className="searchResultMeta">
                      {post.author.username}
                      {post.author.role === "admin" && <span className="ownerMiniBadge">站主</span>}
                    </span>
                  </button>
                ))
              ) : (
                <div className="searchEmpty">没有匹配的博客</div>
              )}
            </div>
          )}
        </form>

        <nav className="topActions">
          <button type="button" className="iconTextButton glassModeToggle"
            aria-label={glassEnabled ? "切换到简化玻璃" : "启用液态玻璃"}
            aria-pressed={glassEnabled} disabled={!canAnimate} onClick={toggleGlass}
            title={!canAnimate ? "当前设备使用简化玻璃，保证流畅阅读" : glassEnabled ? "切换到简化玻璃" : "启用液态玻璃"}>
            <Sparkles size={17} />
          </button>
          {user ? (
            <button className="iconTextButton profileCenterButton" onClick={() => openProfile("posts")}>
              <UserRound size={17} />
              个人中心
              {profileUnreadCount > 0 && <span className="profileUnreadBadge">{profileUnreadCount > 99 ? "99+" : profileUnreadCount}</span>}
            </button>
          ) : (
            <button className="ghostButton" onClick={() => goHome(true)}>
              <BookOpen size={17} />
              阅读
            </button>
          )}
          {user ? (
            <button className="iconTextButton" onClick={() => goHome(true)}>
              <BookOpen size={17} />
              主页
            </button>
          ) : (
            <button className="iconTextButton" onClick={() => setAuthOpen(true)}>
              <LogIn size={17} />
              登录
            </button>
          )}
        </nav>
      </header>

      {notice && (
        <button className="notice" onClick={() => setNotice("")}>
          {notice}
          <X size={14} />
        </button>
      )}

      <main>
        {screen === "home" && (
          <>
            <section className="hero">
              <div className="heroContent">
                <p className="eyebrow">
                  <Sparkles size={16} />
                  Personal Blog
                </p>
                <h1 aria-label={heroTitle}>
                  <span className="typewriterTitle" aria-hidden="true">
                    <span className="typewriterText">{reducedMotion ? heroTitle : heroTitleChars.slice(0, heroTypedCount).join("")}</span>
                    {!reducedMotion && <span className="typewriterCursor" />}
                  </span>
                </h1>
                <p className="heroCopy">
                  欢迎来到纸上尘的个人博客！在这里收录我的小说随笔，旅行日记，技术笔记和课程资料，欢迎评论点赞~也欢迎来灌水区随意发帖玩。
                </p>
                <div className="heroButtons">
                  <button className="solidButton large" onClick={() => startCompose()}>
                    <Plus size={18} />
                    写札记
                  </button>
                </div>
              </div>
            </section>

            <section id="letters" className="contentBand">
              <div className="contentLayout">
                <div className="letterMain">
              <div className="sectionHeader cloudHeader">
                <div>
                  <p className="eyebrow muted">
                    <Leaf size={15} />
                    Cloud Paper
                  </p>
                  <h2>云纸之上</h2>
                  <div className="ownerLine">
                    <span>站主</span>
                    <strong>纸上尘</strong>
                  </div>
                </div>
                <p>纸上尘的栏目</p>
              </div>

              <div className="ownerCategoryGrid">
                {ownerCategories.map((category) => renderCategoryCard(category))}
              </div>

              <div className="sectionHeader waterHeader">
                <div>
                  <p className="eyebrow muted">
                    <MessageCircle size={15} />
                    Commons
                  </p>
                  <h2>灌水区</h2>
                </div>
                <p>灌水聊天局</p>
              </div>

              <div className="ownerCategoryGrid waterAreaGrid">
                {renderWaterAreaCard()}
              </div>
                </div>
                {renderHomeSidebar()}
              </div>
            </section>
          </>
        )}



        {screen === "water" && (
          <section className="categoryShell">
            <div className="categoryHeroPanel waterHeroPanel">
              <button className="textButton" onClick={() => goHome(true)}>
                返回主页
              </button>
              <p className="eyebrow muted">
                <MessageCircle size={15} />
                Commons
              </p>
              <h1>灌水区</h1>
              <p>灌水聊天局，普通用户的公开发帖会展示在这里。</p>
            </div>

            {waterPosts.length > 0 ? (
              <>
                {renderCategoryFeature(waterPosts[0], "water")}
                <div className="sectionHeader compact categoryListHeader">
                  <div>
                    <p className="eyebrow muted">Archive</p>
                    <h2>全部发帖</h2>
                  </div>
                  <span>{waterPosts.length} 篇</span>
                </div>
                <div className="postGrid categoryPostGrid waterArchiveGrid">
                  {waterPosts.map((post) => renderPostCard(post, "water"))}
                </div>
              </>
            ) : (
              <div className="emptyState categoryEmpty">
                <div className="categoryPending" aria-label="待更新">
                  <span>待</span>
                  <span>更</span>
                  <span>新</span>
                </div>
              </div>
            )}
          </section>
        )}
        {screen === "category" && activeCategory && (
          <section className="categoryShell">
            <div className="categoryHeroPanel">
              <button className="textButton" onClick={() => goHome(true)}>
                返回主页
              </button>
              <p className="eyebrow muted">
                <Leaf size={15} />
                Cloud Paper
              </p>
              <h1>{activeCategoryMeta.name}</h1>
              <p>{activeCategoryMeta.description}</p>
            </div>

            {activeCategoryPosts.length > 0 ? (
              <>
                {renderCategoryFeature(activeCategoryPosts[0], "cloud")}
                <div className="sectionHeader compact categoryListHeader">
                  <div>
                    <p className="eyebrow muted">Archive</p>
                    <h2>全部札记</h2>
                  </div>
                  <span>{activeCategoryPosts.length} 篇</span>
                </div>
                <div className="postGrid categoryPostGrid">
                  {activeCategoryPosts.map((post) => renderPostCard(post, "cloud"))}
                </div>
              </>
            ) : (
              <div className="emptyState categoryEmpty">
                <div className="categoryPending" aria-label="待更新">
                  <span>待</span>
                  <span>更</span>
                  <span>新</span>
                </div>
              </div>
            )}
          </section>
        )}
        {screen === "detail" && activePost && (
          <section className="readerShell">
            <article className="reader">
              <div className="readerMeta">
                <button className="textButton" onClick={() => goHome(true)}>
                  返回主页
                </button>
                <span>{activePost.mood}</span>
                <span>{activePost.author.username}</span>
                <time>{formatDate(activePost.updated_at)}</time>
              </div>
              <h1>{activePost.title}</h1>
              <p className="readerExcerpt">{activePost.excerpt}</p>
              <div className="readerActions">
                <button
                  className={activePost.liked_by_me ? "pillButton active" : "pillButton"}
                  onClick={() => togglePostLike(activePost.id)}
                >
                  <Heart size={17} />
                  {activePost.like_count}
                </button>
                <span className="pillInfo">
                  <MessageCircle size={17} />
                  {activePost.comment_count}
                </span>
                {user?.id === activePost.author.id && (
                  <button className="pillButton" onClick={() => startCompose(activePost)}>
                    <Edit3 size={17} />
                    编辑
                  </button>
                )}
                {(user?.id === activePost.author.id || user?.role === "admin") && (
                  <button className="pillButton danger" onClick={() => deletePost(activePost.id)}>
                    <Trash2 size={17} />
                    删除
                  </button>
                )}
              </div>
              <ArticleContent content={activePost.content} />
            </article>

            <aside className="readerSideStack">
              <section className="commentPanel">
                <div className="panelHeader">
                  <h2>回声</h2>
                  <span>{comments.length}</span>
                </div>
              <form className="commentForm" onSubmit={submitComment}>
                <textarea
                  value={commentText}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder={user ? "留下一点回声" : "登录后评论"}
                  disabled={!user}
                />
                <button className="solidButton" disabled={!user || !commentText.trim()}>
                  <Send size={16} />
                  发送
                </button>
              </form>
              <div className="commentList">
                {comments.map((comment) => (
                  <article key={comment.id} className="commentItem">
                    <div className="commentMeta">
                      <strong>{comment.author.username}</strong>
                      <time>{formatDate(comment.created_at)}</time>
                    </div>
                    <p>{comment.content}</p>
                    <div className="commentActions">
                      <button
                        className={comment.liked_by_me ? "metric active" : "metric"}
                        onClick={() => toggleCommentLike(comment.id)}
                      >
                        <Heart size={15} />
                        {comment.like_count}
                      </button>
                      {(user?.id === comment.author.id || user?.role === "admin") && (
                        <button className="metric dangerText" onClick={() => removeComment(comment.id)}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              </section>
              {renderAiSummary()}
            </aside>
          </section>
        )}

        {screen === "profile" && user && renderProfileCenter()}

        {screen === "compose" && (
          <section className={`composerShell composeTab-${composeTab}`}>
            <div className="composeMobileTabs" role="tablist" aria-label="写作视图" onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? "edit" : event.key === "End" ? "preview" : composeTab === "edit" ? "preview" : "edit";
                setComposeTab(next); document.getElementById(`compose-${next}-tab`)?.focus();
              }
            }}>
              <button type="button" role="tab" id="compose-edit-tab" aria-controls="compose-form" aria-selected={composeTab === "edit"} tabIndex={composeTab === "edit" ? 0 : -1} onClick={() => setComposeTab("edit")}><PenLine size={16} />编辑</button>
              <button type="button" role="tab" id="compose-preview-tab" aria-controls="compose-preview" aria-selected={composeTab === "preview"} tabIndex={composeTab === "preview" ? 0 : -1} onClick={() => setComposeTab("preview")}><BookOpen size={16} />预览</button>
            </div>
            <form id="compose-form" className="composer" onSubmit={savePost}>
              <button type="button" className="textButton composeBackButton" onClick={() => goHome(true)}>
                返回主页
              </button>
              <div className="sectionHeader compact">
                <div>
                  <p className="eyebrow muted">
                    <PenLine size={15} />
                    Writing
                  </p>
                  <h2>{editingId ? "整理这篇札记" : "写一篇新札记"}</h2>
                  {!editingId && user?.role !== "admin" && (
                    <p className="composeHint">您发的帖子将被展示在灌水区，快来争做灌水大王！</p>
                  )}
                </div>
                <button className="solidButton" disabled={loading || imageUploading}>
                  <Send size={17} />
                  保存
                </button>
              </div>
              <label>
                标题
                <input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  required
                />
              </label>
              <div className="formRow">
                <label>
                  摘要
                  <input
                    value={draft.excerpt}
                    onChange={(event) => setDraft({ ...draft, excerpt: event.target.value })}
                  />
                </label>
                <label>
                  心情
                  <input
                    value={draft.mood}
                    onChange={(event) => setDraft({ ...draft, mood: event.target.value })}
                  />
                </label>
              </div>

              {user?.role === "admin" && (
                <div className="categorySelector">
                  <div className="categorySelectorTitle">
                    <Leaf size={17} />
                    云纸栏目
                  </div>
                  <div className="categoryChoices">
                    {ownerCategories.map((category) => (
                      <button
                        key={category.name}
                        type="button"
                        className={draft.category === category.name ? "categoryChoice active" : "categoryChoice"}
                        onClick={() => setDraft({ ...draft, category: category.name })}
                      >
                        {category.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="editorField">
                <div className="editorToolbar" role="toolbar" aria-label="正文工具栏">
                  <button type="button" className="mediaIconButton" aria-label="从本地添加图片" title="添加图片" disabled={imageUploading} onClick={() => imageFileRef.current?.click()}>
                    {imageUploading ? <Loader2 size={21} className="spinning" /> : <Plus size={23} />}
                  </button>
                  <button type="button" className="mediaIconButton" aria-label={splitArticleMusic(draft.content).songId ? "更换或移除文章配乐" : "添加文章配乐"} title="文章配乐" onClick={() => setMusicDialogOpen(true)}><Music2 size={21} /></button>
                  <span className="editorToolbarLabel">正文 · Markdown</span>
                  <input ref={imageFileRef} type="file" accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif" multiple hidden onChange={handleImageFilePick} />
                </div>
                <textarea
                  id="post-content"
                  aria-label="正文 Markdown"
                  aria-describedby="editor-media-hint"
                  ref={contentRef}
                  className={dragOver ? "editorArea dragging" : "editorArea"}
                  value={draft.content}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragOver(true); }
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleImageDrop}
                  required
                />
                <p id="editor-media-hint" className="editorMediaHint" role="status">{imageUploading ? "正在上传图片，完成后会显示在预览中…" : "拖入照片或点 ＋ 添加（JPG / PNG / HEIC，每张 ≤ 10 MB）；点 ♫ 添加文章配乐。"}</p>
              </div>
            </form>
            <aside id="compose-preview" className="previewPane">
              <p className="eyebrow muted">
                <BookOpen size={15} />
                Preview
              </p>
              <h1>{draft.title || "未命名札记"}</h1>
              <p>{draft.excerpt || "摘要会落在这里。"}</p>
              <ArticleContent content={draft.content} />
            </aside>
          </section>
        )}
      </main>

      {musicDialogOpen && screen === "compose" && <AddMusicDialog currentId={splitArticleMusic(draft.content).songId}
        onClose={() => setMusicDialogOpen(false)}
        onAdd={(id) => { setDraft((previous) => ({ ...previous, content: withArticleMusic(previous.content, id) })); setMusicDialogOpen(false); }}
        onRemove={() => { setDraft((previous) => ({ ...previous, content: withArticleMusic(previous.content, null) })); setMusicDialogOpen(false); }} />}

      {authOpen && (
        <div className="modalBackdrop">
          <form className="authModal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onSubmit={handleAuth}>
            <button className="modalClose" type="button" onClick={() => setAuthOpen(false)} title="关闭">
              <X size={18} />
            </button>
            <p className="eyebrow muted">
              <UserRound size={15} />
              Account
            </p>
            <h2 id="auth-title">{authMode === "login" ? "回到札记" : "种下一枚新名字"}</h2>
            {authMode === "register" && (
              <label>
                用户名
                <input name="username" minLength={3} required />
              </label>
            )}
            <label>
              邮箱
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                minLength={8}
                required
                defaultValue=""
              />
            </label>
            <button className="solidButton wide" disabled={loading}>
              <LogIn size={17} />
              {authMode === "login" ? "登录" : "注册"}
            </button>
            <button
              className="textButton centered"
              type="button"
              onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
            >
              {authMode === "login" ? "创建账号" : "已有账号"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
