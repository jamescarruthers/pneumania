/**
 * Simulation integration tests.
 *
 * These tests construct small circuits programmatically, run the TLM solver
 * for a number of steps, and assert that pressures, flows, and positions
 * converge to physically correct steady-state values.
 *
 * They are intentionally deterministic (no random input, no GPU path) so
 * they can run as part of `npm run build` / CI.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TLMSolverEngine } from '../engine';
import { DEFAULT_SIM_PARAMS } from '../types';
import type { CircuitDefinition, ComponentDef, ConnectionDef, FluidDef, PortDef } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISO_VG_46: FluidDef = {
  id: 0,
  fluid_type: 'LIQUID',
  beta_base: 1.6e9,
  rho_base: 861,
  nu: 46e-6,
  x_air_0: 0.01,
  kappa: 1.2,
  p_vapour: 3000,
  gamma: 0,
  molar_mass: 0,
  henry_coeff: 0,
  label: 'ISO VG 46',
};

let nextId = 0;
function uid(): string {
  return `c${nextId++}`;
}

function makePort(id: string, type: 'hydraulic' | 'signal' = 'hydraulic', side: 'top' | 'bottom' | 'left' | 'right' = 'left', offset = 0.5): PortDef {
  return { id, type, side, offset };
}

function makeConnection(
  fromComp: string, fromPort: string,
  toComp: string, toPort: string,
  length = 0.5, diameter = 0.01,
): ConnectionDef {
  return {
    id: uid(),
    from: { component: fromComp, port: fromPort },
    to: { component: toComp, port: toPort },
    waypoints: [],
    line_params: { inner_diameter: diameter, length, fluid_id: 0 },
  };
}

function makeCircuit(
  components: ComponentDef[],
  connections: ConnectionDef[],
): CircuitDefinition {
  return {
    version: '1',
    fluids: [ISO_VG_46],
    default_fluid_id: 0,
    components,
    connections,
    ui: { camera: { x: 0, y: 0, zoom: 1 }, grid_size: 20 },
  };
}

function runFor(solver: TLMSolverEngine, steps: number): void {
  solver.step(steps);
}

/** Derive the global port index for a component's Nth port (0-based local offset). */
function portIndex(solver: TLMSolverEngine, componentId: string, localOffset = 0): number {
  const circuit = solver.getCompiledCircuit();
  if (!circuit) throw new Error('solver not initialised');
  const comp = circuit.componentById.get(componentId);
  if (!comp) throw new Error(`unknown component: ${componentId}`);
  if (localOffset >= comp.portCount) throw new Error(`port offset ${localOffset} out of range for ${componentId}`);
  return comp.portStartIndex + localOffset;
}

beforeEach(() => {
  nextId = 0;
});

// ---------------------------------------------------------------------------
// Double-Acting Cylinder Tests
// ---------------------------------------------------------------------------

