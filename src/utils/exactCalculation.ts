const PERCENT_REQUEST = /^(?:(?:calcule(?: exactement)?|combien font|calculate(?: exactly)?|what is)\s+)?(-?\d{1,12}(?:[.,]\d{1,6})?)\s*%\s*(de|of)\s*(-?\d{1,12}(?:[.,]\d{1,6})?)(\s*€)?[?!.]?(?:\s*(?:donne seulement le montant\s+)?(arrondi au centime|rounded to the nearest cent)[?!.]?)?$/i

function decimal(value: string) {
  const [whole, fraction = ''] = value.split(/[.,]/)
  return { digits: BigInt(whole + fraction), scale: fraction.length }
}

/** Resolve only standalone, unambiguous percentages. The rest goes to the model. */
export function exactPercentage(request: string): string | undefined {
  const match = request.trim().match(PERCENT_REQUEST)
  if (!match) return
  const [, rateText, connector, amountText, euros, rounded] = match
  const french = connector.toLowerCase() === 'de'
  if (!french && [rateText, amountText].some(text => text.includes(','))) return
  const rate = decimal(rateText)
  const amount = decimal(amountText)
  const signed = rate.digits * amount.digits
  let value = signed < 0n ? -signed : signed
  let scale = rate.scale + amount.scale + 2
  if (rounded) {
    const divisor = 10n ** BigInt(scale - 2)
    value = (value + divisor / 2n) / divisor
    scale = 2
  }
  const digits = value.toString().padStart(scale + 1, '0')
  const fraction = rounded ? digits.slice(-scale) : digits.slice(-scale).replace(/0+$/, '')
  const sign = signed < 0n && value !== 0n ? '−' : ''
  return sign + digits.slice(0, -scale) + (fraction ? (french ? ',' : '.') + fraction : '') + (euros ? ' €' : '')
}
