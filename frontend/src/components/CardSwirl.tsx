import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { api, cardImageUrl, onCardImageError, CARD_BACK_URL } from '../lib/api'

/** Slots on the ring. Each renders two faces, so this is half the image count. */
const SLOTS = 14
/** Cap on waiting for card art to decode before starting anyway. */
const PRELOAD_TIMEOUT_MS = 2000

/* ---- cycle timing, measured from the moment a set arrives ---- */
/** How long a set stays up before it crumbles. */
const HOLD_MS = 15_000
/** Cards unmount once the layer has faded; the dust outlives them. */
const CLEAR_MS = HOLD_MS + 2100
/** When the next set flies in — 10s after the dissolve begins. */
const RESPAWN_MS = 25_000

/** Specks per card. 14 cards x this is the transient element count. */
const MOTES_PER_CARD = 30
/** Cards disintegrate one after another rather than all at once. */
const CARD_STAGGER_MS = 70
/** How long the erosion front takes to sweep up a single card. */
const WAVE_MS = 450

interface Mote {
  src: string
  size: number
  x: number; y: number
  bx: number; by: number; bw: number; bh: number
  dx: number; dy: number
  mx: number; my: number
  dur: number; delay: number
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** A fresh random set, cycling if the pool holds fewer cards than there are slots. */
function pick(pool: string[]): string[] {
  if (!pool.length) return []
  const s = shuffle(pool)
  return Array.from({ length: SLOTS }, (_, i) => s[i % s.length])
}

/**
 * Prefers the signed-in user's own collection; falls back to high-rarity cards
 * when the collection is empty or nobody is signed in. Fetched once for the life
 * of the component — every later cycle just reshuffles this locally, so the
 * repeating animation never costs another request.
 */
async function resolvePool(): Promise<string[]> {
  try {
    const col = await api.collection()
    const ids = col.cards.map((c) => c.cardId)
    if (ids.length) return ids
  } catch { /* not signed in or request failed → fall back below */ }
  try { return await api.rareCards() } catch { return [] }
}

/** Resolves once every image has decoded, or once the timeout fires — whichever first. */
function preload(urls: string[]): Promise<void> {
  const decoded = urls.map((src) => {
    const img = new Image()
    img.src = src
    // decode() rejects on a 404; the face's onError swaps in the card back, so a
    // failure here shouldn't hold up the entrance.
    return img.decode().catch(() => undefined)
  })
  return Promise.race([
    Promise.all(decoded).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, PRELOAD_TIMEOUT_MS)),
  ])
}

/**
 * Scatters specks over wherever the cards currently are on screen.
 *
 * getBoundingClientRect on a 3D-transformed element returns its *projected* 2D
 * box, so this reads the live position of each card mid-orbit without having to
 * know the ring's rotation. Each speck then paints a tiny slice of that card's
 * own art via background-position, so the dust carries the card's colours.
 */
function spawnMotes(ring: HTMLElement | null): Mote[] {
  if (!ring) return []
  const cards = Array.from(ring.querySelectorAll<HTMLElement>('.swirl-card'))
  const motes: Mote[] = []
  cards.forEach((el, ci) => {
    const r = el.getBoundingClientRect()
    // Which card this is comes off the element too, so position and identity are
    // read from the same source at the same instant.
    const id = el.dataset.card
    // Skip cards turned edge-on — there's no visible area to crumble.
    if (r.width < 6 || r.height < 6 || !id) return
    const src = cardImageUrl(id)
    for (let i = 0; i < MOTES_PER_CARD; i++) {
      // Weighted small, so the field reads as dust with a few larger flakes.
      const size = 2 + Math.random() ** 2 * 7
      const px = Math.random() * Math.max(1, r.width - size)
      const py = Math.random() * Math.max(1, r.height - size)
      // The erosion front sweeps bottom-to-top through each card, and cards go
      // one after another — that sequencing is what sells disintegration over a
      // uniform puff.
      const wave = (1 - py / r.height) * WAVE_MS
      const dx = 55 + (Math.random() - 0.5) * 230          // a shared breeze, plus spread
      const dy = -110 - Math.random() * 300                // strongly upward
      motes.push({
        src, size,
        x: r.left + px, y: r.top + py,
        bx: -px, by: -py, bw: r.width, bh: r.height,
        dx, dy,
        // Mid-flight waypoint bends each path into an arc instead of a straight line.
        mx: dx * 0.4 + (Math.random() - 0.5) * 70,
        my: dy * 0.42 - 18,
        dur: 2.6 + Math.random() * 2.6,
        delay: (ci * CARD_STAGGER_MS + wave + Math.random() * 160) / 1000,
      })
    }
  })
  return motes
}

