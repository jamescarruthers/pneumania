/**
 * C-type (Capacitive) component TLM update functions.
 * These compute wave variables c and impedance Zc.
 */

import {
  type PortState,
  type SimParams,
  type FluidDef,
  type ComponentInstance,
  P_ATM,
} from '../../solver/types';
import {
  effectiveBulkModulus,
} from '../../fluid/properties';

// ============================================================
// Pressure Source (C-type)
// ============================================================

export function updatePressureSource(
  comp: ComponentInstance,
  ports: PortState[],
  _params: SimParams
): void {
  const portIdx = comp.portStartIndex;
  const pressure = comp.params.pressure ?? 150e5; // default 150 bar
  const port = ports[portIdx];

  // Ramp over several time steps at startup to avoid exciting high-frequency oscillations
  const rampSteps = comp.params.ramp_steps ?? 20;
  const rampCount = (comp.state.ramp_count ?? 0);
  const rampFactor = rampCount >= rampSteps ? 1.0 : rampCount / rampSteps;
  const p_eff = P_ATM + (pressure - P_ATM) * rampFactor;
  comp.state.ramp_count = rampCount + 1;

  // Near-zero impedance (ideal pressure source)
  const Zc = 1e3; // small but non-zero for numerical stability
  port.c = 2 * p_eff - (port.c || p_eff);
  port.Zc = Zc;
  port.p = p_eff;
  // q is determined by connected component
}

// ============================================================
// Tank / Reservoir (C-type)
// ============================================================

export function updateTank(
  comp: ComponentInstance,
  ports: PortState[],
  _params: SimParams
): void {
  const portIdx = comp.portStartIndex;
  const pressure = comp.params.pressure ?? P_ATM;
  const port = ports[portIdx];

  const Zc = 1e3;
  port.c = 2 * pressure - (port.c || pressure);
  port.Zc = Zc;
  port.p = pressure;
}

// ============================================================
// TLM Hydraulic Line (C-type) — lumped capacitive volume
// ============================================================

export function updateTlmLine(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  const p1 = ports[comp.portStartIndex];
  const p2 = ports[comp.portStartIndex + 1];
  const fluidId = comp.params.fluid_id ?? 0;
  const fluid = fluids[fluidId] || fluids[0];
  const volume = comp.params.volume ?? 1e-6; // 1 mL default

  // Use persistent internal pressure state instead of averaging port pressures
  let p_internal = comp.state.p_internal ?? P_ATM;
  const beta = effectiveBulkModulus(p_internal, fluid, params);
  const Zc = (beta * params.dt) / (2 * volume);

  // Pressure update from net flow
  const q_net = p1.q + p2.q; // positive = into volume
  p_internal += (beta * params.dt / volume) * q_net;
  comp.state.p_internal = p_internal;

  p1.c = p_internal + Zc * p1.q;
  p1.Zc = Zc;
  p2.c = p_internal + Zc * p2.q;
  p2.Zc = Zc;
}

// ============================================================
// Tee / Multi-Way Junction (C-type)
// ============================================================

export function updateTeeJunction(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  const volume = comp.params.volume ?? 1e-6;
  const fluidId = comp.params.fluid_id ?? 0;
  const fluid = fluids[fluidId] || fluids[0];
  let p_junction = comp.state.p_junction ?? P_ATM;

  // Sum flows into junction
  let q_net = 0;
  for (let i = 0; i < comp.portCount; i++) {
    q_net += ports[comp.portStartIndex + i].q;
  }

  const beta = effectiveBulkModulus(p_junction, fluid, params);
  p_junction += (beta * params.dt / volume) * q_net;
  comp.state.p_junction = p_junction;

  const Zc = (beta * params.dt) / (2 * volume);

  // Write wave variables to all ports
  for (let i = 0; i < comp.portCount; i++) {
    const port = ports[comp.portStartIndex + i];
    port.c = p_junction + Zc * port.q;
    port.Zc = Zc;
    port.p = p_junction;
  }
}

// ============================================================
// Hydropneumatic Sphere with Diaphragm (C-type)
// ============================================================

export function updateHydropneumaticSphere(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  const portIdx = comp.portStartIndex;
  const port = ports[portIdx];

  const R = comp.params.R_sphere ?? 0.062;
  const restRatio = comp.params.diaphragm_rest_ratio ?? 0.5;
  const thickness = comp.params.diaphragm_thickness ?? 0.003;
  const modulus = comp.params.diaphragm_modulus ?? 2e6;
  const precharge = comp.params.gas_precharge_pressure ?? 60e5;
  const gasFluidId = comp.params.fluid_id_gas ?? 0;
  const gasFluid = fluids[gasFluidId] || fluids[0];
  const kappa = gasFluid.kappa || comp.params.kappa || 1.4;

  let h = comp.state.h;
  const h_rest = restRatio * 2 * R;
  const h_min = 0.001 * R;
  const h_max = 2 * R - 0.001 * R;

  // Spherical cap geometry
  const V_cap = (h: number) => (Math.PI * h * h / 3) * (3 * R - h);
  const A_eff = (h: number) => Math.PI * (2 * R * h - h * h);
  const V_total = (4 / 3) * Math.PI * R * R * R;
  const V_gas_0 = V_total - V_cap(h_rest);

  // Gas pressure (polytropic)
  const V_gas = V_total - V_cap(h);
  const V_gas_safe = Math.max(V_gas, 1e-9);
  const p_gas = precharge * Math.pow(V_gas_0 / V_gas_safe, kappa);

  // Diaphragm elastic restoring pressure
  const p_elastic = modulus * thickness * (h - h_rest) / (R * R);

  // Liquid-side pressure
  const p_liquid = p_gas + p_elastic;

  // Effective stiffness
  const K_gas = kappa * p_gas / V_gas_safe;
  const K_elastic = modulus * thickness / (R * R * Math.max(A_eff(h), 1e-9));
  const K_total = K_gas + K_elastic;
  const C_total = 1.0 / Math.max(K_total, 1e-3);

  const Zc = params.dt / (2.0 * C_total);

  // Wave variable output
  port.c = p_liquid + Zc * port.q;
  port.Zc = Zc;
  port.p = p_liquid;

  // Update diaphragm position from flow
  const A_eff_h = Math.max(A_eff(h), 1e-9);
  h += params.dt * port.q / A_eff_h;
  h = Math.max(h_min, Math.min(h_max, h));
  comp.state.h = h;
}

