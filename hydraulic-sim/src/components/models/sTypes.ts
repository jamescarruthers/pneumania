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
