/**
 * Rapier Hybrid Solver — uses Rapier 2D (WASM) for the mechanical domain
 * (cylinders, masses, springs) while retaining the TLM engine for hydraulic
 * wave propagation.
 *
 * Execution order each dt:
 *   1. TLM wave variable update (hydraulic connections only)
 *   2. C-type component updates (TLM)
 *   3. S-type updates + signal routing (TLM)
 *   4. Compute hydraulic forces on mechanical bodies → apply to Rapier
 *   5. Step Rapier world
 *   6. Read back Rapier state → update cylinder port pressures/flows
 *   7. Non-mechanical Q-type updates (orifices, valves — TLM)
 *   8. Swap port buffers
 */

import RAPIER from '@dimforge/rapier2d-compat';
import {
  type PortState,
  type SimParams,
  type FluidDef,
  type ComponentInstance,
  type CircuitDefinition,
  type Solver,
  DEFAULT_SIM_PARAMS,
  COMPONENT_TLM_CLASS,
  P_ATM,
} from '../types';
import {
  effectiveBulkModulus,
  waveSpeed,
} from '../../fluid/properties';
import {
  updatePressureSource,
  updateTank,
  updateTlmLine,
  updateTeeJunction,
  updateHydropneumaticSphere,
  updatePistonAccumulator,
  updateBalloon,
} from '../../components/models/cTypes';
import {
  updateOrifice,
  updateCheckValve,
  updateOneWayFlowControl,
  updateVariableOrifice,
  updateDcv43,
  updateDcv32,
} from '../../components/models/qTypes';
import {
  updatePushButton,
  updateToggleSwitch,
  updateSliderControl,
} from '../../components/models/sTypes';
import type { CompiledCircuit, CompiledConnection, SignalRoute } from '../engine';

// Minimum trapped volume (m³) to prevent division-by-zero.
const MIN_TRAPPED_VOLUME_M3 = 1e-10;

/** Tracks a Rapier rigid body linked to a cylinder component. */
interface RapierCylinderBody {
  compId: string;
  body: RAPIER.RigidBody;
  /** Prismatic joint constraining motion to one axis. */
  joint: RAPIER.ImpulseJoint;
  /** Cap-side piston area (m²). */
  A_cap: number;
  /** Rod-side piston area (m²). */
  A_rod: number;
  stroke: number;
  isSingleActing: boolean;
}

/** Tracks a Rapier rigid body linked to a MASS_LOAD component. */
interface RapierMassBody {
  compId: string;
  body: RAPIER.RigidBody;
}

/** Tracks a Rapier spring joint between two mechanical port endpoints. */
interface RapierSpringLink {
  compId: string;
  bodyA: RAPIER.RigidBody;
  bodyB: RAPIER.RigidBody;
  springRate: number;
  preload: number;
  damping: number;
}

let rapierInitialised = false;

export async function ensureRapierInit(): Promise<void> {
  if (rapierInitialised) return;
  await RAPIER.init();
  rapierInitialised = true;
}

function createDefaultPort(p_atm: number): PortState {
  return { p: p_atm, q: 0, c: p_atm, Zc: 1e6, fluid_id: 0 };
}

export class RapierHybridSolver implements Solver {
  private circuit: CompiledCircuit | null = null;
  private mouseForces: Map<string, number> = new Map();

  // Rapier world and body mappings
  private world: RAPIER.World | null = null;
  private cylinderBodies: Map<string, RapierCylinderBody> = new Map();
  private massBodies: Map<string, RapierMassBody> = new Map();
  private springLinks: RapierSpringLink[] = [];
  /** Ground body used as an anchor for prismatic joints. */
  private groundBody: RAPIER.RigidBody | null = null;

  /** Component IDs whose mechanical dynamics are handled by Rapier. */
  private rapierManagedIds: Set<string> = new Set();

  init(circuitDef: CircuitDefinition): void {
    this.dispose();
    this.circuit = compileCircuitDef(circuitDef);
    this.buildRapierWorld();
  }

  private buildRapierWorld(): void {
    if (!this.circuit) return;

    // Create Rapier world with zero gravity (gravity handled per-component via params)
    const gravity = new RAPIER.Vector2(0.0, 0.0);
    this.world = new RAPIER.World(gravity);

    // Create a fixed ground body as anchor for prismatic joints
    const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0);
    this.groundBody = this.world.createRigidBody(groundDesc);

    const c = this.circuit;

    // Build mechanical port connectivity: which components share mechanical connections
    const mechConnections = new Map<string, Set<string>>(); // compId -> connected compIds
    for (const conn of c.connections) {
      if (!conn.is_mechanical) continue;
      const compA = this.findComponentByPort(conn.port_a);
      const compB = this.findComponentByPort(conn.port_b);
      if (compA && compB && compA.id !== compB.id) {
        if (!mechConnections.has(compA.id)) mechConnections.set(compA.id, new Set());
        if (!mechConnections.has(compB.id)) mechConnections.set(compB.id, new Set());
        mechConnections.get(compA.id)!.add(compB.id);
        mechConnections.get(compB.id)!.add(compA.id);
      }
    }

    // Create Rapier bodies for cylinders
    for (const comp of c.components) {
      if (comp.type === 'DOUBLE_ACTING_CYLINDER' || comp.type === 'SINGLE_ACTING_CYLINDER') {
        this.createCylinderBody(comp);
      }
    }

