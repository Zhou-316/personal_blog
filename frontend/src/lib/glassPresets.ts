export type GlassPreset = "A" | "B" | "C";
export type GlassTuning = {
  navAlpha: number; blur: number; displacement: number; saturation: number;
  aberration: number; cardAlpha: number; readingAlpha: number; glowRadius: number; elasticity: number;
};
export const glassPresets: Record<GlassPreset, GlassTuning> = {
  A: { navAlpha: .30, blur: 10, displacement: 48, saturation: 120, aberration: .4, cardAlpha: .48, readingAlpha: .74, glowRadius: 120, elasticity: .03 },
  B: { navAlpha: .20, blur: 8, displacement: 64, saturation: 135, aberration: .8, cardAlpha: .34, readingAlpha: .68, glowRadius: 160, elasticity: .05 },
  C: { navAlpha: .12, blur: 6, displacement: 80, saturation: 145, aberration: 1, cardAlpha: .22, readingAlpha: .62, glowRadius: 200, elasticity: .08 }
};
export const glassTuningFields: Array<{ key: keyof GlassTuning; label: string; min: number; max: number; step: number }> = [
  { key: "navAlpha", label: "导航底色", min: .10, max: .40, step: .01 },
  { key: "blur", label: "背景模糊 px", min: 4, max: 16, step: 1 },
  { key: "displacement", label: "边缘折射", min: 32, max: 96, step: 4 },
  { key: "saturation", label: "饱和度 %", min: 100, max: 150, step: 5 },
  { key: "aberration", label: "色散", min: 0, max: 1.2, step: .1 },
  { key: "cardAlpha", label: "卡片外层", min: .20, max: .55, step: .01 },
  { key: "readingAlpha", label: "读字衬底", min: .60, max: .82, step: .01 },
  { key: "glowRadius", label: "高光半径 px", min: 100, max: 220, step: 10 },
  { key: "elasticity", label: "按压弹性", min: .02, max: .08, step: .01 }
];
