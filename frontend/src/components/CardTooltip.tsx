import { createPortal } from 'react-dom'
import type { BinderSlotDto, CollectionCardDto } from '../lib/api'

/** Gap between the pocket and the panel, px. */
const GAP = 14

/**
 * Card detail for a hovered binder pocket.
 *
 * Portaled to document.body on purpose: .binder-flip clips its overflow (so the
 * turn sweep can't spawn scrollbars) and the pockets sit inside a 3D-transformed
 * subtree, so a tooltip nested in a pocket would be cut off at the book's edge and
 * would tilt with the page mid-turn.
 *
 * `slot` covers name/set/rarity from the binder read model; `detail` adds price,
 * condition and copy count, which only exist on the collection view.
 */
export default function CardTooltip({ slot, rect, detail }: {
  slot: BinderSlotDto
  rect: DOMRect
  detail?: CollectionCardDto
}) {
  // Prefer the pocket's right side, and flip to its left when the panel would run
  // off-screen. Anchoring the flipped case with translate(-100%) keeps the width
  // out of the arithmetic.
  const flipLeft = rect.right + GAP + 240 > window.innerWidth

  return createPortal(
    <div className="binder-tip" role="tooltip"
         style={{
           left: flipLeft ? rect.left - GAP : rect.right + GAP,
           top: rect.top + rect.height / 2,
           transform: flipLeft ? 'translate(-100%, -50%)' : 'translateY(-50%)',
         }}>
      <div className="card-name">{slot.cardName}</div>
      <div className="card-meta">{slot.setName}</div>
      <span className="badge">{slot.rarity}</span>
      {detail?.marketPriceUsd != null && <div className="price">${detail.marketPriceUsd.toFixed(2)}</div>}
      {detail && <div className="card-meta">{detail.condition}</div>}
      {detail && (
        <div className="tip-owned">
          {detail.count} cop{detail.count === 1 ? 'y' : 'ies'} in collection
        </div>
      )}
    </div>,
    document.body,
  )
}
