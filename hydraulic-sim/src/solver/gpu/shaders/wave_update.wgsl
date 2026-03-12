// wave_update.wgsl — Pass 1: TLM wave variable propagation

struct PortState {
  p: f32, q: f32, c: f32, Zc: f32,
  fluid_id: u32, _pad1: u32, _pad2: u32, _pad3: u32,
}

struct FluidDef {
  fluid_type: u32, beta_base: f32, rho_base: f32, x_air_0: f32,
  kappa: f32, p_vapour: f32, nu: f32, gamma: f32,
  molar_mass: f32, henry_coeff: f32, _pad1: f32, _pad2: f32,
}

struct SimParams {
  dt: f32, time: f32, step: u32, num_connections: u32,
  num_c_components: u32, num_q_components: u32,
  num_s_components: u32, buffer_toggle: u32,
  temperature: f32, p_atm: f32, _pad1: f32, _pad2: f32,
}

struct Connection {
  port_a: u32, port_b: u32, Zc: f32, delay_samples: u32,
  fluid_id: u32, inner_diameter: f32, _pad1: u32, _pad2: u32,
}

const R_GAS: f32 = 8.314;

@group(0) @binding(0) var<storage, read> ports_prev: array<PortState>;
@group(0) @binding(1) var<storage, read_write> ports_curr: array<PortState>;
@group(0) @binding(2) var<storage, read_write> connections: array<Connection>;
@group(0) @binding(3) var<uniform> params: SimParams;
@group(0) @binding(4) var<uniform> fluids: array<FluidDef, 16>;

fn effective_bulk_modulus_fn(p: f32, fluid: FluidDef) -> f32 {
  if (fluid.fluid_type == 1u) {
    return fluid.kappa * max(p, 100.0);
  }
  let p_safe = max(p, fluid.p_vapour);
  let x_air = fluid.x_air_0 * pow(params.p_atm / p_safe, 1.0 / fluid.kappa);
  let inv_beta = (1.0 - x_air) / fluid.beta_base + x_air * fluid.kappa / p_safe;
  return 1.0 / inv_beta;
}

fn wave_speed_calc(p: f32, fluid: FluidDef) -> f32 {
  let beta = effective_bulk_modulus_fn(p, fluid);
  var rho: f32;
  if (fluid.fluid_type == 1u) {
    rho = fluid.molar_mass * max(p, 100.0) / (R_GAS * params.temperature);
  } else {
    let p_safe = max(p, fluid.p_vapour);
    let x_air = fluid.x_air_0 * pow(params.p_atm / p_safe, 1.0 / fluid.kappa);
    let rho_air = 1.225 * p_safe / params.p_atm;
    rho = fluid.rho_base * (1.0 - x_air) + rho_air * x_air;
  }
  return sqrt(beta / rho);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.num_connections) { return; }

  let conn = connections[idx];
  let a = ports_prev[conn.port_a];
  let b = ports_prev[conn.port_b];

  let fluid = fluids[conn.fluid_id];
  let p_avg = 0.5 * (a.p + b.p);
  let area_line = 3.14159 * conn.inner_diameter * conn.inner_diameter * 0.25;
  let ws = wave_speed_calc(p_avg, fluid);
  let beta = effective_bulk_modulus_fn(p_avg, fluid);
  let Zc_updated = beta / (area_line * ws);

  connections[idx].Zc = Zc_updated;

  let c_a_new = b.p + Zc_updated * b.q;
  let c_b_new = a.p + Zc_updated * a.q;

  ports_curr[conn.port_a].c = c_a_new;
  ports_curr[conn.port_a].Zc = Zc_updated;
  ports_curr[conn.port_a].fluid_id = conn.fluid_id;
  ports_curr[conn.port_b].c = c_b_new;
  ports_curr[conn.port_b].Zc = Zc_updated;
  ports_curr[conn.port_b].fluid_id = conn.fluid_id;
}
