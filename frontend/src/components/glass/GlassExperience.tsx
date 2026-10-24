import { lazy, Suspense, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { useGlassCapabilities } from "../../hooks/useGlassCapabilities";

const GlassLab = import.meta.env.DEV ? lazy(() => import("./GlassLab")) : null;
const surfaceSelector = ".topbar, .hero, .ownerCategoryCard, .postCard, .sidePanel, .categoryHeroPanel, .profileHero, .musicPlayer, .authModal, .mediaModal";
const controlSelector = ".solidButton, .iconTextButton, .pillButton, .categoryTitleBar, .categoryChoice, .profileTab, .musicPlayButton, .mediaIconButton, .glassActionShell";

function useMaterialPointer() {
  const { canAnimate } = useGlassCapabilities();
  useEffect(() => {
    if (!canAnimate) return;
    let frame = 0;
    let pointer: { x: number; y: number; target: Element } | null = null;
    let active = new Set<HTMLElement>();
    const clear = () => { for (const element of active) element.style.setProperty("--glass-hover", "0"); active.clear(); };
    const paint = () => {
      frame = 0;
      if (!pointer || document.hidden) { clear(); return; }
      const next = new Set<HTMLElement>();
      for (const selector of [surfaceSelector, controlSelector]) {
        const element = pointer.target.closest<HTMLElement>(selector);
        if (element) next.add(element);
      }
      for (const element of active) if (!next.has(element)) element.style.setProperty("--glass-hover", "0");
      for (const element of next) {
        const rect = element.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, pointer.x - rect.left));
        const y = Math.max(0, Math.min(rect.height, pointer.y - rect.top));
        element.style.setProperty("--glass-x", `${x.toFixed(1)}px`);
        element.style.setProperty("--glass-y", `${y.toFixed(1)}px`);
        element.style.setProperty("--glass-light-angle", `${(135 + (x / Math.max(1, rect.width) - .5) * 90).toFixed(1)}deg`);
        element.style.setProperty("--glass-hover", "1");
      }
      active = next;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
      pointer = { x: event.clientX, y: event.clientY, target: event.target }; schedule();
    };
    const leave = () => { pointer = null; clear(); };
    const out = (event: PointerEvent) => { if (!event.relatedTarget) leave(); };
    const scroll = () => {
      if (!pointer) return;
      const target = document.elementFromPoint(pointer.x, pointer.y);
      if (target) { pointer.target = target; schedule(); } else leave();
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", out, { passive: true });
    document.addEventListener("pointercancel", leave);
    document.addEventListener("visibilitychange", leave);
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame); clear();
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerout", out);
      document.removeEventListener("pointercancel", leave); document.removeEventListener("visibilitychange", leave);
      window.removeEventListener("scroll", scroll);
    };
  }, [canAnimate]);
}

export function GlassExperience() {
  useMaterialPointer();
  const { enabled, renderer, reducedMotion, toggle } = useGlassCapabilities();
  return <>
    <footer className="appearanceFooter" aria-label="阅读外观">
      <span>阅读外观</span>
      <button type="button" role="switch" aria-checked={enabled} onClick={toggle} aria-label="液态玻璃外观">
        <Sparkles size={15} aria-hidden="true" />{enabled ? "液态玻璃" : "简化玻璃"}
      </button>
      <small className="appearanceHint" aria-live="polite">{[
        enabled && renderer === "compatible" ? "当前设备使用兼容玻璃效果" : "",
        reducedMotion ? "已跟随系统减少动态效果" : ""
      ].filter(Boolean).join(" · ") || "\u00a0"}</small>
    </footer>
    {GlassLab && new URLSearchParams(location.search).get("glassLab") === "1" && <Suspense fallback={null}><GlassLab /></Suspense>}
  </>;
}
