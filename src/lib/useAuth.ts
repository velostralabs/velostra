import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { api, type Auth } from './api'
import { robinhoodChain } from './chain'

export function useVelostraAuth() {
  const { address, chainId, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const addressRef = useRef(address)
  const correctNetwork = chainId === robinhoodChain.id
  const [auth, setAuth] = useState<Auth | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    addressRef.current = address
  }, [address])

  const refresh = useCallback(async () => {
    setError(null)
    if (!isConnected || !address) {
      setAuth(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const { auth: current } = await api.get<{ auth: Auth | null }>('/api/auth/me')
      const matchesActiveWallet =
        current?.wallet_address.toLowerCase() === address.toLowerCase()
      setAuth(matchesActiveWallet ? current : null)
    } catch (refreshError) {
      setAuth(null)
      setError(refreshError instanceof Error ? refreshError.message : 'Session check failed')
    } finally {
      setLoading(false)
    }
  }, [address, isConnected])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const synchronize = () => void refresh()
    window.addEventListener('velostra:auth-changed', synchronize)
    return () => window.removeEventListener('velostra:auth-changed', synchronize)
  }, [refresh])

  const signIn = useCallback(async () => {
    if (!address || !correctNetwork) return
    const expectedAddress = address
    setSigningIn(true)
    setError(null)
    try {
      const { message } = await api.post<{ message: string; nonce: string }>('/api/auth/nonce', {
        walletAddress: expectedAddress,
      })
      if (addressRef.current?.toLowerCase() !== expectedAddress.toLowerCase()) {
        throw new Error('Wallet changed before verification completed. Please try again.')
      }
      const signature = await signMessageAsync({ message })
      if (addressRef.current?.toLowerCase() !== expectedAddress.toLowerCase()) {
        throw new Error('Wallet changed during verification. Please verify the active wallet.')
      }
      const { user } = await api.post<{ token: string; user: Auth }>('/api/auth/login', {
        walletAddress: expectedAddress,
        signature,
      })
      if (
        addressRef.current?.toLowerCase() !== expectedAddress.toLowerCase() ||
        user.wallet_address.toLowerCase() !== expectedAddress.toLowerCase()
      ) {
        setAuth(null)
        throw new Error('The verified session does not match the active wallet.')
      }
      setAuth(user)
      window.dispatchEvent(new Event('velostra:auth-changed'))
    } catch (signInError) {
      setAuth(null)
      setError(signInError instanceof Error ? signInError.message : 'Wallet verification failed')
    } finally {
      setSigningIn(false)
    }
  }, [address, correctNetwork, signMessageAsync])

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } finally {
      setAuth(null)
      window.dispatchEvent(new Event('velostra:auth-changed'))
    }
  }, [])

  const walletBoundAuth =
    auth && address && auth.wallet_address.toLowerCase() === address.toLowerCase()
      ? auth
      : null

  return {
    auth: walletBoundAuth,
    isConnected,
    correctNetwork,
    loading,
    signingIn,
    error,
    signIn,
    signOut,
    refresh,
  }
}