describe('Double-Acting Cylinder', () => {
  /**
   * BUG REPRO: Equal pressure on both sides of a standard (single-rod)
   * cylinder.  Because A_cap > A_rod, the net force is P*(A_cap - A_rod),
   * so the piston MUST extend.  This is correct physics for a differential-
   * area cylinder.
   */
  it('extends under equal pressure due to differential piston area', () => {
    const pressure = 100e5; // 100 bar
    const srcA = uid();
    const srcB = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: srcA, type: 'PRESSURE_SOURCE', label: 'P1',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure },
          ports: [makePort('out', 'hydraulic', 'right')],
        },
        {
          id: srcB, type: 'PRESSURE_SOURCE', label: 'P2',
          position: { x: 200, y: 0 }, rotation: 0,
          params: { pressure },
          ports: [makePort('out', 'hydraulic', 'left')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,   // standard single-rod → A_cap > A_rod
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0.1,        // start at mid-stroke
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
          ],
        },
      ],
      [
        makeConnection(srcA, 'out', cyl, 'A'),
        makeConnection(srcB, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 5000);

    const state = solver.getComponentState(cyl);
    // With A_cap > A_rod and equal pressure, piston must have moved toward full extension
    expect(state.position).toBeGreaterThan(0.1);
  });

  /**
   * A rodless cylinder (rod_diameter = 0, so A_cap = A_rod) with equal
   * pressure on both sides MUST stay at its initial position.
   */
  it('stays stationary with equal pressure when areas are equal (rod_diameter = 0)', () => {
    const pressure = 100e5;
    const srcA = uid();
    const srcB = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: srcA, type: 'PRESSURE_SOURCE', label: 'P1',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure },
          ports: [makePort('out', 'hydraulic', 'right')],
        },
        {
          id: srcB, type: 'PRESSURE_SOURCE', label: 'P2',
          position: { x: 200, y: 0 }, rotation: 0,
          params: { pressure },
          ports: [makePort('out', 'hydraulic', 'left')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0,       // equal areas on both sides
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0.1,        // mid-stroke
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
          ],
        },
      ],
      [
        makeConnection(srcA, 'out', cyl, 'A'),
        makeConnection(srcB, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 5000);

    const state = solver.getComponentState(cyl);
    // Position should remain at 0.1 (mid-stroke) within a small tolerance
    expect(state.position).toBeCloseTo(0.1, 2);
    expect(Math.abs(state.velocity)).toBeLessThan(1e-4);
  });

  /**
   * Higher pressure on cap side should extend the cylinder.
   */
  it('extends when cap-side pressure is higher', () => {
    const srcA = uid();
    const srcB = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: srcA, type: 'PRESSURE_SOURCE', label: 'P-high',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 150e5 },
          ports: [makePort('out')],
        },
        {
          id: srcB, type: 'PRESSURE_SOURCE', label: 'P-low',
          position: { x: 200, y: 0 }, rotation: 0,
          params: { pressure: 50e5 },
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0.1,
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(srcA, 'out', cyl, 'A'),
        makeConnection(srcB, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 5000);

    const state = solver.getComponentState(cyl);
    // Should have extended
    expect(state.position).toBeGreaterThan(0.1);
  });

  /**
   * Higher pressure on rod side should retract the cylinder.
   */
  it('retracts when rod-side pressure is much higher', () => {
    const srcA = uid();
    const srcB = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: srcA, type: 'PRESSURE_SOURCE', label: 'P-low',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 10e5 },    // 10 bar cap
          ports: [makePort('out')],
        },
        {
          id: srcB, type: 'PRESSURE_SOURCE', label: 'P-high',
          position: { x: 200, y: 0 }, rotation: 0,
          params: { pressure: 200e5 },   // 200 bar rod
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0.1,
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(srcA, 'out', cyl, 'A'),
        makeConnection(srcB, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 5000);

    const state = solver.getComponentState(cyl);
    // 200 bar on A_rod still produces more force than 10 bar on A_cap
    // since 200e5 * A_rod >> 10e5 * A_cap, net force is retraction
    expect(state.position).toBeLessThan(0.1);
  });

  /**
   * Cylinder should reach hard stop at full extension and stay there.
   */
  it('reaches full extension hard stop', () => {
    const srcA = uid();
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: srcA, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 150e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0,
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(srcA, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 10000);

    const state = solver.getComponentState(cyl);
    expect(state.position).toBeCloseTo(0.2, 4); // at full stroke
    expect(state.velocity).toBeCloseTo(0, 4);
  });

  /**
   * Cylinder should reach hard stop at full retraction and stay there.
   */
  it('reaches full retraction hard stop', () => {
    const srcB = uid();
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 0, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: srcB, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 200, y: 0 }, rotation: 0,
          params: { pressure: 150e5 },
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0.2,   // start at full extension
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(tank, 'out', cyl, 'A'),
        makeConnection(srcB, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 10000);

    const state = solver.getComponentState(cyl);
    expect(state.position).toBeCloseTo(0, 4);
    expect(state.velocity).toBeCloseTo(0, 4);
  });

  /**
   * Pressure-compensated equilibrium: choose rod-side pressure such that
   * P_cap * A_cap = P_rod * A_rod.  Piston should stay at mid-stroke.
   */
  it('holds position when pressures are area-compensated', () => {
    const bore = 0.05;
    const rod = 0.025;
    const A_cap = Math.PI * bore * bore * 0.25;
    const A_rod = Math.PI * (bore * bore - rod * rod) * 0.25;

    const P_cap = 100e5;
    const P_rod = P_cap * A_cap / A_rod; // compensated for area ratio

    const srcA = uid();
    const srcB = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: srcA, type: 'PRESSURE_SOURCE', label: 'P-cap',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: P_cap },
          ports: [makePort('out')],
        },
        {
          id: srcB, type: 'PRESSURE_SOURCE', label: 'P-rod',
          position: { x: 200, y: 0 }, rotation: 0,
          params: { pressure: P_rod },
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: bore,
            rod_diameter: rod,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0.1,
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(srcA, 'out', cyl, 'A'),
        makeConnection(srcB, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 5000);

    const state = solver.getComponentState(cyl);
    expect(state.position).toBeCloseTo(0.1, 2);
    expect(Math.abs(state.velocity)).toBeLessThan(1e-4);
  });
});

// ---------------------------------------------------------------------------
// Single-Acting Cylinder Tests
// ---------------------------------------------------------------------------

describe('Single-Acting Cylinder', () => {
  it('retracts to zero with only spring force (no pressure)', () => {
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 0, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'SINGLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 5,
            friction_viscous: 50,
            spring_rate: 5000,
            spring_preload: 200,
            position: 0.1,
          },
          ports: [makePort('A')],
        },
      ],
      [makeConnection(tank, 'out', cyl, 'A')],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 10000);

    const state = solver.getComponentState(cyl);
    // Spring should push the piston back toward zero
    expect(state.position).toBeLessThan(0.05);
  });

  it('extends against spring with sufficient pressure', () => {
    const src = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 150e5 },
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'SINGLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 5,
            friction_viscous: 50,
            spring_rate: 5000,
            spring_preload: 200,
            position: 0,
          },
          ports: [makePort('A')],
        },
      ],
      [makeConnection(src, 'out', cyl, 'A')],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 10000);

    const state = solver.getComponentState(cyl);
    // 150 bar on ~1963 mm² piston ≈ 29 kN >> spring force, should fully extend
    expect(state.position).toBeCloseTo(0.2, 3);
  });
});