    // Create Rapier bodies for mass loads
    for (const comp of c.components) {
      if (comp.type === 'MASS_LOAD') {
        this.createMassBody(comp, mechConnections);
      }
    }

    // Create spring links
    for (const comp of c.components) {
      if (comp.type === 'SPRING') {
        this.createSpringLink(comp, mechConnections);
      }
    }
  }

  private findComponentByPort(portIndex: number): ComponentInstance | null {
    if (!this.circuit) return null;
    for (const comp of this.circuit.components) {
      if (portIndex >= comp.portStartIndex && portIndex < comp.portStartIndex + comp.portCount) {
        return comp;
      }
    }
    return null;
  }

  private createCylinderBody(comp: ComponentInstance): void {
    if (!this.world || !this.groundBody) return;

    const bore = comp.params.bore_diameter ?? 0.05;
    const rod = comp.params.rod_diameter ?? 0.025;
    const stroke = comp.params.stroke_length ?? 0.2;
    const mass = comp.params.mass ?? 10;
    const isSingle = comp.type === 'SINGLE_ACTING_CYLINDER';

    const A_cap = Math.PI * bore * bore * 0.25;
    const A_rod = Math.PI * (bore * bore - rod * rod) * 0.25;

    const position = comp.state.position ?? 0;

    // Create dynamic body at current piston position
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position, 0)
      .setLinearDamping(0); // we handle viscous friction explicitly
    const body = this.world.createRigidBody(bodyDesc);

    // Set mass via a collider (small sensor — we only need the mass properties)
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.01, 0.01)
      .setMass(mass)
      .setSensor(true);
    this.world.createCollider(colliderDesc, body);

    // Prismatic joint: constrain to X-axis, limits [0, stroke]
    const jointParams = RAPIER.JointData.prismatic(
      new RAPIER.Vector2(0, 0),      // anchor on ground body
      new RAPIER.Vector2(-position, 0), // anchor on piston body (offset so joint space = [0, stroke])
      new RAPIER.Vector2(1, 0),       // axis
    );
    const joint = this.world.createImpulseJoint(jointParams, this.groundBody, body, true);
    joint.setLimitsEnabled(RAPIER.JointAxis.LinX, true);
    joint.setLimits(RAPIER.JointAxis.LinX, 0, stroke);

    const info: RapierCylinderBody = {
      compId: comp.id,
      body,
      joint,
      A_cap,
      A_rod,
      stroke,
      isSingleActing: isSingle,
    };

    this.cylinderBodies.set(comp.id, info);
    this.rapierManagedIds.add(comp.id);
  }

  private createMassBody(comp: ComponentInstance, mechConns: Map<string, Set<string>>): void {
    if (!this.world) return;

    const mass = comp.params.mass ?? 100;

    // Find if this mass is connected to a cylinder — if so, share its body
    const connected = mechConns.get(comp.id);
    if (connected) {
      for (const otherId of connected) {
        const cyl = this.cylinderBodies.get(otherId);
        if (cyl) {
          // Increase the cylinder body's mass to include this load
          // Rapier: we add mass by adding another collider
          const colliderDesc = RAPIER.ColliderDesc.cuboid(0.005, 0.005)
            .setMass(mass)
            .setSensor(true);
          this.world.createCollider(colliderDesc, cyl.body);

          this.massBodies.set(comp.id, { compId: comp.id, body: cyl.body });
          this.rapierManagedIds.add(comp.id);
          return;
        }
      }
    }

    // Standalone mass body (no cylinder connection) — create its own body
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0)
      .setLinearDamping(0);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.01, 0.01)
      .setMass(mass)
      .setSensor(true);
    this.world.createCollider(colliderDesc, body);

    this.massBodies.set(comp.id, { compId: comp.id, body });
    this.rapierManagedIds.add(comp.id);
  }

  private createSpringLink(comp: ComponentInstance, mechConns: Map<string, Set<string>>): void {
    if (!this.world || !this.groundBody) return;

    const springRate = comp.params.spring_rate ?? 10000;
    const preload = comp.params.preload ?? 0;
    const damping = comp.params.damping ?? 100;

    // Find the two bodies connected by this spring's mechanical ports
    const connected = mechConns.get(comp.id);
    let bodyA: RAPIER.RigidBody = this.groundBody;
    let bodyB: RAPIER.RigidBody = this.groundBody;

    if (connected) {
      const connArray = Array.from(connected);
      for (const otherId of connArray) {
        const cyl = this.cylinderBodies.get(otherId);
        const massB = this.massBodies.get(otherId);
        const otherBody = cyl?.body ?? massB?.body;
        if (otherBody) {
          if (bodyA === this.groundBody) {
            bodyA = otherBody;
          } else {
            bodyB = otherBody;
          }
        }
      }
    }

    this.springLinks.push({ compId: comp.id, bodyA, bodyB, springRate, preload, damping });
    this.rapierManagedIds.add(comp.id);
  }

  step(n: number = 1): void {
    if (!this.circuit) return;
    for (let i = 0; i < n; i++) {
      this.stepOnce();
    }
  }

  private stepOnce(): void {
    const c = this.circuit!;
    const dt = c.params.dt;

    // ── Pass 1: Wave variable update (hydraulic connections) ──
    for (const conn of c.connections) {
      const a = c.portsPrev[conn.port_a];
      const b = c.portsPrev[conn.port_b];

      if (conn.is_mechanical) {
        c.ports[conn.port_a].c = b.p;
        c.ports[conn.port_a].Zc = 0;
        c.ports[conn.port_b].c = a.p;
        c.ports[conn.port_b].Zc = 0;
      } else {
        const fluid = c.fluids[conn.fluid_id];
        const p_avg = 0.5 * (a.p + b.p);
        const area = Math.PI * conn.inner_diameter * conn.inner_diameter * 0.25;
        const ws = waveSpeed(p_avg, fluid, c.params);
        const beta = effectiveBulkModulus(p_avg, fluid, c.params);
        const Zc = beta / (area * ws);
        conn.Zc = Zc;

        c.ports[conn.port_a].c = b.p + Zc * b.q;
        c.ports[conn.port_a].Zc = Zc;
        c.ports[conn.port_a].fluid_id = conn.fluid_id;
        c.ports[conn.port_b].c = a.p + Zc * a.q;
        c.ports[conn.port_b].Zc = Zc;
        c.ports[conn.port_b].fluid_id = conn.fluid_id;
      }
    }

    // ── Pass 2: C-type components ──
    for (const comp of c.cComponents) {
      this.updateCType(comp);
    }

    // ── Pass 3: S-type components ──
    for (const comp of c.sComponents) {
      this.updateSType(comp);
    }

    // ── Pass 3b: Signal routing ──
    for (const route of c.signalRoutes) {
      const src = c.componentById.get(route.sourceComponentId);
      const tgt = c.componentById.get(route.targetComponentId);
      if (src && tgt) {
        tgt.state[route.targetKey] = src.state[route.sourceKey] ?? 0;
      }
    }

    // ── Pass 4: Rapier mechanical step ──
    if (this.world) {
      this.applyHydraulicForcesToRapier(dt);
      this.applySpringForces();
      this.applyExternalForces(dt);

      // Step Rapier
      this.world.timestep = dt;
      this.world.step();

      // Read back Rapier state → update cylinder ports and component state
      this.syncRapierToCylinders();
    }

    // ── Pass 5: Non-mechanical Q-type components (valves, orifices) ──
    for (const comp of c.qComponents) {
      if (this.rapierManagedIds.has(comp.id)) continue;

      // Oscillating force: update but don't use TLM mechanical model
      if (comp.type === 'OSCILLATING_FORCE') {
        this.updateOscillatingForceRapier(comp);
        continue;
      }

      this.updateQType(comp);
    }

    // ── Pass 6: Swap buffers ──
    for (let i = 0; i < c.ports.length; i++) {
      c.portsPrev[i].p = c.ports[i].p;
      c.portsPrev[i].q = c.ports[i].q;
      c.portsPrev[i].c = c.ports[i].c;
      c.portsPrev[i].Zc = c.ports[i].Zc;
      c.portsPrev[i].fluid_id = c.ports[i].fluid_id;
    }

    c.params.time += dt;
    c.params.step++;
  }

  /** Compute hydraulic pressure forces on each cylinder and apply to Rapier bodies. */
  private applyHydraulicForcesToRapier(dt: number): void {
    const c = this.circuit!;

    for (const [compId, cylInfo] of this.cylinderBodies) {
      const comp = c.componentById.get(compId);
      if (!comp) continue;

      const portA = c.ports[comp.portStartIndex];
      const portB = cylInfo.isSingleActing ? null : c.ports[comp.portStartIndex + 1];

      const position = cylInfo.body.translation().x;
      const velocity = cylInfo.body.linvel().x;

      let c_A: number, Zc_A: number;
      let c_B: number, Zc_B: number;

      if (cylInfo.isSingleActing) {
        c_A = portA.c;
        Zc_A = portA.Zc;
        c_B = 0;
        Zc_B = 0;
      } else {
        const capA = comp.params.cap_a ?? 0;
        const capB = comp.params.cap_b ?? 0;

        if (capA) {
          const deadVol = comp.params.dead_volume_A ?? 1e-6;
          const V_A = Math.max(cylInfo.A_cap * position + deadVol, MIN_TRAPPED_VOLUME_M3);
          const fluid = c.fluids[portA.fluid_id] || c.fluids[0];
          const p_trapped = comp.state.p_cap_a ?? c.params.p_atm;
          const beta = effectiveBulkModulus(p_trapped, fluid, c.params);
          Zc_A = beta * dt / V_A;
          c_A = p_trapped;
        } else {
          c_A = portA.c;
          Zc_A = portA.Zc;
        }

        if (capB) {
          const deadVol = comp.params.dead_volume_B ?? 1e-6;
          const V_B = Math.max(cylInfo.A_rod * (cylInfo.stroke - position) + deadVol, MIN_TRAPPED_VOLUME_M3);
          const fluid = c.fluids[portB!.fluid_id] || c.fluids[0];
          const p_trapped = comp.state.p_cap_b ?? c.params.p_atm;
          const beta = effectiveBulkModulus(p_trapped, fluid, c.params);
          Zc_B = beta * dt / V_B;
          c_B = p_trapped;
        } else {
          c_B = portB!.c;
          Zc_B = portB!.Zc;
        }
      }

      // Hydraulic force from wave variables
      // F = p_A * A_cap - p_B * A_rod
      // Using TLM relationship: p = c - Zc * q, with q_A = v * A_cap
      // F_wave = c_A * A_cap - c_B * A_rod
      // The impedance coupling creates a velocity-dependent damping:
      // F_impedance = -(Zc_A * A_cap² + Zc_B * A_rod²) * v
      const F_wave = c_A * cylInfo.A_cap - c_B * cylInfo.A_rod;
      const hydraulicDamping = Zc_A * cylInfo.A_cap * cylInfo.A_cap + Zc_B * cylInfo.A_rod * cylInfo.A_rod;
      const F_impedance = -hydraulicDamping * velocity;

      // Viscous friction
      const frictionViscous = comp.params.friction_viscous ?? 100;
      const F_friction = -frictionViscous * velocity;

      // Single-acting: spring return + atmospheric
      let F_spring = 0;
      if (cylInfo.isSingleActing) {
        const springRate = comp.params.spring_rate ?? 1000;
        const springPreload = comp.params.spring_preload ?? 100;
        const A_rod_sa = cylInfo.A_rod;
        F_spring = -(springRate * position + springPreload) - P_ATM * A_rod_sa;
      }

      // Mouse force
      const mouseForce = this.mouseForces.get(compId) || 0;
      const externalForce = (comp.params.external_force ?? 0) + (comp.state.signal_input ?? 0) + mouseForce;

      // Mechanical port force
      const mechPortIndex = cylInfo.isSingleActing
        ? comp.portStartIndex + 2
        : comp.portStartIndex + 3;
      const portMech = c.ports[mechPortIndex];
      const F_mech = portMech ? portMech.c : 0;

      const totalForce = F_wave + F_impedance + F_friction + F_spring + externalForce + F_mech;
      cylInfo.body.applyForce(new RAPIER.Vector2(totalForce, 0), true);
    }
  }

  /** Apply spring forces between connected Rapier bodies. */
  private applySpringForces(): void {
    for (const link of this.springLinks) {
      const posA = link.bodyA.translation().x;
      const posB = link.bodyB.translation().x;
      const velA = link.bodyA.linvel().x;
      const velB = link.bodyB.linvel().x;

      const displacement = posA - posB;
      const relVelocity = velA - velB;

      const force = link.springRate * displacement + link.preload + link.damping * relVelocity;

      // Apply equal and opposite forces
      if (link.bodyA.bodyType() === RAPIER.RigidBodyType.Dynamic) {
        link.bodyA.applyForce(new RAPIER.Vector2(-force, 0), true);
      }
      if (link.bodyB.bodyType() === RAPIER.RigidBodyType.Dynamic) {
        link.bodyB.applyForce(new RAPIER.Vector2(force, 0), true);
      }

      // Update spring component state
      const comp = this.circuit?.componentById.get(link.compId);
      if (comp) {
        comp.state.displacement = displacement;
      }
    }
  }

  /** Apply external forces (gravity, user forces) to mass load bodies. */
  private applyExternalForces(_dt: number): void {
    const c = this.circuit!;

    for (const [compId, massInfo] of this.massBodies) {
      const comp = c.componentById.get(compId);
      if (!comp) continue;

      const gravityForce = comp.params.gravity_force ?? 0;
      const externalForce = comp.params.external_force ?? 0;

      // Mechanical port wave variable
      const port = c.ports[comp.portStartIndex];
      const F_port = port ? port.c : 0;

      massInfo.body.applyForce(
        new RAPIER.Vector2(gravityForce + externalForce + F_port, 0),
        true
      );
    }

    // Apply oscillating forces to connected bodies
    for (const comp of c.components) {
      if (comp.type !== 'OSCILLATING_FORCE') continue;
      // Find which body this force source connects to via mechanical ports
      for (const conn of c.connections) {
        if (!conn.is_mechanical) continue;
        const port = c.ports[comp.portStartIndex];
        if (conn.port_a === comp.portStartIndex || conn.port_b === comp.portStartIndex) {
          const otherPortIdx = conn.port_a === comp.portStartIndex ? conn.port_b : conn.port_a;
          const otherComp = this.findComponentByPort(otherPortIdx);
          if (otherComp) {
            const cyl = this.cylinderBodies.get(otherComp.id);
            const massB = this.massBodies.get(otherComp.id);
            const body = cyl?.body ?? massB?.body;
            if (body) {
              body.applyForce(new RAPIER.Vector2(port.p, 0), true);
            }
          }
        }
      }
    }
  }

  /** Read Rapier body positions/velocities back into cylinder components and port states. */
  private syncRapierToCylinders(): void {
    const c = this.circuit!;

    for (const [compId, cylInfo] of this.cylinderBodies) {
      const comp = c.componentById.get(compId);
      if (!comp) continue;

      const x_new = cylInfo.body.translation().x;
      const v_new = cylInfo.body.linvel().x;

      comp.state.position = x_new;
      comp.state.velocity = v_new;

      // Update hydraulic port pressures and flows
      const portA = c.ports[comp.portStartIndex];

      const capA = comp.params.cap_a ?? 0;
      const capB = comp.params.cap_b ?? 0;

      let c_A: number, Zc_A: number;
      if (capA) {
        const deadVol = comp.params.dead_volume_A ?? 1e-6;
        const V_A = Math.max(cylInfo.A_cap * x_new + deadVol, MIN_TRAPPED_VOLUME_M3);
        const fluid = c.fluids[portA.fluid_id] || c.fluids[0];
        const p_trapped = comp.state.p_cap_a ?? c.params.p_atm;
        const beta = effectiveBulkModulus(p_trapped, fluid, c.params);
        Zc_A = beta * c.params.dt / V_A;
        c_A = p_trapped;
      } else {
        c_A = portA.c;
        Zc_A = portA.Zc;
      }

      const q_A = v_new * cylInfo.A_cap;
      const p_A = c_A - Zc_A * q_A;
      comp.state.p_cap_a = Math.max(p_A, 0);

      if (capA) {
        portA.p = p_A;
        portA.q = 0;
      } else {
        portA.p = p_A;
        portA.q = -q_A;
      }

      if (!cylInfo.isSingleActing) {
        const portB = c.ports[comp.portStartIndex + 1];

        let c_B: number, Zc_B: number;
        if (capB) {
          const deadVol = comp.params.dead_volume_B ?? 1e-6;
          const V_B = Math.max(cylInfo.A_rod * (cylInfo.stroke - x_new) + deadVol, MIN_TRAPPED_VOLUME_M3);
          const fluid = c.fluids[portB.fluid_id] || c.fluids[0];
          const p_trapped = comp.state.p_cap_b ?? c.params.p_atm;
          const beta = effectiveBulkModulus(p_trapped, fluid, c.params);
          Zc_B = beta * c.params.dt / V_B;
          c_B = p_trapped;
        } else {
          c_B = portB.c;
          Zc_B = portB.Zc;
        }

        const q_B = -v_new * cylInfo.A_rod;
        const p_B = c_B - Zc_B * q_B;
        comp.state.p_cap_b = Math.max(p_B, 0);

        if (capB) {
          portB.p = p_B;
          portB.q = 0;
        } else {
          portB.p = p_B;
          portB.q = -q_B;
        }
      }

      // Mechanical port output
      const mechPortIndex = cylInfo.isSingleActing
        ? comp.portStartIndex + 2
        : comp.portStartIndex + 3;
      const portMech = c.ports[mechPortIndex];
      if (portMech) {
        const Zc_mech = portMech.Zc;
        const F_mech = portMech.c;
        portMech.q = v_new;
        portMech.p = F_mech - Zc_mech * v_new;
      }
    }

    // Update mass load component state
    for (const [compId, massInfo] of this.massBodies) {
      const comp = c.componentById.get(compId);
      if (!comp) continue;
      comp.state.velocity = massInfo.body.linvel().x;
      const port = c.ports[comp.portStartIndex];
      if (port) {
        port.q = massInfo.body.linvel().x;
        port.p = port.c - port.Zc * port.q;
      }
    }
  }

  /** Update oscillating force component state (waveform generation) without TLM mechanical model. */
  private updateOscillatingForceRapier(comp: ComponentInstance): void {
    const c = this.circuit!;
    const port = c.ports[comp.portStartIndex];

    const amplitude = comp.params.amplitude ?? 1000;
    const frequency = comp.params.frequency ?? 5;
    const waveform = comp.params.waveform ?? 0;
    const offset = comp.params.offset ?? 0;

    const phase = (c.params.time * frequency) % 1.0;

    let signal: number;
    switch (waveform) {
      case 1: signal = phase < 0.5 ? 1.0 : -1.0; break;
      case 2: signal = phase < 0.5 ? 4.0 * phase - 1.0 : 3.0 - 4.0 * phase; break;
      case 3: {
        const cycle = Math.floor(c.params.time * frequency);
        const prevCycle = comp.state.random_cycle ?? -1;
        if (cycle !== prevCycle) {
          const seed = Math.imul(cycle, 2654435761);
          comp.state.random_value = ((seed & 0x7fffffff) / 0x7fffffff) * 2 - 1;
          comp.state.random_cycle = cycle;
        }
        signal = comp.state.random_value ?? 0;
        break;
      }
      default: signal = Math.sin(2 * Math.PI * phase); break;
    }

    const forceValue = offset + amplitude * signal;
    comp.state.force_value = forceValue;
    port.p = forceValue;
    port.q = 0;
  }

  private updateCType(comp: ComponentInstance): void {
    const c = this.circuit!;
    switch (comp.type) {
      case 'PRESSURE_SOURCE':
        updatePressureSource(comp, c.ports, c.params);
        break;
      case 'TANK':
        updateTank(comp, c.ports, c.params);
        break;
      case 'TLM_LINE':
        updateTlmLine(comp, c.ports, c.fluids, c.params);
        break;
      case 'TEE_JUNCTION':
      case 'CROSS_JUNCTION':
        updateTeeJunction(comp, c.ports, c.fluids, c.params);
        break;
      case 'HYDROPNEUMATIC_SPHERE':
        updateHydropneumaticSphere(comp, c.ports, c.fluids, c.params);
        break;
      case 'PISTON_ACCUMULATOR':
        updatePistonAccumulator(comp, c.ports, c.fluids, c.params);
        break;
      case 'BALLOON_SPHERICAL':
      case 'BALLOON_CYLINDRICAL':
        updateBalloon(comp, c.ports, c.fluids, c.params);
        break;
    }
  }

  private updateQType(comp: ComponentInstance): void {
    const c = this.circuit!;
    switch (comp.type) {
      case 'ORIFICE':
        updateOrifice(comp, c.ports, c.fluids, c.params);
        break;
      case 'CHECK_VALVE':
        updateCheckValve(comp, c.ports, c.fluids, c.params);
        break;
      case 'ONE_WAY_FLOW_CONTROL':
        updateOneWayFlowControl(comp, c.ports, c.fluids, c.params);
        break;
      case 'VARIABLE_ORIFICE':
        updateVariableOrifice(comp, c.ports, c.fluids, c.params);
        break;
      case 'DCV_4_3':
      case 'DCV_5_2':
      case 'DCV_5_3':
        updateDcv43(comp, c.ports, c.fluids, c.params);
        break;
      case 'DCV_3_2':
        updateDcv32(comp, c.ports, c.fluids, c.params);
        break;
    }
  }

  private updateSType(comp: ComponentInstance): void {
    const c = this.circuit!;
    switch (comp.type) {
      case 'PUSH_BUTTON':
        updatePushButton(comp, c.params);
        break;
      case 'TOGGLE_SWITCH':
        updateToggleSwitch(comp, c.params);
        break;
      case 'SLIDER_CONTROL':
        updateSliderControl(comp, c.params);
        break;
    }
  }

  // ── Public Solver interface ──

  setMouseForce(componentId: string, force: number): void {
    this.mouseForces.set(componentId, force);
  }

  clearMouseForce(componentId: string): void {
    this.mouseForces.delete(componentId);
  }

  setComponentState(componentId: string, key: string, value: number): void {
    if (!this.circuit) return;
    const comp = this.circuit.componentById.get(componentId);
    if (comp) {
      comp.state[key] = value;
    }
  }

  getPortState(index: number): PortState {
    if (!this.circuit || index >= this.circuit.ports.length) {
      return createDefaultPort(this.circuit?.params.p_atm ?? DEFAULT_SIM_PARAMS.p_atm);
    }
    return { ...this.circuit.ports[index] };
  }

  getComponentState(id: string): Record<string, number> {
    if (!this.circuit) return {};
    const comp = this.circuit.componentById.get(id);
    if (!comp) return {};
    return { ...comp.state };
  }

  getAllPortStates(): PortState[] {
    return this.circuit ? this.circuit.ports.map((p) => ({ ...p })) : [];
  }

  getCompiledCircuit(): CompiledCircuit | null {
    return this.circuit;
  }

  getSimParams(): SimParams {
    return this.circuit ? { ...this.circuit.params } : { ...DEFAULT_SIM_PARAMS };
  }

  reset(): void {
    if (!this.circuit) return;
    const p_atm = this.circuit.params.p_atm;

    for (let i = 0; i < this.circuit.ports.length; i++) {
      const isMech = this.circuit.mechanicalPortIndices.has(i);
      this.circuit.ports[i].p = isMech ? 0 : p_atm;
      this.circuit.ports[i].q = 0;
      this.circuit.ports[i].c = isMech ? 0 : p_atm;
      this.circuit.ports[i].Zc = isMech ? 0 : 1e6;
    }
    for (let i = 0; i < this.circuit.portsPrev.length; i++) {
      const isMech = this.circuit.mechanicalPortIndices.has(i);
      this.circuit.portsPrev[i].p = isMech ? 0 : p_atm;
      this.circuit.portsPrev[i].q = 0;
      this.circuit.portsPrev[i].c = isMech ? 0 : p_atm;
      this.circuit.portsPrev[i].Zc = isMech ? 0 : 1e6;
    }
    for (const comp of this.circuit.components) {
      if (comp.initialState) {
        comp.state = { ...comp.initialState };
      }
    }
    this.circuit.params.time = 0;
    this.circuit.params.step = 0;
    this.mouseForces.clear();

    // Reset Rapier bodies to initial positions
    for (const [compId, cylInfo] of this.cylinderBodies) {
      const comp = this.circuit.componentById.get(compId);
      if (comp) {
        const pos = comp.state.position ?? 0;
        cylInfo.body.setTranslation(new RAPIER.Vector2(pos, 0), true);
        cylInfo.body.setLinvel(new RAPIER.Vector2(0, 0), true);
      }
    }
    for (const [, massInfo] of this.massBodies) {
      massInfo.body.setTranslation(new RAPIER.Vector2(0, 0), true);
      massInfo.body.setLinvel(new RAPIER.Vector2(0, 0), true);
    }
  }

  dispose(): void {
    this.world?.free();
    this.world = null;
    this.groundBody = null;
    this.cylinderBodies.clear();
    this.massBodies.clear();
    this.springLinks = [];
    this.rapierManagedIds.clear();
    this.circuit = null;
    this.mouseForces.clear();
  }
}

