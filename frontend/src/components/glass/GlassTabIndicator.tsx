import { useLayoutEffect, useRef } from "react";
import { useGlassCapabilities } from "../../hooks/useGlassCapabilities";

export function GlassTabIndicator({ active }: { active: string }) {
  const indicator = useRef<HTMLSpanElement>(null);
  const { enabled } = useGlassCapabilities();
  useLayoutEffect(() => {
    const element = indicator.current, host = element?.parentElement?.parentElement;
    if (!element || !host) return;
    const update = () => {
      const selected = host.querySelector<HTMLElement>("button[aria-selected='true'], button.active");
      if (!selected || !host.offsetWidth) { element.style.opacity = "0"; return; }
      const rect = selected.getBoundingClientRect(), parent = host.getBoundingClientRect();
      element.style.width = `${rect.width}px`; element.style.height = `${rect.height}px`;
      element.style.transform = `translate(${rect.left - parent.left - host.clientLeft}px, ${rect.top - parent.top - host.clientTop}px)`;
      element.style.opacity = "1";
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(host);
    return () => observer.disconnect();
  }, [active, enabled]);
  return <span className="glassTabTrack" aria-hidden="true"><span ref={indicator} className="glassTabIndicator" /></span>;
}
