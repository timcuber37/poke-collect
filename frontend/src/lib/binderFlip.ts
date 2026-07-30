// Geometry and timing for the binder's page turn.
//
// A leaf is three rigid column panels nested inside one another, each hinged at
// its own gutter (panel 0 at the spine, panel 1 at the first gutter, panel 2 at
// the second). Because they're nested, their rotations compound: the world angle
// of panel d is the sum of angles 0..d. That's what makes the fold rigid-body
// correct without any matrix math — each panel only needs its angle relative to
// its parent, which is what hingeAngles returns.

/**
 * Degrees of flex allowed at each gutter. Index = hinge distance from the spine.
 * The outer gutter creases harder than the inner one, the way a sheet held at the
 * spine does.
 *
 * These sum to 180, which is the ceiling the invariant on hingeAngles permits —
 * raising either one past this lets the spine hinge overshoot and the inner column
 * sinks behind the resting page. At this setting adjacent columns break to about
 * 104 degrees of each other at peak, so it is also about as hard a crease as still
 * reads as stiff plastic rather than a sheet collapsing.
 */
const GUTTER_FLEX_DEG = [0, 70, 110]
/**
 * Where each gutter's flex peaks. sin(pi * p^skew) is 0 at both ends and peaks at
 * p = 0.5^(1/skew), so skew > 1 peaks later in the turn. Pushed past 1 to hold the
 * crease open through the middle of the turn, against the damping below that pulls
 * it shut as the leaf lands. The outer gutter still leads, so the flex ripples
 * outward from the spine.
 */
const GUTTER_SKEW = [0, 1.5, 1.1]

/** Duration of a full turn. Shorter hops (a spring-back) scale down from this. */
const FLIP_MS = 620
/** Pointer travel before a press counts as a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 6

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Cubic ease-in-out, applied to the turn as a whole.
 *
 * Deliberately baked into hingeAngles rather than into the tween's clock. That
 * means a drag eases by pointer position rather than tracking the cursor
 * one-to-one: the page holds back early in the gesture and then swings through
 * the middle. Cursor-accurate tracking (inverting spineX + radius * cos(theta)
 * for the held point, with the easing moved onto the tween) was tried and felt
 * worse — the page came away too eagerly on the first few pixels of movement.
 */
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

/**
 * rotateY (deg) for each column panel at turn progress `p` — 0 = flat on the
 * right, 1 = flat on the left — each relative to its parent panel.
 *
 * The two gutters get a flex that is zero at both ends and peaks mid-turn, so the
 * page is perfectly flat at rest and bows like stiff plastic in between. The
 * spine hinge absorbs whatever is left over, which pins the total at exactly
 * -180 * ease(p): the leaf lands flush however the gutters are tuned.
 *
 * The gutter angles are positive against a negative total, so each panel trails
 * the one inside it — the outer edge of the sheet drags behind, the way a stiff
 * page does. Handing each hinge an equal 60deg share instead would zigzag the
 * page into an accordion, which reads as floppier rather than more rigid.
 *
 * Invariant: every panel's *world* angle (the running sum) must stay within
 * [-180, 0], because rotateY past -180 swings a panel to negative Z and the
 * resting page then occludes it. Since the spine hinge absorbs the gutter flex,
 * it is the one at risk late in the turn — so the flex is scaled by the rotation
 * still remaining, which bounds g1 + g2 by sum(GUTTER_FLEX_DEG) * (1 - ease)
 * against 180 * (1 - ease) of headroom. That scaling has to stay at least linear
 * in (1 - ease): anything gentler (sqrt, say) outruns the headroom near the end
 * and lets the spine hinge overshoot again. It also reads as more physical — a
 * stiff sheet creases most as you lift it and straightens as it falls flat, so
 * the fold is inherently front-loaded.
 */
export function hingeAngles(p: number): [number, number, number] {
  const t = clamp01(p)
  const turned = ease(t)
  const flex = (d: number) =>
    GUTTER_FLEX_DEG[d] * Math.sin(Math.PI * t ** GUTTER_SKEW[d]) * (1 - turned)
  const g1 = flex(1)
  const g2 = flex(2)
  return [-180 * turned - g1 - g2, g1, g2]
}

/**
 * Linear rAF tween over progress, returning a cancel function. Deliberately
 * linear: hingeAngles already eases, so easing here would double up.
 */
export function tweenProgress(
  from: number,
  to: number,
  onFrame: (p: number) => void,
  onDone: () => void,
): () => void {
  const ms = Math.max(120, FLIP_MS * Math.abs(to - from))
  const start = performance.now()
  let raf = 0
  const step = (now: number) => {
    const k = clamp01((now - start) / ms)
    onFrame(from + (to - from) * k)
    if (k < 1) raf = requestAnimationFrame(step)
    else onDone()
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}