/**
 * Landing-page carousel: a random assortment of the user's cards streaks in and
 * settles into a ring spinning about the vertical axis, cards riding tangent so
 * the far half shows their backs. Every ~25s the set crumbles into dust and a
 * fresh one flies in.
 *
 * The carousel runs entirely on CSS keyframes — no rAF loop, no resize listener.
 * CSS can't run two animations against `transform` on one element, so each motion
 * gets its own nesting level and the browser composes them: .swirl-entry converges
 * once, .swirl-ring spins forever, .swirl-slot holds a static ring position,
 * .swirl-card staggers each arrival, .swirl-hover carries the hover scale.
 *
 * The dust is deliberately a flat 2D layer outside the 3D scene, so it can use
 * opacity freely — inside the scene that would flatten `preserve-3d`.
 */
export default function CardSwirl() {
  const [ids, setIds] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const [dissolving, setDissolving] = useState(false)
  const [motes, setMotes] = useState<Mote[]>([])
  const [cycle, setCycle] = useState(0)

  const pool = useRef<string[]>([])
  const nextIds = useRef<string[]>([])
  const ringRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    resolvePool().then(async (all) => {
      if (cancelled || !all.length) return
      pool.current = all
      const first = pick(all)
      setIds(first)
      // Hold the entrance until the art has decoded, so it doesn't play out
      // against half-loaded cards.
      await preload([...new Set(first.map((id) => cardImageUrl(id))), CARD_BACK_URL])
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true }
  }, [])

  const scheduleCycle = useCallback((push: (t: number) => void) => {
    push(window.setTimeout(() => {
      setMotes(spawnMotes(ringRef.current))
      setDissolving(true)
      // Choose and warm the next set during the gap, so it arrives fully decoded.
      nextIds.current = pick(pool.current)
      void preload(nextIds.current.map((id) => cardImageUrl(id)))
    }, HOLD_MS))

    push(window.setTimeout(() => setIds([]), CLEAR_MS))

    push(window.setTimeout(() => {
      setMotes([])
      setIds(nextIds.current)
      setDissolving(false)
      setCycle((c) => c + 1)
    }, RESPAWN_MS))
  }, [])

  // Restarts on every cycle, so the chain repeats indefinitely.
  useEffect(() => {
    if (!ready) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timers: number[] = []
    scheduleCycle((t) => timers.push(t))
    return () => timers.forEach(clearTimeout)
  }, [ready, cycle, scheduleCycle])

  if (!ids.length && !motes.length) return null

  return (
    <>
      {ids.length > 0 && (
        <div className={`swirl${ready ? ' ready' : ''}${dissolving ? ' out' : ''}`} aria-hidden="true">
          <div className="swirl-entry">
            <div className="swirl-ring" ref={ringRef} style={{ '--n': SLOTS } as CSSProperties}>
              {ids.map((id, i) => (
                // Keyed on the cycle so a new set always remounts and replays the
                // entrance, even when a card lands in the same slot as last time.
                <div className="swirl-slot" key={`${cycle}-${i}`} style={{ '--i': i } as CSSProperties}>
                  {/* .swirl-hover exists only to carry the hover scale — see index.css. */}
                  <div className="swirl-card" data-card={id}>
                    <div className="swirl-hover">
                      <div className="swirl-face swirl-front">
                        <img src={cardImageUrl(id)} alt="" draggable={false} onError={onCardImageError} />
                      </div>
                      <div className="swirl-face swirl-back">
                        <img src={CARD_BACK_URL} alt="" draggable={false} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {motes.length > 0 && (
        <div className="swirl-dust" aria-hidden="true">
          {motes.map((m, i) => (
            <span className="dust-mote" key={i} style={{
              left: m.x, top: m.y, width: m.size, height: m.size,
              backgroundImage: `url(${m.src})`,
              backgroundSize: `${m.bw}px ${m.bh}px`,
              backgroundPosition: `${m.bx}px ${m.by}px`,
              '--dx': `${m.dx}px`, '--dy': `${m.dy}px`,
              '--mx': `${m.mx}px`, '--my': `${m.my}px`,
              '--dur': `${m.dur}s`, '--delay': `${m.delay}s`,
            } as CSSProperties} />
          ))}
        </div>
      )}
    </>
  )
}
