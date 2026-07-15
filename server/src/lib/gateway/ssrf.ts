import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { isProduction } from '../config.js'
import { AppError } from '../errors.js'

export class EndpointSecurityError extends AppError {
  constructor(code: string, message: string, cause?: unknown) {
    super(400, code, message, { expose: true, cause })
    this.name = 'EndpointSecurityError'
  }
}

export class AgentEndpointError extends AppError {
  constructor(code: string, message: string, status = 502, cause?: unknown) {
    super(status, code, message, { expose: true, cause })
    this.name = 'AgentEndpointError'
  }
}

type LookupAddress = { address: string; family: number }
type Resolver = (hostname: string) => Promise<LookupAddress[]>

export interface SafeAgentResponse {
  ok: boolean
  status: number
  text: string
  headers: http.IncomingHttpHeaders
}

function integerEnv(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`)
  }
  return value
}

function allowedPorts(): Set<number> {
  const raw = process.env.AGENT_ALLOWED_PORTS ?? '80,443'
  const ports = raw.split(',').map((entry) => Number(entry.trim()))
  if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('AGENT_ALLOWED_PORTS must be a comma-separated list of valid ports')
  }
  return new Set(ports)
}

function normalizedIpv4(address: string): number[] | null {
  const candidate = address.toLowerCase().startsWith('::ffff:')
    ? address.slice(address.lastIndexOf(':') + 1)
    : address
  if (net.isIP(candidate) !== 4) return null
  return candidate.split('.').map(Number)
}

function isLoopbackAddress(address: string): boolean {
  const ipv4 = normalizedIpv4(address)
  if (ipv4) return ipv4[0] === 127
  return address.toLowerCase() === '::1'
}

export function isBlockedAddress(address: string): boolean {
  const ipv4 = normalizedIpv4(address)
  if (ipv4) {
    const [a, b, c] = ipv4
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    )
  }

  const ipv6 = address.toLowerCase().split('%')[0]
  if (net.isIP(ipv6) !== 6) return true
  return (
    ipv6 === '::' ||
    ipv6 === '::1' ||
    ipv6.startsWith('fc') ||
    ipv6.startsWith('fd') ||
    /^fe[89ab]/.test(ipv6) ||
    ipv6.startsWith('ff') ||
    ipv6.startsWith('2001:db8:')
  )
}

function allowLoopbackForTests(address: string): boolean {
  return (
    process.env.NODE_ENV === 'test' &&
    process.env.AGENT_SSRF_TEST_ALLOW_LOOPBACK === 'true' &&
    isLoopbackAddress(address)
  )
}

export function parseAgentEndpoint(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch (error) {
    throw new EndpointSecurityError('AGENT_ENDPOINT_INVALID', 'Agent endpoint is not a valid URL', error)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new EndpointSecurityError('AGENT_ENDPOINT_SCHEME_BLOCKED', 'Agent endpoint must use HTTPS or HTTP')
  }
  if (isProduction() && url.protocol !== 'https:') {
    throw new EndpointSecurityError(
      'AGENT_ENDPOINT_HTTPS_REQUIRED',
      'Production agent endpoints must use HTTPS'
    )
  }
  if (url.username || url.password) {
    throw new EndpointSecurityError('AGENT_ENDPOINT_CREDENTIALS_BLOCKED', 'Agent endpoint cannot contain URL credentials')
  }
  if (url.hash) {
    throw new EndpointSecurityError('AGENT_ENDPOINT_FRAGMENT_BLOCKED', 'Agent endpoint cannot contain a URL fragment')
  }

  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  if (!allowedPorts().has(port)) {
    throw new EndpointSecurityError('AGENT_ENDPOINT_PORT_BLOCKED', `Agent endpoint port ${port} is not allowed`)
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    if (!(process.env.NODE_ENV === 'test' && process.env.AGENT_SSRF_TEST_ALLOW_LOOPBACK === 'true')) {
      throw new EndpointSecurityError('AGENT_ENDPOINT_HOST_BLOCKED', 'Local and internal hostnames are not allowed')
    }
  }

  return url
}

async function defaultResolver(hostname: string): Promise<LookupAddress[]> {
  if (net.isIP(hostname)) return [{ address: hostname, family: net.isIP(hostname) }]
  return dns.lookup(hostname, { all: true, verbatim: true })
}

export async function resolveSafeAgentEndpoint(
  rawUrl: string,
  resolver: Resolver = defaultResolver
): Promise<{ url: URL; address: string; family: number }> {
  const url = parseAgentEndpoint(rawUrl)
  let addresses: LookupAddress[]
  try {
    addresses = await resolver(url.hostname)
  } catch (error) {
    throw new EndpointSecurityError('AGENT_ENDPOINT_DNS_FAILED', 'Agent endpoint DNS resolution failed', error)
  }

  if (addresses.length === 0) {
    throw new EndpointSecurityError('AGENT_ENDPOINT_DNS_EMPTY', 'Agent endpoint did not resolve to an address')
  }
  for (const entry of addresses) {
    if (isBlockedAddress(entry.address) && !allowLoopbackForTests(entry.address)) {
      throw new EndpointSecurityError(
        'AGENT_ENDPOINT_PRIVATE_ADDRESS',
        'Agent endpoint resolves to a private, local, reserved, or non-routable address'
      )
    }
  }

  return { url, address: addresses[0].address, family: addresses[0].family }
}

export async function validateAgentEndpoint(rawUrl: string): Promise<void> {
  await resolveSafeAgentEndpoint(rawUrl)
}

function requestOnce(
  rawUrl: string,
  options: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number; maxBytes: number }
): Promise<SafeAgentResponse & { location?: string }> {
  return resolveSafeAgentEndpoint(rawUrl).then(({ url, address }) =>
    new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http
      const request = transport.request(
        {
          protocol: url.protocol,
          hostname: address,
          port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
          path: `${url.pathname}${url.search}`,
          method: options.method,
          headers: { ...options.headers, host: url.host },
          servername: url.hostname,
          timeout: options.timeoutMs,
        },
        (response) => {
          const declaredLength = Number(response.headers['content-length'] ?? 0)
          if (declaredLength > options.maxBytes) {
            response.destroy()
            reject(new AgentEndpointError('AGENT_RESPONSE_TOO_LARGE', 'Agent response exceeded the configured size limit'))
            return
          }

          const chunks: Buffer[] = []
          let received = 0
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (received > options.maxBytes) {
              response.destroy(new AgentEndpointError('AGENT_RESPONSE_TOO_LARGE', 'Agent response exceeded the configured size limit'))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => {
            const status = response.statusCode ?? 502
            resolve({
              ok: status >= 200 && status < 300,
              status,
              text: Buffer.concat(chunks).toString('utf8'),
              headers: response.headers,
              location: response.headers.location,
            })
          })
          response.on('error', reject)
        }
      )

      const deadline = setTimeout(() => {
        request.destroy(
          new AgentEndpointError('AGENT_ENDPOINT_TIMEOUT', 'Agent endpoint timed out', 504)
        )
      }, options.timeoutMs)
      request.once('close', () => clearTimeout(deadline))
      request.on('timeout', () => {
        request.destroy(new AgentEndpointError('AGENT_ENDPOINT_TIMEOUT', 'Agent endpoint timed out', 504))
      })
      request.on('error', (error) => {
        reject(
          error instanceof AppError
            ? error
            : new AgentEndpointError('AGENT_ENDPOINT_REQUEST_FAILED', 'Agent endpoint request failed', 502, error)
        )
      })
      if (options.body) request.write(options.body)
      request.end()
    })
  )
}

export async function safeFetchAgent(
  rawUrl: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<SafeAgentResponse> {
  const method = options.method ?? 'POST'
  const maxRedirects = integerEnv('AGENT_MAX_REDIRECTS', 2, 0)
  const timeoutMs = integerEnv('AGENT_TIMEOUT_MS', 30_000, 1)
  const maxBytes = integerEnv('AGENT_MAX_RESPONSE_BYTES', 1_048_576, 1)
  let currentUrl = rawUrl

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await requestOnce(currentUrl, {
      method,
      headers: options.headers ?? {},
      body: options.body,
      timeoutMs,
      maxBytes,
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    if (!response.location) {
      throw new AgentEndpointError('AGENT_REDIRECT_INVALID', 'Agent endpoint returned a redirect without a location')
    }
    if (redirect === maxRedirects) {
      throw new AgentEndpointError('AGENT_REDIRECT_LIMIT', 'Agent endpoint exceeded the redirect limit')
    }
    if (![307, 308].includes(response.status) && method !== 'GET') {
      throw new AgentEndpointError('AGENT_REDIRECT_METHOD_BLOCKED', 'Agent POST endpoint must use a 307 or 308 redirect')
    }
    currentUrl = new URL(response.location, currentUrl).toString()
  }

  throw new AgentEndpointError('AGENT_REDIRECT_LIMIT', 'Agent endpoint exceeded the redirect limit')
}