import { useEffect, useRef } from 'react'
import type { LocalMicRecorder } from '../utils/localAudio'
import { tr } from '../utils/i18n'
export function DictationVisualizer({ recorder }: { recorder: LocalMicRecorder }) {
  const bars = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const clock = { frame: 0, last: 0 }
    const history = Array<number>(64).fill(0)
    const update = (now: number) => {
      if (now - clock.last > 65) {
        history.shift(); history.push(recorder.waveformLevel())
        bars.current?.querySelectorAll<HTMLElement>('i').forEach((bar, i) => { bar.style.height = `${2 + history[i] * 32}px` })
        clock.last = now
      }
      clock.frame = requestAnimationFrame(update)
    }
    clock.frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(clock.frame)
  }, [recorder])
  return <div className="dictation-visualizer"><div ref={bars} className="dictation-bars" role="img" aria-label={tr('Forme d’onde du microphone')}>{Array.from({ length: 64 }, (_, i) => <i key={i} />)}</div></div>
}
