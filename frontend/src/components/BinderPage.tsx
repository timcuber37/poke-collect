import { type BinderSlotDto, cardImageUrl, onCardImageError } from '../lib/api'

/** One side of the book. Only 'grid' pages ever appear on a turning leaf. */
export type PageDesc =
  | { kind: 'grid'; page: number }
  | { kind: 'inside' }
  | { kind: 'back' }

export interface PocketHandlers {
  slotAt: (page: number, index: number) => BinderSlotDto | null
  busy: boolean
  onOpen: (page: number, index: number) => void
  onRemove: (page: number, index: number) => void
  onHover: (slot: BinderSlotDto, rect: DOMRect) => void
  onLeave: () => void
}

/** One pocket: a card in a toploader, or an empty sleeve that opens the picker. */
function Pocket({ page, index, h }: { page: number; index: number; h: PocketHandlers }) {
  const slot = h.slotAt(page, index)

  // Still a <button> for keyboard/AT reachability. It no longer needs to be one
  // to avoid stealing the page turn — the binder now tells a click from a drag by
  // pointer travel, so the whole page is a drag surface and pockets aren't dead
  // zones the way they were under react-pageflip.
  if (!slot) {
    return (
      <button className="pocket empty" type="button" title="Add a card"
              onClick={() => h.onOpen(page, index)}>+</button>
    )
  }

  return (
    <div className="pocket"
         onPointerEnter={(e) => h.onHover(slot, e.currentTarget.getBoundingClientRect())}
         onPointerLeave={h.onLeave}>
      {/* draggable={false} is load-bearing, not cosmetic: an <img> is natively
          draggable, and starting that drag fires pointercancel, which aborts the
          page turn mid-flip. user-select alone doesn't suppress it in Firefox. */}
      <img src={cardImageUrl(slot.cardId)} alt={slot.cardName} loading="lazy"
           draggable={false} onError={onCardImageError} />
      <button className="slot-remove" type="button" title="Remove from binder" disabled={h.busy}
              onClick={(e) => { e.stopPropagation(); h.onRemove(page, index) }}>×</button>
    </div>
  )
}

/**
 * The three pockets in one vertical column — the unit a leaf panel carries, and
 * also what a static page tiles three of. Both paths share this component so the
 * leaf lines up pixel-for-pixel with the page it replaces when a drag begins.
 */
export function PocketColumn({ page, col, h }: { page: number; col: number; h: PocketHandlers }) {
  return (
    <div className="pocket-col">
      {[0, 1, 2].map((row) => <Pocket key={row} page={page} index={row * 3 + col} h={h} />)}
    </div>
  )
}

/** A whole resting page: three columns of pockets, or one of the two cover faces. */
export function PageFace({ desc, h }: { desc: PageDesc; h: PocketHandlers }) {
  if (desc.kind === 'inside') return <div className="binder-face face-inside" />
  if (desc.kind === 'back') {
    return (
      <div className="binder-face face-back">
        <div className="cover-inner"><div className="pokeball"><div className="pokeball-center" /></div></div>
      </div>
    )
  }
  return (
    <div className="binder-face face-grid">
      {[0, 1, 2].map((col) => <PocketColumn key={col} page={desc.page} col={col} h={h} />)}
    </div>
  )
}
