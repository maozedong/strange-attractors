/**
 * How the voice curve is drawn, shared by VoiceAttractor and the offline preview in verify.ts
 * so the preview shows what the stage shows.
 */

/** curve width in CSS pixels */
export const LINE_PX = 1.4
/** brightness of the newest stretch of curve; older samples fade as age^1.5 */
export const CURVE_GAIN = 0.55
/** the glowing head at the newest sample (HeadPoints adds its own bright core) */
export const HEAD_GAIN = 0.85
/** how far the head's colour is lifted toward white */
export const HEAD_WHITEN = 0.35
/** speedColor t for a clean loop (cool violet) and for noise (warm) */
export const TINT_CLEAN = 0.3
export const TINT_ROUGH = 0.92
/**
 * Oscilloscope beam: every sample deposits the same light, so a segment longer than
 * BEAM_REF × size is dimmed by BEAM_REF × size / length. Clean loops (segments ≈ 0.01 × size)
 * are untouched; noise, whose consecutive samples jump across the whole figure, becomes a
 * faint haze instead of a white flash, and a sawtooth's jumps vanish like a scope's retrace.
 */
export const BEAM_REF = 0.05
