// parallel-pacer: watches this PC's CPU and free memory and the chats running on it,
// holds back heavy commands (installs, builds, tests, dev servers) when the PC is
// choked, and says how many more chats it can take.
//
// All chats share one reading through $.store: whichever chat finds the reading
// older than SAMPLE_MS takes the next one, so the sampler runs once per PC, not per chat.

const SAMPLE_MS = 30_000
const BEAT_MS = 20_000
const LIVE_MS = 60_000 // a chat with no heartbeat for this long is gone
const HEAVY_TTL_MS = 10 * 60_000 // a heavy command left in the background counts this long
const PASS_AFTER = 3 // denials within PASS_WINDOW before a command is let through anyway
const PASS_WINDOW_MS = 10 * 60_000

// Thresholds for a 16 GB laptop (i5-1235U). Free memory in GB, CPU in percent (smoothed).
const OVER = { freeGb: 2, cpu: 90 }
const TIGHT = { freeGb: 3.5, cpu: 75 }
const GB_PER_CHAT = 1 // a chat plus what it runs, roughly

const HEAVY =
  /\b(npm (i|install|ci|run (build|test|typecheck|dev|check))|pnpm (i|install|build|test|dev|typecheck)|yarn (install|build|test|dev)|tsc\b|vitest|jest|vite build|next build|wrangler dev|cargo (build|test)|docker build|playwright test)/i

type Load = { at: number; cpu: number; freeGb: number }
type Beat = { at: number; busy: boolean }
type Heavy = { at: number; cmd: string }
type Level = 'ok' | 'tight' | 'over'

const SAMPLE = [
  'powershell',
  '-NoProfile',
  '-Command',
  '$o=Get-CimInstance Win32_OperatingSystem;$c=(Get-CimInstance Win32_Processor|Measure-Object LoadPercentage -Average).Average;"$c $($o.FreePhysicalMemory)"',
]

// The words shown, in English or Japanese. With the language option on auto they follow
// Claude Code's own language setting ("japanese" and the like), else English.
const MESSAGES = {
  en: {
    level: { ok: 'calm', tight: 'tight', over: 'choked' } as Record<Level, string>,
    chats: (n: number) => `${n} chat${n === 1 ? '' : 's'}`,
    line: (chats: string, busy: number, cpu: number, free: number, lv: string, tail: string) => `${chats} (${busy} busy) · CPU ${cpu}% · ${free} GB free · ${lv}, ${tail}`,
    more: (n: number) => `room for ${n} more`,
    noMore: 'add no more',
    oneByOne: 'heavy work one at a time',
    toastOver: (cpu: number, free: number) => `This PC is choked (CPU ${cpu}%, ${free} GB free). Heavy work now runs one at a time. Start new chats on claude.ai/code`,
    toastTight: (cpu: number, free: number) => `This PC is getting tight (CPU ${cpu}%, ${free} GB free). Do not add more chats`,
    deny: (lv: string, cpu: number, free: number, heavy: number, after: number) =>
      `parallel-pacer: this PC is ${lv} (CPU ${cpu}%, ${free} GB free, ${heavy} heavy run(s) in other chats). ` +
      'Put this heavy command off, go on with other work first, and run the same command again in 1 to 2 minutes. ' +
      `After ${after} holds it is let through.`,
    note: (lv: string, cpu: number, free: number) =>
      `[parallel-pacer] This PC is ${lv} (CPU ${cpu}%, ${free} GB free). ` +
      'Run npm install, builds, tests, type checks and dev servers only as needed and one at a time, and stop a dev server once done. ' +
      'One subagent at a time, and no Workflow. Keep the whole request; make the way of doing it lighter. The user does not see this note.',
    cmdDesc: 'The parallel state (CPU, free memory, chats, heavy work). /para off stops the pacing, /para on brings it back',
    on: 'Pacing is back on',
    off: 'Pacing stopped (the status line goes too)',
    heavyLine: (others: number, own: number) => `Heavy work: ${others} in other chats, ${own} in this one`,
    rule: (t: typeof TIGHT, o: typeof OVER) => `Rule: tight = under ${t.freeGb} GB free or CPU ${t.cpu}%+ / choked = under ${o.freeGb} GB free or CPU ${o.cpu}%+`,
    pacing: (on: boolean) => `Pacing: ${on ? 'on' : 'off (/para on brings it back)'}`,
  },
  ja: {
    level: { ok: '余裕', tight: '詰まり気味', over: '詰まり' } as Record<Level, string>,
    chats: (n: number) => `並列 ${n}本`,
    line: (chats: string, busy: number, cpu: number, free: number, lv: string, tail: string) => `${chats}(動作${busy}) · CPU ${cpu}% · 空き ${free}GB · ${lv} ${tail}`,
    more: (n: number) => `あと${n}本可`,
    noMore: '増やさない',
    oneByOne: '重い処理は1本ずつ',
    toastOver: (cpu: number, free: number) => `PC が詰まっています（CPU ${cpu}%・空き ${free}GB）。重い処理を1本ずつに絞ります。新しい会話は claude.ai/code へ`,
    toastTight: (cpu: number, free: number) => `PC が詰まり気味です（CPU ${cpu}%・空き ${free}GB）。これ以上会話を増やさないでください`,
    deny: (lv: string, cpu: number, free: number, heavy: number, after: number) =>
      `parallel-pacer: この PC が${lv}です（CPU ${cpu}%・空き ${free}GB・他の会話で重い処理 ${heavy} 本）。` +
      'この重い処理は後回しにして、先に他の作業を進め、1〜2 分後に同じコマンドを再実行してください。' +
      `${after} 回止められた後は通します。`,
    note: (lv: string, cpu: number, free: number) =>
      `[parallel-pacer] この PC が${lv}です（CPU ${cpu}%・空き ${free}GB）。` +
      'npm install・ビルド・テスト・型チェック・dev server は必要な物だけを 1 本ずつ走らせ、終わった dev server は止めてください。' +
      'サブエージェントは 1 体ずつ、Workflow は使わないでください。依頼の範囲は削らず、やり方を軽くしてください。このメモはユーザーには見えていません。',
    cmdDesc: '並列の状態（CPU・空きメモリ・会話数・重い処理）を見る。/para off で調整を止め、/para on で戻す',
    on: '並列の調整を戻しました',
    off: '並列の調整を止めました（表示も消します）',
    heavyLine: (others: number, own: number) => `重い処理: 他の会話 ${others} 本・この会話 ${own} 本`,
    rule: (t: typeof TIGHT, o: typeof OVER) => `基準: 詰まり気味 = 空き ${t.freeGb}GB 未満か CPU ${t.cpu}% 以上 / 詰まり = 空き ${o.freeGb}GB 未満か CPU ${o.cpu}% 以上`,
    pacing: (on: boolean) => `調整: ${on ? 'オン' : 'オフ（/para on で戻す）'}`,
  },
}
let M = MESSAGES.en
// "japanese", "日本語", "ja-JP" → Japanese; anything else → English
const pickLang = (option: unknown, setting: unknown): 'en' | 'ja' => {
  const v = typeof option === 'string' && option !== 'auto' ? option : setting
  return typeof v === 'string' && /^(ja\b|ja[-_]|japanese|日本)/i.test(v.trim()) ? 'ja' : 'en'
}