// ---------------------------------------------------------------------------
// Pressure Source Tests
// ---------------------------------------------------------------------------

describe('Pressure Source', () => {
  it('reaches target pressure after ramp-in', () => {
    const src = uid();
    const tank = uid();

    // Source connected to tank via orifice — should reach set pressure
    const orifice = uid();
    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5, ramp_steps: 20 },
          ports: [makePort('out')],
        },
        {
          id: orifice, type: 'ORIFICE', label: 'OR',
          position: { x: 100, y: 0 }, rotation: 0,
          params: { Cd: 0.65, area: 1e-5 },
          ports: [makePort('in'), makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
      ],
      [
        makeConnection(src, 'out', orifice, 'in'),
        makeConnection(orifice, 'out', tank, 'out'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 2000);

    // Source port should be near 100 bar
    const srcPort = solver.getPortState(portIndex(solver, src));
    expect(srcPort.p).toBeGreaterThan(90e5);
    expect(srcPort.p).toBeLessThan(110e5);
  });
});

// ---------------------------------------------------------------------------
// Orifice Tests
// ---------------------------------------------------------------------------

describe('Orifice', () => {
  it('produces zero net flow with equal pressures on both sides', () => {
    const src1 = uid();
    const src2 = uid();
    const orifice = uid();

    const P = 100e5;
    const circuit = makeCircuit(
      [
        {
          id: src1, type: 'PRESSURE_SOURCE', label: 'P1',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: P },
          ports: [makePort('out')],
        },
        {
          id: orifice, type: 'ORIFICE', label: 'OR',
          position: { x: 100, y: 0 }, rotation: 0,
          params: { Cd: 0.65, area: 1e-5 },
          ports: [makePort('in'), makePort('out')],
        },
        {
          id: src2, type: 'PRESSURE_SOURCE', label: 'P2',
          position: { x: 200, y: 0 }, rotation: 0,
          params: { pressure: P },
          ports: [makePort('out')],
        },
      ],
      [
        makeConnection(src1, 'out', orifice, 'in'),
        makeConnection(orifice, 'out', src2, 'out'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 2000);

    // Flow through the orifice ports should be near zero
    const portIn = solver.getPortState(portIndex(solver, orifice, 0));  // orifice port 'in'
    const portOut = solver.getPortState(portIndex(solver, orifice, 1)); // orifice port 'out'
    expect(Math.abs(portIn.q)).toBeLessThan(1e-6);
    expect(Math.abs(portOut.q)).toBeLessThan(1e-6);
  });

  it('flows from high to low pressure', () => {
    const src1 = uid();
    const src2 = uid();
    const orifice = uid();

    const circuit = makeCircuit(
      [
        {
          id: src1, type: 'PRESSURE_SOURCE', label: 'P-high',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 150e5 },
          ports: [makePort('out')],
        },
        {
          id: orifice, type: 'ORIFICE', label: 'OR',
          position: { x: 100, y: 0 }, rotation: 0,
          params: { Cd: 0.65, area: 1e-5 },
          ports: [makePort('in'), makePort('out')],
        },
        {
          id: src2, type: 'PRESSURE_SOURCE', label: 'P-low',
          position: { x: 200, y: 0 }, rotation: 0,
          params: { pressure: 50e5 },
          ports: [makePort('out')],
        },
      ],
      [
        makeConnection(src1, 'out', orifice, 'in'),
        makeConnection(orifice, 'out', src2, 'out'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 2000);

    // Flow should be positive (from high to low pressure)
    const portOut = solver.getPortState(portIndex(solver, orifice, 1)); // orifice 'out' port
    expect(portOut.q).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Conservation / Consistency Tests
// ---------------------------------------------------------------------------

describe('Conservation', () => {
  it('port outflow equals negative piston velocity times area', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();

    const bore = 0.05;
    const rod = 0.025;
    const A_cap = Math.PI * bore * bore * 0.25;

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: bore,
            rod_diameter: rod,
            stroke_length: 1.0,
            mass: 50,
            friction_viscous: 5000,
            position: 0,
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Run enough for motion to reach steady-state but not hit the hard stop.
    // Steady-state velocity ≈ F/friction ≈ (100e5 * 1.96e-3)/5000 ≈ 3.9 m/s.
    // After 200 steps (0.02s) the piston travels ~0.04m out of 1.0m stroke.
    runFor(solver, 200);

    const state = solver.getComponentState(cyl);
    const portA = solver.getPortState(portIndex(solver, cyl, 0)); // cylinder port A

    // Piston should be extending (velocity > 0) and not yet at end-stop
    expect(state.velocity).toBeGreaterThan(0);
    expect(state.position).toBeLessThan(1.0);

    // Outflow convention: portA.q = -v * A_cap (negative because fluid enters the cylinder)
    const expected_q = -state.velocity * A_cap;
    expect(portA.q).toBeCloseTo(expected_q, 6);
  });

  it('pressures are non-negative throughout simulation', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0,
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Run in chunks and check pressures each chunk
    for (let chunk = 0; chunk < 10; chunk++) {
      runFor(solver, 500);
      const allPorts = solver.getAllPortStates();
      for (const port of allPorts) {
        // Allow small numerical undershoot but nothing catastrophic
        expect(port.p).toBeGreaterThan(-1e5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// DCV 4/3 Tests
// ---------------------------------------------------------------------------

describe('DCV 4/3', () => {
  it('blocks flow in center (neutral) position', () => {
    const src = uid();
    const tank = uid();
    const dcv = uid();
    const cylA = uid();
    const cylB = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 50, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: dcv, type: 'DCV_4_3', label: 'DCV',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            Cd: 0.65,
            area_max: 1e-4,
            overlap: 0.0,
            spool_position: 0,   // center
          },
          ports: [
            makePort('P'), makePort('T'),
            makePort('A'), makePort('B'),
          ],
        },
        {
          id: cylA, type: 'TANK', label: 'TA',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cylB, type: 'TANK', label: 'TB',
          position: { x: 200, y: 50 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
      ],
      [
        makeConnection(src, 'out', dcv, 'P'),
        makeConnection(tank, 'out', dcv, 'T'),
        makeConnection(dcv, 'A', cylA, 'out'),
        makeConnection(dcv, 'B', cylB, 'out'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 2000);

    // In center position with overlap = 0, areas are all 0 (only leakage)
    // Flow at A and B ports should be near zero
    const portA = solver.getPortState(portIndex(solver, dcv, 2)); // dcv port A
    const portB = solver.getPortState(portIndex(solver, dcv, 3)); // dcv port B
    expect(Math.abs(portA.q)).toBeLessThan(1e-6);
    expect(Math.abs(portB.q)).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------
// Oscillating Force Tests
// ---------------------------------------------------------------------------

describe('Oscillating Force', () => {
  it('applies sinusoidal force that moves the cylinder', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();
    const osc = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0.1,
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'bottom', offset: 0.5 },
          ],
        },
        {
          id: osc, type: 'OSCILLATING_FORCE', label: 'OSC',
          position: { x: 100, y: -50 }, rotation: 0,
          params: {
            amplitude: 5000,   // 5 kN — enough to visibly affect position
            frequency: 10,      // 10 Hz
            waveform: 0,        // sine
            offset: 0,
          },
          ports: [{ id: 'mech', type: 'mechanical', side: 'right', offset: 0.5 }],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
        {
          id: uid(),
          from: { component: osc, port: 'mech' },
          to: { component: cyl, port: 'mech' },
          waypoints: [],
          line_params: { inner_diameter: 0, length: 0, fluid_id: 0 },
        },
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Derive step counts from the solver's actual dt so the test is
    // deterministic regardless of how the circuit's hydraulic lines
    // affect the time step.
    const freq = 10; // Hz – must match the oscillator params above
    const { dt } = solver.getSimParams();
    const period = 1 / freq;                      // seconds per cycle
    const stepsPerPeriod = Math.round(period / dt);

    // Sample 1: phase = 0.25 cycle  →  sin(π/2) = +1  (positive peak)
    const steps1 = Math.round(stepsPerPeriod * 1.25); // 1 full cycle + quarter
    runFor(solver, steps1);
    const oscState1 = solver.getComponentState(osc);
    const cylState1 = solver.getComponentState(cyl);
    expect(oscState1.force_value).toBeDefined();

    // Sample 2: phase = 0.75 cycle  →  sin(3π/2) = −1  (negative peak)
    // These two phases are guaranteed to produce opposite-sign force values.
    const steps2 = Math.round(stepsPerPeriod * 0.5); // advance half a period
    runFor(solver, steps2);
    const oscState2 = solver.getComponentState(osc);
    // Force values at opposite peaks must differ by more than FP noise
    expect(Math.abs(oscState1.force_value - oscState2.force_value)).toBeGreaterThan(1);
    // Cylinder should have moved away from its initial position (0.1)
    expect(Math.abs(cylState1.position - 0.1)).toBeGreaterThan(1e-6);
  });

  it('produces square wave output', () => {
    const osc = uid();

    const circuit = makeCircuit(
      [
        {
          id: osc, type: 'OSCILLATING_FORCE', label: 'OSC',
          position: { x: 0, y: 0 }, rotation: 0,
          params: {
            amplitude: 1000,
            frequency: 5,
            waveform: 1, // square
            offset: 0,
          },
          ports: [{ id: 'mech', type: 'mechanical', side: 'right', offset: 0.5 }],
        },
      ],
      [], // no connections needed; solver falls back to default dt
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 100);

    const state = solver.getComponentState(osc);
    // Square wave: force_value should be exactly +amplitude or -amplitude
    expect(Math.abs(Math.abs(state.force_value) - 1000)).toBeLessThan(1);
  });

  it('random waveform holds value within one cycle', () => {
    const osc = uid();

    const circuit = makeCircuit(
      [
        {
          id: osc, type: 'OSCILLATING_FORCE', label: 'OSC',
          position: { x: 0, y: 0 }, rotation: 0,
          params: {
            amplitude: 500,
            frequency: 1, // 1 Hz — one cycle per second
            waveform: 3,  // random
            offset: 100,
          },
          ports: [{ id: 'mech', type: 'mechanical', side: 'right', offset: 0.5 }],
        },
      ],
      [], // no connections needed; solver falls back to default dt
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Run a few steps within the first cycle
    runFor(solver, 10);
    const state1 = solver.getComponentState(osc);
    runFor(solver, 10);
    const state2 = solver.getComponentState(osc);

    // Within the same cycle, the value should be held constant
    expect(state1.force_value).toBe(state2.force_value);

    // Value should be within offset ± amplitude range
    expect(state2.force_value).toBeGreaterThanOrEqual(100 - 500);
    expect(state2.force_value).toBeLessThanOrEqual(100 + 500);
  });
});

// ---------------------------------------------------------------------------
// Cylinder Position Clamping Tests
// ---------------------------------------------------------------------------

describe('Cylinder initial position clamping', () => {
  it('clamps negative initial position to 0 for double-acting cylinder', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: -0.5, // out of range: negative
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Initial position must be clamped to 0
    const state0 = solver.getComponentState(cyl);
    expect(state0.position).toBe(0);

    // After running, position must remain within [0, stroke]
    runFor(solver, 1000);
    const state1 = solver.getComponentState(cyl);
    expect(state1.position).toBeGreaterThanOrEqual(0);
    expect(state1.position).toBeLessThanOrEqual(0.2);
  });

  it('clamps initial position exceeding stroke to stroke_length for double-acting cylinder', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0.5, // out of range: exceeds stroke
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Initial position must be clamped to stroke_length
    const state0 = solver.getComponentState(cyl);
    expect(state0.position).toBe(0.2);

    // After running, position must remain within [0, stroke]
    runFor(solver, 1000);
    const state1 = solver.getComponentState(cyl);
    expect(state1.position).toBeGreaterThanOrEqual(0);
    expect(state1.position).toBeLessThanOrEqual(0.2);
  });

  it('clamps negative initial position to 0 for single-acting cylinder', () => {
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 0, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'SINGLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 5,
            friction_viscous: 50,
            spring_rate: 5000,
            spring_preload: 200,
            position: -1.0, // out of range: negative
          },
          ports: [makePort('A')],
        },
      ],
      [makeConnection(tank, 'out', cyl, 'A')],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    const state0 = solver.getComponentState(cyl);
    expect(state0.position).toBe(0);

    runFor(solver, 1000);
    const state1 = solver.getComponentState(cyl);
    expect(state1.position).toBeGreaterThanOrEqual(0);
    expect(state1.position).toBeLessThanOrEqual(0.2);
  });

  it('clamps initial position exceeding stroke for single-acting cylinder', () => {
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 0, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'SINGLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 5,
            friction_viscous: 50,
            spring_rate: 5000,
            spring_preload: 200,
            position: 10.0, // out of range: way beyond stroke
          },
          ports: [makePort('A')],
        },
      ],
      [makeConnection(tank, 'out', cyl, 'A')],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    const state0 = solver.getComponentState(cyl);
    expect(state0.position).toBe(0.2);

    runFor(solver, 1000);
    const state1 = solver.getComponentState(cyl);
    expect(state1.position).toBeGreaterThanOrEqual(0);
    expect(state1.position).toBeLessThanOrEqual(0.2);
  });
});

// ---------------------------------------------------------------------------
// Solver Infrastructure Tests
// ---------------------------------------------------------------------------

describe('Solver Infrastructure', () => {
  it('advances time correctly', () => {
    const src = uid();
    const tank = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
      ],
      [makeConnection(src, 'out', tank, 'out')],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    const dt = solver.getSimParams().dt;
    runFor(solver, 100);
    const params = solver.getSimParams();
    expect(params.step).toBe(100);
    expect(params.time).toBeCloseTo(100 * dt, 10);
  });

  it('reset zeroes state and simulation clock', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            position: 0.08, // non-zero initial so movement is distinguishable
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 5000);

    // Position should have moved away from initial
    const stateBefore = solver.getComponentState(cyl);
    expect(stateBefore.position).not.toBeCloseTo(0.08, 2);

    solver.reset();

    // reset() restores initial component state
    const stateAfter = solver.getComponentState(cyl);
    expect(stateAfter.position).toBeCloseTo(0.08, 6);
    expect(stateAfter.velocity).toBe(0);
    expect(solver.getSimParams().step).toBe(0);
    expect(solver.getSimParams().time).toBe(0);
  });

  it('reset() and initial port state use non-default p_atm', () => {
    const src = uid();
    const tank = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 50e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
      ],
      [makeConnection(src, 'out', tank, 'out')],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Override p_atm to a non-default value on the compiled circuit
    const customPAtm = 90000;
    const compiled = solver.getCompiledCircuit()!;
    compiled.params.p_atm = customPAtm;

    // Run a few steps so ports diverge from initial atmospheric
    runFor(solver, 500);

    // After reset, hydraulic ports should use the custom p_atm
    solver.reset();

    const srcPortIdx = portIndex(solver, src, 0);
    const tankPortIdx = portIndex(solver, tank, 0);
    const srcPort = solver.getPortState(srcPortIdx);
    const tankPort = solver.getPortState(tankPortIdx);

    expect(srcPort.p).toBe(customPAtm);
    expect(srcPort.c).toBe(customPAtm);
    expect(tankPort.p).toBe(customPAtm);
    expect(tankPort.c).toBe(customPAtm);

    // Verify it does NOT equal the default — the custom value is actually used
    expect(srcPort.p).not.toBe(DEFAULT_SIM_PARAMS.p_atm);
  });

  it('getPortState out-of-range fallback uses active p_atm', () => {
    const src = uid();
    const tank = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 50e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
      ],
      [makeConnection(src, 'out', tank, 'out')],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Override p_atm to a non-default value
    const customPAtm = 85000;
    solver.getCompiledCircuit()!.params.p_atm = customPAtm;

    // Request a port index that is out of range
    const fallback = solver.getPortState(9999);
    expect(fallback.p).toBe(customPAtm);
    expect(fallback.c).toBe(customPAtm);
  });
});

