import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type GlassSettings = { enabled: boolean; canAnimate: boolean; reducedMotion: boolean; toggle: () => void };
const GlassContext = createContext<GlassSettings>({ enabled: false, canAnimate: false, reducedMotion: false, toggle: () => {} });

export function GlassProvider({ children }: { children: ReactNode }) {
  const [simple, setSimple] = useState(() => {
    try { return localStorage.getItem("blog_glass_mode") === "simple"; } catch { return false; }
  });
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const desktopQuery = "(min-width: 768px) and (hover: hover) and (pointer: fine)";
  const [finePointer, setFinePointer] = useState(() => matchMedia(desktopQuery).matches);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = matchMedia(desktopQuery);
    const update = () => { setReducedMotion(motion.matches); setFinePointer(pointer.matches); };
    motion.addEventListener("change", update);
    pointer.addEventListener("change", update);
    return () => { motion.removeEventListener("change", update); pointer.removeEventListener("change", update); };
  }, []);
  // SVG backdrop displacement is currently reliable in desktop Chromium.
  const canAnimate = finePointer && !reducedMotion && CSS.supports("backdrop-filter", "blur(1px)")
    && /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);
  const enabled = canAnimate && !simple;
  useEffect(() => {
    document.documentElement.dataset.glass = enabled ? "liquid" : "simple";
    try { localStorage.setItem("blog_glass_mode", simple ? "simple" : "liquid"); } catch { /* Private browsing can disable storage. */ }
  }, [enabled, simple]);
  return <GlassContext.Provider value={{ enabled, canAnimate, reducedMotion, toggle: () => setSimple(value => !value) }}>{children}</GlassContext.Provider>;
}

export function useGlassCapabilities() { return useContext(GlassContext); }
