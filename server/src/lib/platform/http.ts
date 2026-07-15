import type { RequestHandler, Response } from 'express'

export const apiV1Headers: RequestHandler = (_req, res, next) => {
  res.setHeader('X-API-Version', '1')
  const originalJson = res.json.bind(res)
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400 || (body && typeof body === 'object' && 'data' in body)) {
      return originalJson(body)
    }
    return originalJson({ data: body })
  }) as typeof res.json
  next()
}

export function legacyApiHeaders(successor: string): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('Deprecation', 'true')
    res.setHeader('Sunset', 'Fri, 31 Dec 2027 23:59:59 GMT')
    res.setHeader('Link', `<${successor}>; rel="successor-version"`)
    next()
  }
}

export function sendPage<T>(
  res: Response,
  data: T[],
  page: { nextCursor: string | null; hasMore: boolean }
) {
  return res.json({
    data,
    page: { next_cursor: page.nextCursor, has_more: page.hasMore },
  })
}
