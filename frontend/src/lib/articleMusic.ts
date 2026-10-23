// Explicit metadata inserted only by the music dialog. Ordinary pasted links
// remain ordinary links, and the Markdown remains readable outside this blog.
const MUSIC_LINE = /^\[网易云音乐\]\(https:\/\/music\.163\.com\/song\?id=([1-9]\d{0,19}) "blog-music"\)[ \t]*(?:\r?\n|$)/;

export function splitArticleMusic(content: string) {
  const match = MUSIC_LINE.exec(content);
  return { songId: match?.[1] ?? null, body: match ? content.slice(match[0].length).replace(/^\r?\n/, "") : content };
}

export function withArticleMusic(content: string, songId: string | null) {
  const { body } = splitArticleMusic(content);
  return songId ? `[网易云音乐](https://music.163.com/song?id=${songId} "blog-music")\n\n${body}` : body;
}
