/**
 * Q-type (Resistive/Inertive) component TLM update functions.
 * These compute pressure p and flow q at their ports given wave variables.
 */

import {
  type PortState,
  type SimParams,
  type FluidDef,
  type ComponentInstance,
  P_ATM,
} from '../../solver/types';
import { orificeFlow, effectiveDensity, effectiveBulkModulus } from '../../fluid/properties';

/** Minimum trapped volume (m³) to prevent division-by-zero in impedance calculations. */
const MIN_TRAPPED_VOLUME_M3 = 1e-10;

// ============================================================
// Double-Acting Cylinder (Q-type)
// ============================================================

export function updateDoubleActingCylinder(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams,
  externalForce: number = 0
): void {
  const portA = ports[comp.portStartIndex];
  const portB = ports[comp.portStartIndex + 1];
  // Port index 2 is ctrl (signal), index 3 is mech (mechanical)
  const portMech = ports[comp.portStartIndex + 3];

  const bore = comp.params.bore_diameter ?? 0.05;
  const rod = comp.params.rod_diameter ?? 0.025;
  const stroke = comp.params.stroke_length ?? 0.2;
  const mass = comp.params.mass ?? 10;
  const frictionViscous = comp.params.friction_viscous ?? 100;
  const capA = comp.params.cap_a ?? 0;
  const capB = comp.params.cap_b ?? 0;

  const A_cap = Math.PI * bore * bore * 0.25;
  const A_rod = Math.PI * (bore * bore - rod * rod) * 0.25;

  let position = comp.state.position ?? 0;
  let velocity = comp.state.velocity ?? 0;

  // Wave variables for hydraulic ports — either from external connections or
  // from internally-modelled capped (trapped) volumes.
  let c_A: number, Zc_A: number;
  let c_B: number, Zc_B: number;

  if (capA) {
    // Capped port A: trapped fluid volume acts as a hydraulic spring.
    // V_A increases with extension (positive x), so extending drops pressure.
    const deadVol = comp.params.dead_volume_A ?? 1e-6;
    const V_A = Math.max(A_cap * position + deadVol, MIN_TRAPPED_VOLUME_M3);
    const fluid = fluids[portA.fluid_id] || fluids[0];
    const p_trapped = comp.state.p_cap_a ?? params.p_atm;
    const beta = effectiveBulkModulus(p_trapped, fluid, params);
    // Semi-implicit stiffness: Zc_cap = beta * dt / V
    Zc_A = beta * params.dt / V_A;
    c_A = p_trapped;
  } else {
    c_A = portA.c;
    Zc_A = portA.Zc;
  }

  if (capB) {
    // Capped port B: trapped fluid on the rod side.
    // V_B decreases with extension (positive x), so extending raises pressure.
    const deadVol = comp.params.dead_volume_B ?? 1e-6;
    const V_B = Math.max(A_rod * (stroke - position) + deadVol, MIN_TRAPPED_VOLUME_M3);
    const fluid = fluids[portB.fluid_id] || fluids[0];
    const p_trapped = comp.state.p_cap_b ?? params.p_atm;
    const beta = effectiveBulkModulus(p_trapped, fluid, params);
    Zc_B = beta * params.dt / V_B;
    c_B = p_trapped;
  } else {
    c_B = portB.c;
    Zc_B = portB.Zc;
  }

  // Mechanical port force (from connected spring/mass)
  const F_mech = portMech ? portMech.c : 0;
  const Zc_mech = portMech ? portMech.Zc : 0;

  // TLM-coupled Newton's second law
  const hydraulicStiffness = Zc_A * A_cap * A_cap + Zc_B * A_rod * A_rod + Zc_mech;
  const F_wave = c_A * A_cap - c_B * A_rod;
  const F_ext = externalForce + (comp.params.external_force ?? 0) + (comp.state.signal_input ?? 0) + F_mech;

  const denom = mass / params.dt + hydraulicStiffness + frictionViscous;
  let v_new = (mass * velocity / params.dt + F_wave + F_ext) / denom;

  // Position update (trapezoidal)
  let x_new = position + params.dt * 0.5 * (velocity + v_new);

  // Hard stops
  if (x_new < 0) {
    x_new = 0;
    v_new = 0;
  } else if (x_new > stroke) {
    x_new = stroke;
    v_new = 0;
  }

  // Port flows and pressures
  const q_A = v_new * A_cap;
  const q_B = -v_new * A_rod;
  const p_A = c_A - Zc_A * q_A;
  const p_B = c_B - Zc_B * q_B;

  if (capA) {
    // Update trapped pressure for next step
    comp.state.p_cap_a = Math.max(p_A, 0);
    portA.p = p_A;
    portA.q = 0;   // no external flow — port is capped
  } else {
    portA.p = p_A;
    portA.q = -q_A; // outflow convention: positive = leaving component
  }

  if (capB) {
    comp.state.p_cap_b = Math.max(p_B, 0);
    portB.p = p_B;
    portB.q = 0;
  } else {
    portB.p = p_B;
    portB.q = -q_B; // outflow convention: positive = leaving component
  }

  // Mechanical port: output piston velocity and reaction force
  if (portMech) {
    portMech.q = v_new;
    portMech.p = F_mech - Zc_mech * v_new;
  }

  comp.state.position = x_new;
  comp.state.velocity = v_new;
}

