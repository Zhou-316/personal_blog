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
  parent_id: number | null;
  root_id: number | null;
  content: string;
  author: User;
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
  reply_count: number;
  is_deleted: boolean;
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

export type CommentNotification = {
  id: number;
  read: boolean;
  created_at: string;
  actor: User;
  post: {
    id: number;
    title: string;
  };
  comment: {
    id: number;
    content: string;
    created_at: string;
  };
};

export type UserCenter = {
  user: User;
  posts: Post[];
  comment_notifications: CommentNotification[];
  unread_comment_count: number;
  unread_message_count: number;
};

export type DirectMessage = {
  id: number;
  content: string;
  sender: User;
  recipient: User;
  created_at: string;
  read: boolean;
  mine: boolean;
};

export type MessageThread = {
  user: User;
  last_message: DirectMessage;
  unread_count: number;
};

export type MessageThreadDetail = {
  user: User;
  messages: DirectMessage[];
  unread_message_count: number;
};

export type UploadResponse = {
  url: string;
  filename: string;
};

export type MusicSong = {
  id: string;
  title: string;
  artist: string;
  cover: string;
  duration: number;
  fee: number;
};
export type MusicSession = {
  logged_in: boolean;
  profile?: { nickname: string; vip: boolean } | null;
};
export type MusicQr = { image: string; url: string; expires_in: number };
export type MusicQrStatus = {
  status: "waiting" | "confirming" | "authorizing" | "expired" | "authorized" | "superseded";
  profile?: MusicSession["profile"];
};
