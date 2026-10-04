export type Display = {
  show: boolean
  fiveHour: boolean
  sevenDay: boolean
  others: boolean
  reset: boolean
  cost: boolean
  context: boolean
}

declare module 'claude-code' {
  interface PluginState {
    u: { display: Display }
  }
}