// ---------------------------------------------------------------------------
// Mechanical Port Initialization
// ---------------------------------------------------------------------------

describe('Unconnected mechanical port initialisation', () => {
  it('double-acting cylinder mech port is zeroed on init and does not inject phantom forces', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();

    // Define the cylinder with all four ports, including the mechanical port.
    // Only the hydraulic ports (A, B) are connected; the mech port is left open.
    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
          },
          ports: [
            makePort('A'),
            makePort('B'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'right', offset: 0.5 },
          ],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // The mechanical port (local offset 3) must be zero after init.
    const mechIdx = portIndex(solver, cyl, 3);
    const mechInit = solver.getPortState(mechIdx);
    expect(mechInit.p).toBe(0);
    expect(mechInit.c).toBe(0);
    expect(mechInit.Zc).toBe(0);

    // Run the simulation — cylinder should extend as normal (pressure on
    // cap-side, tank on rod-side → net force extends piston).
    runFor(solver, 5000);

    const state = solver.getComponentState(cyl);
    expect(state.position).toBeGreaterThan(0);

    // Mech port should still not carry phantom force / stiffness.
    const mechAfter = solver.getPortState(mechIdx);
    expect(mechAfter.Zc).toBe(0);
  });

  it('single-acting cylinder mech port is zeroed on init and does not inject phantom forces', () => {
    const src = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'SINGLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
            spring_rate: 1000,
            spring_preload: 100,
          },
          ports: [
            makePort('A'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'right', offset: 0.5 },
          ],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Mechanical port (local offset 2) must be zero.
    const mechIdx = portIndex(solver, cyl, 2);
    const mechInit = solver.getPortState(mechIdx);
    expect(mechInit.p).toBe(0);
    expect(mechInit.c).toBe(0);
    expect(mechInit.Zc).toBe(0);

    runFor(solver, 5000);

    const state = solver.getComponentState(cyl);
    expect(state.position).toBeGreaterThan(0);

    const mechAfter = solver.getPortState(mechIdx);
    expect(mechAfter.Zc).toBe(0);
  });

  it('mech port stays zeroed after reset()', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 100,
          },
          ports: [
            makePort('A'),
            makePort('B'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'right', offset: 0.5 },
          ],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 1000);

    solver.reset();

    const mechIdx = portIndex(solver, cyl, 3);
    const mechAfterReset = solver.getPortState(mechIdx);
    expect(mechAfterReset.p).toBe(0);
    expect(mechAfterReset.c).toBe(0);
    expect(mechAfterReset.Zc).toBe(0);

    // Hydraulic ports should be back to atmospheric (sanity check).
    const hydIdx = portIndex(solver, cyl, 0);
    const hydAfterReset = solver.getPortState(hydIdx);
    expect(hydAfterReset.p).toBe(101325);
    expect(hydAfterReset.c).toBe(101325);
  });

  it('unconnected mech port does not alter cylinder motion vs no-mech-port circuit', () => {
    // Build two identical circuits — one with the mech port declared, one without.
    // After the same number of steps, cylinder position should match.
    function buildCircuit(includeMechPort: boolean) {
      const src = uid();
      const tank = uid();
      const cyl = uid();

      const cylPorts: PortDef[] = [makePort('A'), makePort('B')];
      if (includeMechPort) {
        cylPorts.push(
          makePort('ctrl', 'signal', 'top'),
          { id: 'mech', type: 'mechanical', side: 'right', offset: 0.5 },
        );
      }

      const circuit = makeCircuit(
        [
          {
            id: src, type: 'PRESSURE_SOURCE', label: 'P',
            position: { x: 0, y: 0 }, rotation: 0,
            params: { pressure: 100e5 },
            ports: [makePort('out')],
          },
          {
            id: tank, type: 'TANK', label: 'T',
            position: { x: 200, y: 0 }, rotation: 0,
            params: {},
            ports: [makePort('out')],
          },
          {
            id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
            position: { x: 100, y: 0 }, rotation: 0,
            params: {
              bore_diameter: 0.05,
              rod_diameter: 0.025,
              stroke_length: 0.2,
              mass: 10,
              friction_viscous: 100,
            },
            ports: cylPorts,
          },
        ],
        [
          makeConnection(src, 'out', cyl, 'A'),
          makeConnection(tank, 'out', cyl, 'B'),
        ],
      );

      return { circuit, cyl };
    }

    const withMech = buildCircuit(true);
    const withoutMech = buildCircuit(false);

    const solverA = new TLMSolverEngine();
    const solverB = new TLMSolverEngine();
    solverA.init(withMech.circuit);
    solverB.init(withoutMech.circuit);

    runFor(solverA, 3000);
    runFor(solverB, 3000);

    const posA = solverA.getComponentState(withMech.cyl).position;
    const posB = solverB.getComponentState(withoutMech.cyl).position;

    // Positions should be equal (within floating-point tolerance).
    expect(posA).toBeCloseTo(posB, 6);
  });
});

