/** Y-axis domain helpers for temperature trend charts (INSTRUCTION-493). */
export const TEMP_DOMAIN_PAD_C = 0.5

export function tempDomainMin(dataMin: number): number {
  return Number.isFinite(dataMin) ? Math.floor(dataMin - TEMP_DOMAIN_PAD_C) : 0
}

export function tempDomainMax(dataMax: number): number {
  return Number.isFinite(dataMax) ? Math.ceil(dataMax + TEMP_DOMAIN_PAD_C) : 1
}

export const tempDomain: [(dataMin: number) => number, (dataMax: number) => number] =
  [tempDomainMin, tempDomainMax]
