import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Check,
  Edit3,
  Feather,
  Flame,
  Heart,
  ImagePlus,
  Leaf,
  LogIn,
  LogOut,
  MessageCircle,
  PenLine,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { api } from "./api";
import type { AuthResponse, CommentItem, Post, PostInput, User } from "./types";

type Screen = "home" | "detail" | "compose" | "category";
type OwnerCategory = "小说随笔" | "旅行日记" | "技术笔记" | "课程笔记与资料";
type AuthMode = "login" | "register";
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
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  const ownerPosts = useMemo(() => posts.filter((post) => post.author.role === "admin"), [posts]);
  const waterPosts = useMemo(() => posts.filter((post) => post.author.role !== "admin"), [posts]);
  const featured = ownerPosts[0] ?? posts[0];
  const stats = useMemo(() => {
    const likes = posts.reduce((sum, post) => sum + post.like_count, 0);
    const commentsTotal = posts.reduce((sum, post) => sum + post.comment_count, 0);
    return {
      posts: posts.length,
      owner: ownerPosts.length,
      water: waterPosts.length,
      likes,
      comments: commentsTotal
    };
  }, [ownerPosts.length, posts, waterPosts.length]);


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

  async function loadPosts() {
    const data = await api.posts("", token);
    setPosts(data);
  }

  async function loadMe(currentToken = token) {
    if (!currentToken) {
      setUser(null);
      return;
    }
    try {
      setUser(await api.me(currentToken));
    } catch {
      localStorage.removeItem("blog_token");
      setToken(null);
      setUser(null);
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

  function renderCategoryFeature(post: Post) {
    return (
      <article className="categoryFeature" role="button" tabIndex={0} onClick={() => openPost(post.id)} onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPost(post.id);
        }
      }}>
        <div>
          <p className="eyebrow muted">Featured</p>
          <h2>{post.title}</h2>
          <p>{post.excerpt}</p>
        </div>
        <span className="featureMeta">
          <Heart size={15} />
          {post.like_count}
          <MessageCircle size={15} />
          {post.comment_count}
        </span>
      </article>
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
  function insertImageMarkdown() {
    const url = imageUrl.trim();
    if (!url) {
      setNotice("请先填写图片地址");
      return;
    }

    const alt = imageAlt.trim() || "插图";
    const snippet = `\n\n![${alt}](${url})\n\n`;
    const textarea = contentRef.current;
    const start = textarea?.selectionStart ?? draft.content.length;
    const end = textarea?.selectionEnd ?? draft.content.length;
    const nextContent = `${draft.content.slice(0, start)}${snippet}${draft.content.slice(end)}`;

    setDraft({ ...draft, content: nextContent });
    setImageUrl("");
    setImageAlt("");

    window.setTimeout(() => {
      const cursor = start + snippet.length;
      contentRef.current?.focus();
      contentRef.current?.setSelectionRange(cursor, cursor);
    }, 0);
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
          <time>{formatDate(post.updated_at)}</time>
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
  useEffect(() => {
    loadMe();
  }, [token]);

  useEffect(() => {
    loadPosts().catch((error) => setNotice(error instanceof Error ? error.message : "文章加载失败"));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
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
            placeholder="搜索blog标题，摘要或作者名"
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
                      openSearchResult(post);
                    }}
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
          <button className="ghostButton" onClick={() => goHome(true)}>
            <BookOpen size={17} />
            阅读
          </button>
          <button className="solidButton" onClick={() => startCompose()}>
            <PenLine size={17} />
            写文章
          </button>
          {user ? (
            <button className="iconTextButton" onClick={logout}>
              <LogOut size={17} />
              {user.username}
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
                <h1>云山苍苍，江水泱泱</h1>
                <p className="heroCopy">
                  欢迎来到纸上尘的个人博客！在这里收录我的小说随笔，旅行日记，技术笔记和课程资料，欢迎评论点赞~也欢迎来灌水区随意发帖玩。
                </p>
                <div className="heroButtons">
                  <button className="solidButton large" onClick={() => startCompose()}>
                    <Plus size={18} />
                    新札记
                  </button>
                  {featured && (
                    <button className="glassButton large" onClick={() => openPost(featured.id)}>
                      <Feather size={18} />
                      最新一篇
                    </button>
                  )}
                </div>
              </div>
              <div className="heroStats" aria-label="站点统计">
                <span>
                  <strong>{stats.posts}</strong>
                  文章
                </span>
                <span>
                  <strong>{stats.comments}</strong>
                  评论
                </span>
                <span>
                  <strong>{stats.likes}</strong>
                  喜欢
                </span>
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

              {waterPosts.length > 0 ? (
                <div className="postGrid waterGrid">
                  {waterPosts.map((post) => renderPostCard(post, "water"))}
                </div>
              ) : (
                <div className="emptyState">灌水区暂时还没有文章。</div>
              )}
                </div>
                {renderHomeSidebar()}
              </div>
            </section>
          </>
        )}


        {screen === "category" && activeCategory && (
          <section className="categoryShell">
            <div className="categoryHeroPanel">
              <button className="textButton" onClick={() => goHome(true)}>
                返回云纸之上
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
                {renderCategoryFeature(activeCategoryPosts[0])}
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
                  返回文章流
                </button>
                <span>{activePost.mood}</span>
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
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{activePost.content}</ReactMarkdown>
              </div>
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

        {screen === "compose" && (
          <section className="composerShell">
            <form className="composer" onSubmit={savePost}>
              <div className="sectionHeader compact">
                <div>
                  <p className="eyebrow muted">
                    <PenLine size={15} />
                    Writing
                  </p>
                  <h2>{editingId ? "整理这篇札记" : "写一篇新札记"}</h2>
                </div>
                <button className="solidButton" disabled={loading}>
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
                  <div className="imageInsertTitle">
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
              <div className="imageInsertPanel">
                <div className="imageInsertTitle">
                  <ImagePlus size={17} />
                  插图助手
                </div>
                <input
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  placeholder="图片地址，例如 https://.../photo.jpg"
                />
                <input
                  value={imageAlt}
                  onChange={(event) => setImageAlt(event.target.value)}
                  placeholder="图片描述，可选"
                />
                <button type="button" className="ghostButton" onClick={insertImageMarkdown}>
                  <ImagePlus size={16} />
                  插入图片
                </button>
              </div>
              <label>
                正文
                <textarea
                  ref={contentRef}
                  className="editorArea"
                  value={draft.content}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                  required
                />
              </label>
            </form>
            <aside className="previewPane">
              <p className="eyebrow muted">
                <BookOpen size={15} />
                Preview
              </p>
              <h1>{draft.title || "未命名札记"}</h1>
              <p>{draft.excerpt || "摘要会落在这里。"}</p>
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content}</ReactMarkdown>
              </div>
            </aside>
          </section>
        )}
      </main>

      {authOpen && (
        <div className="modalBackdrop">
          <form className="authModal" onSubmit={handleAuth}>
            <button className="modalClose" type="button" onClick={() => setAuthOpen(false)} title="关闭">
              <X size={18} />
            </button>
            <p className="eyebrow muted">
              <UserRound size={15} />
              Account
            </p>
            <h2>{authMode === "login" ? "回到札记" : "种下一枚新名字"}</h2>
            {authMode === "register" && (
              <label>
                用户名
                <input name="username" minLength={3} required />
              </label>
            )}
            <label>
              邮箱
              <input name="email" type="email" required defaultValue={authMode === "login" ? "wenzhenxiansheng@163.com" : ""} />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
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