// ============================================================
// Single-Acting Cylinder (Q-type)
// ============================================================

export function updateSingleActingCylinder(
  comp: ComponentInstance,
  ports: PortState[],
  _fluids: FluidDef[],
  params: SimParams,
  externalForce: number = 0
): void {
  const portA = ports[comp.portStartIndex];
  // Port index 1 is ctrl (signal), index 2 is mech (mechanical)
  const portMech = ports[comp.portStartIndex + 2];

  const bore = comp.params.bore_diameter ?? 0.05;
  const rod = comp.params.rod_diameter ?? 0.025;
  const stroke = comp.params.stroke_length ?? 0.2;
  const mass = comp.params.mass ?? 10;
  const frictionViscous = comp.params.friction_viscous ?? 100;
  const springRate = comp.params.spring_rate ?? 1000;
  const springPreload = comp.params.spring_preload ?? 100;

  const A_cap = Math.PI * bore * bore * 0.25;
  const A_rod = Math.PI * (bore * bore - rod * rod) * 0.25;

  let position = comp.state.position ?? 0;
  let velocity = comp.state.velocity ?? 0;

  const c_A = portA.c;
  const Zc_A = portA.Zc;

  // Mechanical port force (from connected spring/mass)
  const F_mech = portMech ? portMech.c : 0;
  const Zc_mech = portMech ? portMech.Zc : 0;

  // Spring return force + atmospheric pressure on rod side
  const F_spring = -(springRate * position + springPreload);
  const F_atm = -P_ATM * A_rod;
  const F_ext = externalForce + (comp.params.external_force ?? 0) + (comp.state.signal_input ?? 0) + F_mech;

  // Semi-implicit: include spring stiffness in denominator for stability
  const hydraulicStiffness = Zc_A * A_cap * A_cap + Zc_mech;
  const springStiffness = springRate * params.dt;
  const denom = mass / params.dt + hydraulicStiffness + frictionViscous + springStiffness;
  let v_new = (mass * velocity / params.dt + c_A * A_cap + F_spring + F_atm + F_ext) / denom;

  let x_new = position + params.dt * 0.5 * (velocity + v_new);

  if (x_new < 0) { x_new = 0; v_new = 0; }
  else if (x_new > stroke) { x_new = stroke; v_new = 0; }

  const q_A = v_new * A_cap;
  const p_A = c_A - Zc_A * q_A;

  portA.p = p_A;
  portA.q = -q_A; // outflow convention: positive = leaving component

  // Mechanical port: output piston velocity and reaction force
  if (portMech) {
    portMech.q = v_new;
    portMech.p = F_mech - Zc_mech * v_new;
  }

  comp.state.position = x_new;
  comp.state.velocity = v_new;
}

// ============================================================
// Orifice / Restriction (Q-type)
// ============================================================

