import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { makeBackup, mergeBackup } from './backup'
import {
  activeApplication,
  configureOptionalAI,
  configureOptionalRemoteIntelligence,
  intelligenceRouter,
  loadInitialState,
  saveApplicationState,
  scenarioModeLabel,
} from './application/composition'
import { addCorrection } from './domain/context-engine'
import { AIAssistance } from './AIAssistance'
import { IntelligenceSettings } from './IntelligenceSettings'
import { ShadowSettings } from './ShadowSettings'
import { PluginSettings } from './PluginSettings'
import { RelationAssist } from './RelationAssist'
import { ConnectedServices, type CalendarUi } from './ConnectedServices'
import { parseCapture, shouldUseAI, toLocalInputValue } from './capture'
import { demoItems, makeManualItem, manualActions } from './data'
import { ingestSourcePlugin } from './extensions/source-plugin'
import { readingClubPlugin } from './extensions/reading-club-plugin'
import { dateLabel, matchesQuery } from './format'
import { actionPolicy } from './orchestration'
import { plugins, assertPluginAction } from './plugins'
import { enqueueRemoteAction, replayQueue } from './sync'
import { Navigation, type TodayView } from './Navigation'
import { Daylight, TodaySurface } from './TodaySurface'
import { Icon, ModalFrame } from './ui'
import type { Item, ItemAction, PersistedState } from './types'

type Sheet = 'add' | 'settings' | null
type Toast = { message: string; undo?: Item }

