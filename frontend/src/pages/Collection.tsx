import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, type CollectionResponse, cardImageUrl, onCardImageError } from '../lib/api'
import { useAuth } from '../lib/auth'
import Binder from '../components/Binder'

export default function Collection() {
  const { user, username, loading: authLoading } = useAuth()
  const [view, setView] = useState<'grid' | 'binder'>('grid')
  const [sortKey, setSortKey] = useState<'name' | 'value'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filter, setFilter] = useState('')
  const [data, setData] = useState<CollectionResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    api.collection().then(setData).catch(() => setData(null))
  }, [])

  useEffect(() => { if (user) load() }, [user, load])

  // Writes propagate through Kafka → Cassandra, so refetch after a short delay.
  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await new Promise((r) => setTimeout(r, 900))
      load()
    } finally {
      setBusy(false)
    }
  }

  // Refreshing every owned set takes minutes, so the backend runs it in the
  // background: kick it off, then poll status until it finishes and reload.
  const refreshPrices = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const started = await api.startRefresh()
      if (started.state === 'cooling') {
        const mins = Math.max(1, Math.ceil(started.cooldownRemainingSeconds / 60))
        setRefreshMsg(`Prices were refreshed recently — try again in ~${mins} min.`)
        setRefreshing(false)
        return
      }
      setRefreshMsg('Refreshing prices in the background — this can take a few minutes…')

      // Poll until the run leaves the "running" state (cap ~10 min at 5s each).
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const s = await api.refreshStatus()
        if (s.state !== 'running') {
          if (s.cardsUpdated != null) {
            const n = s.setsRefreshed ?? 0
            setRefreshMsg(`Updated ${s.cardsUpdated} card prices across ${n} set${n === 1 ? '' : 's'}.`)
          } else {
            setRefreshMsg('Prices refreshed.')
          }
          load()
          break
        }
      }
    } catch {
      setRefreshMsg('Price refresh failed — try again later.')
    } finally {
      setRefreshing(false)
    }
  }

  if (authLoading) return <div className="empty-state">…</div>
  if (!user) return <Navigate to="/" replace />

  const cards = data?.cards ?? []

  // Clicking the active field flips direction; switching fields picks a sensible
  // default (Name A→Z, Value high→low).
  const setSort = (key: 'name' | 'value') => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'value' ? 'desc' : 'asc') }
  }

  const sortedCards = [...cards].sort((a, b) => {
    if (sortKey === 'value') {
      const av = a.marketPriceUsd, bv = b.marketPriceUsd
      // Unpriced cards always sort to the end, regardless of direction.
      if (av == null && bv == null) return a.cardName.localeCompare(b.cardName)
      if (av == null) return 1
      if (bv == null) return -1
      return sortDir === 'asc' ? av - bv : bv - av
    }
    const cmp = a.cardName.localeCompare(b.cardName)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const arrow = (key: 'name' | 'value') => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  // Filters what's already loaded rather than querying — /collection returns the
  // whole collection up front, so narrowing costs no request per keystroke and is
  // unrelated to the catalog search in the top bar.
  const query = filter.trim().toLowerCase()
  const visible = query
    ? sortedCards.filter((c) =>
        c.cardName.toLowerCase().includes(query) || c.setName.toLowerCase().includes(query))
    : sortedCards

  return (
    <>
      <div className="collection-head">
        <h1 style={{ margin: 0 }}>{username}'s Collection</h1>
        {view === 'grid' && data && cards.length > 0 && (
          <div className="collection-total">
            <div className="label">Total value</div>
            <div className="value">${data.totalValue.toFixed(2)}</div>
            <div className="sub">
              {data.pricedCopies} of {data.totalCopies} cop{data.totalCopies === 1 ? 'y' : 'ies'} priced · {cards.length} unique
            </div>
          </div>
        )}
      </div>

      <div className="collection-controls">
        <div className="controls-left">
          <div className="view-toggle">
            <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>Collection</button>
            <button className={view === 'binder' ? 'active' : ''} onClick={() => setView('binder')}>Binder</button>
          </div>
          <Link to="/scan" className="btn btn-secondary scan-link">Scan a card</Link>
          {view === 'grid' && cards.length > 0 && (
            <button className="btn btn-secondary" disabled={refreshing} onClick={refreshPrices}>
              {refreshing ? 'Refreshing…' : 'Refresh prices'}
            </button>
          )}
          {view === 'grid' && cards.length > 0 && (
            <input className="collection-search" type="search" value={filter}
                   onChange={(e) => setFilter(e.target.value)}
                   placeholder="Filter by name or set…" autoComplete="off"
                   aria-label="Filter collection by card name or set" />
          )}
        </div>

        {view === 'grid' && cards.length > 1 && (
          <div className="sort-group">
            <span className="sort-label">Sort</span>
            <div className="view-toggle">
              <button className={sortKey === 'name' ? 'active' : ''} onClick={() => setSort('name')}>Name{arrow('name')}</button>
              <button className={sortKey === 'value' ? 'active' : ''} onClick={() => setSort('value')}>Value{arrow('value')}</button>
            </div>
          </div>
        )}
      </div>

      {view === 'grid' && refreshMsg && (
        <div className="card-meta" style={{ marginBottom: 12 }}>{refreshMsg}</div>
      )}

      {view === 'binder' && <Binder />}

      {view === 'grid' && query && visible.length > 0 && (
        <div className="card-meta" style={{ marginBottom: 12 }}>
          {visible.length} of {cards.length} card{cards.length === 1 ? '' : 's'} match “{filter.trim()}”
        </div>
      )}

      {view === 'grid' && !data && <div className="empty-state">Loading…</div>}
      {view === 'grid' && data && cards.length === 0 && (
        <div className="empty-state">Your collection is empty. Search for cards to add.</div>
      )}
      {view === 'grid' && cards.length > 0 && visible.length === 0 && (
        <div className="empty-state">No cards in your collection match “{filter.trim()}”.</div>
      )}

      {view === 'grid' && visible.length > 0 && (
        <div className="card-grid">
          {visible.map((c) => (
            <div className="card" key={c.cardId}>
              <img src={cardImageUrl(c.cardId)} alt={c.cardName} loading="lazy"
                   onError={onCardImageError} />
              <div className="card-name">{c.cardName}</div>
              <div className="card-meta">{c.setName}</div>
              <span className="badge">{c.rarity}</span>
              {c.marketPriceUsd != null && (
                <div className="price">
                  ${c.marketPriceUsd.toFixed(2)}
                  {c.count > 1 && (
                    <span style={{ color: '#888', fontWeight: 400, fontSize: '0.85rem' }}>
                      {' '}× {c.count} = ${(c.marketPriceUsd * c.count).toFixed(2)}
                    </span>
                  )}
                </div>
              )}
              <div className="card-meta" style={{ marginTop: 6 }}>{c.condition}</div>

              <div className="qty-row">
                <button className="btn btn-secondary qty-btn" title="Remove one copy" disabled={busy}
                        onClick={() => mutate(() => api.removeCard(c.collectionIds[0]))}>−</button>
                <div className="qty">{c.count}</div>
                <button className="btn qty-btn" title="Add another copy" disabled={busy}
                        onClick={() => mutate(() => api.addCopy(c.cardId, c.condition))}>+</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
