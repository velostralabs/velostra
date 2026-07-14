import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import PageShell from '../components/PageShell'
import { api, type AgentSummary } from '../lib/api'
import '../components/MarketplacePreview.css'

const CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'CRYPTO_DEFI', label: 'Crypto / DeFi' },
  { value: 'WALLET_ANALYSIS', label: 'Wallet Analysis' },
  { value: 'TOKEN_RESEARCH', label: 'Token Research' },
  { value: 'TRADING', label: 'Trading' },
  { value: 'WRITING', label: 'Writing' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'PRODUCTIVITY', label: 'Productivity' },
  { value: 'DATA_ANALYSIS', label: 'Data Analysis' },
  { value: 'CODE', label: 'Code' },
  { value: 'OTHER', label: 'Other' },
]

const SORTS = [
  { value: 'featured', label: 'Featured' },
  { value: 'popular', label: 'Most called' },
  { value: 'price', label: 'Lowest price' },
]

export default function Marketplace() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawQ = searchParams.get('q') ?? ''
  const qParam = rawQ.trim()
  const rawCategory = searchParams.get('category') ?? ''
  const rawSort = searchParams.get('sort') ?? 'featured'
  const category = CATEGORIES.some((item) => item.value === rawCategory) ? rawCategory : ''
  const sort = SORTS.some((item) => item.value === rawSort) ? rawSort : 'featured'

  const [q, setQ] = useState(qParam)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setQ(qParam), [qParam])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextQuery = q.trim()
      if (nextQuery === qParam) return
      const next = new URLSearchParams(searchParams)
      if (nextQuery) next.set('q', nextQuery)
      else next.delete('q')
      setSearchParams(next, { replace: true })
    }, 260)
    return () => window.clearTimeout(timer)
  }, [q, qParam, searchParams, setSearchParams])

  useEffect(() => {
    const alreadyClean =
      rawQ === qParam &&
      rawCategory === category &&
      rawSort === sort &&
      !(searchParams.has('category') && !category) &&
      !(searchParams.has('sort') && sort === 'featured')
    if (alreadyClean) return
    const next = new URLSearchParams(searchParams)
    if (qParam) next.set('q', qParam)
    else next.delete('q')
    if (category) next.set('category', category)
    else next.delete('category')
    if (sort !== 'featured') next.set('sort', sort)
    else next.delete('sort')
    setSearchParams(next, { replace: true })
  }, [category, qParam, rawCategory, rawQ, rawSort, searchParams, setSearchParams, sort])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (qParam) params.set('q', qParam)
    if (category) params.set('category', category)
    if (sort !== 'featured') params.set('sort', sort)

    setLoading(true)
    setError(null)
    api
      .get<{ agents: AgentSummary[] }>('/api/agents' + (params.size ? '?' + params.toString() : ''), {
        signal: controller.signal,
      })
      .then((response) => setAgents(response.agents))
      .catch((requestError: Error) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [qParam, category, sort])

  function setFilter(key: 'category' | 'sort', value: string) {
    const next = new URLSearchParams(searchParams)
    if (value && !(key === 'sort' && value === 'featured')) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  function clearFilters() {
    setQ('')
    setSearchParams({}, { replace: true })
  }

  const hasFilters = Boolean(qParam || category || sort !== 'featured')

  return (
    <PageShell>
      <div className="page-heading">
        <span className="section-eyebrow">Agent discovery</span>
        <h1 className="page-title">Marketplace</h1>
        <p className="page-sub">
          Specialized agents with transparent per-call pricing and receipt-verified execution.
          Connect a wallet when you are ready to run one.
        </p>
      </div>

      <form className="panel marketplace-filters" role="search" onSubmit={(event) => event.preventDefault()}>
        <div className="marketplace-filters__label">
          <SlidersHorizontal size={15} />
          <span className="mono">Market filters</span>
        </div>
        <div className="field-row marketplace-filters__search">
          <label htmlFor="agent-search">Search</label>
          <div className="input-with-icon">
            <Search size={15} />
            <input
              id="agent-search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search agents"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-row">
          <label htmlFor="agent-category">Category</label>
          <select id="agent-category" value={category} onChange={(event) => setFilter('category', event.target.value)}>
            {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="agent-sort">Sort</label>
          <select id="agent-sort" value={sort} onChange={(event) => setFilter('sort', event.target.value)}>
            {SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        {hasFilters && (
          <button type="button" className="filter-clear" onClick={clearFilters}>
            <X size={13} /> Reset
          </button>
        )}
      </form>

      <div className="marketplace-results" aria-live="polite" aria-busy={loading}>
        <span>{loading ? 'Scanning market…' : error ? 'Market unavailable' : agents.length + ' agents found'}</span>
        {hasFilters && <span className="mono">URL STATE / SYNCED</span>}
      </div>

      {loading && (
        <div className="mkt__grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <div className="mkt__card mkt__card--skeleton" key={index} />)}
        </div>
      )}
      {error && (
        <div className="empty-state empty-state--error" role="alert">
          <strong>Marketplace temporarily unreachable.</strong>
          <span>{error}</span>
        </div>
      )}
      {!loading && !error && agents.length === 0 && (
        <div className="empty-state marketplace-empty">
          <span className="mono">NO MATCHING EXECUTION OBJECTS</span>
          <strong>Try a wider search or reset the active filters.</strong>
          {hasFilters && <button type="button" className="btn btn--ghost" onClick={clearFilters}>Reset filters</button>}
        </div>
      )}

      {!loading && !error && agents.length > 0 && (
        <div className="mkt__grid">
          {agents.map((agent, index) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.36, delay: Math.min(index, 5) * 0.035 }}
              whileHover={{ y: -4 }}
            >
              <Link className="mkt__card" to={'/agents/' + agent.slug}>
                <div className="mkt__card-top">
                  <span className="mkt__glyph">V</span>
                  <span className={'mkt__pill mkt__pill--' + agent.price_tier.toLowerCase()}>{agent.price_tier}</span>
                </div>
                <div>
                  <span className="mkt__meta mono">{agent.category.replaceAll('_', ' ')}</span>
                  <h2 className="mkt__name">{agent.name}</h2>
                  <p className="mkt__cat">{agent.description}</p>
                </div>
                <div className="mkt__footer">
                  <span className="mkt__price mono">{'$' + agent.price_per_call.toFixed(2) + ' / call'}</span>
                  <span className="mkt__run">Inspect ↗</span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </PageShell>
  )
}
