export type Settings = {
  enabled: boolean
  sound: boolean
  volume: number
  soundName: string
  speak: boolean
  speakDone: string
  speakAsk: string
  notifyPermission: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'baton-notify': { settings: Settings; lastSent: string }
  }
}
