// q_type_update.wgsl — Pass 3: Q-type component updates (cylinders, orifices)

struct PortState {
  p: f32, q: f32, c: f32, Zc: f32,
  fluid_id: u32, _pad1: u32, _pad2: u32, _pad3: u32,
}

struct SimParams {
  dt: f32, time: f32, step: u32, num_connections: u32,
  num_c_components: u32, num_q_components: u32,
  num_s_components: u32, buffer_toggle: u32,
  temperature: f32, p_atm: f32, _pad1: f32, _pad2: f32,
}

struct CylinderParams {
  A_cap: f32,
  A_rod: f32,
  stroke: f32,
  mass: f32,
  friction_static: f32,
  friction_viscous: f32,
  dead_vol_A: f32,
  dead_vol_B: f32,
  position: f32,
  velocity: f32,
  external_force: f32,
  port_A_idx: u32,
  port_B_idx: u32,
  fluid_id_A: u32,
  fluid_id_B: u32,
  // Mechanical port index (0xFFFFFFFF = no mech port connected)
  port_mech_idx: u32,
  // End-stop contact parameters
  endstop_stiffness: f32,
  endstop_damping: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<storage, read_write> ports: array<PortState>;
@group(0) @binding(1) var<uniform> params: SimParams;
@group(0) @binding(2) var<storage, read_write> cylinders: array<CylinderParams>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.num_q_components) { return; }

  var cyl = cylinders[idx];

  let c_A = ports[cyl.port_A_idx].c;
  let Zc_A = ports[cyl.port_A_idx].Zc;
  let c_B = ports[cyl.port_B_idx].c;
  let Zc_B = ports[cyl.port_B_idx].Zc;

  // Mechanical port coupling (force from connected spring/mass)
  let has_mech = cyl.port_mech_idx != 0xFFFFFFFFu;
  var F_mech: f32 = 0.0;
  var Zc_mech: f32 = 0.0;
  if (has_mech) {
    F_mech = ports[cyl.port_mech_idx].c;
    Zc_mech = ports[cyl.port_mech_idx].Zc;
  }

  // End-stop contact model (semi-implicit penalty method).
  // A stiff spring + heavy damper at each end stop dissipates impact energy
  // and produces physically realistic pressures during contact.
  var F_contact: f32 = 0.0;
  var K_contact: f32 = 0.0;
  if (cyl.position < 0.0 || (cyl.position == 0.0 && cyl.velocity < 0.0)) {
    F_contact = cyl.endstop_stiffness * (-cyl.position)
              + cyl.endstop_damping * max(-cyl.velocity, 0.0);
    K_contact = cyl.endstop_stiffness * params.dt + cyl.endstop_damping;
  } else if (cyl.position > cyl.stroke || (cyl.position == cyl.stroke && cyl.velocity > 0.0)) {
    F_contact = -cyl.endstop_stiffness * (cyl.position - cyl.stroke)
              - cyl.endstop_damping * max(cyl.velocity, 0.0);
    K_contact = cyl.endstop_stiffness * params.dt + cyl.endstop_damping;
  }

  let hydraulic_stiffness = Zc_A * cyl.A_cap * cyl.A_cap
                          + Zc_B * cyl.A_rod * cyl.A_rod
                          + Zc_mech;
  let F_wave = c_A * cyl.A_cap - c_B * cyl.A_rod;
  let F_ext = cyl.external_force + F_mech;

  let denom = cyl.mass / params.dt + hydraulic_stiffness + cyl.friction_viscous + K_contact;
  var v_new = (cyl.mass * cyl.velocity / params.dt + F_wave + F_ext + F_contact) / denom;

  var x_new = cyl.position + params.dt * 0.5 * (cyl.velocity + v_new);

  // Hard clamp (safety net for extreme transients)
  if (x_new < 0.0) {
    x_new = 0.0;
    if (v_new < 0.0) { v_new = 0.0; }
  } else if (x_new > cyl.stroke) {
    x_new = cyl.stroke;
    if (v_new > 0.0) { v_new = 0.0; }
  }

  let q_A = v_new * cyl.A_cap;
  let q_B = -v_new * cyl.A_rod;
  let p_A = c_A - Zc_A * q_A;
  let p_B = c_B - Zc_B * q_B;

  ports[cyl.port_A_idx].p = p_A;
  ports[cyl.port_A_idx].q = q_A;
  ports[cyl.port_B_idx].p = p_B;
  ports[cyl.port_B_idx].q = q_B;

  // Mechanical port output: piston velocity and reaction force
  if (has_mech) {
    ports[cyl.port_mech_idx].q = v_new;
    ports[cyl.port_mech_idx].p = F_mech - Zc_mech * v_new;
  }

  cylinders[idx].position = x_new;
  cylinders[idx].velocity = v_new;
}
