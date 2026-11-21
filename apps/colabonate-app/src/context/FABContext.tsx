import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
export interface FABAction {
  id: string
  label: string
  info?: string
  group: string
  icon?: 'plus' | 'briefcase' | 'package' | 'handshake' | 'bot'
  onClick: () => void
}

interface FABContextValue {
  actions: FABAction[]
  setActions: (actions: FABAction[]) => void
  clear: () => void
}

const FABContext = createContext<FABContextValue | null>(null)

export function FABProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<FABAction[]>([])

  const clear = useCallback(() => setActions([]), [])

  return (
    <FABContext.Provider value={{ actions, setActions, clear }}>
      {children}
    </FABContext.Provider>
  )
}

export function useFABActions(): FABContextValue {
  const ctx = useContext(FABContext)
  if (!ctx) throw new Error('useFABActions must be used within FABProvider')
  return ctx
}