// ============================================================
// Piston Accumulator (C-type)
// ============================================================

export function updatePistonAccumulator(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  const portIdx = comp.portStartIndex;
  const port = ports[portIdx];

  const bore = comp.params.bore ?? 0.05;
  const stroke = comp.params.stroke ?? 0.2;
  const precharge = comp.params.gas_precharge_pressure ?? 50e5;
  const gasFluidId = comp.params.fluid_id_gas ?? 0;
  const gasFluid = fluids[gasFluidId] || fluids[0];
  const kappa = gasFluid.kappa || 1.4;

  const A = Math.PI * bore * bore * 0.25;
  let x = comp.state.piston_position ?? 0;

  const V_gas_0 = A * stroke;
  const V_gas = A * (stroke - x);
  const V_gas_safe = Math.max(V_gas, 1e-9);
  const p_gas = precharge * Math.pow(V_gas_0 / V_gas_safe, kappa);

  const K_gas = kappa * p_gas / V_gas_safe;
  const C_total = 1.0 / Math.max(K_gas, 1e-3);
  const Zc = params.dt / (2.0 * C_total);

  const p_liquid = p_gas;
  port.c = p_liquid + Zc * port.q;
  port.Zc = Zc;
  port.p = p_liquid;

  // Position update
  x += params.dt * port.q / A;
  x = Math.max(0, Math.min(stroke, x));
  comp.state.piston_position = x;
}

// ============================================================
// Balloon / Flexible Membrane Vessel (C-type)
// ============================================================

export function updateBalloon(
  comp: ComponentInstance,
  ports: PortState[],
  _fluids: FluidDef[],
  params: SimParams
): void {
  const portIdx = comp.portStartIndex;
  const port = ports[portIdx];

  const isSpherical = comp.type === 'BALLOON_SPHERICAL';
  const R_nominal = comp.params.R_nominal ?? 0.025;
  const wallThickness = comp.params.wall_thickness ?? 0.002;
  const E = comp.params.elastic_modulus ?? 2e6;
  const stiffening = comp.params.stiffening_exponent ?? 2.0;
  const maxStrain = comp.params.max_strain ?? 2.5;
  const dampingRatio = comp.params.damping_ratio ?? 0.1;
  const p_external = comp.params.p_external ?? P_ATM;
  const length = comp.params.length ?? 0.1; // for cylindrical

  let V = comp.state.V_current;

  // Nominal volume
  const V_nominal = isSpherical
    ? (4 / 3) * Math.PI * R_nominal * R_nominal * R_nominal
    : Math.PI * R_nominal * R_nominal * length;

  // Current radius
  const R_current = isSpherical
    ? Math.pow((3 * V) / (4 * Math.PI), 1 / 3)
    : Math.sqrt(V / (Math.PI * length));

  // Strain
  const epsilon = (R_current - R_nominal) / R_nominal;

  // Wall stress with nonlinear stiffening
  const sigma = E * epsilon * (1.0 + (stiffening - 1.0) * epsilon * epsilon);

  // Membrane restoring pressure (Laplace's law)
  const p_membrane = isSpherical
    ? (2.0 * sigma * wallThickness) / R_current
    : (sigma * wallThickness) / R_current;

  const p_internal = p_external + p_membrane;

  // Compliance via finite difference
  const dV = 1e-9;
  const R_plus = isSpherical
    ? Math.pow((3 * (V + dV)) / (4 * Math.PI), 1 / 3)
    : Math.sqrt((V + dV) / (Math.PI * length));
  const eps_plus = (R_plus - R_nominal) / R_nominal;
  const sig_plus = E * eps_plus * (1.0 + (stiffening - 1.0) * eps_plus * eps_plus);
  const p_plus = isSpherical
    ? p_external + (2.0 * sig_plus * wallThickness) / R_plus
    : p_external + (sig_plus * wallThickness) / R_plus;

  const K = (p_plus - p_internal) / dV;
  const C_total = 1.0 / Math.max(K, 1.0);

  const Zc_elastic = params.dt / (2.0 * C_total);
  const Zc_damping = dampingRatio * Math.sqrt(Math.abs(K)) * params.dt;
  const Zc = Zc_elastic + Zc_damping;

  port.c = p_internal + Zc * port.q;
  port.Zc = Zc;
  port.p = p_internal;

  // Update volume
  V += params.dt * port.q;
  const V_min = V_nominal * 0.1;
  const V_burst = isSpherical
    ? (4 / 3) * Math.PI * Math.pow(R_nominal * (1 + maxStrain), 3)
    : Math.PI * Math.pow(R_nominal * (1 + maxStrain), 2) * length;
  V = Math.max(V_min, Math.min(V_burst, V));
  comp.state.V_current = V;
}
