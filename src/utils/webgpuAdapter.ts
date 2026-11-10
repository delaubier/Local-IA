type AdapterOptions = { powerPreference?: 'low-power' | 'high-performance'; [key: string]: unknown }

/** Windows Chromium ignores powerPreference and logs a warning (crbug.com/369219127). */
export function omitWindowsWebGPUPowerPreference() {
  if (typeof navigator === 'undefined' || !/Windows/i.test(navigator.userAgent)) return
  const gpu = (navigator as Navigator & { gpu?: {
    requestAdapter: (options?: AdapterOptions) => Promise<unknown>
  } }).gpu
  if (!gpu?.requestAdapter) return
  const requestAdapter = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = options => {
    if (!options || !('powerPreference' in options)) return requestAdapter(options)
    const { powerPreference: _ignored, ...otherOptions } = options
    return requestAdapter(otherOptions)
  }
}
