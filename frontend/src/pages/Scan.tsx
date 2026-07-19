import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, cardImageUrl, onCardImageError, type CardDto, type ScanResponse } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  analyzeFrame,
  guideRegion,
  ARM_COOLDOWN_MS,
  MOTION_MAX,
  SAMPLE_INTERVAL_MS,
  SHARP_MIN,
  STEADY_FRAMES,
} from '../lib/scanFrame'

type Status = 'starting' | 'live' | 'scanning' | 'results' | 'error'

function scanErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : ''
  if (msg.includes('502')) return "Scanning isn't available yet — the server's Vision API key isn't configured."
  if (msg.includes('429')) return "You're scanning too quickly — wait a moment, then try again."
  if (msg.includes('401')) return 'Your session expired. Please sign in again.'
  if (msg.includes('400')) return 'No image was captured — try again.'
  return 'Scan failed. Check your connection and try again.'
}

/**
 * Build a fixture-ready capture (Phase 2.5) from a debug scan and copy it to the
 * clipboard, so real OCR output can be pasted into parser/matcher regression tests.
 */
function copyCapture(r: ScanResponse) {
  const top = r.candidates[0]
  const fixture = {
    parsed: r.parsed,
    fullText: r.debug?.fullText ?? '',
    words: r.debug?.words ?? [],
    topCandidate: top
      ? { pokewalletId: top.card.pokewalletId, cardName: top.card.cardName, confidence: top.confidence }
      : null,
  }
  navigator.clipboard?.writeText(JSON.stringify(fixture, null, 2))
}

// Confidence tiers for auto-select (Phase 3d). Provisional — retune from the corpus
// as real scans accumulate (see match-fixtures.json / expectedMinConfidence).
const AUTO_SELECT_CONFIDENCE = 0.85 // top candidate at least this confident…
const AUTO_SELECT_MARGIN = 0.15     // …and this far clear of #2 ⇒ present it as the answer
const LOW_CONFIDENCE = 0.55         // below this, lead with a retake hint

type Tier = 'none' | 'confident' | 'choose' | 'low'

/**
 * Classify the ranked candidates: a clear, confident top match is presented as the
 * answer; a weak read leads with a retake hint; otherwise the user picks from the
 * list. Shared by render and the auto-capture retry decision (`low`/`none` ⇒ re-arm).
 */
function classifyTier(candidates: ScanResponse['candidates']): Tier {
  const top = candidates[0]
  const runnerUp = candidates[1]?.confidence ?? 0
  if (!top) return 'none'
  if (top.confidence >= AUTO_SELECT_CONFIDENCE && top.confidence - runnerUp >= AUTO_SELECT_MARGIN) return 'confident'
  if (top.confidence < LOW_CONFIDENCE) return 'low'
  return 'choose'
}

// Card condition (TCGplayer scale). OCR can't see wear/foil, so the user picks it.
const CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged']

