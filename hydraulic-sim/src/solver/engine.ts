/**
 * TLM Solver Engine — JavaScript reference implementation.
 *
 * Execution order each Δt: C-types → S-types → signal routing → Q-types
 * All components within each class execute independently (embarrassingly parallel).
 */

import {
  type PortState,
  type SimParams,
  type FluidDef,
  type ComponentInstance,
  DEFAULT_SIM_PARAMS,
  type CircuitDefinition,
  type Solver,
  COMPONENT_TLM_CLASS,
} from './types';
import {
  effectiveBulkModulus,
  waveSpeed,
} from '../fluid/properties';
import { updatePressureSource, updateTank, updateTlmLine, updateTeeJunction, updateHydropneumaticSphere, updatePistonAccumulator, updateBalloon } from '../components/models/cTypes';
import { updateDoubleActingCylinder, updateSingleActingCylinder, updateOrifice, updateCheckValve, updateOneWayFlowControl, updateVariableOrifice, updateDcv43, updateDcv32, updateSpring, updateMassLoad } from '../components/models/qTypes';
import { updatePushButton, updateToggleSwitch, updateSliderControl, updateOscillatingForce } from '../components/models/sTypes';

export interface CompiledConnection {
  port_a: number;
  port_b: number;
  line_length: number;
  inner_diameter: number;
  fluid_id: number;
  Zc: number;
}

export interface SignalRoute {
  sourceComponentId: string;
  sourceKey: string;       // state key to read (e.g. 'spool_position' or 'value')
  targetComponentId: string;
  targetKey: string;       // state key to write (e.g. 'signal_input')
}

export interface CompiledCircuit {
  fluids: FluidDef[];
  ports: PortState[];
  portsPrev: PortState[];
  connections: CompiledConnection[];
  signalRoutes: SignalRoute[];
  components: ComponentInstance[];
  componentById: Map<string, ComponentInstance>;
  cComponents: ComponentInstance[];
  qComponents: ComponentInstance[];
  sComponents: ComponentInstance[];
  params: SimParams;
}

function createDefaultPort(): PortState {
  return { p: 101325, q: 0, c: 101325, Zc: 1e6, fluid_id: 0 };
}

export class TLMSolverEngine implements Solver {
  private circuit: CompiledCircuit | null = null;
  private mouseForces: Map<string, number> = new Map();

  init(circuitDef: CircuitDefinition): void {
    this.circuit = compileCircuitDef(circuitDef);
  }

  step(n: number = 1): void {
    if (!this.circuit) return;
    for (let i = 0; i < n; i++) {
      this.stepOnce();
    }
  }

  private stepOnce(): void {
    const c = this.circuit!;

    // Pass 1: Wave variable update (connections)
    for (const conn of c.connections) {
      const a = c.portsPrev[conn.port_a];
      const b = c.portsPrev[conn.port_b];
      const fluid = c.fluids[conn.fluid_id];
      const p_avg = 0.5 * (a.p + b.p);
      const area =
        Math.PI * conn.inner_diameter * conn.inner_diameter * 0.25;
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

    // Pass 2: C-type components
    for (const comp of c.cComponents) {
      this.updateCType(comp);
    }

    // Pass 3: S-type components (before Q-types so signals propagate same step)
    for (const comp of c.sComponents) {
      this.updateSType(comp);
    }

    // Pass 3b: Signal routing — propagate S-type outputs to Q-type inputs
    for (const route of c.signalRoutes) {
      const src = c.componentById.get(route.sourceComponentId);
      const tgt = c.componentById.get(route.targetComponentId);
      if (src && tgt) {
        tgt.state[route.targetKey] = src.state[route.sourceKey] ?? 0;
      }
    }

    // Pass 4: Q-type components
    for (const comp of c.qComponents) {
      this.updateQType(comp);
    }

    // Pass 5: Swap buffers
    for (let i = 0; i < c.ports.length; i++) {
      c.portsPrev[i].p = c.ports[i].p;
      c.portsPrev[i].q = c.ports[i].q;
      c.portsPrev[i].c = c.ports[i].c;
      c.portsPrev[i].Zc = c.ports[i].Zc;
      c.portsPrev[i].fluid_id = c.ports[i].fluid_id;
    }

    c.params.time += c.params.dt;
    c.params.step++;
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
    // Apply external mouse force if any
    const mouseForce = this.mouseForces.get(comp.id) || 0;

    switch (comp.type) {
      case 'DOUBLE_ACTING_CYLINDER':
        updateDoubleActingCylinder(comp, c.ports, c.fluids, c.params, mouseForce);
        break;
      case 'SINGLE_ACTING_CYLINDER':
        updateSingleActingCylinder(comp, c.ports, c.fluids, c.params, mouseForce);
        break;
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
      case 'SPRING':
        updateSpring(comp, c.ports, c.params);
        break;
      case 'MASS_LOAD':
        updateMassLoad(comp, c.ports, c.params);
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
      case 'OSCILLATING_FORCE':
        updateOscillatingForce(comp, c.params);
        break;
    }
  }

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
      return createDefaultPort();
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
    for (const port of this.circuit.ports) {
      port.p = 101325;
      port.q = 0;
      port.c = 101325;
      port.Zc = 1e6;
    }
    for (const port of this.circuit.portsPrev) {
      port.p = 101325;
      port.q = 0;
      port.c = 101325;
      port.Zc = 1e6;
    }
    for (const comp of this.circuit.components) {
      // Reset component-specific state
      if (comp.type === 'DOUBLE_ACTING_CYLINDER' || comp.type === 'SINGLE_ACTING_CYLINDER') {
        comp.state.position = 0;
        comp.state.velocity = 0;
      }
    }
    this.circuit.params.time = 0;
    this.circuit.params.step = 0;
    this.mouseForces.clear();
  }

