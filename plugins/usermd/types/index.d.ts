export type Open = boolean

declare module 'claude-code' {
  interface PluginState {
    usermd: { isOpen: Open }
  }
}
