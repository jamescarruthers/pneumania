/**
 * Standard cylinder sizes and component presets.
 */

export interface StandardCylinder {
  bore: number;        // mm
  rods: number[];      // mm
  strokes: number[];   // mm
}

export const STANDARD_CYLINDERS: StandardCylinder[] = [
  { bore: 10,  rods: [4, 6],           strokes: [10, 15, 25, 50] },
  { bore: 12,  rods: [6, 8],           strokes: [10, 15, 25, 50] },
  { bore: 16,  rods: [6, 8, 10],       strokes: [10, 25, 50, 75, 100] },
  { bore: 20,  rods: [8, 10, 12],      strokes: [25, 50, 75, 100, 150] },
  { bore: 25,  rods: [10, 12, 16],     strokes: [25, 50, 100, 150, 200] },
  { bore: 32,  rods: [12, 16, 20],     strokes: [25, 50, 100, 150, 200, 300] },
  { bore: 40,  rods: [16, 20, 25],     strokes: [50, 100, 150, 200, 300] },
  { bore: 50,  rods: [20, 25, 32],     strokes: [50, 100, 200, 300, 500] },
  { bore: 63,  rods: [25, 32, 40],     strokes: [50, 100, 200, 300, 500] },
  { bore: 80,  rods: [32, 40, 50],     strokes: [100, 200, 300, 500] },
  { bore: 100, rods: [40, 50, 63],     strokes: [100, 200, 300, 500, 1000] },
  { bore: 125, rods: [50, 63, 80],     strokes: [100, 200, 500, 1000] },
  { bore: 160, rods: [63, 80, 100],    strokes: [200, 500, 1000] },
  { bore: 200, rods: [80, 100, 125],   strokes: [200, 500, 1000] },
];

export const SPHERE_PRESETS: Record<string, Record<string, number | string>> = {
  citroen_front_gs: {
    R_sphere: 0.057, diaphragm_rest_ratio: 0.5,
    gas_precharge_pressure: 55e5, label: 'GS/GSA Front Sphere (450cm³, 55 bar)',
  },
  citroen_rear_gs: {
    R_sphere: 0.052, diaphragm_rest_ratio: 0.5,
    gas_precharge_pressure: 35e5, label: 'GS/GSA Rear Sphere (400cm³, 35 bar)',
  },
  citroen_front_cx: {
    R_sphere: 0.062, diaphragm_rest_ratio: 0.5,
    gas_precharge_pressure: 60e5, label: 'CX Front Sphere (500cm³, 60 bar)',
  },
  citroen_front_xm: {
    R_sphere: 0.062, diaphragm_rest_ratio: 0.5,
    gas_precharge_pressure: 62e5, label: 'XM/Xantia Front Sphere (500cm³, 62 bar)',
  },
  citroen_hydractive: {
    R_sphere: 0.057, diaphragm_rest_ratio: 0.5,
    gas_precharge_pressure: 75e5, label: 'Hydractive Stiffness Sphere (450cm³, 75 bar)',
  },
  citroen_rear_c5: {
    R_sphere: 0.052, diaphragm_rest_ratio: 0.5,
    gas_precharge_pressure: 42e5, label: 'C5 Rear Sphere (400cm³, 42 bar)',
  },
  industrial_bladder_1L: {
    R_sphere: 0.062, diaphragm_rest_ratio: 0.5,
    gas_precharge_pressure: 50e5, label: 'Bladder Accumulator 1L (50 bar precharge)',
  },
};

export const BALLOON_PRESETS: Record<string, Record<string, number | string>> = {
  rubber_bladder_small: {
    geometry_type: 'SPHERICAL', R_nominal: 0.025, wall_thickness: 0.002,
    elastic_modulus: 2e6, stiffening_exponent: 2.0, max_strain: 2.5,
    label: 'Small Rubber Bladder (50mm dia)',
  },
  rubber_bladder_large: {
    geometry_type: 'SPHERICAL', R_nominal: 0.075, wall_thickness: 0.003,
    elastic_modulus: 2e6, stiffening_exponent: 2.0, max_strain: 2.5,
    label: 'Large Rubber Bladder (150mm dia)',
  },
  silicone_tube_6mm: {
    geometry_type: 'CYLINDRICAL', R_nominal: 0.003, length: 0.1,
    wall_thickness: 0.001, elastic_modulus: 5e6, stiffening_exponent: 1.5,
    max_strain: 3.0, label: 'Silicone Tube 6mm × 100mm',
  },
  silicone_tube_12mm: {
    geometry_type: 'CYLINDRICAL', R_nominal: 0.006, length: 0.2,
    wall_thickness: 0.002, elastic_modulus: 5e6, stiffening_exponent: 1.5,
    max_strain: 3.0, label: 'Silicone Tube 12mm × 200mm',
  },
  latex_balloon: {
    geometry_type: 'SPHERICAL', R_nominal: 0.05, wall_thickness: 0.0005,
    elastic_modulus: 1.5e6, stiffening_exponent: 3.0, max_strain: 5.0,
    damping_ratio: 0.1, label: 'Latex Balloon (100mm dia)',
  },
};

/** Component palette groups for the UI */
export const COMPONENT_GROUPS = [
  {
    name: 'Actuators',
    items: [
      { type: 'DOUBLE_ACTING_CYLINDER', label: 'Double-Acting Cylinder' },
      { type: 'SINGLE_ACTING_CYLINDER', label: 'Single-Acting Cylinder' },
    ],
  },
  {
    name: 'Valves',
    items: [
      { type: 'CHECK_VALVE', label: 'Check Valve' },
      { type: 'ONE_WAY_FLOW_CONTROL', label: 'One-Way Flow Control' },
      { type: 'VARIABLE_ORIFICE', label: 'Variable Orifice' },
      { type: 'DCV_3_2', label: '3/2 DCV' },
      { type: 'DCV_4_3', label: '4/3 DCV' },
    ],
  },
  {
    name: 'Restrictions',
    items: [
      { type: 'ORIFICE', label: 'Fixed Orifice' },
    ],
  },
  {
    name: 'Junctions',
    items: [
      { type: 'TEE_JUNCTION', label: 'Tee (3-way)' },
      { type: 'CROSS_JUNCTION', label: 'Cross (4-way)' },
    ],
  },
  {
    name: 'Accumulators',
    items: [
      { type: 'HYDROPNEUMATIC_SPHERE', label: 'Hydropneumatic Sphere' },
      { type: 'PISTON_ACCUMULATOR', label: 'Piston Accumulator' },
      { type: 'BALLOON_SPHERICAL', label: 'Balloon (Spherical)' },
      { type: 'BALLOON_CYLINDRICAL', label: 'Balloon (Cylindrical)' },
    ],
  },
  {
    name: 'Sources',
    items: [
      { type: 'PRESSURE_SOURCE', label: 'Pressure Source' },
      { type: 'TANK', label: 'Tank / Reservoir' },
    ],
  },
  {
    name: 'Mechanical',
    items: [
      { type: 'SPRING', label: 'Spring' },
      { type: 'MASS_LOAD', label: 'Mass / Load' },
    ],
  },
  {
    name: 'Controls',
    items: [
      { type: 'PUSH_BUTTON', label: 'Push Button' },
      { type: 'TOGGLE_SWITCH', label: 'Toggle Switch' },
      { type: 'SLIDER_CONTROL', label: 'Slider' },
      { type: 'OSCILLATING_FORCE', label: 'Oscillating Force' },
    ],
  },
] as const;