// ============================================================
// Circuit Compiler (duplicated from engine.ts to avoid coupling)
// We reuse the same CompiledCircuit structure.
// ============================================================

import { MIN_LINE_LENGTH } from '../types';

function initComponentState(def: { type: string; params: Record<string, number | string | boolean> }): Record<string, number> {
  const state: Record<string, number> = {};
  const p = def.params;

  switch (def.type) {
    case 'PRESSURE_SOURCE':
      state.ramp_count = 0;
      break;
    case 'DOUBLE_ACTING_CYLINDER': {
      const stroke = typeof p.stroke_length === 'number' ? p.stroke_length : 0.2;
      const pos = typeof p.position === 'number' ? p.position : 0;
      state.position = Math.max(0, Math.min(pos, stroke));
      state.velocity = 0;
      state.p_cap_a = DEFAULT_SIM_PARAMS.p_atm;
      state.p_cap_b = DEFAULT_SIM_PARAMS.p_atm;
      break;
    }
    case 'SINGLE_ACTING_CYLINDER': {
      const stroke = typeof p.stroke_length === 'number' ? p.stroke_length : 0.2;
      const pos = typeof p.position === 'number' ? p.position : 0;
      state.position = Math.max(0, Math.min(pos, stroke));
      state.velocity = 0;
      break;
    }
    case 'HYDROPNEUMATIC_SPHERE':
      state.h = (typeof p.diaphragm_rest_ratio === 'number' ? p.diaphragm_rest_ratio : 0.5)
        * 2 * (typeof p.R_sphere === 'number' ? p.R_sphere : 0.06);
      state.h_dot = 0;
      break;
    case 'PISTON_ACCUMULATOR':
      state.piston_position = (typeof p.piston_position === 'number' ? p.piston_position : 0);
      state.piston_velocity = 0;
      break;
    case 'BALLOON_SPHERICAL':
    case 'BALLOON_CYLINDRICAL': {
      const R = typeof p.R_nominal === 'number' ? p.R_nominal : 0.025;
      if (def.type === 'BALLOON_SPHERICAL') {
        state.V_current = (4 / 3) * Math.PI * R * R * R;
      } else {
        const L = typeof p.length === 'number' ? p.length : 0.1;
        state.V_current = Math.PI * R * R * L;
      }
      state.V_dot = 0;
      break;
    }
    case 'VARIABLE_ORIFICE':
      state.actual_position = typeof p.position === 'number' ? p.position : 0;
      break;
    case 'DCV_4_3':
    case 'DCV_3_2':
    case 'DCV_5_2':
    case 'DCV_5_3':
      state.actual_spool = typeof p.spool_position === 'number' ? p.spool_position : 0;
      break;
    case 'PUSH_BUTTON':
      state.pressed = 0;
      state.spool_position = 0;
      break;
    case 'TOGGLE_SWITCH':
      state.toggle_state = 0;
      state.spool_position = 0;
      break;
    case 'SLIDER_CONTROL':
      state.value = typeof p.initial_value === 'number' ? p.initial_value : 0;
      break;
    case 'OSCILLATING_FORCE':
      state.force_value = 0;
      state.random_cycle = -1;
      state.random_value = 0;
      break;
    case 'TLM_LINE':
      state.p_internal = typeof p.initial_pressure === 'number' ? p.initial_pressure : 101325;
      break;
    case 'TEE_JUNCTION':
    case 'CROSS_JUNCTION':
      state.p_junction = typeof p.initial_pressure === 'number' ? p.initial_pressure : 101325;
      break;
  }

  return state;
}

