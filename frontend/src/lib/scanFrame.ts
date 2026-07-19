// Frame geometry + cheap client-side quality detection for the card scanner.
//
// The OCR backend (Google Vision) is paid and rate-limited, so auto-capture must
// judge "is a sharp, steady card in the frame?" locally and only send a good frame.
// `guideRegion` (shared with the manual capture path) and `analyzeFrame` here crop
// the *same* ROI, so what we analyse is exactly what we upload.

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * Source-pixel rectangle of the on-screen card guide, so we upload only the card
 * (fewer pixels = cheaper OCR + faster, and less background text to confuse the
 * parser). Maps the guide's DOM rect through the video's `object-fit: cover` crop
 * into the camera's native resolution. Falls back to the whole frame if the guide
 * isn't laid out yet.
 */
export function guideRegion(video: HTMLVideoElement, guide: HTMLElement | null) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const box = video.getBoundingClientRect()
  const g = guide?.getBoundingClientRect()
  if (!g || box.width === 0 || box.height === 0) {
    return { sx: 0, sy: 0, sw: vw, sh: vh }
  }
  // `object-fit: cover` scales the video to fill `box` and center-crops the
  // overflow. Work out which native-pixel rectangle is actually visible in `box`.
  const boxAspect = box.width / box.height
  const videoAspect = vw / vh
  let cropW: number, cropH: number, cropX: number, cropY: number
  if (videoAspect > boxAspect) {
    cropH = vh
    cropW = vh * boxAspect
    cropX = (vw - cropW) / 2
    cropY = 0
  } else {
    cropW = vw
    cropH = vw / boxAspect
    cropX = 0
    cropY = (vh - cropH) / 2
  }
  // Guide position as a fraction of the displayed video box, then into native pixels.
  const fLeft = (g.left - box.left) / box.width
  const fTop = (g.top - box.top) / box.height
  const gx = cropX + fLeft * cropW
  const gy = cropY + fTop * cropH
  const gw = (g.width / box.width) * cropW
  const gh = (g.height / box.height) * cropH
  // Pad the crop so edge text survives slightly-off framing — extra at the bottom,
  // where the collector number sits just inside the card's lower border. Half the
  // test scans lost their whole bottom section (flavor text + number) to a tight crop.
  const left = clamp(gx - gw * 0.05, 0, vw)
  const topY = clamp(gy - gh * 0.04, 0, vh)
  const right = clamp(gx + gw * 1.05, 0, vw)
  const bottom = clamp(gy + gh * 1.12, 0, vh)
  return { sx: left, sy: topY, sw: Math.max(1, right - left), sh: Math.max(1, bottom - topY) }
}

// --- Auto-capture detection tuning (provisional; retune on the real webcam) ---
// The gate must clear ALL of these for STEADY_FRAMES consecutive samples before firing.
export const SHARP_MIN = 40        // min variance-of-Laplacian (higher = sharper, in-focus)
export const MOTION_MAX = 6        // max mean abs frame-to-frame gray diff (lower = held still)
export const STEADY_FRAMES = 4     // consecutive good samples required (~0.5s at ~120ms/sample)
export const SAMPLE_INTERVAL_MS = 120 // how often the rAF loop actually analyses a frame (~8fps)
export const ARM_COOLDOWN_MS = 4000   // min gap between auto-fires (keeps under the ~1 scan/6s limit)

const ANALYZE_WIDTH = 256 // downscale the ROI to this width before analysis (cheap, stable scale)

export interface FrameStats {
  sharpness: number
  motion: number
  /** Grayscale buffer of this frame; pass back as `prevGray` next call to get motion. */
  gray: Uint8ClampedArray
}

/**
 * Downscale the guide ROI to grayscale and measure focus + motion. Cheap enough to
 * run several times a second. `scratch` is a reused canvas so we don't allocate per
 * frame; `prevGray` is the previous call's `gray` (pass null on the first sample).
 * Returns null if the video/guide isn't ready to sample.
 */
export function analyzeFrame(
  video: HTMLVideoElement,
  guide: HTMLElement | null,
  prevGray: Uint8ClampedArray | null,
  scratch: HTMLCanvasElement,
): FrameStats | null {
  if (!video.videoWidth) return null
  const { sx, sy, sw, sh } = guideRegion(video, guide)
  const w = ANALYZE_WIDTH
  const h = Math.max(1, Math.round((sh / sw) * w))
  if (scratch.width !== w) scratch.width = w
  if (scratch.height !== h) scratch.height = h
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null // e.g. a transiently tainted/empty frame
  }

  // Luma grayscale.
  const gray = new Uint8ClampedArray(w * h)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000
  }

  // Sharpness = variance of a 3x3 Laplacian over interior pixels. Blurry frames have
  // little high-frequency energy, so their Laplacian variance is small.
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w]
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  const mean = n ? sum / n : 0
  const sharpness = n ? sumSq / n - mean * mean : 0

  // Motion = mean absolute difference vs. the previous sampled frame. First sample
  // (or a size change) reports high motion so we never fire before we can confirm hold.
  let motion = Number.POSITIVE_INFINITY
  if (prevGray && prevGray.length === gray.length) {
    let diff = 0
    for (let i = 0; i < gray.length; i++) diff += Math.abs(gray[i] - prevGray[i])
    motion = diff / gray.length
  }

  return { sharpness, motion, gray }
}