// ---------------------------------------------------------------------------
// Cylinder with mechanically connected MASS_LOAD
// ---------------------------------------------------------------------------

describe('Cylinder mechanically connected to MASS_LOAD', () => {
  it('extends under pressure with an external mass load', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();
    const mass = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 5,
            friction_viscous: 100,
            position: 0,
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'bottom', offset: 0.5 },
          ],
        },
        {
          id: mass, type: 'MASS_LOAD', label: 'MASS',
          position: { x: 100, y: -50 }, rotation: 0,
          params: { mass: 50, gravity_force: 0, external_force: 0 },
          ports: [{ id: 'mech', type: 'mechanical', side: 'right', offset: 0.5 }],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
        {
          id: uid(),
          from: { component: cyl, port: 'mech' },
          to: { component: mass, port: 'mech' },
          waypoints: [],
          line_params: { inner_diameter: 0, length: 0, fluid_id: 0 },
        },
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 5000);

    const cylState = solver.getComponentState(cyl);
    // The piston should extend under 100 bar cap-side pressure
    expect(cylState.position).toBeGreaterThan(0.01);
    // Mass load velocity should be tracked
    const massState = solver.getComponentState(mass);
    expect(massState.velocity).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cylinder with mechanically connected SPRING
// ---------------------------------------------------------------------------

