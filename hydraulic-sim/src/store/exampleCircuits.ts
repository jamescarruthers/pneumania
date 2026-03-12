/**
 * Pre-built example circuits for testing and demonstration.
 */

import type { CircuitDefinition } from '../solver/types';
import { createFluidDef } from '../fluid/presets';

/**
 * 10.1 Basic Extension: Pressure source → 4/3 DCV → Double-acting cylinder → Tank
 */
export function createBasicExtensionCircuit(): CircuitDefinition {
  const fluid = createFluidDef('iso_vg_46', 0);

  return {
    version: '1.0',
    fluids: [fluid],
    default_fluid_id: 0,
    components: [
      {
        id: 'source',
        type: 'PRESSURE_SOURCE',
        label: 'Pressure Source 150 bar',
        position: { x: -200, y: 0 },
        rotation: 0,
        params: { pressure: 150e5 },
        ports: [{ id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 }],
      },
      {
        id: 'dcv',
        type: 'DCV_4_3',
        label: '4/3 DCV',
        position: { x: 0, y: 0 },
        rotation: 0,
        params: {
          Cd: 0.65,
          area_max: 1e-4,
          spool_position: 0,
          overlap: 0.0,
          response_time: 0.02,
          centre_config: 'CLOSED_CENTRE',
        },
        ports: [
          { id: 'P', type: 'hydraulic', side: 'bottom', offset: 0.3 },
          { id: 'T', type: 'hydraulic', side: 'bottom', offset: 0.7 },
          { id: 'A', type: 'hydraulic', side: 'top', offset: 0.3 },
          { id: 'B', type: 'hydraulic', side: 'top', offset: 0.7 },
        ],
      },
      {
        id: 'cylinder',
        type: 'DOUBLE_ACTING_CYLINDER',
        label: 'Cylinder 50/25 × 200mm',
        position: { x: 200, y: -80 },
        rotation: 0,
        params: {
          bore_diameter: 0.05,
          rod_diameter: 0.025,
          stroke_length: 0.2,
          mass: 10,
          friction_static: 50,
          friction_viscous: 100,
          dead_volume_A: 1e-6,
          dead_volume_B: 1e-6,
          position: 0,
          external_force: 0,
        },
        ports: [
          { id: 'port_A', type: 'hydraulic', side: 'left', offset: 0.5 },
          { id: 'port_B', type: 'hydraulic', side: 'right', offset: 0.5 },
        ],
      },
      {
        id: 'tank',
        type: 'TANK',
        label: 'Tank',
        position: { x: 0, y: 100 },
        rotation: 0,
        params: { pressure: 101325 },
        ports: [{ id: 'out', type: 'hydraulic', side: 'top', offset: 0.5 }],
      },
    ],
    connections: [
      {
        id: 'conn_source_dcv',
        from: { component: 'source', port: 'out' },
        to: { component: 'dcv', port: 'P' },
        waypoints: [],
        line_params: { inner_diameter: 0.01, length: 0.5, fluid_id: 0 },
      },
      {
        id: 'conn_dcv_a_cyl_a',
        from: { component: 'dcv', port: 'A' },
        to: { component: 'cylinder', port: 'port_A' },
        waypoints: [],
        line_params: { inner_diameter: 0.01, length: 0.5, fluid_id: 0 },
      },
      {
        id: 'conn_dcv_b_cyl_b',
        from: { component: 'dcv', port: 'B' },
        to: { component: 'cylinder', port: 'port_B' },
        waypoints: [{ x: 200, y: -40 }],
        line_params: { inner_diameter: 0.01, length: 0.5, fluid_id: 0 },
      },
      {
        id: 'conn_dcv_tank',
        from: { component: 'dcv', port: 'T' },
        to: { component: 'tank', port: 'out' },
        waypoints: [],
        line_params: { inner_diameter: 0.012, length: 0.5, fluid_id: 0 },
      },
    ],
    ui: { camera: { x: 0, y: 0, zoom: 1 }, grid_size: 20 },
  };
}

/**
 * 10.2 Meter-Out Speed Control
 */
