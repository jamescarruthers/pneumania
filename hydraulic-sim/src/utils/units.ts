/**
 * Unit conversion utilities.
 * Internal: SI base units. Display: user-configurable.
 */

export type PressureUnit = 'Pa' | 'bar' | 'psi' | 'MPa' | 'kPa';
export type FlowUnit = 'm3/s' | 'L/min' | 'gal/min';
export type LengthUnit = 'm' | 'mm' | 'cm' | 'in';
export type ForceUnit = 'N' | 'kN' | 'lbf';

export function convertPressure(value: number, from: PressureUnit, to: PressureUnit): number {
  // Convert to Pa first
  let pa: number;
  switch (from) {
    case 'Pa': pa = value; break;
    case 'bar': pa = value * 1e5; break;
    case 'psi': pa = value * 6894.757; break;
    case 'MPa': pa = value * 1e6; break;
    case 'kPa': pa = value * 1e3; break;
  }
  // Convert from Pa to target
  switch (to) {
    case 'Pa': return pa;
    case 'bar': return pa / 1e5;
    case 'psi': return pa / 6894.757;
    case 'MPa': return pa / 1e6;
    case 'kPa': return pa / 1e3;
  }
}

export function convertFlow(value: number, from: FlowUnit, to: FlowUnit): number {
  let m3s: number;
  switch (from) {
    case 'm3/s': m3s = value; break;
    case 'L/min': m3s = value / 60000; break;
    case 'gal/min': m3s = value * 6.309e-5; break;
  }
  switch (to) {
    case 'm3/s': return m3s;
    case 'L/min': return m3s * 60000;
    case 'gal/min': return m3s / 6.309e-5;
  }
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  let m: number;
  switch (from) {
    case 'm': m = value; break;
    case 'mm': m = value / 1000; break;
    case 'cm': m = value / 100; break;
    case 'in': m = value * 0.0254; break;
  }
  switch (to) {
    case 'm': return m;
    case 'mm': return m * 1000;
    case 'cm': return m * 100;
    case 'in': return m / 0.0254;
  }
}

export function formatPressure(pa: number, unit: PressureUnit = 'bar', decimals: number = 1): string {
  return convertPressure(pa, 'Pa', unit).toFixed(decimals) + ' ' + unit;
}

export function formatFlow(m3s: number, unit: FlowUnit = 'L/min', decimals: number = 2): string {
  return convertFlow(m3s, 'm3/s', unit).toFixed(decimals) + ' ' + unit;
}

export function formatLength(m: number, unit: LengthUnit = 'mm', decimals: number = 1): string {
  return convertLength(m, 'm', unit).toFixed(decimals) + ' ' + unit;
}
