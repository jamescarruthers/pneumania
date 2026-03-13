/**
 * S-type (Signal) component update functions.
 * Controllers, switches, user inputs.
 */

import type { ComponentInstance, SimParams } from '../../solver/types';

// ============================================================
// Push Button (S-type)
// ============================================================

export function updatePushButton(
  comp: ComponentInstance,
  params: SimParams
): void {
  const responseTime = comp.params.response_time ?? 0.05;
  const pressed = comp.state.pressed ?? 0;
  const target = pressed > 0.5 ? 1.0 : 0.0;

  let spool = comp.state.spool_position ?? 0;
  spool += (params.dt / responseTime) * (target - spool);
  comp.state.spool_position = spool;
}

// ============================================================
// Toggle Switch (S-type)
// ============================================================

export function updateToggleSwitch(
  comp: ComponentInstance,
  params: SimParams
): void {
  const responseTime = comp.params.response_time ?? 0.05;
  const positions = comp.params.position_count ?? 2;
  const toggleState = comp.state.toggle_state ?? 0;

  let target: number;
  if (positions === 2) {
    target = toggleState > 0.5 ? 1.0 : 0.0;
  } else {
    // 3-position: -1, 0, 1
    target = Math.round(toggleState) ;
    target = Math.max(-1, Math.min(1, target));
  }

  let spool = comp.state.spool_position ?? 0;
  spool += (params.dt / responseTime) * (target - spool);
  comp.state.spool_position = spool;
}

// ============================================================
// Slider Control (S-type)
// ============================================================

export function updateSliderControl(
  _comp: ComponentInstance,
  _params: SimParams
): void {
  // Slider value is set directly by UI, no dynamics needed
  // comp.state.value is updated by UI interaction
}

// ============================================================
// Oscillating Force (S-type)
// Generates a time-varying force signal (e.g. road surface input).
// Waveforms: 0 = sine, 1 = square, 2 = triangle, 3 = random
// ============================================================

export function updateOscillatingForce(
  comp: ComponentInstance,
  params: SimParams
): void {
  const amplitude = comp.params.amplitude ?? 1000;    // N
  const frequency = comp.params.frequency ?? 5;        // Hz
  const waveform = comp.params.waveform ?? 0;          // 0=sine, 1=square, 2=triangle, 3=random
  const offset = comp.params.offset ?? 0;              // N (DC offset)

  const phase = (params.time * frequency) % 1.0; // 0–1 normalised phase

  let signal: number;
  switch (waveform) {
    case 1: // square
      signal = phase < 0.5 ? 1.0 : -1.0;
      break;
    case 2: // triangle
      signal = phase < 0.5
        ? 4.0 * phase - 1.0
        : 3.0 - 4.0 * phase;
      break;
    case 3: { // random (sample-and-hold at each cycle)
      // Use a simple deterministic hash seeded by cycle count for reproducibility
      const cycle = Math.floor(params.time * frequency);
      const prevCycle = comp.state.random_cycle ?? -1;
      if (cycle !== prevCycle) {
        // Generate new random value at each new cycle
        const seed = Math.imul(cycle, 2654435761); // Knuth multiplicative hash
        comp.state.random_value = ((seed & 0x7fffffff) / 0x7fffffff) * 2 - 1; // -1 to 1
        comp.state.random_cycle = cycle;
      }
      signal = comp.state.random_value ?? 0;
      break;
    }
    default: // sine
      signal = Math.sin(2 * Math.PI * phase);
      break;
  }

  comp.state.force_value = offset + amplitude * signal;
}
