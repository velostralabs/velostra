import { useCallback, useEffect, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { api, type Auth } from './api'

export function useVelostraAuth() {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [auth, setAuth] = useState<Auth | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const { auth: current } = await api.get<{ auth: Auth | null }>('/api/auth/me')
      setAuth(current)
    } catch (refreshError) {
      setAuth(null)
      setError(refreshError instanceof Error ? refreshError.message : 'Session check failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const signIn = useCallback(async () => {
    if (!address) return
    setSigningIn(true)
    setError(null)
    try {
      const { message } = await api.post<{ message: string; nonce: string }>('/api/auth/nonce', {
        walletAddress: address,
      })
      const signature = await signMessageAsync({ message })
      const { user } = await api.post<{ token: string; user: Auth }>('/api/auth/login', {
        walletAddress: address,
        signature,
      })
      setAuth(user)
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Wallet verification failed')
    } finally {
      setSigningIn(false)
    }
  }, [address, signMessageAsync])

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } finally {
      setAuth(null)
    }
  }, [])

  return { auth, isConnected, loading, signingIn, error, signIn, signOut, refresh }
}
