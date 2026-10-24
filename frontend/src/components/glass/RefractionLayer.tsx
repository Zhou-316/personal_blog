import { useId } from "react";
import { GlassFilter } from "../../vendor/liquid-glass";
import type { GlassTuning } from "../../lib/glassPresets";

export default function RefractionLayer({ width, height, radius, edgeWidth, tuning }: {
  width: number; height: number; radius: number; edgeWidth: number; tuning: GlassTuning;
}) {
  const id = useId();
  return <>
    <GlassFilter id={id} mode="standard" width={width} height={height}
      displacementScale={tuning.displacement} aberrationIntensity={tuning.aberration}
      cornerRadius={radius} edgeWidth={edgeWidth} />
    <span className="glassRefraction" style={{ filter: `url(#${id})`,
      backdropFilter: `blur(${tuning.blur}px) saturate(${tuning.saturation}%)` }} />
  </>;
}
