import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitArticleMusic } from "../lib/articleMusic";
import { MusicPlayer } from "./MusicPlayer";

export function ArticleContent({ content }: { content: string }) {
  const { songId, body } = splitArticleMusic(content);
  return <>
    {songId && <MusicPlayer key={songId} songId={songId} />}
    <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown></div>
  </>;
}