export function updateOrifice(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  const p1 = ports[comp.portStartIndex];
  const p2 = ports[comp.portStartIndex + 1];

  const Cd = comp.params.Cd ?? 0.65;
  const area = comp.params.area ?? 1e-5;
  const fluidId = p1.fluid_id ?? 0;
  const fluid = fluids[fluidId] || fluids[0];

  const c1 = p1.c;
  const Zc1 = p1.Zc;
  const c2 = p2.c;
  const Zc2 = p2.Zc;

  // Initial dp estimate from wave variables
  const p_avg = 0.5 * (c1 + c2);

  // Newton-Raphson iterations (2 iterations typically sufficient)
  let q = comp.state?.q_prev ?? 0; // start from previous
  for (let iter = 0; iter < 3; iter++) {
    const dp = (c1 - c2) - (Zc1 + Zc2) * q;
    const q_target = orificeFlow(dp, Cd, area, fluid, Math.max(p_avg, P_ATM), params);
    const rho = effectiveDensity(Math.max(p_avg, P_ATM), fluid, params);
    // Jacobian approximation — blended to match the flow equation's smooth transition
    const dp_transition = 100.0;
    const blend = Math.min(Math.abs(dp) / dp_transition, 1.0);
    const D_h = Math.sqrt((4.0 * area) / Math.PI);
    const dq_ddp_lam = (Cd * area * area) / (32 * rho * fluid.nu * D_h);
    const dq_ddp_turb = Math.abs(dp) > 1
      ? Cd * area / Math.sqrt(2 * rho * Math.abs(dp))
      : dq_ddp_lam;
    const dq_ddp = dq_ddp_lam * (1.0 - blend) + dq_ddp_turb * blend;
    const f = q - q_target;
    const fp = 1 + (Zc1 + Zc2) * dq_ddp;
    q = q - f / Math.max(fp, 1e-10);
  }

  const p_1 = c1 - Zc1 * q;
  const p_2 = c2 + Zc2 * q;

  p1.p = p_1;
  p1.q = -q; // flow out of port 1
  p2.p = p_2;
  p2.q = q;  // flow into port 2

  comp.state.q_prev = q;
}

// ============================================================
// Check Valve (Q-type)
// ============================================================

export function updateCheckValve(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  const p_in = ports[comp.portStartIndex];
  const p_out = ports[comp.portStartIndex + 1];

  const Cd = comp.params.Cd ?? 0.65;
  const areaMax = comp.params.area_max ?? 1e-4;
  const crackingPressure = comp.params.cracking_pressure ?? 3e4; // 0.3 bar
  const fullOpenPressure = comp.params.full_open_pressure ?? 1e5; // 1 bar
  const leakageFlow = comp.params.leakage_flow ?? 1e-10;

  const fluidId = p_in.fluid_id ?? 0;
  const fluid = fluids[fluidId] || fluids[0];

  const c1 = p_in.c;
  const Zc1 = p_in.Zc;
  const c2 = p_out.c;
  const Zc2 = p_out.Zc;

  const Zc_sum = Zc1 + Zc2;
  const p_avg = Math.max(0.5 * (c1 + c2), P_ATM);
  const rho = effectiveDensity(p_avg, fluid, params);

  // Newton-Raphson iteration (like the orifice model)
  let q = comp.state?.q_prev ?? 0;
  for (let iter = 0; iter < 3; iter++) {
    const dp = (c1 - c2) - Zc_sum * q;

    let q_target: number;
    let areaEff: number;
    if (dp < crackingPressure) {
      q_target = leakageFlow * Math.sign(dp);
    } else if (dp < fullOpenPressure) {
      const fraction = (dp - crackingPressure) / (fullOpenPressure - crackingPressure);
      areaEff = fraction * areaMax;
      q_target = orificeFlow(dp, Cd, areaEff, fluid, p_avg, params);
    } else {
      areaEff = areaMax;
      q_target = orificeFlow(dp, Cd, areaEff, fluid, p_avg, params);
    }

    // Jacobian: dq_target/ddp
    let dq_ddp: number;
    if (dp < crackingPressure) {
      dq_ddp = 0;
    } else {
      const a = dp < fullOpenPressure
        ? ((dp - crackingPressure) / (fullOpenPressure - crackingPressure)) * areaMax
        : areaMax;
      const dp_transition = 100.0;
      const blend = Math.min(Math.abs(dp) / dp_transition, 1.0);
      const D_h = Math.sqrt((4.0 * a) / Math.PI);
      const dq_ddp_lam = (Cd * a * a) / (32 * rho * fluid.nu * D_h);
      const dq_ddp_turb = Math.abs(dp) > 1
        ? Cd * a / Math.sqrt(2 * rho * Math.abs(dp))
        : dq_ddp_lam;
      dq_ddp = dq_ddp_lam * (1.0 - blend) + dq_ddp_turb * blend;
    }

    const f = q - q_target;
    const fp = 1 + Zc_sum * dq_ddp;
    q = q - f / Math.max(fp, 1e-10);
  }

  // Ensure no reverse flow (beyond leakage)
  if (q < 0) q = leakageFlow * Math.sign((c1 - c2) - Zc_sum * q);

  const p_1 = c1 - Zc1 * q;
  const p_2 = c2 + Zc2 * q;

  p_in.p = p_1;
  p_in.q = -q;
  p_out.p = p_2;
  p_out.q = q;

  comp.state.q_prev = q;
}