describe('Cylinder mechanically connected to SPRING', () => {
  it('runs without NaN/Infinity when spring is connected to cylinder', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();
    const spring = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 5e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 5,
            friction_viscous: 200,
            position: 0,
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'bottom', offset: 0.5 },
          ],
        },
        {
          id: spring, type: 'SPRING', label: 'SPR',
          position: { x: 100, y: -50 }, rotation: 0,
          params: { spring_rate: 500000, preload: 0, damping: 100 },
          ports: [
            { id: 'mech_a', type: 'mechanical', side: 'left', offset: 0.5 },
            { id: 'mech_b', type: 'mechanical', side: 'right', offset: 0.5 },
          ],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
        {
          id: uid(),
          from: { component: cyl, port: 'mech' },
          to: { component: spring, port: 'mech_a' },
          waypoints: [],
          line_params: { inner_diameter: 0, length: 0, fluid_id: 0 },
        },
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 5000);

    const cylState = solver.getComponentState(cyl);
    // Simulation should produce finite values (no NaN/Infinity)
    expect(Number.isFinite(cylState.position)).toBe(true);
    expect(Number.isFinite(cylState.velocity)).toBe(true);
    // Piston should extend under pressure
    expect(cylState.position).toBeGreaterThan(0);
    // Spring state should be finite
    const springState = solver.getComponentState(spring);
    expect(Number.isFinite(springState.displacement)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Capped-port pressure evolution
// ---------------------------------------------------------------------------

describe('Capped cylinder ports', () => {
  it('builds up pressure in a capped volume when piston moves', () => {
    const src = uid();
    const cyl = uid();

    // Port A connected to a pressure source, port B capped.
    // Pressurising A should extend the piston, compressing the trapped
    // fluid on the B side and raising p_cap_b above atmospheric.
    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 200,
            cap_b: 1,              // cap port B (trapped fluid)
            dead_volume_B: 1e-5,   // 10 cm³ dead volume
            position: 0,
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'bottom', offset: 0.5 },
          ],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    const initialState = solver.getComponentState(cyl);
    expect(initialState.p_cap_b).toBeCloseTo(DEFAULT_SIM_PARAMS.p_atm, 0); // starts at atmospheric

    runFor(solver, 5000);

    const finalState = solver.getComponentState(cyl);
    // Piston should have extended, compressing the trapped B-side fluid
    expect(finalState.position).toBeGreaterThan(0);
    // Trapped pressure must have risen above atmospheric
    expect(finalState.p_cap_b).toBeGreaterThan(DEFAULT_SIM_PARAMS.p_atm);
  });

  it('does not produce NaN with zero dead volume', () => {
    const src = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 50e5 },
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 200,
            cap_a: 1,
            cap_b: 1,
            dead_volume_A: 0,  // edge case: zero dead volume
            dead_volume_B: 0,
            position: 0.1,    // mid-stroke so both V_A and V_B are nonzero from piston area
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'bottom', offset: 0.5 },
          ],
        },
      ],
      [],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 2000);

    const state = solver.getComponentState(cyl);
    // No NaN/Infinity in state values
    expect(Number.isFinite(state.position)).toBe(true);
    expect(Number.isFinite(state.velocity)).toBe(true);
    expect(Number.isFinite(state.p_cap_a)).toBe(true);
    expect(Number.isFinite(state.p_cap_b)).toBe(true);
  });

  it('resets trapped pressures on solver reset', () => {
    const src = uid();
    const cyl = uid();

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 10,
            friction_viscous: 200,
            cap_b: 1,
            dead_volume_B: 1e-5,
            position: 0,
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'bottom', offset: 0.5 },
          ],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 3000);

    // Pressure should have risen
    const preReset = solver.getComponentState(cyl);
    expect(preReset.p_cap_b).toBeGreaterThan(DEFAULT_SIM_PARAMS.p_atm);

    // After reset, trapped pressure should return to atmospheric
    solver.reset();
    const postReset = solver.getComponentState(cyl);
    expect(postReset.p_cap_b).toBeCloseTo(DEFAULT_SIM_PARAMS.p_atm, 0);
    expect(postReset.position).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Two Cylinders Connected Together (Q-to-Q coupling)
