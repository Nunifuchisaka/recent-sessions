import { atom, read, update } from 'claude-code'
import type { McpToolResult, Register } from 'claude-code'

import type { SessionRow } from '../types'

const PANE = 'recent-sessions'
const TITLE = '最近の使用'
const REFRESH_MS = 30000

const sessions = atom({ plugin: 'recent-sessions', key: 'sessions' } as const, [], {
  shape: 'sessions-1',
})
const error = atom({ plugin: 'recent-sessions', key: 'error' } as const, null)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const folderOf = (cwd: string): string => {
  if (cwd.includes('scratch-workspaces')) return 'フォルダなし'
  const parts = cwd.split(/[\\/]+/).filter(part => part !== '')

  return parts[parts.length - 1] ?? cwd
}

const payloadOf = (result: McpToolResult): unknown => {
  if (result.structuredContent !== undefined) return result.structuredContent
  const block = result.content[0]
  if (block?.text === undefined) return undefined

  return JSON.parse(block.text)
}

const rowsOf = (payload: unknown): SessionRow[] => {
  // structuredContent は配列そのものか、配列を包んだオブジェクトのどちらかで来うる
  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.sessions)
      ? payload.sessions
      : undefined
  if (list === undefined) throw new Error('list_sessions の結果が配列ではありません')

  const rows: SessionRow[] = []
  for (const item of list) {
    if (!isRecord(item) || typeof item.sessionId !== 'string') continue
    const cwd = typeof item.cwd === 'string' ? item.cwd : ''
    const row: SessionRow = {
      id: item.sessionId,
      title: typeof item.title === 'string' && item.title !== '' ? item.title : '(無題)',
      folder: folderOf(cwd),
      isRunning: item.isRunning === true,
      lastActivityAt: typeof item.lastActivityAt === 'string' ? item.lastActivityAt : '',
    }
    if (typeof item.link === 'string' && item.link !== '') row.link = item.link
    rows.push(row)
  }

  return rows.sort(
    (a, b) => (Date.parse(b.lastActivityAt) || 0) - (Date.parse(a.lastActivityAt) || 0),
  )
}

const ago = (now: number, iso: string): string => {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const minutes = Math.floor((now - at) / 60000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  if (hours < 48) return '昨日'

  return `${Math.floor(hours / 24)}日前`
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const fetchSessions = async (): Promise<void> => {
      try {
        const result = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { limit: 20 })
        if (result.isError) {
          const text = result.content.map(block => block.text ?? '').join('\n').trim()
          await update($, error, () => `セッション一覧の取得に失敗しました: ${text || '不明なエラー'}`)
          return
        }
        await update($, sessions, () => rowsOf(payloadOf(result)))
        await update($, error, () => null)
      } catch (cause) {
        await update($, error, () => `セッション一覧の取得に失敗しました: ${messageOf(cause)}`)
      }
    }

    await $.command.register({
      name: 'recent-sessions',
      description: '最近使ったセッションの一覧をパネルに表示する',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    await fetchSessions()
    $.clock.every(REFRESH_MS, () => {
      void fetchSessions()
    })

    return next(e)
  })

  on('command.run', { command: 'recent-sessions' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '最近の使用パネルを開きました。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, sessions)
    const failure = await read($, error)
    const now = await $.clock.now()
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)

    // デスクトップ面は claude:// の Link をリンクにしないため、OS のプロトコル登録経由で開く
    const openSession = async (link: string): Promise<void> => {
      try {
        const ran = await $.process.run(['rundll32', 'url.dll,FileProtocolHandler', link], {
          timeoutMs: 10000,
        })
        if (ran.exitCode !== 0) $.ui.toast(`セッションを開けませんでした（終了コード ${ran.exitCode}）`)
      } catch (cause) {
        $.ui.toast(`セッションを開けませんでした: ${messageOf(cause)}`)
      }
    }

    return (
      <Box flexDirection="column">
        {failure !== null && <Text color="error">{failure}</Text>}
        {failure === null && list.length === 0 && (
          <Text dimColor>他のセッションはありません</Text>
        )}
        {list.slice(0, room).map(row => {
          const mark = row.isRunning ? '● ' : ''
          const meta = <Text dimColor> {row.folder} · {ago(now, row.lastActivityAt)}</Text>
          const link = row.link

          return link === undefined ? (
            <Text wrap="truncate-end">
              {mark}
              {row.title}
              {meta}
            </Text>
          ) : (
            // 実行時の Button は文字列ラベルしか受け付けないため、薄字の補足は横に並べる
            <Box flexDirection="row">
              <Button
                key={row.id}
                label={`${mark}${row.title}`}
                plain
                onPress={() => void openSession(link)}
              />
              <Text wrap="truncate-end">{meta}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