/**
 * Solve orifice flow with TLM impedance coupling using 2 Newton-Raphson iterations.
 * Used by DCV, one-way flow control, and other multi-path Q-type components.
 */
function solveOrificeFlowNR(
  c1: number,
  Zc1: number,
  c2: number,
  Zc2: number,
  Cd: number,
  area: number,
  fluid: FluidDef,
  p_avg: number,
  params: SimParams
): number {
  const Zc_sum = Zc1 + Zc2;
  const rho = effectiveDensity(p_avg, fluid, params);
  let q = 0;
  for (let iter = 0; iter < 2; iter++) {
    const dp = (c1 - c2) - Zc_sum * q;
    const q_target = orificeFlow(dp, Cd, area, fluid, p_avg, params);
    const dp_transition = 100.0;
    const blend = Math.min(Math.abs(dp) / dp_transition, 1.0);
    const D_h = Math.sqrt((4.0 * area) / Math.PI);
    const dq_ddp_lam = (Cd * area * area) / (32 * rho * fluid.nu * D_h);
    const dq_ddp_turb = Math.abs(dp) > 1
      ? Cd * area / Math.sqrt(2 * rho * Math.abs(dp))
      : dq_ddp_lam;
    const dq_ddp = dq_ddp_lam * (1.0 - blend) + dq_ddp_turb * blend;
    const f = q - q_target;
    const fp = 1 + Zc_sum * dq_ddp;
    q = q - f / Math.max(fp, 1e-10);
  }
  return q;
}

// ============================================================
// One-Way Flow Control (Q-type)
// ============================================================

export function updateOneWayFlowControl(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  const p1 = ports[comp.portStartIndex];
  const p2 = ports[comp.portStartIndex + 1];

  const Cd = comp.params.Cd ?? 0.65;
  const checkAreaMax = comp.params.area_max ?? 1e-4;
  const orificeAreaMin = comp.params.orifice_area_min ?? 1e-7;
  const orificeAreaMax = comp.params.orifice_area_max ?? 1e-4;
  const setting = comp.params.orifice_setting ?? 0.5;

  const fluidId = p1.fluid_id ?? 0;
  const fluid = fluids[fluidId] || fluids[0];

  const c1 = p1.c;
  const Zc1 = p1.Zc;
  const c2 = p2.c;
  const Zc2 = p2.Zc;
  const dp_wave = c1 - c2;
  const p_avg = Math.max(0.5 * (c1 + c2), P_ATM);

  let q: number;
  if (dp_wave > 0) {
    // Free flow direction — check valve open
    q = solveOrificeFlowNR(c1, Zc1, c2, Zc2, Cd, checkAreaMax, fluid, p_avg, params);
  } else {
    // Restricted direction
    const areaEff = orificeAreaMin + setting * (orificeAreaMax - orificeAreaMin);
    q = solveOrificeFlowNR(c1, Zc1, c2, Zc2, Cd, areaEff, fluid, p_avg, params);
  }

  p1.p = c1 - Zc1 * q;
  p1.q = -q;
  p2.p = c2 + Zc2 * q;
  p2.q = q;
}

// ============================================================
// Variable Orifice / Proportional Valve (Q-type)
// ============================================================

