import type { ComponentType, PortDef } from '../solver/types';

export function getDefaultPorts(type: ComponentType): PortDef[] {
  switch (type) {
    case 'PRESSURE_SOURCE':
    case 'TANK':
      return [{ id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 }];

    case 'DOUBLE_ACTING_CYLINDER':
      return [
        { id: 'port_A', type: 'hydraulic', side: 'left', offset: 0.5, label: 'A (cap)' },
        { id: 'port_B', type: 'hydraulic', side: 'right', offset: 0.5, label: 'B (rod)' },
      ];

    case 'SINGLE_ACTING_CYLINDER':
      return [
        { id: 'port_A', type: 'hydraulic', side: 'left', offset: 0.5, label: 'A (cap)' },
      ];

    case 'ORIFICE':
    case 'VARIABLE_ORIFICE':
      return [
        { id: 'in', type: 'hydraulic', side: 'left', offset: 0.5 },
        { id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 },
      ];

    case 'CHECK_VALVE':
    case 'ONE_WAY_FLOW_CONTROL':
      return [
        { id: 'in', type: 'hydraulic', side: 'left', offset: 0.5 },
        { id: 'out', type: 'hydraulic', side: 'right', offset: 0.5 },
      ];

    case 'DCV_4_3':
    case 'DCV_5_2':
    case 'DCV_5_3':
      return [
        { id: 'P', type: 'hydraulic', side: 'bottom', offset: 0.3, label: 'P' },
        { id: 'T', type: 'hydraulic', side: 'bottom', offset: 0.7, label: 'T' },
        { id: 'A', type: 'hydraulic', side: 'top', offset: 0.3, label: 'A' },
        { id: 'B', type: 'hydraulic', side: 'top', offset: 0.7, label: 'B' },
        { id: 'control', type: 'signal', side: 'left', offset: 0.5, label: 'Ctrl' },
      ];

    case 'DCV_3_2':
      return [
        { id: 'P', type: 'hydraulic', side: 'bottom', offset: 0.3, label: 'P' },
        { id: 'T', type: 'hydraulic', side: 'bottom', offset: 0.7, label: 'T' },
        { id: 'A', type: 'hydraulic', side: 'top', offset: 0.5, label: 'A' },
        { id: 'control', type: 'signal', side: 'left', offset: 0.5, label: 'Ctrl' },
      ];

    case 'TEE_JUNCTION':
      return [
        { id: 'p1', type: 'hydraulic', side: 'left', offset: 0.5 },
        { id: 'p2', type: 'hydraulic', side: 'right', offset: 0.5 },
        { id: 'p3', type: 'hydraulic', side: 'bottom', offset: 0.5 },
      ];

    case 'CROSS_JUNCTION':
      return [
        { id: 'p1', type: 'hydraulic', side: 'left', offset: 0.5 },
        { id: 'p2', type: 'hydraulic', side: 'right', offset: 0.5 },
        { id: 'p3', type: 'hydraulic', side: 'top', offset: 0.5 },
        { id: 'p4', type: 'hydraulic', side: 'bottom', offset: 0.5 },
      ];

    case 'HYDROPNEUMATIC_SPHERE':
    case 'PISTON_ACCUMULATOR':
    case 'BALLOON_SPHERICAL':
    case 'BALLOON_CYLINDRICAL':
      return [
        { id: 'port', type: 'hydraulic', side: 'bottom', offset: 0.5 },
      ];

    case 'SPRING':
      return [
        { id: 'p1', type: 'mechanical', side: 'left', offset: 0.5 },
        { id: 'p2', type: 'mechanical', side: 'right', offset: 0.5 },
      ];

    case 'MASS_LOAD':
      return [
        { id: 'port', type: 'mechanical', side: 'top', offset: 0.5 },
      ];

    case 'PUSH_BUTTON':
    case 'TOGGLE_SWITCH':
    case 'SLIDER_CONTROL':
    case 'OSCILLATING_FORCE':
      return [
        { id: 'signal_out', type: 'signal', side: 'right', offset: 0.5 },
      ];

    case 'TLM_LINE':
      return [
        { id: 'p1', type: 'hydraulic', side: 'left', offset: 0.5 },
        { id: 'p2', type: 'hydraulic', side: 'right', offset: 0.5 },
      ];

    default:
      return [];
  }
}

