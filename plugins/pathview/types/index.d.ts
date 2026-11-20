// One list per placed row: the paths, and `*` for the whole list, whose fold
// was turned from where it starts.
export type ToggledPaths = string[]

// The paths a placed row lists, as its reply typed them, each with the line
// number written after it there.
export type ListedPaths = { typed: string; line?: number }[]

declare module 'claude-code' {
  interface PluginState {
    pathview: { toggled: StateFamily<ToggledPaths>; listed: StateFamily<ListedPaths> }
  }
}
