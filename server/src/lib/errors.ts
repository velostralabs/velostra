export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly expose: boolean
  readonly details?: unknown

  constructor(status: number, code: string, message: string, options: {
    expose?: boolean
    details?: unknown
    cause?: unknown
  } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.expose = options.expose ?? status < 500
    this.details = options.details
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(dependency: string, cause?: unknown) {
    super(503, 'DEPENDENCY_UNAVAILABLE', `${dependency} is temporarily unavailable`, {
      expose: true,
      cause,
    })
    this.name = 'DependencyUnavailableError'
  }
}

export function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'INTERNAL_ERROR'
}