import type {
  AiSummaryResponse,
  AuthResponse,
  CommentItem,
  DirectMessage,
  MessageThread,
  MessageThreadDetail,
  Post,
  PostInput,
  UploadResponse,
  User,
  UserCenter
} from "./types";
import type { MusicQr, MusicQrStatus, MusicSession, MusicSong } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

type RequestOptions = RequestInit & {
  token?: string | null;
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new ApiError(typeof detail === "string" ? detail : detail?.message ?? "请求失败", response.status, detail?.code);
  }
  return data as T;
}

export const api = {
  register(payload: { username: string; email: string; password: string }) {
    return request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  login(payload: { email: string; password: string }) {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  me(token: string) {
    return request<User>("/users/me", { token });
  },
  users(token: string) {
    return request<User[]>("/users", { token });
  },
  userCenter(token: string) {
    return request<UserCenter>("/users/me/center", { token });
  },
  markNotificationsRead(token: string) {
    return request<{ unread_comment_count: number; unread_message_count: number }>("/users/me/notifications/read", {
      method: "POST",
      token,
      body: JSON.stringify({ type: "comment" })
    });
  },
  posts(query: string, token?: string | null) {
    const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
    return request<Post[]>(`/posts${suffix}`, { token });
  },
  post(id: number, token?: string | null) {
    return request<Post>(`/posts/${id}`, { token });
  },
  createPost(payload: PostInput, token: string) {
    return request<Post>("/posts", {
      method: "POST",
      token,
      body: JSON.stringify(payload)
    });
  },
  updatePost(id: number, payload: PostInput, token: string) {
    return request<Post>(`/posts/${id}`, {
      method: "PUT",
      token,
      body: JSON.stringify(payload)
    });
  },
  deletePost(id: number, token: string) {
    return request<void>(`/posts/${id}`, {
      method: "DELETE",
      token
    });
  },
  summarizePost(id: number) {
    return request<AiSummaryResponse>(`/posts/${id}/summary`, {
      method: "POST"
    });
  },
  togglePostLike(id: number, token: string) {
    return request<{ liked: boolean; like_count: number }>(`/posts/${id}/likes`, {
      method: "POST",
      token
    });
  },
  comments(postId: number, token?: string | null) {
    return request<CommentItem[]>(`/posts/${postId}/comments`, { token });
  },
  createComment(postId: number, content: string, token: string) {
    return request<CommentItem>(`/posts/${postId}/comments`, {
      method: "POST",
      token,
      body: JSON.stringify({ content })
    });
  },
  deleteComment(id: number, token: string) {
    return request<void>(`/comments/${id}`, {
      method: "DELETE",
      token
    });
  },
  toggleCommentLike(id: number, token: string) {
    return request<{ liked: boolean; like_count: number }>(`/comments/${id}/likes`, {
      method: "POST",
      token
    });
  },
  messageThreads(token: string) {
    return request<MessageThread[]>("/messages/threads", { token });
  },
  messageThread(userId: number, token: string) {
    return request<MessageThreadDetail>(`/messages/threads/${userId}`, { token });
  },
  sendMessage(recipientId: number, content: string, token: string) {
    return request<DirectMessage>("/messages", {
      method: "POST",
      token,
      body: JSON.stringify({ recipient_id: recipientId, content })
    });
  },
  uploadImage(file: File, token: string) {
    const formData = new FormData();
    formData.append("file", file);
    return request<UploadResponse>("/upload", {
      method: "POST",
      token,
      body: formData
    });
  }
};

const musicOptions = { credentials: "include" as const, headers: { "X-Music-Request": "1" } };
export const musicApi = {
  resolve(link: string) {
    return request<MusicSong>("/music/resolve", { ...musicOptions, method: "POST", body: JSON.stringify({ link }) });
  },
  song(id: string) { return request<MusicSong>(`/music/songs/${id}`, musicOptions); },
  play(id: string) {
    return request<{ url: string; expires_in: number }>(`/music/songs/${id}/play`, { ...musicOptions, method: "POST" });
  },
  session() { return request<MusicSession>("/music/session", musicOptions); },
  createQr() { return request<MusicQr>("/music/auth/qr", { ...musicOptions, method: "POST" }); },
  checkQr() { return request<MusicQrStatus>("/music/auth/qr/check", { ...musicOptions, method: "POST" }); },
  logout() { return request<MusicSession>("/music/session", { ...musicOptions, method: "DELETE" }); }
};


