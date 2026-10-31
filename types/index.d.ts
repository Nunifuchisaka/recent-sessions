export type SessionRow = {
  id: string
  title: string
  folder: string
  link?: string
  isRunning: boolean
  lastActivityAt: string
}

declare module 'claude-code' {
  interface PluginState {
    'recent-sessions': {
      sessions: Shaped<SessionRow[]>
      error: string | null
      fetchedAt: number | null
    }
  }
}