let sid = ''
let lastLevel: Level | null = null
const denied: number[] = []

const level = (l: Load | undefined): Level =>
  !l ? 'ok' : l.freeGb < OVER.freeGb || l.cpu >= OVER.cpu ? 'over' : l.freeGb < TIGHT.freeGb || l.cpu >= TIGHT.cpu ? 'tight' : 'ok'

// How many more chats fit: memory gives the room, CPU caps it.
const room = (l: Load | undefined): number => {
  if (!l) return 0
  const byMem = Math.floor((l.freeGb - OVER.freeGb) / GB_PER_CHAT)
  const byCpu = l.cpu < 50 ? 3 : l.cpu < 65 ? 2 : l.cpu < TIGHT.cpu ? 1 : 0
  return Math.max(0, Math.min(byMem, byCpu))
}

async function sample($: any, at: number): Promise<Load | undefined> {
  const old = (await $.store.get('load')) as Load | undefined
  if (old && at - old.at < SAMPLE_MS) return old
  await $.store.set('load', { ...(old ?? { cpu: 0, freeGb: 16 }), at }) // claim the turn before the slow read
  try {
    const r = await $.process.run(SAMPLE, { timeoutMs: 15_000 })
    const [cpu, freeKb] = r.stdout.trim().split(/\s+/).map(Number)
    if (!Number.isFinite(cpu) || !Number.isFinite(freeKb)) return old
    // CPU load jumps from second to second; smooth it so one spike does not throttle
    const smooth = old && old.cpu > 0 ? Math.round(old.cpu * 0.5 + cpu * 0.5) : cpu
    const l = { at, cpu: smooth, freeGb: Math.round((freeKb / 1024 / 1024) * 10) / 10 }
    await $.store.set('load', l)
    return l
  } catch {
    return old
  }
}

async function scan($: any, at: number) {
  const keys: string[] = await $.store.keys()
  let chats = 0
  let busy = 0
  const heavy: Heavy[] = []
  for (const k of keys) {
    if (k.startsWith('s:')) {
      const b = (await $.store.get(k)) as Beat | undefined
      if (!b || at - b.at > LIVE_MS) await $.store.delete(k)
      else {
        chats++
        if (b.busy) busy++
      }
    } else if (k.startsWith('h:')) {
      const h = (await $.store.get(k)) as Heavy | undefined
      if (!h || at - h.at > HEAVY_TTL_MS) await $.store.delete(k)
      else if (!k.startsWith(`h:${sid}:`)) heavy.push(h)
    }
  }
  return { chats, busy, heavy }
}

