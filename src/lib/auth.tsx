import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from '../types/domain'

type AuthContextValue = { session: Session | null; profile: Profile | null; loading: boolean; error: string | null; refreshProfile: () => Promise<void>; signOut: () => Promise<void> }
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refreshProfile() {
    if (!supabase) return
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) { setProfile(null); setLoading(false); return }
    const { data, error: profileError } = await supabase.from('profiles').select('id, full_name, role, is_active').eq('id', authData.user.id).single()
    if (profileError) { setError('Le profil est introuvable ou inaccessible. Contactez un administrateur.'); setProfile(null); setLoading(false); return }
    setError(null)
    setProfile(data as Profile)
    setLoading(false)
  }

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let active = true
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      setSession(data.session)
      if (sessionError) setError(sessionError.message)
      if (!data.session && active) setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      if (!next) { setProfile(null); setError(null); setLoading(false) }
      else setLoading(true)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (session?.user.id) void refreshProfile()
  }, [session?.user.id])

  async function signOut() {
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(signOutError.message)
  }
  return <AuthContext.Provider value={{ session, profile, loading, error, refreshProfile, signOut }}>{children}</AuthContext.Provider>
}
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

export const roleLabels: Record<Profile['role'], string> = {
  admin: 'Administrateur', sales_manager: 'Responsable commercial', sales_rep: 'Commercial',
}