// ---------------------------------------------------------------------------

describe('Two cylinders connected together', () => {
  /**
   * BUG REPRO: When two double-ended cylinders are connected port-to-port
   * (B of cyl1 → A of cyl2), pushing cyl1 should drive cyl2.  Previously
   * the TLM port flow sign convention was wrong for cylinders, so wave
   * variables never propagated through Q-to-Q connections — oil appeared
   * to "disappear" and the receiving cylinder never moved.
   */
  it('pushing one cylinder drives the connected cylinder', () => {
    const src = uid();
    const tank = uid();
    const cyl1 = uid();
    const cyl2 = uid();

    const circuit = makeCircuit(
      [
        // High pressure on cyl1 cap side to push it
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 100e5 },
          ports: [makePort('out')],
        },
        // Tank on cyl2 rod side (return)
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 400, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('in')],
        },
        // Cylinder 1: pressure drives cap side, rod side connected to cyl2
        {
          id: cyl1, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL1',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 5,
            friction_viscous: 50,
            position: 0,
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'bottom', offset: 0.5 },
          ],
        },
        // Cylinder 2: cap side receives oil from cyl1, rod side to tank
        {
          id: cyl2, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL2',
          position: { x: 250, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: 0.2,
            mass: 5,
            friction_viscous: 50,
            position: 0,
          },
          ports: [
            makePort('A', 'hydraulic', 'left'),
            makePort('B', 'hydraulic', 'right'),
            makePort('ctrl', 'signal', 'top'),
            { id: 'mech', type: 'mechanical', side: 'bottom', offset: 0.5 },
          ],
        },
      ],
      [
        makeConnection(src, 'out', cyl1, 'A'),     // pressure → cyl1 cap
        makeConnection(cyl1, 'B', cyl2, 'A'),       // cyl1 rod → cyl2 cap (Q-to-Q!)
        makeConnection(cyl2, 'B', tank, 'in'),       // cyl2 rod → tank
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);
    runFor(solver, 5000);

    const state1 = solver.getComponentState(cyl1);
    const state2 = solver.getComponentState(cyl2);

    // Cyl1 must have extended (pushed by pressure source)
    expect(state1.position).toBeGreaterThan(0.01);
    // Cyl2 must ALSO have extended (driven by oil from cyl1's rod side)
    expect(state2.position).toBeGreaterThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// End-Stop Contact (bounce dissipation)
