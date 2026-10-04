export type SlashCommand = { name: string; desc: string; isFavorite: boolean }

export type FeatureKey = 'todo' | 'notify' | 'usage' | 'commands'

export type Prefs = { isHidden: boolean; commands: SlashCommand[]; features: Record<FeatureKey, boolean> }

declare module 'claude-code' {
  interface PluginState {
    status: { isOpen: boolean; prefs: Prefs; candidates: { name: string; desc: string }[]; available: string[]; recent: string[] }
  }
}
