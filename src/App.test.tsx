// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  localStorage.clear()
  // Successful empty IDB reads distinguish first use from an unavailable store.
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: Record<string, unknown> = {}
      request.result = {
        close() {},
        transaction() {
          const transaction: Record<string, unknown> = {}
          transaction.objectStore = () => ({ get: () => ({ result: undefined }), put() {} })
          queueMicrotask(() => (transaction.oncomplete as () => void)?.())
          return transaction
        },
      }
      queueMicrotask(() => (request.onsuccess as () => void)?.())
      return request
    },
  })
  // jsdom has no Web Locks. Real cross-tab ownership is tested in browser E2E.
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, _options: LockOptions, callback: LockGrantedCallback<void>) =>
        callback({} as Lock),
    },
  })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  let id = 0
  vi.stubGlobal('crypto', { randomUUID: () => `test-id-${++id}` })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('core journey', () => {
  it('launches empty, captures a task, completes it, undoes it, and snoozes it', async () => {
    render(<App />)
    expect(await screen.findByText('今すぐ対応するものはありません')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^追加$/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'やること・予定' }), {
      target: { value: '数学プリント金曜まで' },
    })
    expect(screen.getByText('数学プリント')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Todayに追加' }))
    expect(await screen.findByRole('heading', { name: '数学プリント' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '完了にする' }))
    await waitFor(() => expect(screen.getByText('完了・整理済み')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(await screen.findByRole('heading', { name: '数学プリント' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^詳細$/ }))
    fireEvent.click(screen.getByRole('button', { name: '明日まで保留' }))
    await waitFor(() => expect(screen.getByText('あとで見る')).toBeTruthy())
  })
  it('continues local capture while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    render(<App />)
    expect(await screen.findByText('オフラインで利用中')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^追加$/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'やること・予定' }), {
      target: { value: 'Pick up milk' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Todayに追加' }))
    expect(await screen.findByRole('heading', { name: 'Pick up milk' })).toBeTruthy()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })
})
