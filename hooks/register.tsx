import { atom, read, update } from 'claude-code'
import type { McpToolResult, Register, Timer } from 'claude-code'

import type { SessionRow } from '../types'

const PANE = 'recent-sessions'
const TITLE = '最近の使用'
const REFRESH_MS = 30000
// 起動直後は ccd_session_mgmt が未接続で失敗しうるため、失敗が続く間は短い間隔から試し直す
const RETRY_MS = [3000, 5000, 10000]
const MARK_COLUMNS = 2

const sessions = atom({ plugin: 'recent-sessions', key: 'sessions' } as const, [], {
  shape: 'sessions-1',
})
const error = atom({ plugin: 'recent-sessions', key: 'error' } as const, null)
const fetchedAt = atom({ plugin: 'recent-sessions', key: 'fetchedAt' } as const, null)

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

const clockOf = (ms: number): string => {
  const at = new Date(ms)

  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u

const cellsOf = (ch: string): number => (WIDE.test(ch) ? 2 : 1)

const fit = (text: string, columns: number): string => {
  const chars = Array.from(text)
  if (chars.reduce((sum, ch) => sum + cellsOf(ch), 0) <= columns) return text
  let used = 0
  let out = ''
  for (const ch of chars) {
    if (used + cellsOf(ch) > columns - 1) break
    used += cellsOf(ch)
    out += ch
  }

  return `${out}…`
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    let timer: Timer | undefined
    let isFetching = false
    let failures = 0

    const fail = async (reason: string): Promise<void> => {
      failures += 1
      await update($, error, () => reason)
    }

    const fetchSessions = async (): Promise<void> => {
      if (isFetching) return
      isFetching = true
      try {
        const result = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { limit: 20 })
        if (result.isError) {
          const text = result.content.map(block => block.text ?? '').join(' ').trim()
          await fail(text || '不明なエラー')
          return
        }
        const rows = rowsOf(payloadOf(result))
        const at = await $.clock.now()
        await update($, sessions, () => rows)
        await update($, fetchedAt, () => at)
        await update($, error, () => null)
        failures = 0
      } catch (cause) {
        await fail(messageOf(cause))
      } finally {
        isFetching = false
        schedule()
      }
    }

    // 次の取得は今の取得が終わってから仕掛けるので、タイマーが重なって走ることはない
    const schedule = (): void => {
      timer?.cancel()
      const delay = failures === 0 ? REFRESH_MS : (RETRY_MS[failures - 1] ?? REFRESH_MS)
      timer = $.clock.after(delay, () => {
        void fetchSessions()
      })
    }

    await $.command.register({
      name: 'recent-sessions',
      description: '最近使ったセッションの一覧をパネルに表示する',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    await fetchSessions()

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
    const lastFetchedAt = await read($, fetchedAt)
    const now = await $.clock.now()
    const columns = Math.max(MARK_COLUMNS + 2, e.props.bodyColumns)
    const isEmpty = list.length === 0
    const headerRows = 2 + (failure !== null && !isEmpty ? 1 : 0)
    const room = Math.max(1, Math.floor((e.props.scroll.bodyRows - headerRows) / 3))
    const shown = list.slice(0, room)

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
        <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <Text bold wrap="truncate-end">
            {TITLE} · {list.length} 件
          </Text>
          {lastFetchedAt !== null && <Text dimColor> 更新 {clockOf(lastFetchedAt)}</Text>}
        </Box>
        {failure !== null && !isEmpty && (
          <Text dimColor wrap="truncate-end">
            一覧を更新できません（再試行中）: {failure}
          </Text>
        )}
        {failure !== null && isEmpty && (
          <Box flexDirection="column">
            <Text color="error">一覧を更新できません（再試行中）</Text>
            <Text dimColor wrap="truncate-end">
              {failure}
            </Text>
          </Box>
        )}
        {failure === null && isEmpty && <Text dimColor>他のセッションはありません</Text>}
        {shown.map((row, index) => {
          const link = row.link
          const title = fit(row.title, columns - MARK_COLUMNS)

          return (
            <Box
              key={`row:${row.id}`}
              flexDirection="column"
              marginBottom={index < shown.length - 1 ? 1 : 0}
            >
              <Box flexDirection="row">
                {/* 実行時の Button は文字列ラベルしか受け付けないため、色付きの ● は外の Text に置く */}
                <Text color="success">{row.isRunning ? '● ' : '  '}</Text>
                {link === undefined ? (
                  <Text wrap="truncate-end">{title}</Text>
                ) : (
                  <Button key={row.id} label={title} plain onPress={() => void openSession(link)} />
                )}
              </Box>
              <Box paddingLeft={4}>
                <Text dimColor wrap="truncate-end">
                  {row.folder} · {ago(now, row.lastActivityAt)}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
