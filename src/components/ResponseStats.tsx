import { Timer } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { GenerationMetrics } from '../llm-protocol'
import { interfaceLocale, tr } from '../utils/i18n'
function positionTooltip(tooltip: HTMLSpanElement, anchor: HTMLButtonElement) {
  const rect = anchor.getBoundingClientRect()
  const width = tooltip.offsetWidth, height = tooltip.offsetHeight
  tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
  const above = rect.top - height - 10
  tooltip.style.top = `${Math.max(8, Math.min(above >= 8 ? above : rect.bottom + 10, window.innerHeight - height - 8))}px`
}
export function ResponseStats({ metrics }: { metrics: GenerationMetrics }) {
  const tooltipId = useId()
  const card = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const show = () => {
    const tooltip = card.current, anchor = button.current
    if (!tooltip || !anchor) return
    tooltip.showPopover()
    positionTooltip(tooltip, anchor)
  }
  const hide = () => card.current?.hidePopover()
  useEffect(() => {
    const resize = () => { if (card.current?.matches(':popover-open') && button.current) positionTooltip(card.current, button.current) }
    const scroll = () => card.current?.hidePopover()
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('scroll', scroll, true) }
  }, [])
  const value = (number: number | null, suffix = '') => number === null || !Number.isFinite(number) ? '—' : new Intl.NumberFormat(interfaceLocale(), { maximumFractionDigits: 2 }).format(number) + suffix
  const reason = { stop: 'Fin de réponse', eos: 'Fin de réponse (EOS)', interrupted: 'Arrêt demandé', length: 'Limite de tokens', tool_calls: 'Appel d’outil', unknown: 'Non disponible' }[metrics.finishReason] ?? metrics.finishReason
  return <span className="response-stats" onMouseLeave={() => { if (document.activeElement !== button.current) hide() }}>
    <button ref={button} type="button" aria-label={tr('Statistiques de la réponse')} aria-describedby={tooltipId} onMouseEnter={show} onFocus={show} onBlur={hide} onKeyDown={event => { if (event.key === 'Escape') hide() }}><Timer size={15} strokeWidth={1.6} /></button>
    <span ref={card} popover="manual" className="response-stats-card" id={tooltipId} role="tooltip">
      {[[tr('Tokens par seconde'), metrics.tokensPerSecond > 0 ? value(metrics.tokensPerSecond, ' tok/s') : '—'],
        [tr('Tokens générés'), metrics.tokens > 0 ? value(metrics.tokens) : '—'], [tr('Tokens d’entrée'), value(metrics.promptTokens)],
        [tr('Temps de réponse'), value(metrics.elapsedMs / 1000, ' s')], [tr('Premier token'), value(metrics.firstTokenMs === null ? null : metrics.firstTokenMs / 1000, ' s')],
        [tr('Raison d’arrêt'), tr(reason)]].map(([label, result]) => <span key={label}><span>{label}</span><strong>{result}</strong></span>)}
    </span>
  </span>
}
