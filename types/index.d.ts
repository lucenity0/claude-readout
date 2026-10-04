/** Why a call failed, by its tool_use_id: `blocked by seatbelt`, `File does not exist`. */
export type Reasons = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    readout: { reasons: Reasons }
  }
}
