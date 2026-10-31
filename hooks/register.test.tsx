import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-31T09:00:00.000Z')

const PANE = {
  plugin: 'recent-sessions',
  component: 'Pane',
  requestId: 'recent-sessions',
  props: {
    title: '最近の使用',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const ROWS = [
  {
    sessionId: 'local_a',
    title: 'FrostTouch の調整',
    cwd: 'E:\\Unity\\Develop\\Assets\\Nunifuchisaka\\FrostTouch',
    isArchived: false,
    isRunning: true,
    lastActivityAt: '2026-10-31T08:57:00.000Z',
    group: null,
    pinned: true,
    link: 'claude://claude.ai/epitaxy/local_a',
  },
  {
    sessionId: 'local_b',
    title: '雑談メモ',
    cwd: 'C:\\Users\\someone\\AppData\\Local\\Claude-Data\\scratch-workspaces\\x\\y',
    isArchived: false,
    isRunning: false,
    lastActivityAt: '2026-10-31T07:00:00.000Z',
    group: null,
  },
]

test('the pane lists other sessions, on terminal and desktop', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'recent-sessions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', () => ({
    value: { content: [{ type: 'text', text: JSON.stringify(ROWS) }], isError: false },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const button = await ui.find({ type: 'Button', key: 'local_a' })
    expect(button?.text).toMatch(/FrostTouch の調整/)
    expect(await ui.find({ type: 'Button', key: 'local_b' })).toBeUndefined()
    expect(await ui.find({ text: /FrostTouch · 3分前/ })).toBeDefined()
    expect(await ui.find({ text: /雑談メモ/ })).toBeDefined()
    expect(await ui.find({ text: /フォルダなし · 2時間前/ })).toBeDefined()
    expect(await ui.find({ text: /●/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a failed list_sessions call is shown, not swallowed', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'recent-sessions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', () => ({
    value: { content: [{ type: 'text', text: 'server not found' }], isError: true },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ text: /server not found/ })).toBeDefined()
  await ui.unmount()
})

test('with no other sessions the pane says so', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'recent-sessions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', () => ({
    value: { content: [{ type: 'text', text: '[]' }], isError: false },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('他のセッションはありません')
  await ui.unmount()
})

test('the list is fetched again every 30 seconds', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let calls = 0
  on('command.register', () => ({ value: { command: 'recent-sessions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', () => {
    calls += 1
    const rows = calls === 1 ? [] : [{ ...ROWS[0], title: '更新後の行' }]

    return { value: { content: [{ type: 'text', text: JSON.stringify(rows) }], isError: false } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(30000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(calls).toBe(2)
  expect(await ui.find({ text: /更新後の行/ })).toBeDefined()
  await ui.unmount()
})

test('pressing a row hands its claude:// link to the OS', async ($, on) => {
  mock.clock(on, { now: NOW })
  const runs: (readonly string[])[] = []
  on('command.register', () => ({ value: { command: 'recent-sessions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', () => ({
    value: { content: [{ type: 'text', text: JSON.stringify(ROWS) }], isError: false },
  }))
  on('process.run', (_, e) => {
    runs.push(e.argv)

    return {
      value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'local_a' })
    await ui.unmount()
  }

  expect(runs).toEqual([
    ['rundll32', 'url.dll,FileProtocolHandler', 'claude://claude.ai/epitaxy/local_a'],
    ['rundll32', 'url.dll,FileProtocolHandler', 'claude://claude.ai/epitaxy/local_a'],
  ])
})

test('a failed open is told with a toast', async ($, on) => {
  mock.clock(on, { now: NOW })
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'recent-sessions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('mcp.call', () => ({
    value: { content: [{ type: 'text', text: JSON.stringify(ROWS) }], isError: false },
  }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'local_a' })
  await ui.unmount()

  expect(toasts).toEqual(['セッションを開けませんでした（終了コード 1）'])
})
