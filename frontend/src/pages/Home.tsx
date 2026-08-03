import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type CardDto, type SearchResponse } from '../lib/api'
import { useAuth } from '../lib/auth'
import CardGrid from '../components/CardGrid'
import Pagination from '../components/Pagination'
import CardSwirl from '../components/CardSwirl'

export default function Home({ onSignIn }: { onSignIn: () => void }) {
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const query = params.get('q') ?? ''
  const setName = params.get('set') ?? ''
  const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)

  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  // cardId → copies owned, so results can show how many the user already has.
  // Keyed on `user` only: this reads our own Cassandra view, and refetching it per
  // query/page would be pure waste since search can't change what's owned.
  const [owned, setOwned] = useState<Map<string, number>>(new Map())

  const active = query !== '' || setName !== ''

  useEffect(() => {
    if (!user) return
    api.collection()
      .then((c) => setOwned(new Map(c.cards.map((card) => [card.cardId, card.count]))))
      .catch(() => setOwned(new Map()))
  }, [user])

  useEffect(() => {
    if (!active) { setData(null); return }
    setLoading(true)
    api.search(query, setName, page)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [query, setName, page, active])

  const setPage = (p: number) => {
    const sp = new URLSearchParams(params)
    sp.set('page', String(p))
    setParams(sp)
  }

  // Bump the count locally rather than refetching: the write lands in Cassandra
  // via Kafka, so an immediate reread would still return the pre-add count.
  const onAdd = user
    ? async (card: CardDto) => {
        await api.addFromSearch(card)
        setOwned((m) => new Map(m).set(card.pokewalletId, (m.get(card.pokewalletId) ?? 0) + 1))
      }
    : undefined

  if (!active) {
    return (
      <>
        <CardSwirl />
        <div className="hero">
          <h1>Find any Pokémon card</h1>
          <p>Search the modern catalog and build your collection</p>
          {!user && (
            <button className="btn" style={{ marginTop: 20 }} onClick={onSignIn}>Sign in to start collecting</button>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <h1 style={{ fontSize: '1.2rem', fontWeight: 500, color: '#aaa' }}>
        {data ? data.total : '…'} result{data?.total === 1 ? '' : 's'}
        {query && ` for "${query}"`}
        {setName && ` in ${setName}`}
        {data && data.totalPages > 1 && <span style={{ color: '#666', fontSize: '0.9rem' }}> · page {data.page} of {data.totalPages}</span>}
      </h1>

      {loading && !data && <div className="empty-state">Searching…</div>}
      {data && data.results.length === 0 && <div className="empty-state">No cards found.</div>}
      {data && data.results.length > 0 && (
        <>
          {/* undefined when signed out, so counts from a previous session can't leak. */}
          <CardGrid cards={data.results} onAdd={onAdd} owned={user ? owned : undefined} />
          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      )}
    </>
  )
}
