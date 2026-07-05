import type { AiSummaryResponse, AuthResponse, CommentItem, Post, PostInput, User } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

type RequestOptions = RequestInit & {
  token?: string | null;
};

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
    throw new Error(data?.detail ?? "请求失败");
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
  }
};


