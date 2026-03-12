// Core types for the hydraulic circuit simulator TLM solver

// ============================================================
// Fluid Types
// ============================================================

export type FluidType = 'LIQUID' | 'GAS';

export interface FluidDef {
  id: number;
  fluid_type: FluidType;
  beta_base: number;    // base bulk modulus (Pa)
  rho_base: number;     // base density (kg/m³)
  x_air_0: number;      // initial entrained air fraction
  kappa: number;        // polytropic index
  p_vapour: number;     // vapour pressure (Pa)
  nu: number;           // kinematic viscosity (m²/s)
  gamma: number;        // ratio of specific heats (gas)
  molar_mass: number;   // kg/mol (gas)
  henry_coeff: number;  // Henry's law coefficient
  label: string;
}

// ============================================================
// Port and Connection Types
// ============================================================

export interface PortState {
  p: number;       // pressure (Pa)
  q: number;       // volumetric flow (m³/s)
  c: number;       // wave variable
  Zc: number;      // characteristic impedance
  fluid_id: number; // index into fluids array
}

export type PortType = 'hydraulic' | 'mechanical' | 'signal';
export type PortSide = 'top' | 'bottom' | 'left' | 'right';

export interface PortDef {
  id: string;
  type: PortType;
  side: PortSide;
  offset: number; // 0-1 along the side
  label?: string;
}

export interface Connection {
  port_a: number;      // index into port buffer
  port_b: number;      // index into port buffer
  line_length: number;
  Zc: number;
  fluid_id: number;
  inner_diameter: number;
}

// ============================================================
// Component Types
// ============================================================

export type ComponentType =
  | 'PRESSURE_SOURCE'
  | 'TANK'
  | 'DOUBLE_ACTING_CYLINDER'
  | 'SINGLE_ACTING_CYLINDER'
  | 'ORIFICE'
  | 'CHECK_VALVE'
  | 'ONE_WAY_FLOW_CONTROL'
  | 'VARIABLE_ORIFICE'
  | 'DCV_4_3'
  | 'DCV_3_2'
  | 'DCV_5_2'
  | 'DCV_5_3'
  | 'TEE_JUNCTION'
  | 'CROSS_JUNCTION'
  | 'HYDROPNEUMATIC_SPHERE'
  | 'PISTON_ACCUMULATOR'
  | 'BALLOON_SPHERICAL'
  | 'BALLOON_CYLINDRICAL'
  | 'SPRING'
  | 'MASS_LOAD'
  | 'LINKED_CYLINDERS'
  | 'PUSH_BUTTON'
  | 'TOGGLE_SWITCH'
  | 'SLIDER_CONTROL'
  | 'TLM_LINE';

export type TLMClass = 'C' | 'Q' | 'S';

export const COMPONENT_TLM_CLASS: Record<ComponentType, TLMClass> = {
  PRESSURE_SOURCE: 'C',
  TANK: 'C',
  DOUBLE_ACTING_CYLINDER: 'Q',
  SINGLE_ACTING_CYLINDER: 'Q',
  ORIFICE: 'Q',
  CHECK_VALVE: 'Q',
  ONE_WAY_FLOW_CONTROL: 'Q',
  VARIABLE_ORIFICE: 'Q',
  DCV_4_3: 'Q',
  DCV_3_2: 'Q',
  DCV_5_2: 'Q',
  DCV_5_3: 'Q',
  TEE_JUNCTION: 'C',
  CROSS_JUNCTION: 'C',
  HYDROPNEUMATIC_SPHERE: 'C',
  PISTON_ACCUMULATOR: 'C',
  BALLOON_SPHERICAL: 'C',
  BALLOON_CYLINDRICAL: 'C',
  SPRING: 'Q',
  MASS_LOAD: 'Q',
  LINKED_CYLINDERS: 'Q',
  PUSH_BUTTON: 'S',
  TOGGLE_SWITCH: 'S',
  SLIDER_CONTROL: 'S',
  TLM_LINE: 'C',
};

// ============================================================
// Component Instance (runtime)
// ============================================================

export interface ComponentInstance {
  id: string;
  type: ComponentType;
  tlmClass: TLMClass;
  portStartIndex: number;
  portCount: number;
  params: Record<string, number>;
  state: Record<string, number>;
}

// ============================================================
// Circuit Definition (serialisable)
// ============================================================

export interface ComponentDef {
  id: string;
  type: ComponentType;
  label: string;
  position: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  params: Record<string, number | string | boolean>;
  ports: PortDef[];
}

export interface ConnectionDef {
  id: string;
  from: { component: string; port: string };
  to: { component: string; port: string };
  waypoints: { x: number; y: number }[];
  line_params: {
    inner_diameter: number;
    length: number;
    fluid_id: number;
  };
}

export interface CircuitDefinition {
  version: string;
  fluids: FluidDef[];
  default_fluid_id: number;
  components: ComponentDef[];
  connections: ConnectionDef[];
  ui: {
    camera: { x: number; y: number; zoom: number };
    grid_size: number;
  };
}

// ============================================================
// Simulation Parameters
// ============================================================

export interface SimParams {
  dt: number;
  time: number;
  step: number;
  temperature: number;  // K (default 293.15 = 20°C)
  p_atm: number;        // atmospheric pressure (Pa)
}

export const DEFAULT_SIM_PARAMS: SimParams = {
  dt: 1e-4,        // 0.1ms
  time: 0,
  step: 0,
  temperature: 293.15,
  p_atm: 101325,
};

// ============================================================
// Solver Interface
// ============================================================

export interface Solver {
  init(circuit: CircuitDefinition): void;
  step(n: number): void;
  getPortState(index: number): PortState;
  getComponentState(id: string): Record<string, number>;
  getSimParams(): SimParams;
  reset(): void;
  dispose(): void;
}

// ============================================================
// Constants
// ============================================================

export const R_GAS = 8.314;        // J/(mol·K)
export const P_ATM = 101325;       // Pa
export const MAX_COMPONENTS = 1024;
export const MAX_PORTS = 4096;
export const MAX_CONNECTIONS = 2048;
export const MAX_FLUIDS = 16;
