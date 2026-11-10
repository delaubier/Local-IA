/** Overall loading progress. The file budget is fixed before transfers start;
 * session creation and GPU warmup are included, so downloads never mean ready. */
export class ModelLoadProgress {
  private files = new Map<string, { weight: number; fraction: number }>()
  private value = 0

  constructor(files: { file: string; size?: number }[]) {
    const hasAllSizes = files.every(({ size }) => Number.isFinite(size) && size! > 0)
    for (const { file, size } of files) {
      this.files.set(file, { weight: hasAllSizes ? size! : 1, fraction: 0 })
    }
  }

  update(event: { file?: string; status?: string; loaded?: number; total?: number; progress?: number }) {
    const file = event.file ? this.files.get(event.file) : undefined
    if (!file) return this.value
    const fraction = event.status === 'done' ? 1
      : event.total && event.total > 0 ? (event.loaded ?? 0) / event.total
      : (event.progress ?? 0) / 100
    if (Number.isFinite(fraction)) file.fraction = Math.max(file.fraction, Math.min(1, Math.max(0, fraction)))
    let completed = 0
    let total = 0
    for (const item of this.files.values()) {
      completed += item.weight * item.fraction
      total += item.weight
    }
    this.value = Math.max(this.value, total ? 0.9 * completed / total : 0)
    return this.value
  }

  preparing() { this.value = Math.max(this.value, 0.95); return this.value }
  ready() { this.value = 1; return this.value }
}
