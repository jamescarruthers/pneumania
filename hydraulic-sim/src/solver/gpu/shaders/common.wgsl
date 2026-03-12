// common.wgsl — shared structs and fluid property functions

struct PortState {
  p: f32,
  q: f32,
  c: f32,
  Zc: f32,
  fluid_id: u32,
  _pad1: u32,
  _pad2: u32,
  _pad3: u32,
}

struct FluidDef {
  fluid_type: u32,    // 0 = LIQUID, 1 = GAS
  beta_base: f32,
  rho_base: f32,
  x_air_0: f32,
  kappa: f32,
  p_vapour: f32,
  nu: f32,
  gamma: f32,
  molar_mass: f32,
  henry_coeff: f32,
  _pad1: f32,
  _pad2: f32,
}

struct SimParams {
  dt: f32,
  time: f32,
  step: u32,
  num_connections: u32,
  num_c_components: u32,
  num_q_components: u32,
  num_s_components: u32,
  buffer_toggle: u32,
  temperature: f32,
  p_atm: f32,
  _pad1: f32,
  _pad2: f32,
}

struct Connection {
  port_a: u32,
  port_b: u32,
  Zc: f32,
  delay_samples: u32,
  fluid_id: u32,
  inner_diameter: f32,
  _pad1: u32,
  _pad2: u32,
}

const R_GAS: f32 = 8.314;
const FLUID_TYPE_LIQUID: u32 = 0u;
const FLUID_TYPE_GAS: u32 = 1u;

fn effective_bulk_modulus(p: f32, fluid: FluidDef, params: SimParams) -> f32 {
  if (fluid.fluid_type == FLUID_TYPE_GAS) {
    return fluid.kappa * max(p, 100.0);
  }
  let p_safe = max(p, fluid.p_vapour);
  let x_air = fluid.x_air_0 * pow(params.p_atm / p_safe, 1.0 / fluid.kappa);
  let inv_beta = (1.0 - x_air) / fluid.beta_base + x_air * fluid.kappa / p_safe;
  return 1.0 / inv_beta;
}

fn effective_density(p: f32, fluid: FluidDef, params: SimParams) -> f32 {
  if (fluid.fluid_type == FLUID_TYPE_GAS) {
    return fluid.molar_mass * max(p, 100.0) / (R_GAS * params.temperature);
  }
  let p_safe = max(p, fluid.p_vapour);
  let x_air = fluid.x_air_0 * pow(params.p_atm / p_safe, 1.0 / fluid.kappa);
  let rho_air = 1.225 * p_safe / params.p_atm;
  return fluid.rho_base * (1.0 - x_air) + rho_air * x_air;
}

fn wave_speed_fn(p: f32, fluid: FluidDef, params: SimParams) -> f32 {
  let beta = effective_bulk_modulus(p, fluid, params);
  let rho = effective_density(p, fluid, params);
  return sqrt(beta / rho);
}

fn smooth_sign(x: f32, eps: f32) -> f32 {
  return x / sqrt(x * x + eps * eps);
}

fn orifice_flow_fn(dp: f32, Cd: f32, area: f32, rho: f32, nu: f32) -> f32 {
  let dp_transition: f32 = 100.0;
  let q_turb = Cd * area * smooth_sign(dp, 1.0) * sqrt(2.0 * abs(dp) / rho);
  let D_h = sqrt(4.0 * area / 3.14159);
  let q_lam = Cd * area * area * dp / (32.0 * rho * nu * D_h);
  let blend = clamp(abs(dp) / dp_transition, 0.0, 1.0);
  return mix(q_lam, q_turb, blend);
}