/** One matched candidate. Shared by the auto-select hero and the pick-one list. */
function CandidateCard({
  card,
  confidence,
  state,
  hero,
  onAdd,
}: {
  card: CardDto
  confidence: number
  state?: 'busy' | 'done'
  hero?: boolean
  onAdd: (condition: string) => void
}) {
  const [condition, setCondition] = useState<string>('Near Mint')
  const busy = state === 'busy' || state === 'done'
  return (
    <div className={`scan-candidate${hero ? ' scan-candidate--hero' : ''}`}>
      <span className="conf">{Math.round(confidence * 100)}% match</span>
      <img src={cardImageUrl(card.pokewalletId)} alt={card.cardName} loading="lazy" onError={onCardImageError} />
      <div className="nm">{card.cardName}</div>
      <div className="set">{card.setName}{card.cardNumber ? ` · #${card.cardNumber}` : ''}</div>
      <select
        className="scan-condition"
        value={condition}
        onChange={(e) => setCondition(e.target.value)}
        disabled={busy}
        aria-label="Card condition"
      >
        {CONDITIONS.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <button
        className={`btn ${state === 'done' ? 'btn-secondary' : ''}`}
        disabled={busy}
        onClick={() => onAdd(condition)}
      >
        {state === 'done' ? 'Added ✓' : state === 'busy' ? 'Adding…' : 'Add to collection'}
      </button>
    </div>
  )
}

export default function Scan() {
  const { user, loading: authLoading } = useAuth()
  const videoRef = useRef<HTMLVideoElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<Status>('starting')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [added, setAdded] = useState<Record<string, 'busy' | 'done'>>({})
  const [showAll, setShowAll] = useState(false)
  const [autoEnabled, setAutoEnabled] = useState(true)
  const [detectHint, setDetectHint] = useState<'searching' | 'steady' | null>(null)

  // Auto-capture machinery — refs so the per-frame rAF loop doesn't churn state/renders.
  const rafRef = useRef<number | null>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null) // reused analysis canvas
  const prevGrayRef = useRef<Uint8ClampedArray | null>(null) // last sampled frame (for motion)
  const steadyCountRef = useRef(0)         // consecutive good samples so far
  const armAtRef = useRef(0)               // performance.now() before which we won't auto-fire

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    setError(null)
    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Request 1080p: the collector number is tiny (~1% of card height), so more
        // sensor pixels on it materially helps OCR read it. Falls back if unsupported.
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setStatus('live')
    } catch {
      setError('Could not access the webcam. Allow camera access in your browser and make sure one is connected.')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!user) return
    startCamera()
    return () => stopCamera()
  }, [user, startCamera, stopCamera])

  // Return to the live view and re-arm auto-capture: reset the steadiness counters and
  // hold off for a cooldown so a fresh steady detection is needed before the next fire.
  const scanAnother = useCallback(() => {
    steadyCountRef.current = 0
    prevGrayRef.current = null
    armAtRef.current = performance.now() + ARM_COOLDOWN_MS
    setResult(null)
    setError(null)
    setShowAll(false)
    setDetectHint(null)
    setStatus('live')
  }, [])

  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    // Crop to the card guide before uploading (ROI): cheaper OCR, less stray text.
    const { sx, sy, sw, sh } = guideRegion(video, guideRef.current)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sw)
    canvas.height = Math.round(sh)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92))
    if (!blob) return

    setStatus('scanning')
    setError(null)
    setResult(null)
    setAdded({})
    setShowAll(false)
    setDetectHint(null)
    try {
      const resp = await api.scan(blob)
      setResult(resp)
      // Auto-capture fires exactly once per live session: land on results and wait for
      // the user to hit "Scan another" (which re-arms the detector). No auto-retry — a
      // weak read must not silently loop the paid OCR call.
      setStatus('results')
    } catch (e) {
      setError(scanErrorMessage(e))
      setStatus('error')
    }
  }, [])

  const addCard = useCallback(async (card: CardDto, condition: string) => {
    setAdded((a) => ({ ...a, [card.pokewalletId]: 'busy' }))
    try {
      await api.addFromSearch(card, condition)
      setAdded((a) => ({ ...a, [card.pokewalletId]: 'done' }))
    } catch {
      setAdded((a) => {
        const next = { ...a }
        delete next[card.pokewalletId]
        return next
      })
    }
  }, [])

  // Auto-capture detection loop: while the camera is live and auto is on, sample the
  // guide ROI a few times a second and fire once the card is sharp and held steady.
  // Firing flips status to 'scanning', which tears this effect down (one scan per hold);
  // ARM_COOLDOWN_MS + the server rate limiter bound how often we ever hit OCR.
  useEffect(() => {
    // Render already hides the hint outside live/auto, so we needn't clear it here.
    if (status !== 'live' || !autoEnabled) return
    const scratch = (scratchRef.current ??= document.createElement('canvas'))
    let lastSample = 0
    const tick = (t: number) => {
      rafRef.current = requestAnimationFrame(tick)
      if (t - lastSample < SAMPLE_INTERVAL_MS) return
      lastSample = t
      const video = videoRef.current
      if (!video || !video.videoWidth) return
      const stats = analyzeFrame(video, guideRef.current, prevGrayRef.current, scratch)
      if (!stats) return
      prevGrayRef.current = stats.gray
      const steady = stats.sharpness >= SHARP_MIN && stats.motion <= MOTION_MAX
      steadyCountRef.current = steady ? steadyCountRef.current + 1 : 0
      setDetectHint(steady ? 'steady' : 'searching')
      if (steadyCountRef.current >= STEADY_FRAMES && performance.now() >= armAtRef.current) {
        steadyCountRef.current = 0
        // Push the arm-time forward immediately so a stray tick before this effect tears
        // down (status → scanning) can't fire a second scan.
        armAtRef.current = performance.now() + ARM_COOLDOWN_MS
        capture()
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      prevGrayRef.current = null
    }
  }, [status, autoEnabled, capture])

  if (authLoading) return <div className="empty-state">…</div>
  if (!user) return <Navigate to="/" replace />

  const cameraFailed = status === 'error' && !result && !streamRef.current
  const parsed = result?.parsed

  // Auto-select tier from the ranked candidates: a clear, confident top match is
  // presented as the answer; a weak read leads with a retake hint; otherwise the
  // user picks from the list.
  const candidates = result?.candidates ?? []
  const top = candidates[0]
  const tier = classifyTier(candidates)

  return (
    <div className="scan-page">
      <div className="scan-head">
        <h1 style={{ margin: 0 }}>Scan a Card</h1>
        <Link to="/collection" className="btn btn-secondary">← Back to collection</Link>
      </div>
      <p className="scan-hint">
        Hold the card flat inside the frame, fill it as much as possible, and avoid glare.
        {autoEnabled ? ' It captures automatically once the card is steady and in focus.' : ' Then capture.'}
      </p>

      <div className="scan-stage">
        <video ref={videoRef} className="scan-video" autoPlay muted playsInline />
        {(status === 'live' || status === 'scanning') && <div className="scan-guide" ref={guideRef} />}
        {status === 'live' && autoEnabled && detectHint && (
          <div className={`scan-detect${detectHint === 'steady' ? ' steady' : ''}`}>
            {detectHint === 'steady' ? 'Hold steady…' : 'Searching for a card…'}
          </div>
        )}
        {status === 'scanning' && <div className="scan-overlay-msg">Scanning…</div>}
        {cameraFailed && <div className="scan-overlay-msg error">Camera unavailable</div>}
      </div>

      <div className="scan-actions">
        {cameraFailed ? (
          <button className="btn" onClick={startCamera}>Retry camera</button>
        ) : status === 'results' || (status === 'error' && result) ? (
          <button className="btn" onClick={scanAnother}>Scan another</button>
        ) : (
          <div className="scan-capture-controls">
            <button className="btn" onClick={capture} disabled={status !== 'live'}>
              {status === 'scanning' ? 'Scanning…' : autoEnabled ? 'Capture now' : 'Capture & Scan'}
            </button>
            <label className="scan-auto-toggle">
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => {
                  setAutoEnabled(e.target.checked)
                  if (!e.target.checked) setDetectHint(null)
                }}
                disabled={status === 'scanning'}
              />
              Auto-capture
            </label>
          </div>
        )}
      </div>

      {error && <div className="empty-state scan-error">{error}</div>}

      {result && (
        <div className="scan-results">
          <div className="scan-parsed">
            Read: <strong>{parsed?.name || '—'}</strong>
            {parsed?.collectorNumber ? <span> · #{parsed.collectorNumber}</span> : null}
          </div>

          {tier === 'none' && (
            <div className="empty-state">No match found — reposition the card, fill the frame, improve lighting, then scan again.</div>
          )}

          {tier === 'confident' && top && (
            <div className="scan-autoselect">
              <div className="scan-best-label">Best match · {Math.round(top.confidence * 100)}% confident</div>
              <CandidateCard
                card={top.card}
                confidence={top.confidence}
                state={added[top.card.pokewalletId]}
                hero
                onAdd={(condition) => addCard(top.card, condition)}
              />
              {candidates.length > 1 && (
                <button className="scan-more-link" onClick={() => setShowAll((v) => !v)}>
                  {showAll
                    ? 'Hide other matches'
                    : `Not this? See ${candidates.length - 1} other match${candidates.length - 1 === 1 ? '' : 'es'}`}
                </button>
              )}
              {showAll && (
                <div className="scan-candidates">
                  {candidates.slice(1).map(({ card, confidence }) => (
                    <CandidateCard
                      key={card.pokewalletId}
                      card={card}
                      confidence={confidence}
                      state={added[card.pokewalletId]}
                      onAdd={(condition) => addCard(card, condition)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {(tier === 'choose' || tier === 'low') && (
            <>
              {tier === 'low' && (
                <div className="scan-hint-low">
                  Not a confident read. Fill the frame with the card, improve lighting, and avoid glare — then scan again.
                </div>
              )}
              <div className="scan-subhead">{tier === 'low' ? 'Closest matches' : 'Pick the right card'}</div>
              <div className="scan-candidates">
                {candidates.map(({ card, confidence }) => (
                  <CandidateCard
                    key={card.pokewalletId}
                    card={card}
                    confidence={confidence}
                    state={added[card.pokewalletId]}
                    onAdd={(condition) => addCard(card, condition)}
                  />
                ))}
              </div>
            </>
          )}

          {result.debug && (
            <details className="scan-debug">
              <summary>Debug capture (raw OCR)</summary>
              <button className="btn btn-secondary" onClick={() => copyCapture(result)}>
                Copy capture JSON
              </button>
              <pre>{result.debug.fullText || '(no text read)'}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
