import { useEffect, useState } from 'react'
import { LocalMicRecorder } from '../utils/localAudio'
import { tr } from '../utils/i18n'

export function MicrophoneSettings({ deviceId, onChange, disabled }: {
  deviceId: string; onChange: (id: string) => void; disabled: boolean
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const media = navigator.mediaDevices

  useEffect(() => {
    if (!media) return
    let active = true
    const refresh = () => {
      void media.enumerateDevices().then(list => {
        if (active) setDevices(list.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default'))
      }).catch(() => {})
    }
    refresh()
    media.addEventListener('devicechange', refresh)
    return () => { active = false; media.removeEventListener('devicechange', refresh) }
  }, [media, ready])

  useEffect(() => {
    if (!testing || disabled) return
    const recorder = new LocalMicRecorder()
    let active = true
    let sample: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    void recorder.start(deviceId, false).then(() => {
      if (!active) return
      setReady(true)
      sample = setInterval(() => setLevel(recorder.waveformLevel()), 80)
      timeout = setTimeout(() => setTesting(false), 15000)
    }).catch(() => {
      if (active) { setError(true); setTesting(false) }
    })
    return () => {
      active = false
      clearInterval(sample)
      clearTimeout(timeout)
      recorder.cancel()
      setReady(false)
      setLevel(0)
    }
  }, [testing, deviceId, disabled])

  return <div className="settings-microphone">
    <label className="setting-field">
      <span>{tr('Microphone')}</span>
      <select value={deviceId} onChange={event => onChange(event.currentTarget.value)} disabled={disabled || testing}>
        <option value="">{tr('Par défaut du système')}</option>
        {deviceId && !devices.some(device => device.deviceId === deviceId) &&
          <option value={deviceId}>{tr('Microphone sélectionné indisponible')}</option>}
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${tr('Microphone')} ${index + 1}`}</option>)}
      </select>
    </label>
    <div className="settings-mic-test">
      <button type="button" className="import-model-button" disabled={disabled || !media}
        onClick={() => { setError(false); setTesting(!testing) }}>
        {tr(testing ? 'Arrêter le test' : 'Tester le microphone')}
      </button>
      {testing && (ready
        ? <meter min={0} max={1} value={level} aria-label={tr('Niveau du microphone')} />
        : <small role="status">{tr('Connexion au microphone…')}</small>)}
    </div>
    {error && <small role="alert">{tr('Impossible de tester le microphone. Vérifiez son accès dans Chrome.')}</small>}
  </div>
}
