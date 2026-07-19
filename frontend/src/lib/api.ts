// Typed client for the Spring Boot API. Injects the current Supabase session
// JWT as a Bearer token; public endpoints ignore it, protected ones require it.
import { supabase } from './supabase'

const BASE = '/api'

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`)
  return res.status === 204 ? null : (res.json() as Promise<T>)
}

export interface CardDto {
  pokewalletId: string
  cardName: string
  setName: string
  rarity: string
  cardType: string
  marketPriceUsd: number | null
  cardNumber?: string | null
}

export interface SearchResponse {
  results: CardDto[]
  total: number
  page: number
  totalPages: number
  pageSize: number
}

export interface CollectionCardDto {
  cardId: string
  cardName: string
  setName: string
  rarity: string
  condition: string
  marketPriceUsd: number | null
  count: number
  collectionIds: string[]
}

export interface CollectionResponse {
  cards: CollectionCardDto[]
  totalCopies: number
  pricedCopies: number
  totalValue: number
}

export interface RefreshStatus {
  state: 'started' | 'running' | 'cooling' | 'idle'
  cooldownRemainingSeconds: number
  setsRefreshed: number | null
  setsUnmatched: number | null
  cardsUpdated: number | null
  apiCalls: number | null
}

export interface UserDto {
  userId: string
  username: string
  email: string
}

export interface BinderSlotDto {
  pageNumber: number
  slotIndex: number
  cardId: string
  cardName: string
  setName: string
  rarity: string
}

export interface BinderResponse {
  slots: BinderSlotDto[]
  pageCount: number
}

export interface ParsedCard {
  name: string | null
  collectorNumber: string | null
  setCode: string | null
}

export interface ScanCandidate {
  card: CardDto
  confidence: number
}

export interface OcrWord {
  text: string
  height: number
  top: number
  left: number
}

// Present only when the server's scan debug capture is enabled (Phase 2.5).
export interface ScanDebug {
  fullText: string
  words: OcrWord[]
}

export interface ScanResponse {
  candidates: ScanCandidate[]
  parsed: ParsedCard
  debug?: ScanDebug | null
}

export const cardImageUrl = (id: string, size: 'low' | 'high' = 'low') =>
  `${BASE.replace('/api', '')}/card-image/${id}?size=${size}`

// Served from frontend/public. Shown when a card image 404s upstream (e.g. a new
// set whose images PokéWallet hasn't uploaded yet).
export const CARD_BACK_URL = '/card-back.svg'

// onError fallback: swap a failed card image for the card-back placeholder once
// (the data-flag guards against an infinite loop if the placeholder ever fails).
export function onCardImageError(e: { currentTarget: HTMLImageElement }) {
  const img = e.currentTarget
  if (img.dataset.fallback) return
  img.dataset.fallback = '1'
  img.src = CARD_BACK_URL
}

export const api = {
  // Read (public)
  search: (q: string, set: string, page: number) =>
    get<SearchResponse>(`/search?q=${encodeURIComponent(q)}&set=${encodeURIComponent(set)}&page=${page}`),
  sets: (q: string) => get<string[]>(`/sets?q=${encodeURIComponent(q)}`),
  rareCards: () => get<string[]>('/rare-cards'),
  market: (set: string) => get<CardDto[]>(`/market?set=${encodeURIComponent(set)}`),
  marketSets: () => get<string[]>('/market/sets'),

  // Authenticated
  me: () => get<UserDto>('/users/me'),
  syncUser: () => post<UserDto>('/users/sync', {}),
  collection: () => get<CollectionResponse>('/collection'),
  // Kicks off a background refresh and returns immediately. 429 (cooldown) carries
  // a normal status body, so treat it as success rather than throwing.
  startRefresh: async (): Promise<RefreshStatus> => {
    const res = await fetch(`${BASE}/collection/refresh-prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    })
    if (!res.ok && res.status !== 429) throw new Error(`POST /collection/refresh-prices → ${res.status}`)
    return res.json() as Promise<RefreshStatus>
  },
  refreshStatus: () => get<RefreshStatus>('/collection/refresh-prices/status'),
  addFromSearch: (card: CardDto, condition = 'Near Mint') =>
    post<{ collectionId: string }>('/commands/add-from-search', {
      pokewalletId: card.pokewalletId,
      cardName: card.cardName,
      setName: card.setName,
      rarity: card.rarity,
      cardType: card.cardType,
      condition,
      marketPriceUsd: card.marketPriceUsd,
    }),
  addCopy: (pokewalletId: string, condition = 'Near Mint') =>
    post<{ collectionId: string }>('/commands/add-copy', { pokewalletId, condition }),
  removeCard: (collectionId: string) =>
    post<void>('/commands/remove-card', { collectionId }),

  // Card scanning (OCR → catalog match). Multipart: let the browser set the
  // multipart boundary, so we send only the Authorization header.
  scan: async (image: Blob): Promise<ScanResponse> => {
    const form = new FormData()
    form.append('file', image, 'scan.jpg')
    const res = await fetch(`${BASE}/scan`, { method: 'POST', headers: await authHeaders(), body: form })
    if (!res.ok) throw new Error(`POST /scan → ${res.status}`)
    return res.json() as Promise<ScanResponse>
  },

  // Binder
  binder: () => get<BinderResponse>('/binder'),
  placeCard: (cardId: string, pageNumber: number, slotIndex: number) =>
    post<{ status: string }>('/binder/place', { cardId, pageNumber, slotIndex }),
  removeSlot: (pageNumber: number, slotIndex: number) =>
    post<void>('/binder/remove', { pageNumber, slotIndex }),
}
