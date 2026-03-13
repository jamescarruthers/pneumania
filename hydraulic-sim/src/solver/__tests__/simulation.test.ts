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
  it('flow into a cylinder equals piston velocity times area', () => {
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

    // Run enough for motion but not to hit hard stop
    runFor(solver, 500);

    const state = solver.getComponentState(cyl);
    const portA = solver.getPortState(portIndex(solver, cyl, 0)); // cylinder port A

    // q_A should equal velocity * A_cap
    const expected_q = state.velocity * A_cap;
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
          ports: [makePort('signal_out', 'signal', 'right')],
        },
      ],
      [
        makeConnection(src, 'out', cyl, 'A'),
        makeConnection(tank, 'out', cyl, 'B'),
        {
          id: uid(),
          from: { component: osc, port: 'signal_out' },
          to: { component: cyl, port: 'ctrl' },
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
          ports: [makePort('signal_out', 'signal', 'right')],
        },
      ],
      [], // no hydraulic connections needed; solver falls back to default dt
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
          ports: [makePort('signal_out', 'signal', 'right')],
        },
      ],
      [], // no hydraulic connections needed; solver falls back to default dt
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

    // reset() zeroes component state (does not restore initial params)
    const stateAfter = solver.getComponentState(cyl);
    expect(stateAfter.position).toBe(0);
    expect(stateAfter.velocity).toBe(0);
    expect(solver.getSimParams().step).toBe(0);
    expect(solver.getSimParams().time).toBe(0);
  });
});
