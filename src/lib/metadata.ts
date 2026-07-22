const SITE_ORIGIN = 'https://velostra.xyz'
const DEFAULT_IMAGE = SITE_ORIGIN + '/velostra-social-card-1200x630.png'

export interface PageMetadata {
  title: string
  description: string
  path: string
  robots?: 'index, follow' | 'noindex, nofollow'
}

function setMeta(selector: string, value: string) {
  const element = document.head.querySelector<HTMLMetaElement>(selector)
  if (element) element.setAttribute('content', value)
}

export function applyPageMetadata({
  title,
  description,
  path,
  robots = 'index, follow',
}: PageMetadata) {
  const normalizedPath = path === '/' ? '/' : path.replace(/\/$/, '')
  const canonicalUrl = SITE_ORIGIN + normalizedPath
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')

  document.title = title
  canonical?.setAttribute('href', canonicalUrl)
  setMeta('meta[name="description"]', description)
  setMeta('meta[name="robots"]', robots)
  setMeta('meta[property="og:url"]', canonicalUrl)
  setMeta('meta[property="og:title"]', title)
  setMeta('meta[property="og:description"]', description)
  setMeta('meta[property="og:image"]', DEFAULT_IMAGE)
  setMeta('meta[name="twitter:title"]', title)
  setMeta('meta[name="twitter:description"]', description)
  setMeta('meta[name="twitter:image"]', DEFAULT_IMAGE)
}
