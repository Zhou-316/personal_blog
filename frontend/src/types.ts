export type User = {
  id: number;
  username: string;
  email: string;
  bio: string;
  role: "admin" | "member" | string;
  created_at: string;
};

export type Post = {
  id: number;
  title: string;
  excerpt: string;
  content: string;
  mood: string;
  category: string;
  author: User;
  created_at: string;
  updated_at: string;
  comment_count: number;
  like_count: number;
  liked_by_me: boolean;
};

export type CommentItem = {
  id: number;
  post_id: number;
  content: string;
  author: User;
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
};

export type AuthResponse = {
  user: User;
  access_token: string;
};

export type PostInput = {
  title: string;
  excerpt: string;
  content: string;
  mood: string;
  category: string;
};

export type AiSummaryResponse = {
  summary: string;
};
