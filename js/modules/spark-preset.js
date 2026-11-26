/**
 * How Fumoca draws Gaussian splats — one preset for Studio and every viewer.
 *
 * Scans from Brush / gsplat / Postshot / Polycam are trained with the classic
 * 3DGS 0.3-pixel dilation and a 3σ splat footprint. Drawing them the same way
 * keeps surfaces solid and crisp, as in SuperSplat. Dropping the dilation or
 * cutting splats short makes small splats thinner and see-through, which
 * reads as a speckled, smoky surface.
 *
 *   preBlurAmount 0.3  classic dilation, no opacity reduction (as trained)
 *   blurAmount    0    no extra anti-alias blur on top
 *   maxStdDev     √8   standard footprint (≈2.8σ)
 */
export const SPARK_PRESET = Object.freeze({
  maxStdDev: Math.sqrt(8),
  preBlurAmount: 0.3,
  blurAmount: 0,
  focalAdjustment: 1,
  sortRadial: false,
});

export function sparkOptions(extra = {}) {
  return { ...SPARK_PRESET, ...extra };
}