function compileCircuitDef(def: CircuitDefinition): CompiledCircuit {
  const fluids = def.fluids.length > 0
    ? def.fluids
    : [{ id: 0, fluid_type: 'LIQUID' as const, beta_base: 1.6e9, rho_base: 861, nu: 46e-6, x_air_0: 0.01, kappa: 1.2, p_vapour: 3000, gamma: 0, molar_mass: 0, henry_coeff: 0, label: 'ISO VG 46' }];

  const fluidIndexById = new Map<number, number>();
  for (let i = 0; i < fluids.length; i++) {
    fluidIndexById.set(fluids[i].id, i);
  }

  const defaultFluidIndex = fluidIndexById.get(def.default_fluid_id) ?? 0;
  const resolveFluidIndex = (fluidId: number | undefined): number => {
    if (fluidId === undefined) return defaultFluidIndex;
    return fluidIndexById.get(fluidId) ?? defaultFluidIndex;
  };

  const params: SimParams = { ...DEFAULT_SIM_PARAMS };

  let portIndex = 0;
  const componentPortMap: Map<string, Map<string, number>> = new Map();
  const components: ComponentInstance[] = [];
  const mechanicalPortIndices = new Set<number>();

  for (const compDef of def.components) {
    const portMap = new Map<string, number>();
    const portStart = portIndex;
    for (const portDef of compDef.ports) {
      portMap.set(portDef.id, portIndex);
      if (portDef.type === 'mechanical') {
        mechanicalPortIndices.add(portIndex);
      }
      portIndex++;
    }
    componentPortMap.set(compDef.id, portMap);

    const numericParams: Record<string, number> = {};
    for (const [key, val] of Object.entries(compDef.params)) {
      if (typeof val === 'number') {
        if ((key === 'fluid_id' || key === 'fluid_id_gas') && Number.isFinite(val)) {
          numericParams[key] = resolveFluidIndex(val);
        } else {
          numericParams[key] = val;
        }
      }
      else if (typeof val === 'boolean') numericParams[key] = val ? 1 : 0;
    }

    const state = initComponentState(compDef);
    components.push({
      id: compDef.id,
      type: compDef.type,
      tlmClass: COMPONENT_TLM_CLASS[compDef.type] || 'Q',
      portStartIndex: portStart,
      portCount: compDef.ports.length,
      params: numericParams,
      state,
      initialState: { ...state },
    });
  }

  const ports: PortState[] = Array.from({ length: portIndex }, () => createDefaultPort(params.p_atm));
  const portsPrev: PortState[] = Array.from({ length: portIndex }, () => createDefaultPort(params.p_atm));

  for (const idx of mechanicalPortIndices) {
    ports[idx].p = 0;
    ports[idx].c = 0;
    ports[idx].Zc = 0;
    portsPrev[idx].p = 0;
    portsPrev[idx].c = 0;
    portsPrev[idx].Zc = 0;
  }

  const portTypeLookup = new Map<string, string>();
  for (const compDef of def.components) {
    for (const portDef of compDef.ports) {
      portTypeLookup.set(`${compDef.id}:${portDef.id}`, portDef.type);
    }
  }

  const signalSourceKey: Record<string, string> = {
    PUSH_BUTTON: 'spool_position',
    TOGGLE_SWITCH: 'spool_position',
    SLIDER_CONTROL: 'value',
  };

  const connections: CompiledConnection[] = [];
  const signalRoutes: SignalRoute[] = [];
  for (const connDef of def.connections) {
    const fromMap = componentPortMap.get(connDef.from.component);
    const toMap = componentPortMap.get(connDef.to.component);
    if (!fromMap || !toMap) continue;
    const portA = fromMap.get(connDef.from.port);
    const portB = toMap.get(connDef.to.port);
    if (portA === undefined || portB === undefined) continue;

    const fromType = portTypeLookup.get(`${connDef.from.component}:${connDef.from.port}`);
    const toType = portTypeLookup.get(`${connDef.to.component}:${connDef.to.port}`);
    if (fromType === 'signal' || toType === 'signal') {
      if (fromType !== 'signal' || toType !== 'signal') continue;
      const fromComp = def.components.find((c) => c.id === connDef.from.component);
      const toComp = def.components.find((c) => c.id === connDef.to.component);
      if (fromComp && toComp) {
        const fromClass = COMPONENT_TLM_CLASS[fromComp.type] || 'Q';
        const toClass = COMPONENT_TLM_CLASS[toComp.type] || 'Q';
        let srcId: string, tgtId: string, srcType: string;
        if (fromClass === 'S') {
          srcId = fromComp.id;
          tgtId = toComp.id;
          srcType = fromComp.type;
        } else if (toClass === 'S') {
          srcId = toComp.id;
          tgtId = fromComp.id;
          srcType = toComp.type;
        } else {
          continue;
        }
        signalRoutes.push({
          sourceComponentId: srcId,
          sourceKey: signalSourceKey[srcType] ?? 'spool_position',
          targetComponentId: tgtId,
          targetKey: 'signal_input',
        });
      }
      continue;
    }

    const portAisMech = mechanicalPortIndices.has(portA);
    const portBisMech = mechanicalPortIndices.has(portB);
    if (portAisMech !== portBisMech) continue;

    const isMechanicalConn = portAisMech && portBisMech;

    if (isMechanicalConn) {
      connections.push({
        port_a: portA, port_b: portB,
        line_length: 0, inner_diameter: 0, fluid_id: 0, Zc: 0, is_mechanical: true,
      });
    } else {
      const fluidId = resolveFluidIndex(connDef.line_params.fluid_id);
      const fluid = fluids[fluidId] || fluids[0];
      const length = Math.max(connDef.line_params.length, MIN_LINE_LENGTH);
      const diameter = connDef.line_params.inner_diameter || 0.01;
      const area = Math.PI * diameter * diameter * 0.25;
      const ws = waveSpeed(params.p_atm, fluid, params);
      const beta = effectiveBulkModulus(params.p_atm, fluid, params);
      const Zc = beta / (area * ws);
      connections.push({
        port_a: portA, port_b: portB,
        line_length: length, inner_diameter: diameter, fluid_id: fluidId, Zc, is_mechanical: false,
      });
    }
  }

  let minDelay = Infinity;
  for (const conn of connections) {
    if (conn.is_mechanical) continue;
    const fluid = fluids[conn.fluid_id] || fluids[0];
    const ws = waveSpeed(params.p_atm, fluid, params);
    const delay = conn.line_length / ws;
    if (delay < minDelay) minDelay = delay;
  }
  params.dt = minDelay > 0 && minDelay < Infinity ? minDelay : 1e-4;

  const componentById = new Map<string, ComponentInstance>();
  for (const comp of components) {
    componentById.set(comp.id, comp);
  }

  const cComponents = components.filter((c) => c.tlmClass === 'C');
  const qComponents = components.filter((c) => c.tlmClass === 'Q');
  const sComponents = components.filter((c) => c.tlmClass === 'S');

  return {
    fluids, ports, portsPrev, connections, signalRoutes,
    components, componentById, cComponents, qComponents, sComponents,
    mechanicalPortIndices, params,
  };
}
