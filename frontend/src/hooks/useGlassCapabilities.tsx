import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { glassPresets, glassTuningFields, type GlassPreset, type GlassTuning } from "../lib/glassPresets";

type GlassMode = "liquid" | "simple";
type GlassSettings = {
  enabled: boolean; canAnimate: boolean; reducedMotion: boolean;
  renderer: "refractive" | "compatible" | "simple";
  preset: GlassPreset | "custom"; tuning: GlassTuning;
  toggle: () => void; setMode: (mode: GlassMode) => void;
  choosePreset: (preset: GlassPreset) => void;
  adjustTuning: (key: keyof GlassTuning, value: number) => void;
};
const GlassContext = createContext<GlassSettings>({
  enabled: true, canAnimate: false, reducedMotion: false, renderer: "compatible",
  preset: "B", tuning: glassPresets.B, toggle: () => {}, setMode: () => {}, choosePreset: () => {}, adjustTuning: () => {}
});

export function GlassProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<GlassMode>(() => {
    try { return localStorage.getItem("blog_glass_mode") === "simple" ? "simple" : "liquid"; } catch { return "liquid"; }
  });
  const [preset, setPreset] = useState<GlassPreset | "custom">("B");
  const [tuning, setTuning] = useState<GlassTuning>(glassPresets.B);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const desktopQuery = "(min-width: 768px) and (hover: hover) and (pointer: fine)";
  const [desktopPointer, setDesktopPointer] = useState(() => matchMedia(desktopQuery).matches);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = matchMedia(desktopQuery);
    const update = () => { setReducedMotion(motion.matches); setDesktopPointer(pointer.matches); };
    const syncPreference = (event: StorageEvent) => {
      if (event.key === "blog_glass_mode") setMode(event.newValue === "simple" ? "simple" : "liquid");
    };
    motion.addEventListener("change", update);
    pointer.addEventListener("change", update);
    window.addEventListener("storage", syncPreference);
    return () => {
      motion.removeEventListener("change", update); pointer.removeEventListener("change", update);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);
  const enabled = mode === "liquid";
  const supportsOptics = desktopPointer && CSS.supports("backdrop-filter", "blur(1px)")
    && /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);
  const renderer: GlassSettings["renderer"] = !enabled ? "simple" : supportsOptics ? "refractive" : "compatible";
  const canAnimate = enabled && desktopPointer && !reducedMotion;
  const toggle = useCallback(() => setMode(value => value === "liquid" ? "simple" : "liquid"), []);
  const choosePreset = useCallback((value: GlassPreset) => { setPreset(value); setTuning({ ...glassPresets[value] }); }, []);
  const adjustTuning = useCallback((key: keyof GlassTuning, value: number) => {
    const field = glassTuningFields.find(item => item.key === key);
    if (!field || !Number.isFinite(value)) return;
    setPreset("custom");
    setTuning(previous => ({ ...previous, [key]: Math.min(field.max, Math.max(field.min, value)) }));
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.glass = mode; root.dataset.glassRenderer = renderer;
    root.dataset.glassMotion = canAnimate ? "interactive" : "static"; root.dataset.glassPreset = preset;
    const variables = {
      "--liquid-nav-alpha": tuning.navAlpha.toString(), "--liquid-blur": `${tuning.blur}px`,
      "--liquid-saturation": `${tuning.saturation}%`, "--liquid-card-alpha": tuning.cardAlpha.toString(),
      "--liquid-reading-alpha": tuning.readingAlpha.toString(), "--liquid-glow-radius": `${tuning.glowRadius}px`,
      "--liquid-press-scale": (1 - Math.min(.015, tuning.elasticity * .3)).toFixed(3)
    };
    for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
    try { localStorage.setItem("blog_glass_mode", mode); } catch { /* Storage can be disabled in private browsing. */ }
  }, [mode, renderer, canAnimate, preset, tuning]);
  const value = useMemo(() => ({ enabled, canAnimate, reducedMotion, renderer, preset, tuning, toggle, setMode, choosePreset, adjustTuning }),
    [enabled, canAnimate, reducedMotion, renderer, preset, tuning, toggle, choosePreset, adjustTuning]);
  return <GlassContext.Provider value={value}>{children}</GlassContext.Provider>;
}

export function useGlassCapabilities() { return useContext(GlassContext); }