export function createMeterOutCircuit(): CircuitDefinition {
  const fluid = createFluidDef('iso_vg_46', 0);

  return {
    version: '1.0',
    fluids: [fluid],
    default_fluid_id: 0,
    components: [
      {
        id: 'source',
        type: 'PRESSURE_SOURCE',
        label: 'Pressure Source 150 bar',
        position: { x: -200, y: -40 },
        rotation: 0,
        params: { pressure: 150e5 },
        ports: [{ id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 }],
      },
      {
        id: 'check',
        type: 'CHECK_VALVE',
        label: 'Check Valve',
        position: { x: -60, y: -40 },
        rotation: 0,
        params: {
          Cd: 0.65,
          area_max: 1e-4,
          cracking_pressure: 30000,
          full_open_pressure: 100000,
          leakage_flow: 1e-10,
        },
        ports: [
          { id: 'in', type: 'hydraulic', side: 'left', offset: 0.5 },
          { id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 },
        ],
      },
      {
        id: 'cylinder',
        type: 'DOUBLE_ACTING_CYLINDER',
        label: 'Cylinder 50/25 × 200mm',
        position: { x: 140, y: -40 },
        rotation: 0,
        params: {
          bore_diameter: 0.05,
          rod_diameter: 0.025,
          stroke_length: 0.2,
          mass: 10,
          friction_viscous: 100,
          position: 0,
          external_force: 0,
        },
        ports: [
          { id: 'port_A', type: 'hydraulic', side: 'left', offset: 0.5 },
          { id: 'port_B', type: 'hydraulic', side: 'right', offset: 0.5 },
        ],
      },
      {
        id: 'flow_control',
        type: 'ONE_WAY_FLOW_CONTROL',
        label: 'Flow Control',
        position: { x: 140, y: 60 },
        rotation: 0,
        params: {
          Cd: 0.65,
          area_max: 1e-4,
          orifice_area_min: 1e-7,
          orifice_area_max: 1e-4,
          orifice_setting: 0.3,
        },
        ports: [
          { id: 'in', type: 'hydraulic', side: 'left', offset: 0.5 },
          { id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 },
        ],
      },
      {
        id: 'tank',
        type: 'TANK',
        label: 'Tank',
        position: { x: 300, y: 60 },
        rotation: 0,
        params: { pressure: 101325 },
        ports: [{ id: 'out', type: 'hydraulic', side: 'top', offset: 0.5 }],
      },
    ],
    connections: [
      {
        id: 'c1',
        from: { component: 'source', port: 'out' },
        to: { component: 'check', port: 'in' },
        waypoints: [],
        line_params: { inner_diameter: 0.01, length: 0.5, fluid_id: 0 },
      },
      {
        id: 'c2',
        from: { component: 'check', port: 'out' },
        to: { component: 'cylinder', port: 'port_A' },
        waypoints: [],
        line_params: { inner_diameter: 0.01, length: 0.5, fluid_id: 0 },
      },
      {
        id: 'c3',
        from: { component: 'cylinder', port: 'port_B' },
        to: { component: 'flow_control', port: 'in' },
        waypoints: [{ x: 260, y: -40 }, { x: 260, y: 60 }],
        line_params: { inner_diameter: 0.01, length: 0.5, fluid_id: 0 },
      },
      {
        id: 'c4',
        from: { component: 'flow_control', port: 'out' },
        to: { component: 'tank', port: 'out' },
        waypoints: [],
        line_params: { inner_diameter: 0.012, length: 0.5, fluid_id: 0 },
      },
    ],
    ui: { camera: { x: 50, y: 10, zoom: 1 }, grid_size: 20 },
  };
}

/**
 * 10.6 Citroën Hydropneumatic Suspension
 */