function line(l: Load | undefined, chats: number, busy: number): string {
  if (!l) return M.chats(chats)
  const lv = level(l)
  const more = room(l)
  const tail = lv === 'ok' ? (more > 0 ? M.more(more) : M.noMore) : M.oneByOne
  return M.line(M.chats(chats), busy, l.cpu, l.freeGb, M.level[lv], tail)
}

async function beat($: any, busy?: boolean) {
  const at = await $.clock.now()
  const old = (await $.store.get(`s:${sid}`)) as Beat | undefined
  await $.store.set(`s:${sid}`, { at, busy: busy ?? old?.busy ?? false })
  const l = await sample($, at)
  const s = await scan($, at)
  if ((await $.store.get('manage')) === false) {
    $.ui.status(undefined)
    return
  }
  $.ui.status(line(l, s.chats, s.busy))
  const lv = level(l)
  if (lastLevel !== null && lv !== lastLevel && lv !== 'ok')
    $.ui.toast(
      lv === 'over' ? M.toastOver(l!.cpu, l!.freeGb) : M.toastTight(l!.cpu, l!.freeGb),
    )
  lastLevel = lv
}

// Hold back a heavy command while others are running and the PC is choked
async function gate($: any, e: any, next: any) {
  const cmd: string = e.command ?? ''
  if (!HEAVY.test(cmd) || (await $.store.get('manage')) === false) return next(e)
  const at = await $.clock.now()
  const l = (await $.store.get('load')) as Load | undefined
  const lv = level(l)
  const { heavy } = await scan($, at)
  const limit = lv === 'over' ? 1 : lv === 'tight' ? 2 : Infinity
  while (denied.length && at - denied[0] > PASS_WINDOW_MS) denied.shift()
  if (heavy.length >= limit && denied.length < PASS_AFTER) {
    denied.push(at)
    return {
      deny: M.deny(M.level[lv], l!.cpu, l!.freeGb, heavy.length, PASS_AFTER),
    }
  }
  const key = `h:${sid}:${e.tool_use_id ?? at}`
  await $.store.set(key, { at, cmd: HEAVY.exec(cmd)?.[0] ?? '' } /* the kind of command only: arguments may carry secrets */)
  try {
    return await next(e)
  } finally {
    // a background run keeps its slot until HEAVY_TTL_MS; a foreground one frees it now
    if (!e.run_in_background) await $.store.delete(key)
  }
}

export function register(on: any, options: { language?: string } = {}) {
  on('session.start', async ($: any, e: any, next: any) => {
    const started = await next(e)
    const settings = await $.settings.read().catch(() => ({}))
    M = MESSAGES[pickLang(options.language, settings?.language)]
    sid = await $.session.id()
    await $.command.register({ name: 'para', description: M.cmdDesc })
    await beat($, false)
    $.clock.every(BEAT_MS, () => beat($))
    return started
  })

  on('turn.start', async ($: any, e: any, next: any) => {
    const r = await next(e)
    await beat($, true)
    return r
  })

  on('turn.complete', async ($: any, e: any, next: any) => {
    const r = await next(e)
    await beat($, false)
    return r
  })

  on('session.end', async ($: any, e: any, next: any) => {
    if (sid) await $.store.delete(`s:${sid}`)
    return next(e)
  })

  // A note only the model reads, when the PC is choked
  on('prompt.submit', async ($: any, e: any, next: any) => {
    if ((await $.store.get('manage')) === false) return next(e)
    const l = (await $.store.get('load')) as Load | undefined
    const lv = level(l)
    if (lv === 'ok') return next(e)
    const note = M.note(M.level[lv], l!.cpu, l!.freeGb)
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('tool.call', { tool: 'Bash' }, gate)
  on('tool.call', { tool: 'PowerShell' }, gate)

  on('command.run', { command: 'para' }, async ($: any, e: any) => {
    const arg = String(e.args ?? '').trim()
    if (arg === 'off' || arg === 'on') {
      await $.store.set('manage', arg === 'on')
      await beat($)
      return { text: arg === 'on' ? M.on : M.off }
    }
    const at = await $.clock.now()
    const l = await sample($, at)
    const s = await scan($, at)
    const own = (await $.store.keys()).filter((k: string) => k.startsWith(`h:${sid}:`)).length
    const heavy = [...s.heavy.map((h) => h.cmd)]
    return {
      text: [
        line(l, s.chats, s.busy),
        M.heavyLine(s.heavy.length, own),
        ...heavy.map((c) => `  - ${c}`),
        M.rule(TIGHT, OVER),
        M.pacing((await $.store.get('manage')) !== false),
      ].join('\n'),
    }
  })
}
