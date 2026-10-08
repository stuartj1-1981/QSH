// INSTRUCTION-572B — the open-window inference mode (569B): what a stored
// section selects, what QSH runs for it, and what to store for a selection.
import type { WindowDetectionYaml, WindowInferenceMode } from '../types/config'

/** The three names of the mode, in the order that the chooser shows them. */
export const WINDOW_INFERENCE_MODES: readonly WindowInferenceMode[] = ['disabled', 'observe', 'act']

function isMap(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The mode that the chooser shows as selected for a stored section, or null
 *  when the section holds something that is not a mode. An absent section and
 *  a section with no mode key give 'disabled'. Null is given for a section
 *  that is not a map and for a mode that is not one of the three names: the
 *  Settings save and the wizard refuse those (qsh/window_inference.py), and
 *  with no mode selected the operator can select Off to correct the file. */
export function selectedInferenceMode(section: unknown): WindowInferenceMode | null {
  if (section === undefined || section === null) return 'disabled'
  if (!isMap(section)) return null
  if (!('inference' in section)) return 'disabled'
  const value = section.inference
  return WINDOW_INFERENCE_MODES.find((mode) => mode === value) ?? null
}

/** The mode that QSH runs for a stored section: the selected mode, and
 *  'disabled' for a stored value that is not a mode, as
 *  qsh/window_inference.py::resolve_inference_mode reads it. */
export function readInferenceMode(section: unknown): WindowInferenceMode {
  return selectedInferenceMode(section) ?? 'disabled'
}

/** The section to store for a mode: the stored keys, with the mode. The save
 *  replaces the section, so a stored key that is not sent is lost. A stored
 *  section that is not a map gives the mode only. */
export function writeInferenceMode(section: unknown, mode: WindowInferenceMode): WindowDetectionYaml {
  return { ...(isMap(section) ? section : {}), inference: mode }
}
