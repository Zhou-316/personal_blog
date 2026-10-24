import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { useGlassCapabilities } from "../../hooks/useGlassCapabilities";

const RefractionLayer = lazy(() => import("./RefractionLayer"));

/** A single optical pass behind native controls; content and hit targets never deform. */
export function GlassBackdrop({ radius = 24, variant = "navigation" }: { radius?: number; variant?: "navigation" | "action" }) {
  const { renderer, tuning } = useGlassCapabilities();
  const layer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const host = layer.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      setSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [renderer]);
  if (renderer !== "refractive") return null;
  return <div ref={layer} className="glassBackdrop" aria-hidden="true">
    {size.width > 0 && <Suspense fallback={<span className="glassRefractionFallback" />}>
      <RefractionLayer width={size.width} height={size.height} radius={radius}
        edgeWidth={variant === "action" ? 5 : 9} tuning={tuning} />
    </Suspense>}
  </div>;
}