// ---------------------------------------------------------------------------

describe('End-stop contact model', () => {
  /**
   * Regression: a pressurised cylinder (A driven, B vented to tank) used to
   * bounce at the far end stop because the lossless TLM wave reflection would
   * reflect pressure waves without dissipation.  The contact model should
   * absorb impact energy and settle the piston at the stroke end.
   */
  it('cylinder settles at end-stop without repeated bouncing', () => {
    const src = uid();
    const tank = uid();
    const cyl = uid();

    const stroke = 0.1;

    const circuit = makeCircuit(
      [
        {
          id: src, type: 'PRESSURE_SOURCE', label: 'P',
          position: { x: 0, y: 0 }, rotation: 0,
          params: { pressure: 50e5 },
          ports: [makePort('out')],
        },
        {
          id: tank, type: 'TANK', label: 'T',
          position: { x: 200, y: 0 }, rotation: 0,
          params: {},
          ports: [makePort('out')],
        },
        {
          id: cyl, type: 'DOUBLE_ACTING_CYLINDER', label: 'CYL',
          position: { x: 100, y: 0 }, rotation: 0,
          params: {
            bore_diameter: 0.05,
            rod_diameter: 0.025,
            stroke_length: stroke,
            mass: 5,
            friction_viscous: 50,
            position: 0,
          },
          ports: [makePort('A'), makePort('B')],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
      ],
    );

    const solver = new TLMSolverEngine();
    solver.init(circuit);

    // Run long enough for the piston to hit the far end-stop and settle
    runFor(solver, 10000);

    const state = solver.getComponentState(cyl);

    // Piston should be at or very near the far end-stop
    expect(state.position).toBeCloseTo(stroke, 2);

    // Velocity should have settled to near-zero (no sustained bouncing)
    expect(Math.abs(state.velocity)).toBeLessThan(0.1);

    // Sample further to confirm no late-onset oscillation
    runFor(solver, 5000);
    const stateLater = solver.getComponentState(cyl);
    expect(stateLater.position).toBeCloseTo(stroke, 2);
    expect(Math.abs(stateLater.velocity)).toBeLessThan(0.01);
  });
});
