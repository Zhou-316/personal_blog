import { lazy, Suspense } from "react";
import { useGlassCapabilities } from "../../hooks/useGlassCapabilities";

const LiquidGlass = lazy(() => import("../../vendor/liquid-glass"));

/** Decorative layer only: focus, clicks and layout belong to the real controls. */
export function GlassBackdrop({ radius = 24 }: { radius?: number }) {
  const { enabled } = useGlassCapabilities();
  if (!enabled) return null;
  return (
    <div className="glassBackdrop" aria-hidden="true">
      <Suspense fallback={null}>
        <LiquidGlass className="liquidOptics" mode="standard" displacementScale={36}
          blurAmount={0.08} saturation={125} aberrationIntensity={0.7}
          elasticity={0} cornerRadius={radius} padding="0"
          globalMousePos={{ x: 0, y: 0 }} mouseOffset={{ x: 0, y: 0 }}
          style={{ position: "absolute", top: "50%", left: "50%", width: "100%", height: "100%" }}>
          <span />
        </LiquidGlass>
      </Suspense>
    </div>
  );
}
