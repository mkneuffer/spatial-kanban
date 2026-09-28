import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'warn'
  action?: { label: string; run: () => void }
}

interface ToastState {
  toasts: Toast[]
  push(t: Omit<Toast, 'id'>, ms?: number): number
  dismiss(id: number): void
}

let nextId = 1

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push(t, ms = 4000) {
    const id = nextId++
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] })
    if (ms > 0) setTimeout(() => get().dismiss(id), ms)
    return id
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

export function toast(message: string, opts: { tone?: Toast['tone']; action?: Toast['action']; ms?: number } = {}) {
  return useToasts.getState().push({ message, tone: opts.tone ?? 'info', action: opts.action }, opts.ms)
}