export function updateVariableOrifice(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  const p1 = ports[comp.portStartIndex];
  const p2 = ports[comp.portStartIndex + 1];

  const Cd = comp.params.Cd ?? 0.65;
  const areaMax = comp.params.area_max ?? 1e-4;
  const commandedPosition = comp.params.position ?? 0.5;
  const responseTime = comp.params.response_time ?? 0.01;

  // First-order lag on spool
  let actualPos = comp.state.actual_position ?? commandedPosition;
  actualPos += (params.dt / responseTime) * (commandedPosition - actualPos);
  comp.state.actual_position = actualPos;

  const areaEff = Math.max(actualPos * areaMax, 1e-9);
  const fluidId = p1.fluid_id ?? 0;
  const fluid = fluids[fluidId] || fluids[0];

  const dp = p1.c - p2.c;
  const p_avg = Math.max(0.5 * (p1.c + p2.c), P_ATM);
  const q = orificeFlow(dp, Cd, areaEff, fluid, p_avg, params);

  p1.p = p1.c - p1.Zc * q;
  p1.q = -q;
  p2.p = p2.c + p2.Zc * q;
  p2.q = q;
}

// ============================================================
// 4/3 Directional Control Valve (Q-type)
// ============================================================

export function updateDcv43(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  // Ports: P(0), T(1), A(2), B(3)
  const portP = ports[comp.portStartIndex];
  const portT = ports[comp.portStartIndex + 1];
  const portA = ports[comp.portStartIndex + 2];
  const portB = ports[comp.portStartIndex + 3];

  const Cd = comp.params.Cd ?? 0.65;
  const areaMax = comp.params.area_max ?? 1e-4;
  const overlap = comp.params.overlap ?? 0.0;
  const responseTime = comp.params.response_time ?? 0.02;
  // Use signal input from connected controller if available, else fall back to static param
  const commandedSpool = comp.state.signal_input ?? comp.params.spool_position ?? 0;

  // Spool dynamics
  let spool = comp.state.actual_spool ?? 0;
  spool += (params.dt / responseTime) * (commandedSpool - spool);
  comp.state.actual_spool = spool;

  const fluidId = portP.fluid_id ?? 0;
  const fluid = fluids[fluidId] || fluids[0];

  // Area functions with overlap
  const overlapRange = Math.max(overlap, 0.001);
  const area_PA = areaMax * Math.max(Math.min((spool - overlapRange) / (1 - overlapRange), 1), 0);
  const area_BT = area_PA;
  const area_PB = areaMax * Math.max(Math.min((-spool - overlapRange) / (1 - overlapRange), 1), 0);
  const area_AT = area_PB;

  // Leakage when closed
  const leakArea = 1e-9;

  // Solve each flow path with TLM impedance coupling (Newton-Raphson)
  const p_avg = Math.max(0.25 * (portP.c + portT.c + portA.c + portB.c), P_ATM);

  // P→A path
  const q_PA = solveOrificeFlowNR(portP.c, portP.Zc, portA.c, portA.Zc, Cd, Math.max(area_PA, leakArea), fluid, p_avg, params);

  // B→T path
  const q_BT = solveOrificeFlowNR(portB.c, portB.Zc, portT.c, portT.Zc, Cd, Math.max(area_BT, leakArea), fluid, p_avg, params);

  // P→B path
  const q_PB = solveOrificeFlowNR(portP.c, portP.Zc, portB.c, portB.Zc, Cd, Math.max(area_PB, leakArea), fluid, p_avg, params);

  // A→T path
  const q_AT = solveOrificeFlowNR(portA.c, portA.Zc, portT.c, portT.Zc, Cd, Math.max(area_AT, leakArea), fluid, p_avg, params);

  // Net flows at each port
  const q_P = -(q_PA + q_PB);  // out of P
  const q_T = q_BT + q_AT;     // into T
  const q_A = q_PA - q_AT;     // net at A
  const q_B = q_PB - q_BT;     // net at B

  portP.p = portP.c - portP.Zc * q_P;
  portP.q = -q_P; // outflow convention: positive = leaving component
  portT.p = portT.c - portT.Zc * q_T;
  portT.q = -q_T; // outflow convention
  portA.p = portA.c - portA.Zc * q_A;
  portA.q = -q_A; // outflow convention
  portB.p = portB.c - portB.Zc * q_B;
  portB.q = -q_B; // outflow convention
}

// ============================================================
// 3/2 Directional Control Valve (Q-type)
// ============================================================