export function getDefaultParams(type: ComponentType): Record<string, number | string | boolean> {
  switch (type) {
    case 'PRESSURE_SOURCE':
      return { pressure: 150e5 }; // 150 bar

    case 'TANK':
      return { pressure: 101325 }; // 1 atm

    case 'DOUBLE_ACTING_CYLINDER':
      return {
        bore_diameter: 0.05,    // 50mm
        rod_diameter: 0.025,    // 25mm
        stroke_length: 0.2,     // 200mm
        mass: 10,               // kg
        friction_static: 50,    // N
        friction_viscous: 100,  // N·s/m
        dead_volume_A: 1e-6,
        dead_volume_B: 1e-6,
        position: 0,
        external_force: 0,
      };

    case 'SINGLE_ACTING_CYLINDER':
      return {
        bore_diameter: 0.05,
        rod_diameter: 0.025,
        stroke_length: 0.2,
        mass: 10,
        friction_viscous: 100,
        spring_rate: 5000,
        spring_preload: 200,
        position: 0,
        external_force: 0,
      };

    case 'ORIFICE':
      return { Cd: 0.65, area: 1e-5 };

    case 'CHECK_VALVE':
      return {
        Cd: 0.65,
        area_max: 1e-4,
        cracking_pressure: 30000,
        full_open_pressure: 100000,
        leakage_flow: 1e-10,
      };

    case 'ONE_WAY_FLOW_CONTROL':
      return {
        Cd: 0.65,
        area_max: 1e-4,
        orifice_area_min: 1e-7,
        orifice_area_max: 1e-4,
        orifice_setting: 0.5,
      };

    case 'VARIABLE_ORIFICE':
      return {
        Cd: 0.65,
        area_max: 1e-4,
        position: 0.5,
        response_time: 0.01,
      };

    case 'DCV_4_3':
    case 'DCV_5_2':
    case 'DCV_5_3':
      return {
        Cd: 0.65,
        area_max: 1e-4,
        spool_position: 0,
        overlap: 0.0,
        response_time: 0.02,
        centre_config: 'CLOSED_CENTRE',
      };

    case 'DCV_3_2':
      return {
        Cd: 0.65,
        area_max: 1e-4,
        spool_position: 0,
        response_time: 0.02,
      };

    case 'TEE_JUNCTION':
      return { volume: 1e-5, fluid_id: 0 };

    case 'CROSS_JUNCTION':
      return { volume: 1e-5, fluid_id: 0 };

    case 'HYDROPNEUMATIC_SPHERE':
      return {
        R_sphere: 0.062,
        diaphragm_rest_ratio: 0.5,
        diaphragm_thickness: 0.003,
        diaphragm_density: 1200,
        diaphragm_modulus: 2e6,
        gas_precharge_pressure: 60e5,
        fluid_id_gas: 0,
      };

    case 'PISTON_ACCUMULATOR':
      return {
        bore: 0.05,
        stroke: 0.2,
        piston_mass: 1,
        gas_precharge_pressure: 50e5,
        seal_friction: 50,
        fluid_id_gas: 0,
      };

    case 'BALLOON_SPHERICAL':
      return {
        R_nominal: 0.025,
        wall_thickness: 0.002,
        elastic_modulus: 2e6,
        stiffening_exponent: 2.0,
        max_strain: 2.5,
        damping_ratio: 0.1,
        p_external: 101325,
      };

    case 'BALLOON_CYLINDRICAL':
      return {
        R_nominal: 0.006,
        length: 0.2,
        wall_thickness: 0.002,
        elastic_modulus: 5e6,
        stiffening_exponent: 1.5,
        max_strain: 3.0,
        damping_ratio: 0.1,
        p_external: 101325,
      };

    case 'SPRING':
      return { spring_rate: 10000, free_length: 0.1, preload: 0, damping: 100 };

    case 'MASS_LOAD':
      return { mass: 100, gravity_force: 0, external_force: 0 };

    case 'PUSH_BUTTON':
      return { response_time: 0.05 };

    case 'TOGGLE_SWITCH':
      return { response_time: 0.05, position_count: 2 };

    case 'SLIDER_CONTROL':
      return { min_value: 0, max_value: 1, initial_value: 0.5 };

    case 'OSCILLATING_FORCE':
      return {
        amplitude: 1000,    // N
        frequency: 5,        // Hz
        waveform: 0,         // 0=sine, 1=square, 2=triangle, 3=random
        offset: 0,           // N (DC offset)
      };

    case 'TLM_LINE':
      return { volume: 1e-6, fluid_id: 0 };

    default:
      return {};
  }
}
