export type Tier = 'today' | 'red' | 'yellow' | 'white' | 'waiting' | 'done'

export type TodoItem = { tier: Tier; num: string; project: string; title: string; from: Tier | null }

export type Board = { items: TodoItem[]; loadedAt: number; error: string | null }

declare module 'claude-code' {
  interface PluginState {
    'today': { board: Board; tab: Tier; flash: string; showBand: boolean }
  }
}
