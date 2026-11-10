/** Synchronous lifecycle, independent of React render snapshots. */
export class GenerationRun {
  id = 0
  active = false
  private stopSent = false
  start() {
    this.id++
    this.active = true
    this.stopSent = false
    return this.id
  }
  accepts(id?: number) { return id === this.id && this.active }
  finish() { this.active = false }
  requestStop() {
    if (!this.active || this.stopSent) return false
    this.stopSent = true
    return true
  }
}

export function isCurrentInterrupt(activeId: number | null, requestedId: number) {
  return activeId !== null && activeId === requestedId
}