  dispose(): void {
    this.circuit = null;
    this.mouseForces.clear();
  }
}

// ============================================================
// Circuit Compiler
// ============================================================

function compileCircuitDef(def: CircuitDefinition): CompiledCircuit {
  const fluids = def.fluids.length > 0
    ? def.fluids
    : [{ id: 0, fluid_type: 'LIQUID' as const, beta_base: 1.6e9, rho_base: 861, nu: 46e-6, x_air_0: 0.01, kappa: 1.2, p_vapour: 3000, gamma: 0, molar_mass: 0, henry_coeff: 0, label: 'ISO VG 46' }];

  const params: SimParams = { ...DEFAULT_SIM_PARAMS };

  // Assign port indices
  let portIndex = 0;
  const componentPortMap: Map<string, Map<string, number>> = new Map();
  const components: ComponentInstance[] = [];

  for (const compDef of def.components) {
    const portMap = new Map<string, number>();
    const portStart = portIndex;
    for (const portDef of compDef.ports) {
      portMap.set(portDef.id, portIndex);
      portIndex++;
    }
    componentPortMap.set(compDef.id, portMap);

    const numericParams: Record<string, number> = {};
    for (const [key, val] of Object.entries(compDef.params)) {
      if (typeof val === 'number') numericParams[key] = val;
      else if (typeof val === 'boolean') numericParams[key] = val ? 1 : 0;
    }

    components.push({
      id: compDef.id,
      type: compDef.type,
      tlmClass: COMPONENT_TLM_CLASS[compDef.type] || 'Q',
      portStartIndex: portStart,
      portCount: compDef.ports.length,
      params: numericParams,
      state: initComponentState(compDef),
    });
  }

  // Create port buffers
  const ports: PortState[] = Array.from({ length: portIndex }, createDefaultPort);
  const portsPrev: PortState[] = Array.from({ length: portIndex }, createDefaultPort);

  // Build port type lookup: "componentId:portId" -> PortType
  const portTypeLookup = new Map<string, string>();
  for (const compDef of def.components) {
    for (const portDef of compDef.ports) {
      portTypeLookup.set(`${compDef.id}:${portDef.id}`, portDef.type);
    }
  }

  // Signal source key for each S-type component type
  const signalSourceKey: Record<string, string> = {
    PUSH_BUTTON: 'spool_position',
    TOGGLE_SWITCH: 'spool_position',
    SLIDER_CONTROL: 'value',
    OSCILLATING_FORCE: 'force_value',
  };

  // Compile connections — separate signal routes from TLM connections
  const connections: CompiledConnection[] = [];
  const signalRoutes: SignalRoute[] = [];
  const warnedMismatches: string[] = [];
  for (const connDef of def.connections) {
    const fromMap = componentPortMap.get(connDef.from.component);
    const toMap = componentPortMap.get(connDef.to.component);
    if (!fromMap || !toMap) continue;
    const portA = fromMap.get(connDef.from.port);
    const portB = toMap.get(connDef.to.port);
    if (portA === undefined || portB === undefined) continue;

    // Check if endpoints are signal ports
    const fromType = portTypeLookup.get(`${connDef.from.component}:${connDef.from.port}`);
    const toType = portTypeLookup.get(`${connDef.to.component}:${connDef.to.port}`);
    if (fromType === 'signal' || toType === 'signal') {
      if (fromType !== 'signal' || toType !== 'signal') {
        // Mismatched connection (signal↔hydraulic/mechanical) — collect for single warning
        warnedMismatches.push(
          `  ${connDef.from.component}:${connDef.from.port} (${fromType}) → ${connDef.to.component}:${connDef.to.port} (${toType})`
        );
        continue;
      }
      // Both endpoints are signal — determine source (S-type) and target (Q-type) components
      const fromComp = def.components.find((c) => c.id === connDef.from.component);
      const toComp = def.components.find((c) => c.id === connDef.to.component);
      if (fromComp && toComp) {
        const fromClass = COMPONENT_TLM_CLASS[fromComp.type] || 'Q';
        const toClass = COMPONENT_TLM_CLASS[toComp.type] || 'Q';
        // Route signal from S-type to Q-type (or other direction if wired backwards)
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
          continue; // Neither end is an S-type; skip
        }
        signalRoutes.push({
          sourceComponentId: srcId,
          sourceKey: signalSourceKey[srcType] ?? 'spool_position',
          targetComponentId: tgtId,
          targetKey: 'signal_input',
        });
      }
      continue; // Don't create a TLM connection for signal wires
    }

    const fluidId = connDef.line_params.fluid_id ?? def.default_fluid_id ?? 0;
    const fluid = fluids[fluidId] || fluids[0];
    const length = Math.max(connDef.line_params.length, 0.05); // min 50mm
    const diameter = connDef.line_params.inner_diameter || 0.01;
    const area = Math.PI * diameter * diameter * 0.25;
    const ws = waveSpeed(params.p_atm, fluid, params);
    const beta = effectiveBulkModulus(params.p_atm, fluid, params);
    const Zc = beta / (area * ws);

    connections.push({
      port_a: portA,
      port_b: portB,
      line_length: length,
      inner_diameter: diameter,
      fluid_id: fluidId,
      Zc,
    });
  }

  if (warnedMismatches.length > 0) {
    console.warn(
      `Signal routing: skipping ${warnedMismatches.length} mismatched connection(s):\n${warnedMismatches.join('\n')}`
    );
  }

  // Compute dt from minimum line delay
  let minDelay = Infinity;
  for (const conn of connections) {
    const fluid = fluids[conn.fluid_id] || fluids[0];
    const ws = waveSpeed(params.p_atm, fluid, params);
    const delay = conn.line_length / ws;
    if (delay < minDelay) minDelay = delay;
  }
  params.dt = minDelay > 0 && minDelay < Infinity ? minDelay : 1e-4;

  // Build component lookup map (cached for use during stepping)
  const componentById = new Map<string, ComponentInstance>();
  for (const comp of components) {
    componentById.set(comp.id, comp);
  }

  // Classify components
  const cComponents = components.filter((c) => c.tlmClass === 'C');
  const qComponents = components.filter((c) => c.tlmClass === 'Q');
  const sComponents = components.filter((c) => c.tlmClass === 'S');

  return {
    fluids,
    ports,
    portsPrev,
    connections,
    signalRoutes,
    components,
    componentById,
    cComponents,
    qComponents,
    sComponents,
    params,
  };
}

function initComponentState(def: { type: string; params: Record<string, number | string | boolean> }): Record<string, number> {
  const state: Record<string, number> = {};
  const p = def.params;

  switch (def.type) {
    case 'PRESSURE_SOURCE':
      state.ramp_count = 0;
      break;
    case 'DOUBLE_ACTING_CYLINDER':
    case 'SINGLE_ACTING_CYLINDER':
      state.position = (typeof p.position === 'number' ? p.position : 0);
      state.velocity = 0;
      break;
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