function App() {
  const [state, setState] = useState<PersistedState | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ item: Item; action: ItemAction } | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<TodayView>('today')
  const [expanded, setExpanded] = useState(false)
  const [captureText, setCaptureText] = useState('')
  const [quickText, setQuickText] = useState('')
  const [captureKind, setCaptureKind] = useState<'task' | 'event' | null>(null)
  const [captureDate, setCaptureDate] = useState<string | null>(null)
  const [captureImportant, setCaptureImportant] = useState<boolean | null>(null)
  const [captureError, setCaptureError] = useState('')
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiInterpretation, setAiInterpretation] = useState<{
    input: string
    result: ReturnType<typeof parseCapture>
  } | null>(null)
  const [aiWaiting, setAiWaiting] = useState(false)
  const [aiError, setAiError] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editKind, setEditKind] = useState<'task' | 'event'>('task')
  const [editDate, setEditDate] = useState('')
  const [draft, setDraft] = useState('')
  const [toast, setToast] = useState<Toast | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [calendarUi, setCalendarUi] = useState<CalendarUi>({
    configured: false,
    connection: 'disconnected',
    phase: 'loading',
  })
  const [mailUi, setMailUi] = useState<CalendarUi>({
    configured: false,
    connection: 'disconnected',
    phase: 'loading',
  })
  const [clock, setClock] = useState(() => new Date())
  const theme = state?.theme
  const searchRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const syncingRef = useRef(false)
  const calendarBusyRef = useRef(false)
  const mailBusyRef = useRef(false)
  const stateRef = useRef(state)
  const navigationPendingRef = useRef(false)
  const quickCaptureRef = useRef(false)
  stateRef.current = state

  useLayoutEffect(() => {
    if (navigationPendingRef.current) {
      navigationPendingRef.current = false
      document.getElementById('view-heading')?.focus()
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [view])

  useEffect(() => {
    loadInitialState()
      .then(setState)
      .catch(() =>
        setState({ version: 3, items: [], queuedActions: [], theme: 'system', showSamples: false }),
      )
  }, [])
  useEffect(() => {
    const result = new URLSearchParams(location.search).get('gmail')
    if (result === 'cancelled') setToast({ message: 'Gmail の接続はキャンセルされました。' })
    if (result === 'failed')
      setToast({ message: 'Gmail の認証を完了できませんでした。権限と設定を確認してください。' })
    if (result === 'connected')
      setToast({ message: 'Gmail に接続しました。必要な情報を確認しています。' })
    if (result) {
      const url = new URL(location.href)
      url.searchParams.delete('gmail')
      history.replaceState(null, '', url)
    }
  }, [])
  useEffect(() => {
    if (online)
      configureOptionalAI()
        .then(() => activeApplication.aiAvailable())
        .then(setAiAvailable)
        .catch(() => setAiAvailable(false))
  }, [online])
  useEffect(() => {
    if (online) void configureOptionalRemoteIntelligence()
  }, [online])
  useLayoutEffect(() => {
    if (state)
      saveApplicationState(state)
        .then(() => setSaveError(false))
        .catch(() => setSaveError(true))
  }, [state])
  useEffect(() => {
    intelligenceRouter.policy.mode = state?.intelligenceMode || 'LOCAL_ONLY'
    intelligenceRouter.policy.remoteEnabled = [
      'LOCAL_REMOTE_FALLBACK',
      'REMOTE_LOCAL_FALLBACK',
      'PREFER_LOCAL',
      'CUSTOM_ONLY',
    ].includes(state?.intelligenceMode || '')
    intelligenceRouter.policy.localPrivateRemoteConsent = state?.remotePrivateConsent === true
  }, [state?.intelligenceMode, state?.remotePrivateConsent])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    const timer = window.setInterval(() => setClock(new Date()), 60_000)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    if (!theme) return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      document.documentElement.dataset.theme =
        theme === 'dark' || (theme === 'system' && media.matches) ? 'dark' : 'light'
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [theme])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5500)
    return () => clearTimeout(timer)
  }, [toast])
  const modalOpen = !!(sheet || detailId || confirm)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!modalOpen && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modalOpen])
  useEffect(() => {
    if (
      !state ||
      !online ||
      syncingRef.current ||
      !state.queuedActions.some((entry) => entry.status === 'pending')
    )
      return
    syncingRef.current = true
    replayQueue(state, plugins)
      .then((result) => {
        setState(
          (current) =>
            current && {
              ...current,
              queuedActions: result.state.queuedActions,
              items: current.items.map((item) => {
                const updated = result.state.items.find((candidate) => candidate.id === item.id)
                return updated ? { ...item, syncStatus: updated.syncStatus } : item
              }),
            },
        )
        if (result.failed)
          setToast({
            message: `${result.failed}件の操作を同期できませんでした。内容は端末に残っています。`,
          })
        else if (result.completed)
          setToast({ message: `${result.completed}件の操作を同期しました` })
      })
      .finally(() => {
        syncingRef.current = false
      })
  }, [online, state])

  const refreshCalendar = useCallback(async () => {
    if (calendarBusyRef.current) return
    calendarBusyRef.current = true
    setCalendarUi((current) => ({ ...current, phase: 'refreshing' }))
    try {
      const payload = await activeApplication.refreshCalendar([])
      setState(
        (current) =>
          current && {
            ...current,
            items: activeApplication.mergeCalendar(current.items, payload.items),
            calendarSyncedAt: payload.fetchedAt,
          },
      )
      setCalendarUi((current) => ({
        ...current,
        connection: 'connected',
        phase: 'synced',
        error: payload.truncated ? '一部の予定を取得できませんでした' : undefined,
      }))
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'request_failed'
      setCalendarUi((current) => ({
        ...current,
        connection: reason === 'AUTH_EXPIRED' ? 'expired' : current.connection,
        phase: 'stale',
        error: reason,
      }))
    } finally {
      calendarBusyRef.current = false
    }
  }, [])

  const refreshMail = useCallback(async () => {
    if (mailBusyRef.current || !navigator.onLine) return
    const before = stateRef.current
    if (!before) return
    mailBusyRef.current = true
    const cursor = before.syncCursors?.['mail.gmail']
    setMailUi((current) => ({ ...current, phase: 'refreshing' }))
    try {
      const page = await activeApplication.fetchMailPage(cursor)
      setState((current) =>
        current && current.syncCursors?.['mail.gmail']?.opaque === cursor?.opaque
          ? activeApplication.applyMailPage(current, page)
          : current,
      )
      setMailUi((current) => ({
        ...current,
        connection: 'connected',
        phase: 'synced',
        error: page.truncated ? '取得上限に達しました' : undefined,
      }))
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'UNKNOWN'
      setMailUi((current) => ({
        ...current,
        connection:
          reason === 'AUTH_EXPIRED' || reason === 'AUTH_REQUIRED' ? 'expired' : current.connection,
        phase: 'stale',
        error: reason,
      }))
    } finally {
      mailBusyRef.current = false
    }
  }, [])

  const ready = !!state
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const check = async () => {
      if (!online) {
        setMailUi((current) => ({ ...current, phase: 'offline' }))
        return
      }
      try {
        const provider = await activeApplication.mailStatus()
        if (cancelled) return
        const connection =
          provider.state === 'AUTH_EXPIRED'
            ? ('expired' as const)
            : provider.state === 'CONNECTED'
              ? ('connected' as const)
              : ('disconnected' as const)
        setMailUi({
          configured: provider.configured,
          connection,
          phase:
            connection === 'connected'
              ? 'refreshing'
              : connection === 'expired' ||
                  stateRef.current?.items.some((item) => item.sourceId === 'mail.gmail')
                ? 'stale'
                : 'idle',
        })
        setState(
          (current) =>
            current && {
              ...current,
              providerStates: { ...current.providerStates, 'mail.gmail': provider.state },
            },
        )
        if (connection === 'connected') await refreshMail()
      } catch {
        if (!cancelled) setMailUi((current) => ({ ...current, phase: 'failed' }))
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [ready, online, refreshMail])
  useEffect(() => {
    if (!online || mailUi.connection !== 'connected') return
    const check = () => {
      if (document.visibilityState === 'visible') void refreshMail()
    }
    const timer = window.setInterval(check, 10 * 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [mailUi.connection, online, refreshMail])
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const check = async () => {
      if (!online) {
        setCalendarUi((current) => ({ ...current, phase: 'offline' }))
        return
      }
      try {
        const provider = await activeApplication.calendarStatus()
        if (cancelled) return
        const status = {
          configured: provider.configured,
          connection:
            provider.state === 'AUTH_EXPIRED'
              ? ('expired' as const)
              : provider.state === 'CONNECTED'
                ? ('connected' as const)
                : ('disconnected' as const),
        }
        setCalendarUi({
          ...status,
          phase: !status.configured
            ? 'stale'
            : status.connection === 'connected'
              ? 'refreshing'
              : 'idle',
        })
        setState(
          (current) =>
            current && {
              ...current,
              providerStates: { ...current.providerStates, 'calendar.google': provider.state },
            },
        )
        if (status.configured && status.connection === 'disconnected')
          setState((current) =>
            current && current.items.some((item) => item.sourceId === 'google-calendar')
              ? {
                  ...current,
                  items: current.items.filter((item) => item.sourceId !== 'google-calendar'),
                  calendarSyncedAt: undefined,
                }
              : current,
          )
        if (status.connection === 'connected') await refreshCalendar()
      } catch {
        if (!cancelled) setCalendarUi((current) => ({ ...current, phase: 'failed' }))
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [ready, online, refreshCalendar])
  useEffect(() => {
    if (!online || calendarUi.connection !== 'connected') return
    const check = () => {
      if (document.visibilityState === 'visible') void refreshCalendar()
    }
    const timer = window.setInterval(check, 10 * 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [calendarUi.connection, online, refreshCalendar])
  useEffect(() => {
    const local = parseCapture(captureText, clock)
    if (sheet !== 'add' || !state?.aiEnabled || !aiAvailable || !shouldUseAI(captureText, local)) {
      setAiWaiting(false)
      return
    }
    const controller = new AbortController()
    setAiWaiting(true)
    setAiError(false)
    const timer = window.setTimeout(() => {
      activeApplication
        .interpretCapture(
          captureText,
          {
            localTime: new Date().toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          controller.signal,
        )
        .then((value) => {
          if (controller.signal.aborted) return
          setAiInterpretation({
            input: captureText,
            result: {
              title: value.title,
              kind: value.intent,
              date: value.date || undefined,
              importance: value.importance,
              confidence: value.confidence,
              sourceText: captureText.trim(),
            },
          })
        })
        .catch(() => {
          if (!controller.signal.aborted) setAiError(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setAiWaiting(false)
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [captureText, sheet, state?.aiEnabled, aiAvailable, clock])

  const sourceItems = state?.items
  const savedCorrections = state?.contextCorrections
  const savedResolutions = state?.conflictResolutions
  useEffect(() => {
    if (!sourceItems) return
    const items = sourceItems
    const corrections = savedCorrections || []
    const resolutions = savedResolutions || []
    const timer = window.setTimeout(() => {
      const { contexts } = activeApplication.reconcile(items, corrections, resolutions)
      setState((current) =>
        current &&
        current.items === items &&
        JSON.stringify(current.contexts || []) !== JSON.stringify(contexts)
          ? { ...current, contexts }
          : current,
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [sourceItems, savedCorrections, savedResolutions])
  const model = useMemo(
    () =>
      state
        ? activeApplication.buildToday(
            state.items.filter((item) => !item.demo || state.showSamples),
            state.contexts || [],
            clock,
          )
        : {
            items: [],
            priorities: [],
            usedFallback: false,
            contexts: [],
            sourceItems: [],
            compressionRatio: 1,
          },
    [state, clock],
  )
  const rankById = useMemo(
    () => new Map(model.priorities.map((rank) => [rank.itemId, rank])),
    [model.priorities],
  )
  const active = model.items.filter(
    (item) => item.status === 'active' && matchesQuery(item, query, clock),
  )
  const sorted = active.sort(
    (a, b) => (rankById.get(b.id)?.priorityScore || 0) - (rankById.get(a.id)?.priorityScore || 0),
  )
  const attention = query
    ? sorted
    : sorted.filter((item) => rankById.get(item.id)?.layer !== 'later')
  const later = query ? [] : sorted.filter((item) => rankById.get(item.id)?.layer === 'later')
  const completed = model.items
    .filter((item) => item.status === 'done' || item.status === 'dismissed')
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
  const detail =
    model.items.find((item) => item.id === detailId) ||
    state?.items.find((item) => item.id === detailId)
  const contextDetail = detail?.contextId
    ? model.contexts.find((context) => context.id === detail.contextId)
    : undefined
  const contextMembers =
    contextDetail?.itemRefs
      .map((id) => state?.items.find((item) => item.id === id))
      .filter((item): item is Item => !!item) || []
  const upcoming = model.items
    .filter(
      (item) =>
        item.status === 'active' &&
        item.startAt &&
        (item.allDay || new Date(item.startAt).getTime() >= clock.getTime() - 7_200_000) &&
        new Date(item.startAt).toDateString() === clock.toDateString(),
    )
    .sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime())
    .slice(0, 3)
  const today = new Intl.DateTimeFormat('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(clock)
  const parsedCapture = parseCapture(captureText, clock)
  const effectiveCapture =
    aiInterpretation?.input === captureText ? aiInterpretation.result : parsedCapture
  const selectedKind = captureKind || effectiveCapture.kind
  const suggestedDate =
    selectedKind === 'event' && effectiveCapture.kind !== 'event'
      ? ''
      : toLocalInputValue(effectiveCapture.date)
  const selectedDate = captureDate ?? suggestedDate
  const selectedImportant = captureImportant ?? effectiveCapture.importance === 3

  function navigate(next: TodayView) {
    if (next === view) {
      document.getElementById('view-heading')?.focus()
      window.scrollTo({ top: 0, behavior: 'auto' })
    } else navigationPendingRef.current = true
    setView(next)
    setExpanded(false)
  }
  function openCapture(text?: string) {
    quickCaptureRef.current = text !== undefined
    setCaptureText(text ?? '')
    setCaptureKind(null)
    setCaptureDate(null)
    setCaptureImportant(null)
    setCaptureError('')
    setAiInterpretation(null)
    setSheet('add')
  }
  function restoreItem(item: Item) {
    changeItem(
      item,
      (value) => ({
        ...value,
        status: 'active',
        snoozedUntil: undefined,
        lastUpdated: new Date().toISOString(),
      }),
      '項目を戻しました',
    )
  }
  function openDetail(item: Item) {
    setDetailId(item.id)
    setEditing(false)
    setEditTitle(item.title)
    setEditDescription(item.description)
    setEditKind(item.kind === 'event' ? 'event' : 'task')
    setEditDate(toLocalInputValue(item.startAt || item.deadline))
    if (item.kind === 'email')
      setDraft('ご連絡ありがとうございます。内容を確認して、改めてご連絡します。')
  }
  function changeItem(item: Item, updater: (value: Item) => Item, message: string, close = false) {
    setState(
      (current) =>
        current && {
          ...current,
          items: current.items.map((candidate) =>
            candidate.id === item.id ? updater(candidate) : candidate,
          ),
        },
    )
    setToast({ message, undo: item })
    if (close) setDetailId(null)
  }
  function completeItem(item: Item) {
    changeItem(
      item,
      (value) => ({ ...value, status: 'done', lastUpdated: new Date().toISOString() }),
      '完了にしました',
      true,
    )
  }
  function snoozeItem(item: Item) {
    const until = new Date()
    until.setDate(until.getDate() + 1)
    until.setHours(9, 0, 0, 0)
    changeItem(
      item,
      (value) => ({
        ...value,
        snoozedUntil: until.toISOString(),
        lastUpdated: new Date().toISOString(),
      }),
      '明日9:00まで保留しました',
      true,
    )
  }
  function handleAction(item: Item, action: ItemAction) {
    const policy = actionPolicy(item, action)
    if (policy === 'blocked') {
      setToast({ message: 'この操作は利用できません。項目はそのまま残っています。' })
      return
    }
    if (policy === 'local') {
      completeItem(item)
      return
    }
    if (policy === 'prepare' || policy === 'read') {
      openDetail(item)
      return
    }
    setConfirm({ item, action })
  }
  async function executeRemote() {
    if (!confirm || !state || busy) return
    const { item, action } = confirm
    try {
      assertPluginAction(plugins[item.sourceId], action)
      if (!online) {
        setState((current) => current && enqueueRemoteAction(current, item, action))
        setToast({ message: '操作は端末に保存されました。接続後に再試行します。' })
      } else {
        setBusy(true)
        await plugins[item.sourceId].executeAction(action, item, crypto.randomUUID())
        setToast({ message: '操作を完了しました' })
      }
      setConfirm(null)
    } catch {
      setToast({ message: '操作を実行できませんでした。項目はそのまま残っています。' })
    } finally {
      setBusy(false)
    }
  }
  function addItem(event: FormEvent) {
    event.preventDefault()
    if (!state || !captureText.trim()) return
    if (selectedKind === 'event' && !selectedDate) {
      setCaptureError('予定の開始時刻を選んでください。入力内容は保持されています。')
      return
    }
    const title = effectiveCapture.title.trim() || captureText.trim()
    const capture = { ...effectiveCapture, title, kind: selectedKind }
    try {
      const item = makeManualItem(capture, selectedDate || undefined, selectedImportant)
      setState((current) => current && { ...current, items: [item, ...current.items] })
      if (quickCaptureRef.current) setQuickText('')
      setCaptureText('')
      setCaptureKind(null)
      setCaptureDate(null)
      setCaptureImportant(null)
      setCaptureError('')
      setAiInterpretation(null)
      setSheet(null)
      setToast({ message: 'Todayに追加しました' })
    } catch {
      setCaptureError('日時を確認してください。入力内容は保持されています。')
    }
  }
  function saveEditedItem(event: FormEvent) {
    event.preventDefault()
    if (!detail || !editTitle.trim()) return
    if (editKind === 'event' && !editDate) return
    const timestamp = new Date().toISOString()
    changeItem(
      detail,
      (value) => ({
        ...value,
        title: editTitle.trim(),
        description: editDescription.trim(),
        kind: editKind,
        deadline: editKind === 'task' && editDate ? new Date(editDate).toISOString() : undefined,
        startAt: editKind === 'event' && editDate ? new Date(editDate).toISOString() : undefined,
        requiresAction: editKind === 'task',
        actions: manualActions(editKind),
        lastUpdated: timestamp,
        sourceUpdatedAt: timestamp,
        confidence: 'high',
      }),
      '変更を保存しました',
    )
    setEditing(false)
  }
  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft)
      setToast({ message: '返信案をコピーしました。送信は行っていません。' })
    } catch {
      setToast({ message: 'コピーできませんでした。文章を選択してコピーしてください。' })
    }
  }
  async function showSamples() {
    const sample = await ingestSourcePlugin(readingClubPlugin, ['LOCAL_SAMPLE'])
    setState(
      (current) =>
        current && {
          ...current,
          items: [...current.items.filter((item) => !item.demo), ...demoItems(), ...sample.items],
          showSamples: true,
        },
    )
    setToast({
      message:
        sample.state === 'CONNECTED'
          ? 'サンプルの一日を表示しました'
          : 'サンプルを一部表示しました',
    })
  }
  async function connectCalendar() {
    try {
      const result = await activeApplication.connectCalendar()
      const destination = new URL(result.url)
      if (destination.origin !== 'https://accounts.google.com')
        throw new Error('invalid_destination')
      window.location.assign(destination.toString())
    } catch {
      setToast({ message: 'Google Calendarに接続できませんでした。設定を確認してください。' })
    }
  }
  async function disconnectCalendar() {
    try {
      const result = await activeApplication.disconnectCalendar()
      setState(
        (current) =>
          current && {
            ...current,
            items: current.items.filter((item) => item.sourceId !== 'google-calendar'),
            calendarSyncedAt: undefined,
          },
      )
      setCalendarUi({
        configured: calendarUi.configured,
        connection: 'disconnected',
        phase: 'idle',
      })
      setToast({
        message: result.revoked
          ? '接続を解除し、保存済みの予定を消しました'
          : 'この端末の接続を解除しました。Google側の権限も確認してください。',
      })
    } catch {
      setToast({ message: '接続を解除できませんでした。予定は保持されています。' })
    }
  }
  async function connectMail() {
    try {
      const result = await activeApplication.connectMail()
      const destination = new URL(result.url)
      if (destination.origin !== 'https://accounts.google.com')
        throw new Error('invalid_destination')
      window.location.assign(destination.toString())
    } catch {
      setToast({ message: 'Gmail に接続できませんでした。設定を確認してください。' })
    }
  }
  async function disconnectMail() {
    try {
      const result = await activeApplication.disconnectMail()
      setState((current) => {
        if (!current) return current
        const items = current.items.filter((item) => item.sourceId !== 'mail.gmail')
        const syncCursors = { ...current.syncCursors }
        delete syncCursors['mail.gmail']
        return {
          ...current,
          items,
          contexts: activeApplication.reconcile(
            items,
            current.contextCorrections,
            current.conflictResolutions,
          ).contexts,
          mailSyncedAt: undefined,
          syncCursors,
          providerStates: { ...current.providerStates, 'mail.gmail': 'DISCONNECTED' },
        }
      })
      setMailUi((current) => ({ ...current, connection: 'disconnected', phase: 'idle' }))
      setToast({
        message: result.revoked
          ? 'Gmail の接続を解除し、取得済みのメール情報をこの端末から削除しました。'
          : 'この端末の接続を解除しました。Google 側の権限も確認してください。',
      })
    } catch {
      setToast({
        message: 'Gmail の接続を解除できませんでした。保存済みの情報は保持されています。',
      })
    }
  }
  function exportBackup() {
    if (!state) return
    const content = makeBackup(state)
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `today-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setToast({ message: 'バックアップを書き出しました' })
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !state) return
    if (file.size > 5_000_000) {
      setToast({ message: 'ファイルが大きすぎます。データは変更していません。' })
      return
    }
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const result = mergeBackup(state, parsed)
      setState(result.state)
      setToast({
        message: `${result.added}件の項目を読み込みました。既存の項目は保持されています。`,
      })
    } catch {
      setToast({ message: 'バックアップを読み込めませんでした。データは変更していません。' })
    }
  }

  if (!state)
    return (
      <div className="loading-shell" role="status" aria-live="polite">
        <div className="loading-mark">
          <Icon name="check" size={28} />
        </div>
        <span>Todayを準備しています</span>
      </div>
    )

  return (
    <div className="app-shell">
      <Daylight />
      <a className="skip-link" href="#view-heading">
        本文へ移動
      </a>
      <Navigation
        view={view}
        inert={modalOpen}
        onNavigate={navigate}
        onAdd={() => openCapture()}
        onSettings={() => setSheet('settings')}
      />
      <main className="main" inert={modalOpen}>
        <TodaySurface
          view={view}
          today={today}
          clock={clock}
          online={online}
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setExpanded(false)
          }}
          searchRef={searchRef}
          items={model.items.filter((item) => matchesQuery(item, query, clock))}
          attention={attention}
          later={later}
          completed={completed.filter((item) => matchesQuery(item, query, clock))}
          upcoming={upcoming}
          rankById={rankById}
          expanded={expanded}
          onExpand={setExpanded}
          onAction={handleAction}
          onDetail={openDetail}
          onRestore={restoreItem}
          onAdd={openCapture}
          quickText={quickText}
          onQuickText={setQuickText}
          onSettings={() => setSheet('settings')}
          onShowSamples={showSamples}
          showSamples={state.showSamples}
          canShowSamples={!state.showSamples && !state.items.some((item) => item.demo)}
          scenario={scenarioModeLabel}
          notices={
            <>
              {saveError && (
                <div className="error-banner" role="alert">
                  保存できませんでした。入力はこの画面に残っています。ブラウザの保存設定を確認してください。
                </div>
              )}
              {state.items.some((item) => item.sourceId === 'google-calendar') &&
                ['stale', 'offline', 'failed'].includes(calendarUi.phase) && (
                  <p className="calendar-notice" role="status">
                    Google Calendar の予定は前回取得した内容です。
                    {state.calendarSyncedAt && (
                      <>
                        最終更新{' '}
                        {new Intl.DateTimeFormat('ja-JP', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        }).format(new Date(state.calendarSyncedAt))}
                        。
                      </>
                    )}
                    {calendarUi.connection === 'expired' && '設定から再接続してください。'}
                  </p>
                )}
              {state.items.some((item) => item.sourceId === 'mail.gmail') &&
                ['stale', 'offline', 'failed'].includes(mailUi.phase) && (
                  <p className="calendar-notice" role="status">
                    Gmail 由来の情報は前回取得した内容です。
                    {state.mailSyncedAt && (
                      <>
                        最終更新{' '}
                        {new Intl.DateTimeFormat('ja-JP', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        }).format(new Date(state.mailSyncedAt))}
                        。
                      </>
                    )}
                    {mailUi.connection === 'expired' && '設定から再接続してください。'}
                  </p>
                )}
            </>
          }
        />
      </main>

      {sheet === 'add' && (
        <ModalFrame title="すばやく追加" onClose={() => setSheet(null)}>
          <form onSubmit={addItem} className="form">
            <p className="modal-intro">
              やることをそのまま入力。「数学プリント金曜まで」のように書けます。
            </p>
            <label className="field">
              <span>やること・予定</span>
              <input
                autoFocus
                value={captureText}
                onChange={(event) => {
                  setCaptureText(event.target.value)
                  setCaptureDate(null)
                  setCaptureImportant(null)
                  setAiInterpretation(null)
                  setAiError(false)
                  setCaptureError('')
                }}
                placeholder="例：数学プリント金曜まで"
                maxLength={200}
                required
              />
            </label>
            {captureText.trim() && (
              <p className="capture-preview">
                解釈: <strong>{effectiveCapture.title}</strong>
                {selectedDate && (
                  <> · {dateLabel(new Date(selectedDate).toISOString(), selectedKind, clock)}</>
                )}
                {aiWaiting && <span> · 解釈を補っています…</span>}
                {aiError && <span> · 通常の入力解析で追加できます</span>}
              </p>
            )}
            <div className="segmented" role="group" aria-label="種類">
              <button
                type="button"
                className={selectedKind === 'task' ? 'selected' : ''}
                aria-pressed={selectedKind === 'task'}
                onClick={() => {
                  setCaptureKind('task')
                  setCaptureError('')
                }}
              >
                タスク
              </button>
              <button
                type="button"
                className={selectedKind === 'event' ? 'selected' : ''}
                aria-pressed={selectedKind === 'event'}
                onClick={() => {
                  setCaptureKind('event')
                  setCaptureError('')
                }}
              >
                予定
              </button>
            </div>
            <label className="field">
              <span>
                {selectedKind === 'event' ? '開始時刻' : '期限'}{' '}
                <small>{selectedKind === 'event' ? '必須' : '任意'}</small>
              </span>
              <input
                type="datetime-local"
                value={selectedDate}
                onChange={(event) => {
                  setCaptureDate(event.target.value)
                  setCaptureError('')
                }}
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={selectedImportant}
                onChange={(event) => setCaptureImportant(event.target.checked)}
              />
              <span>重要な項目にする</span>
            </label>
            {captureError && (
              <p className="form-error" role="alert">
                {captureError}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="button button-text" onClick={() => setSheet(null)}>
                閉じる
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={!captureText.trim()}
              >
                Todayに追加
                <Icon name="arrow" size={17} />
              </button>
            </div>
          </form>
        </ModalFrame>
      )}

      {sheet === 'settings' && (
        <ModalFrame title="設定" onClose={() => setSheet(null)}>
          <div className="settings-body">
            <div className="setting-group">
              <h3>表示</h3>
              <div className="theme-options" role="group" aria-label="テーマ">
                <button
                  className={state.theme === 'system' ? 'selected' : ''}
                  aria-pressed={state.theme === 'system'}
                  onClick={() => setState((current) => current && { ...current, theme: 'system' })}
                >
                  自動
                </button>
                <button
                  className={state.theme === 'light' ? 'selected' : ''}
                  aria-pressed={state.theme === 'light'}
                  onClick={() => setState((current) => current && { ...current, theme: 'light' })}
                >
                  <Icon name="sun" size={16} />
                  ライト
                </button>
                <button
                  className={state.theme === 'dark' ? 'selected' : ''}
                  aria-pressed={state.theme === 'dark'}
                  onClick={() => setState((current) => current && { ...current, theme: 'dark' })}
                >
                  <Icon name="moon" size={16} />
                  ダーク
                </button>
              </div>
            </div>
            <ConnectedServices
              calendar={calendarUi}
              mail={mailUi}
              lastSyncedAt={state.calendarSyncedAt}
              mailSyncedAt={state.mailSyncedAt}
              online={online}
              onConnect={connectCalendar}
              onDisconnect={disconnectCalendar}
              onRefresh={() => void refreshCalendar()}
              onMailConnect={connectMail}
              onMailDisconnect={disconnectMail}
              onMailRefresh={() => void refreshMail()}
            />
            <IntelligenceSettings
              mode={state.intelligenceMode || 'LOCAL_ONLY'}
              onModeChange={(mode) =>
                setState((current) => current && { ...current, intelligenceMode: mode })
              }
              remotePrivateConsent={state.remotePrivateConsent === true}
              onRemotePrivateConsentChange={(enabled) =>
                setState((current) => current && { ...current, remotePrivateConsent: enabled })
              }
            />
            <ShadowSettings
              enabled={state.shadowEvaluationEnabled === true}
              onChange={(enabled) =>
                setState((current) => current && { ...current, shadowEvaluationEnabled: enabled })
              }
            />
            <PluginSettings sampleVisible={state.showSamples === true} />
            <AIAssistance
              configured={aiAvailable}
              enabled={state.aiEnabled === true}
              onChange={(enabled) =>
                setState((current) => current && { ...current, aiEnabled: enabled })
              }
            />
            <div className="setting-group">
              <h3>サンプル</h3>
              <p>実サービスには接続しない操作例です。手動で追加した項目には影響しません。</p>
              <button
                className="reset-button"
                onClick={() => {
                  if (state.showSamples)
                    setState((current) => current && { ...current, showSamples: false })
                  else if (state.items.some((item) => item.demo))
                    setState((current) => current && { ...current, showSamples: true })
                  else showSamples()
                }}
              >
                {state.showSamples ? 'サンプルを非表示' : 'サンプルを表示'}
              </button>
            </div>
            <div className="setting-group">
              <h3>データ</h3>
              <p>
                手動項目{' '}
                {state.items.filter((item) => item.sourceId === 'manual' && !item.demo).length}{' '}
                件。手動項目はこのブラウザに保存されます。AIは任意です。リモート処理は既定で無効で、送信にはプライバシー設定とサーバー側の許可が必要です。
              </p>
              {state.queuedActions.length > 0 && (
                <>
                  <p role="status">
                    同期待ち・失敗 {state.queuedActions.length} 件。内容は端末に残っています。
                  </p>
                  <button
                    className="reset-button"
                    onClick={() =>
                      setState(
                        (current) =>
                          current && {
                            ...current,
                            queuedActions: current.queuedActions.map((action) =>
                              action.status === 'conflict'
                                ? action
                                : { ...action, status: 'pending' as const },
                            ),
                          },
                      )
                    }
                    disabled={!online}
                  >
                    同期を再試行
                  </button>
                </>
              )}
            </div>
            <div className="setting-group">
              <h3>バックアップ</h3>
              <p>手動項目をJSONで保存・復元します。ファイルは外部へ送信されません。</p>
              <div className="backup-actions">
                <button className="reset-button" onClick={exportBackup}>
                  書き出す
                </button>
                <button className="reset-button" onClick={() => backupInputRef.current?.click()}>
                  読み込む
                </button>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={importBackup}
                  hidden
                  aria-label="バックアップファイル"
                />
              </div>
            </div>
            <div className="setting-group">
              <h3>このアプリ</h3>
              <p>Today V2.0.1 · オフラインでも手動項目と取得済みの情報を利用できます。</p>
            </div>
          </div>
        </ModalFrame>
      )}

      {detail?.contextId && contextDetail && (
        <ModalFrame title={contextDetail.canonicalTitle} onClose={() => setDetailId(null)} wide>
          <div className="detail-body">
            <p className="detail-description">
              {contextDetail.requirements.length
                ? `持ち物・準備: ${contextDetail.requirements.join('、')}`
                : `${contextMembers.length}件の関連情報`}
            </p>
            {contextDetail.conflicts.map((conflict) => (
              <div className="error-banner" role="status" key={conflict.id}>
                <p>
                  {conflict.resolutionState === 'USER_RESOLVED'
                    ? '確認した時刻を採用しています。元の情報も残しています。'
                    : '時刻に食い違いがあります。どちらか確認できます。'}
                </p>
                {conflict.candidates.map((fact) => (
                  <button
                    className="reset-button"
                    key={`${fact.provenance.providerId}:${fact.value}`}
                    aria-pressed={
                      conflict.chosen?.value === fact.value &&
                      conflict.chosen?.provenance.providerId === fact.provenance.providerId
                    }
                    onClick={() =>
                      setState(
                        (current) =>
                          current && {
                            ...current,
                            conflictResolutions: [
                              ...(current.conflictResolutions || []).filter(
                                (value) => value.conflictId !== conflict.id,
                              ),
                              {
                                conflictId: conflict.id,
                                providerId: fact.provenance.providerId,
                                externalId: fact.provenance.externalId,
                                value: fact.value,
                                updatedAt: new Date().toISOString(),
                              },
                            ],
                          },
                      )
                    }
                  >
                    {fact.provenance.sourceLabel}:{' '}
                    {fact.field === 'TIME'
                      ? new Date(fact.value).toLocaleTimeString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : fact.value}{' '}
                    を採用
                  </button>
                ))}
              </div>
            ))}
            <h3>関連する項目</h3>
            {contextMembers.map((item, index) => (
              <div className="context-member" key={item.id}>
                <button className="reset-button" onClick={() => openDetail(item)}>
                  {item.title} · {item.source}
                </button>
                {index > 0 && (
                  <button
                    className="button button-text"
                    onClick={() =>
                      setState(
                        (current) =>
                          current && {
                            ...current,
                            contextCorrections: addCorrection(
                              current.contextCorrections || [],
                              contextMembers[0].id,
                              item.id,
                              'separate',
                            ),
                          },
                      )
                    }
                  >
                    関連なし
                  </button>
                )}
              </div>
            ))}
            <details className="archive-section">
              <summary>別の項目を関連付ける</summary>
              {state.items
                .filter(
                  (item) => item.status === 'active' && !contextDetail.itemRefs.includes(item.id),
                )
                .slice(0, 8)
                .map((item) => (
                  <button
                    className="reset-button"
                    key={item.id}
                    onClick={() =>
                      setState(
                        (current) =>
                          current && {
                            ...current,
                            contextCorrections: addCorrection(
                              current.contextCorrections || [],
                              contextMembers[0].id,
                              item.id,
                              'link',
                            ),
                          },
                      )
                    }
                  >
                    {item.title}
                  </button>
                ))}
            </details>
            <div className="modal-actions">
              <button className="button button-text" onClick={() => setDetailId(null)}>
                閉じる
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
      {detail && !detail.contextId && (
        <ModalFrame title={detail.title} onClose={() => setDetailId(null)} wide>
          <div className="detail-body">
            <div className="detail-meta">
              <span>{detail.source}</span>
              {detail.demo && <span>サンプル</span>}
              {detail.syncStatus === 'failed' && <span>接続を確認</span>}
            </div>
            {editing && !detail.demo ? (
              <form onSubmit={saveEditedItem} className="form">
                <label className="field">
                  <span>項目名</span>
                  <input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    maxLength={200}
                    required
                  />
                </label>
                <div className="segmented" role="group" aria-label="種類">
                  <button
                    type="button"
                    className={editKind === 'task' ? 'selected' : ''}
                    aria-pressed={editKind === 'task'}
                    onClick={() => setEditKind('task')}
                  >
                    タスク
                  </button>
                  <button
                    type="button"
                    className={editKind === 'event' ? 'selected' : ''}
                    aria-pressed={editKind === 'event'}
                    onClick={() => setEditKind('event')}
                  >
                    予定
                  </button>
                </div>
                <label className="field">
                  <span>{editKind === 'event' ? '開始時刻' : '期限'}</span>
                  <input
                    type="datetime-local"
                    value={editDate}
                    onChange={(event) => setEditDate(event.target.value)}
                    required={editKind === 'event'}
                  />
                </label>
                <label className="field">
                  <span>メモ</span>
                  <textarea
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    rows={3}
                    maxLength={5000}
                  />
                </label>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button button-text"
                    onClick={() => setEditing(false)}
                  >
                    戻る
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={!editTitle.trim() || (editKind === 'event' && !editDate)}
                  >
                    保存
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="detail-description">{detail.description || '補足はありません。'}</p>
                {detail.originalInput && detail.originalInput !== detail.title && (
                  <p className="original-input">元の入力: {detail.originalInput}</p>
                )}
                {(detail.deadline || detail.startAt) && (
                  <div className="detail-row">
                    <Icon name="clock" size={18} />
                    <strong>
                      {dateLabel(
                        detail.deadline || detail.startAt,
                        detail.kind,
                        clock,
                        detail.allDay,
                      )}
                    </strong>
                  </div>
                )}
                {detail.snoozedUntil && new Date(detail.snoozedUntil) > clock && (
                  <div className="detail-row">
                    <Icon name="pause" size={18} />
                    <span>{dateLabel(detail.snoozedUntil, 'task', clock)}保留</span>
                  </div>
                )}
                <div className="detail-row freshness">
                  <Icon name="info" size={18} />
                  <span>
                    最終更新{' '}
                    {new Intl.DateTimeFormat('ja-JP', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(detail.sourceUpdatedAt))}
                  </span>
                </div>
                {detail.kind === 'email' && (
                  <div className="draft-area">
                    <label htmlFor="reply-draft">
                      返信案 <span>実際の送信は行いません</span>
                    </label>
                    <textarea
                      id="reply-draft"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={6}
                    />
                    <button
                      className="button button-secondary"
                      onClick={copyDraft}
                      disabled={!draft.trim()}
                    >
                      <Icon name="copy" size={16} />
                      返信案をコピー
                    </button>
                  </div>
                )}
                {detail.demo && (
                  <div className="demo-callout">
                    <Icon name="info" size={18} />
                    <span>サンプルです。実サービスへの接続はありません。</span>
                  </div>
                )}
                <RelationAssist
                  item={detail}
                  shadowEnabled={state.shadowEvaluationEnabled === true}
                  candidates={state.items
                    .filter((item) => item.status === 'active' && item.id !== detail.id)
                    .slice(0, 8)}
                  corrections={state.contextCorrections || []}
                  mode={state.intelligenceMode || 'LOCAL_ONLY'}
                  onLink={(item) =>
                    setState(
                      (current) =>
                        current && {
                          ...current,
                          contextCorrections: addCorrection(
                            current.contextCorrections || [],
                            detail.id,
                            item.id,
                            'link',
                          ),
                        },
                    )
                  }
                />
                <div className="item-controls">
                  <button
                    onClick={() =>
                      changeItem(
                        detail,
                        (value) => ({ ...value, pinned: !value.pinned }),
                        detail.pinned ? '固定を解除しました' : '最上位に固定しました',
                      )
                    }
                    aria-pressed={detail.pinned}
                  >
                    <Icon name="pin" size={17} />
                    {detail.pinned ? '固定を解除' : '固定する'}
                  </button>
                  {detail.snoozedUntil && new Date(detail.snoozedUntil) > clock ? (
                    <button
                      onClick={() =>
                        changeItem(
                          detail,
                          (value) => ({ ...value, snoozedUntil: undefined }),
                          '保留を解除しました',
                        )
                      }
                    >
                      <Icon name="pause" size={17} />
                      保留を解除
                    </button>
                  ) : (
                    <button onClick={() => snoozeItem(detail)}>
                      <Icon name="pause" size={17} />
                      明日まで保留
                    </button>
                  )}
                  {detail.sourceId === 'manual' && !detail.demo && (
                    <button onClick={() => setEditing(true)}>編集</button>
                  )}
                </div>
                <div className="importance-control">
                  <span>重要度</span>
                  {([1, 2, 3] as const).map((level) => (
                    <button
                      key={level}
                      className={detail.importance === level ? 'selected' : ''}
                      aria-pressed={detail.importance === level}
                      onClick={() =>
                        changeItem(
                          detail,
                          (value) => ({ ...value, importance: level }),
                          '重要度を変更しました',
                        )
                      }
                    >
                      {level === 1 ? '低' : level === 2 ? '普通' : '高'}
                    </button>
                  ))}
                </div>
                <div className="modal-actions">
                  {detail.status === 'active' && detail.kind !== 'event' && (
                    <button className="button button-primary" onClick={() => completeItem(detail)}>
                      <Icon name="check" size={17} />
                      対応済みにする
                    </button>
                  )}
                  {detail.status === 'active' && (
                    <button
                      className="button button-text"
                      onClick={() =>
                        changeItem(
                          detail,
                          (value) => ({ ...value, status: 'dismissed' }),
                          '一覧から外しました',
                          true,
                        )
                      }
                    >
                      一覧から外す
                    </button>
                  )}
                  <button className="button button-text" onClick={() => setDetailId(null)}>
                    閉じる
                  </button>
                </div>
              </>
            )}
          </div>
        </ModalFrame>
      )}

      {confirm && (
        <ModalFrame title="操作を確認" onClose={() => setConfirm(null)}>
          <div className="confirm-body">
            <p>
              <strong>{confirm.item.title}</strong> に対して「{confirm.action.label}」を実行します。
            </p>
            <p>外部操作には明示的な権限が必要です。</p>
            <div className="modal-actions">
              <button className="button button-text" onClick={() => setConfirm(null)}>
                キャンセル
              </button>
              <button className="button button-primary" onClick={executeRemote} disabled={busy}>
                {busy ? '実行中…' : '実行する'}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              onClick={() => {
                const previous = toast.undo!
                setState(
                  (current) =>
                    current && {
                      ...current,
                      items: current.items.map((item) =>
                        item.id === previous.id ? previous : item,
                      ),
                    },
                )
                setToast({ message: '元に戻しました' })
              }}
            >
              <Icon name="undo" size={16} />
              元に戻す
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default App