export function createCitroenSuspensionCircuit(): CircuitDefinition {
  const lhm = createFluidDef('lhm_plus', 0);
  const nitrogen = createFluidDef('nitrogen', 1);

  return {
    version: '1.0',
    fluids: [lhm, nitrogen],
    default_fluid_id: 0,
    components: [
      {
        id: 'source',
        type: 'PRESSURE_SOURCE',
        label: 'HP Pump 150 bar (LHM+)',
        position: { x: -200, y: 0 },
        rotation: 0,
        params: { pressure: 150e5 },
        ports: [{ id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 }],
      },
      {
        id: 'hcv',
        type: 'DCV_4_3',
        label: 'Height Corrector Valve',
        position: { x: -40, y: 0 },
        rotation: 0,
        params: {
          Cd: 0.65,
          area_max: 5e-5,
          spool_position: 0,
          overlap: 0.05,
          response_time: 0.1,
        },
        ports: [
          { id: 'P', type: 'hydraulic', side: 'bottom', offset: 0.3 },
          { id: 'T', type: 'hydraulic', side: 'bottom', offset: 0.7 },
          { id: 'A', type: 'hydraulic', side: 'top', offset: 0.3 },
          { id: 'B', type: 'hydraulic', side: 'top', offset: 0.7 },
        ],
      },
      {
        id: 'cylinder',
        type: 'DOUBLE_ACTING_CYLINDER',
        label: 'Suspension Cylinder',
        position: { x: 120, y: -80 },
        rotation: 0,
        params: {
          bore_diameter: 0.045,
          rod_diameter: 0.022,
          stroke_length: 0.12,
          mass: 5,
          friction_viscous: 200,
          position: 0.06,
          external_force: -4000,
        },
        ports: [
          { id: 'port_A', type: 'hydraulic', side: 'left', offset: 0.5 },
          { id: 'port_B', type: 'hydraulic', side: 'right', offset: 0.5 },
        ],
      },
      {
        id: 'sphere',
        type: 'HYDROPNEUMATIC_SPHERE',
        label: 'Front Sphere (XM, 62 bar)',
        position: { x: 280, y: -80 },
        rotation: 0,
        params: {
          R_sphere: 0.062,
          diaphragm_rest_ratio: 0.5,
          diaphragm_thickness: 0.003,
          diaphragm_density: 1200,
          diaphragm_modulus: 2e6,
          gas_precharge_pressure: 62e5,
          fluid_id_gas: 1,
        },
        ports: [{ id: 'port', type: 'hydraulic', side: 'bottom', offset: 0.5 }],
      },
      {
        id: 'tank',
        type: 'TANK',
        label: 'Return to reservoir',
        position: { x: -40, y: 100 },
        rotation: 0,
        params: { pressure: 101325 },
        ports: [{ id: 'out', type: 'hydraulic', side: 'top', offset: 0.5 }],
      },
    ],
    connections: [
      {
        id: 'c1',
        from: { component: 'source', port: 'out' },
        to: { component: 'hcv', port: 'P' },
        waypoints: [],
        line_params: { inner_diameter: 0.006, length: 1.0, fluid_id: 0 },
      },
      {
        id: 'c2',
        from: { component: 'hcv', port: 'A' },
        to: { component: 'cylinder', port: 'port_A' },
        waypoints: [],
        line_params: { inner_diameter: 0.006, length: 0.5, fluid_id: 0 },
      },
      {
        id: 'c3',
        from: { component: 'cylinder', port: 'port_B' },
        to: { component: 'sphere', port: 'port' },
        waypoints: [],
        line_params: { inner_diameter: 0.006, length: 0.3, fluid_id: 0 },
      },
      {
        id: 'c4',
        from: { component: 'hcv', port: 'T' },
        to: { component: 'tank', port: 'out' },
        waypoints: [],
        line_params: { inner_diameter: 0.008, length: 1.0, fluid_id: 0 },
      },
    ],
    ui: { camera: { x: 40, y: 0, zoom: 1 }, grid_size: 20 },
  };
}

/**
 * Simple test: Pressure source → Orifice → Tank
 */
export function createSimpleOrificeCircuit(): CircuitDefinition {
  const fluid = createFluidDef('iso_vg_46', 0);

  return {
    version: '1.0',
    fluids: [fluid],
    default_fluid_id: 0,
    components: [
      {
        id: 'source',
        type: 'PRESSURE_SOURCE',
        label: 'Pressure Source 100 bar',
        position: { x: -120, y: 0 },
        rotation: 0,
        params: { pressure: 100e5 },
        ports: [{ id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 }],
      },
      {
        id: 'orifice',
        type: 'ORIFICE',
        label: 'Orifice',
        position: { x: 40, y: 0 },
        rotation: 0,
        params: { Cd: 0.65, area: 1e-5 },
        ports: [
          { id: 'in', type: 'hydraulic', side: 'left', offset: 0.5 },
          { id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 },
        ],
      },
      {
        id: 'tank',
        type: 'TANK',
        label: 'Tank',
        position: { x: 200, y: 0 },
        rotation: 0,
        params: { pressure: 101325 },
        ports: [{ id: 'out', type: 'hydraulic', side: 'top', offset: 0.5 }],
      },
    ],
    connections: [
      {
        id: 'c1',
        from: { component: 'source', port: 'out' },
        to: { component: 'orifice', port: 'in' },
        waypoints: [],
        line_params: { inner_diameter: 0.01, length: 0.5, fluid_id: 0 },
      },
      {
        id: 'c2',
        from: { component: 'orifice', port: 'out' },
        to: { component: 'tank', port: 'out' },
        waypoints: [],
        line_params: { inner_diameter: 0.01, length: 0.5, fluid_id: 0 },
      },
    ],
    ui: { camera: { x: 40, y: 0, zoom: 1 }, grid_size: 20 },
  };
}

export const EXAMPLE_CIRCUITS: Array<{ name: string; create: () => CircuitDefinition }> = [
  { name: 'Simple Orifice Test', create: createSimpleOrificeCircuit },
  { name: 'Basic Extension (DCV + Cylinder)', create: createBasicExtensionCircuit },
  { name: 'Meter-Out Speed Control', create: createMeterOutCircuit },
  { name: 'Citroën Hydropneumatic Suspension', create: createCitroenSuspensionCircuit },
];
