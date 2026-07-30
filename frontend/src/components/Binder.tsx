import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api, type BinderResponse, type BinderSlotDto, type CollectionCardDto,
         cardImageUrl, onCardImageError } from '../lib/api'
import { PageFace, PocketColumn, type PageDesc, type PocketHandlers } from './BinderPage'
import CardTooltip from './CardTooltip'
import { DRAG_THRESHOLD_PX, clamp01, hingeAngles, tweenProgress } from '../lib/binderFlip'

/** Width of one page, px. Must match --page-w in index.css; hinges sit at each third. */
const PAGE_W = 420

type Dir = 'fwd' | 'back'

/**
 * A 3x3 binder rendered as a real book of rigid leaves.
 *
 * Page model: a flat list of sides — [inside cover, content 0..n-1, back cover] —
 * where spread s shows sides 2s and 2s+1. A physical *leaf* j carries side 2j+1 on
 * its front and 2j+2 on its back, so turning leaf j advances spread j to j+1. Side
 * 0 is therefore a fixed left endpaper and the book opens to [inside cover | page 0],
 * which is how it behaved before.
 *
 * A leaf is only mounted while it's actually turning; at rest both visible sides are
 * plain static pages. See lib/binderFlip.ts for the three-hinge fold itself.
 */
export default function Binder() {
  const [binder, setBinder] = useState<BinderResponse | null>(null)
  const [owned, setOwned] = useState<CollectionCardDto[]>([])
  const [spread, setSpread] = useState(0)
  const [flip, setFlip] = useState<{ dir: Dir; auto: boolean } | null>(null)
  const [picker, setPicker] = useState<{ page: number; slot: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [tip, setTip] = useState<{ slot: BinderSlotDto; rect: DOMRect } | null>(null)

  const bookRef = useRef<HTMLDivElement>(null)
  const colRefs = useRef<(HTMLDivElement | null)[]>([])
  const progress = useRef(0)
  const drag = useRef<{ x0: number; dir: Dir; id: number } | null>(null)
  const dragged = useRef(false)
  const cancelTween = useRef<(() => void) | null>(null)

  const loadBinder = useCallback(() => {
    api.binder().then(setBinder).catch(() => setBinder(null))
  }, [])

  useEffect(() => {
    loadBinder()
    // The collection feeds both the hover tooltip (price/condition/count, none of
    // which the binder read model carries) and the picker's availability counts.
    api.collection().then((c) => setOwned(c.cards)).catch(() => setOwned([]))
  }, [loadBinder])

  useEffect(() => () => cancelTween.current?.(), [])

  // ---- page model ----

  // Leaves come in pairs, so the content side count is rounded up to even; that
  // also guarantees the back cover lands on a right-hand side.
  const used = binder?.pageCount ?? 0
  const contentCount = Math.max(used + 1, 1) + (Math.max(used + 1, 1) % 2)
  const pages: PageDesc[] = [
    { kind: 'inside' },
    ...Array.from({ length: contentCount }, (_, p): PageDesc => ({ kind: 'grid', page: p })),
    { kind: 'back' },
  ]
  const spreadCount = pages.length / 2
  const canFwd = spread + 1 < spreadCount
  const canBack = spread > 0

  // ---- flip control ----

  /** Writes the three panel transforms straight to the DOM — no re-render per frame. */
  const applyProgress = useCallback((p: number) => {
    progress.current = p
    const angles = hingeAngles(p)
    for (let d = 0; d < 3; d++) {
      const el = colRefs.current[d]
      if (el) el.style.transform = `rotateY(${angles[d]}deg)`
    }
  }, [])

  const finishFlip = useCallback((dir: Dir, target: number) => {
    cancelTween.current?.()
    cancelTween.current = tweenProgress(progress.current, target, applyProgress, () => {
      cancelTween.current = null
      // Commit the spread and unmount the leaf in the same update, so no frame can
      // show the new spread without the leaf that was covering it.
      if (dir === 'fwd' && target === 1) setSpread((s) => s + 1)
      if (dir === 'back' && target === 0) setSpread((s) => s - 1)
      setFlip(null)
    })
  }, [applyProgress])

  // Seed the panels the moment a leaf mounts, before the browser paints, so it
  // appears exactly on top of the page it replaces instead of flashing at angle 0.
  useLayoutEffect(() => {
    if (!flip) return
    applyProgress(flip.dir === 'fwd' ? 0 : 1)
    if (flip.auto) finishFlip(flip.dir, flip.dir === 'fwd' ? 1 : 0)
  }, [flip, applyProgress, finishFlip])

  const turn = (dir: Dir) => {
    if (flip || busy || (dir === 'fwd' ? !canFwd : !canBack)) return
    setTip(null)
    setFlip({ dir, auto: true })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (busy || flip || !binder) return
    const box = bookRef.current?.getBoundingClientRect()
    if (!box) return
    // Grabbing the right half turns forward, the left half turns back.
    const dir: Dir = e.clientX - box.left >= box.width / 2 ? 'fwd' : 'back'
    if (dir === 'fwd' ? !canFwd : !canBack) return
    drag.current = { x0: e.clientX, dir, id: e.pointerId }
    dragged.current = false
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    if (!dragged.current) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      dragged.current = true
      setTip(null)
      // Capture only once it's genuinely a drag: capturing on pointerdown would
      // retarget the follow-up click and break the pocket buttons.
      bookRef.current?.setPointerCapture(d.id)
      setFlip({ dir: d.dir, auto: false })
      return
    }
    applyProgress(d.dir === 'fwd' ? clamp01(-dx / PAGE_W) : clamp01(1 - dx / PAGE_W))
  }

  const endDrag = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (bookRef.current?.hasPointerCapture(d.id)) bookRef.current.releasePointerCapture(d.id)
    // Left false on a plain click so the pocket handlers below let it through;
    // left true after a drag so the trailing click doesn't open the picker.
    if (!dragged.current) return
    const p = progress.current
    finishFlip(d.dir, d.dir === 'fwd' ? (p > 0.5 ? 1 : 0) : (p < 0.5 ? 0 : 1))
  }

  // ---- slots ----

  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setTip(null)
    try { await fn() } catch { /* ignore (e.g. no available copy) */ }
    // The write reaches Cassandra via Kafka, so give the projection a moment.
    await new Promise((r) => setTimeout(r, 900))
    loadBinder()
    setBusy(false)
  }

  const slotAt = (page: number, index: number) =>
    binder?.slots.find((s) => s.pageNumber === page && s.slotIndex === index) ?? null

  const placedCount = (cardId: string) => binder?.slots.filter((s) => s.cardId === cardId).length ?? 0
  const availableOf = (c: CollectionCardDto) => c.count - placedCount(c.cardId)

  const placeCard = (cardId: string) => {
    const target = picker
    setPicker(null)
    if (!target) return
    mutate(() => api.placeCard(cardId, target.page, target.slot))
  }

  const handlers: PocketHandlers = {
    slotAt,
    busy,
    onOpen: (page, slot) => { if (!dragged.current && !busy) setPicker({ page, slot }) },
    onRemove: (page, slot) => { if (!dragged.current && !busy) mutate(() => api.removeSlot(page, slot)) },
    onHover: (slot, rect) => { if (!drag.current && !flip) setTip({ slot, rect }) },
    onLeave: () => setTip(null),
  }

  // ---- render ----

  // While a leaf turns, the side it uncovers has to be rendered beneath it: a
  // forward turn reveals side 2s+3 on the right, a backward turn reveals 2s-2 on
  // the left. At rest these are just the two sides of the current spread.
  const leafIndex = !flip ? -1 : flip.dir === 'fwd' ? spread : spread - 1
  const leftDesc = flip?.dir === 'back' ? pages[2 * spread - 2] : pages[2 * spread]
  const rightDesc = flip?.dir === 'fwd' ? pages[2 * spread + 3] : pages[2 * spread + 1]
  const front = leafIndex >= 0 ? pages[2 * leafIndex + 1] : undefined
  const back = leafIndex >= 0 ? pages[2 * leafIndex + 2] : undefined

  // The leaf's starting pose is rendered, not written after mount. A forward turn
  // starts at progress 0, which is identity and so matches the panels' default CSS
  // — but a backward turn starts at progress 1, which needs rotateY(-180deg). If
  // that only arrived via the layout effect below, a backward turn could paint one
  // frame of an unposed leaf: flat on the right half, showing the wrong face.
  const pose = flip ? hingeAngles(flip.dir === 'fwd' ? 0 : 1) : null

  // Nested, not siblings: that's what makes each panel's rotation compound onto
  // its parent's, so the sheet folds as a rigid body. A panel d away from the
  // spine shows front column d, and back column 2-d — on a left-hand page the
  // column nearest the spine is the rightmost one.
  const leafCol = (d: number, frontPage: number, backPage: number): ReactNode => (
    <div className="leaf-col" ref={(el) => { colRefs.current[d] = el }}
         style={pose ? { transform: `rotateY(${pose[d]}deg)` } : undefined}>
      <div className="binder-face leaf-face leaf-front">
        <PocketColumn page={frontPage} col={d} h={handlers} />
      </div>
      <div className="binder-face leaf-face leaf-back">
        <PocketColumn page={backPage} col={2 - d} h={handlers} />
      </div>
      {d < 2 && leafCol(d + 1, frontPage, backPage)}
    </div>
  )

  return (
    <div className="binder-wrap">
      <div className="binder-flip">
        {binder ? (
          <div className="binder-book" ref={bookRef}
               onPointerDown={onPointerDown} onPointerMove={onPointerMove}
               onPointerUp={endDrag} onPointerCancel={endDrag}>
            <div className="binder-side left">
              {leftDesc && <PageFace desc={leftDesc} h={handlers} />}
            </div>
            <div className="binder-side right">
              {rightDesc && <PageFace desc={rightDesc} h={handlers} />}
            </div>
            {front?.kind === 'grid' && back?.kind === 'grid' && (
              <div className="binder-leaf">{leafCol(0, front.page, back.page)}</div>
            )}
          </div>
        ) : (
          <div className="empty-state">Loading binder…</div>
        )}
      </div>

      <div className="binder-nav">
        <button className="btn btn-secondary" onClick={() => turn('back')}
                disabled={!canBack || !!flip || busy} aria-label="Previous page">←</button>
        <span className="page-label">{spread + 1} / {spreadCount}</span>
        <button className="btn btn-secondary" onClick={() => turn('fwd')}
                disabled={!canFwd || !!flip || busy} aria-label="Next page">→</button>
      </div>

      {tip && <CardTooltip slot={tip.slot} rect={tip.rect}
                           detail={owned.find((c) => c.cardId === tip.slot.cardId)} />}

      {picker !== null && (
        <div className="picker-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPicker(null) }}>
          <div className="picker-dialog">
            <h2>Choose a card</h2>
            {(() => {
              const avail = owned.filter((c) => availableOf(c) > 0)
              if (owned.length === 0) return <div className="empty-state">No cards in your collection yet.</div>
              if (avail.length === 0) return <div className="empty-state">All your copies are already in the binder.</div>
              return (
                <div className="picker-grid">
                  {avail.map((c) => (
                    <div className="picker-card" key={c.cardId} onClick={() => placeCard(c.cardId)}>
                      <img src={cardImageUrl(c.cardId)} alt={c.cardName} loading="lazy"
                           onError={onCardImageError} />
                      <div className="nm">{c.cardName}</div>
                      <div className="avail">{availableOf(c)} available</div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