export function updateDcv32(
  comp: ComponentInstance,
  ports: PortState[],
  fluids: FluidDef[],
  params: SimParams
): void {
  // Ports: P(0), T(1), A(2)
  const portP = ports[comp.portStartIndex];
  const portT = ports[comp.portStartIndex + 1];
  const portA = ports[comp.portStartIndex + 2];

  const Cd = comp.params.Cd ?? 0.65;
  const areaMax = comp.params.area_max ?? 1e-4;
  const responseTime = comp.params.response_time ?? 0.02;
  // Use signal input from connected controller if available, else fall back to static param
  const commandedSpool = comp.state.signal_input ?? comp.params.spool_position ?? 0;

  let spool = comp.state.actual_spool ?? 0;
  spool += (params.dt / responseTime) * (commandedSpool - spool);
  comp.state.actual_spool = spool;

  const fluidId = portP.fluid_id ?? 0;
  const fluid = fluids[fluidId] || fluids[0];
  const leakArea = 1e-9;
  const p_avg = Math.max((portP.c + portT.c + portA.c) / 3, P_ATM);

  // P→A: open when spool → 1
  const area_PA = areaMax * Math.max(Math.min(spool, 1), 0);
  // A→T: open when spool → 0
  const area_AT = areaMax * Math.max(Math.min(1 - spool, 1), 0);

  const q_PA = solveOrificeFlowNR(portP.c, portP.Zc, portA.c, portA.Zc, Cd, Math.max(area_PA, leakArea), fluid, p_avg, params);
  const q_AT = solveOrificeFlowNR(portA.c, portA.Zc, portT.c, portT.Zc, Cd, Math.max(area_AT, leakArea), fluid, p_avg, params);

  const q_P = -q_PA;
  const q_A = q_PA - q_AT;
  const q_T = q_AT;

  portP.p = portP.c - portP.Zc * q_P;
  portP.q = -q_P; // outflow convention: positive = leaving component
  portA.p = portA.c - portA.Zc * q_A;
  portA.q = -q_A; // outflow convention
  portT.p = portT.c - portT.Zc * q_T;
  portT.q = -q_T; // outflow convention
}

// ============================================================
// Spring (Q-type, mechanical domain)
// ============================================================

export function updateSpring(
  comp: ComponentInstance,
  ports: PortState[],
  params: SimParams
): void {
  // Mechanical ports — using p for force, q for velocity
  const p1 = ports[comp.portStartIndex];
  const p2 = ports[comp.portStartIndex + 1];

  const springRate = comp.params.spring_rate ?? 10000;
  const preload = comp.params.preload ?? 0;
  const damping = comp.params.damping ?? 100;

  const displacement = (comp.state.displacement ?? 0);
  const velocity = p1.q - p2.q; // relative velocity

  const force = springRate * displacement + preload + damping * velocity;

  p1.p = force;
  p1.q = velocity;
  p2.p = -force;
  p2.q = -velocity;

  comp.state.displacement = displacement + params.dt * velocity;
}

// ============================================================
// Oscillating Force (Q-type, mechanical domain)
// Generates a time-varying mechanical force (e.g. road surface input).
// Waveforms: 0 = sine, 1 = square, 2 = triangle, 3 = random
// ============================================================

export function updateOscillatingForce(
  comp: ComponentInstance,
  ports: PortState[],
  params: SimParams
): void {
  const port = ports[comp.portStartIndex];

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
      const cycle = Math.floor(params.time * frequency);
      const prevCycle = comp.state.random_cycle ?? -1;
      if (cycle !== prevCycle) {
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

  const forceValue = offset + amplitude * signal;
  comp.state.force_value = forceValue;

  // Apply as a mechanical force source: impose force on the port.
  // In the mechanical TLM domain, p = force, q = velocity.
  // As a force source, we set the port force and accept whatever velocity
  // the connected component dictates.
  port.p = forceValue;
  port.q = 0;
}

// ============================================================
// External Load / Mass (Q-type, mechanical domain)
// ============================================================

export function updateMassLoad(
  comp: ComponentInstance,
  ports: PortState[],
  params: SimParams
): void {
  const port = ports[comp.portStartIndex];

  const mass = comp.params.mass ?? 100;
  const gravityForce = comp.params.gravity_force ?? 0;
  const externalForce = comp.params.external_force ?? 0;

  const velocity = comp.state.velocity ?? 0;
  const force = port.c + gravityForce + externalForce;

  // Semi-implicit: include port impedance in denominator for stability
  const denom = mass / params.dt + port.Zc;
  const v_new = (mass * velocity / params.dt + force) / denom;
  port.q = v_new;
  port.p = port.c - port.Zc * v_new;

  comp.state.velocity = v_new;
}
