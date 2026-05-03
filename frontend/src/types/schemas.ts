/**
 * INSTRUCTION-150E V2 E-H3 / V3 150E-V2-M3:
 *
 * Zod schemas mirroring the TypeScript interfaces in `api.ts` /
 * `config.ts`. TypeScript types erase at runtime; Zod is the right tool
 * for asserting that a payload from the network matches the contract.
 *
 * These schemas are LOAD-BEARING in production: `useLive()` applies
 * `cycleSnapshotSchema.safeParse()` to every WebSocket payload and keeps
 * its last-known-good snapshot when parsing fails (rather than
 * propagating a malformed payload to component consumers).
 *
 * Schemas are written using the standard `z.object().passthrough()` style
 * — extra fields the backend adds in a future release pass through, but
 * required fields produce a parse failure that the consumer can act on.
 */
import { z } from 'zod'

export const fuelSchema = z.enum(['electricity', 'gas', 'lpg', 'oil'])

export const providerKindSchema = z.enum([
  'octopus_electricity',
  'octopus_gas',
  'edf_freephase',
  'fixed',
  'fallback',
  'ha_entity',  // 159A: parity with qsh/tariff/__init__.py SUPPORTED_PROVIDER_KINDS (158B); also the matching ProviderKind union in api.ts (158C).
])

export const providerStatusSchema = z.object({
  fuel: fuelSchema,
  provider_kind: providerKindSchema,
  last_refresh_at: z.number().nullable(),
  stale: z.boolean(),
  last_price: z.number(),
  source_url: z.string().nullable(),
  last_error: z.string().nullable(),
  tariff_label: z.string().nullable(),
})

// V2 E-H1: backend sends a partial map (only fuels in the install).
// `z.partialRecord` matches the TypeScript Partial<Record<Fuel, ProviderStatus>>
// — keys are optional, values fully validated when present.
const tariffProvidersStatusSchema = z.partialRecord(fuelSchema, providerStatusSchema)

/**
 * Schema for the WebSocket cycle snapshot. Mirrors `CycleMessage` in api.ts.
 *
 * Only the fields 150E touches are validated tightly; the rest are
 * `.passthrough()` so backend-side additions don't break the parse. The
 * schema's job is to gate `tariff_providers_status` /
 * `available_provider_kinds`, not to mirror every field of the payload.
 */
export const cycleSnapshotSchema = z
  .object({
    type: z.enum(['cycle', 'keepalive']),
    timestamp: z.number().optional(),
    cycle_number: z.number().optional(),
    tariff_providers_status: tariffProvidersStatusSchema.optional(),
    available_provider_kinds: z.array(providerKindSchema).optional(),
  })
  .passthrough()

export const testOctopusResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  tariff_code: z.string().nullable().optional(),
  additional_import_tariffs: z.array(z.string()).optional(),
  export_tariff: z.string().nullable().optional(),
  account_number: z.string().optional(),
  gas_tariff_code: z.string().nullable().optional(),
})

export const testEdfRegionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
})
