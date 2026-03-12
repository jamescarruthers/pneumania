/**
 * Maps pressure to display colour, with fluid-type-dependent base hue.
 */

import type { FluidDef } from '../solver/types';

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = h % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function getFluidBaseHue(fluid: FluidDef | null): number {
  if (!fluid) return 35; // amber
  if (fluid.fluid_type === 'GAS') return 0; // grey (achromatic)
  const label = fluid.label.toLowerCase();
  if (label.includes('water') || label.includes('hfc')) return 210; // blue
  if (label.includes('lhm')) return 130; // green
  return 35; // amber for oils
}

function isGas(fluid: FluidDef | null): boolean {
  return fluid?.fluid_type === 'GAS';
}

export function pressureToColour(
  pressure: number,
  fluid: FluidDef | null,
  minP: number = 0,
  maxP: number = 350e5
): string {
  if (isGas(fluid)) {
    // Grey scale for gas
    const t = Math.max(0, Math.min(1, (pressure - minP) / (maxP - minP)));
    const l = 0.3 + t * 0.5;
    const v = Math.round(l * 255);
    return `rgb(${v},${v},${v})`;
  }

  const hue = getFluidBaseHue(fluid);
  const t = Math.max(0, Math.min(1, (pressure - minP) / (maxP - minP)));

  // Cavitation warning
  if (pressure < 0) {
    return '#1a1a2e';
  }

  const saturation = 0.7 - t * 0.3;
  const lightness = 0.25 + t * 0.55;

  // Over-pressure warning
  if (pressure > maxP) {
    return `hsl(0, 80%, ${50 + Math.sin(Date.now() / 200) * 15}%)`;
  }

  const { r, g, b } = hslToRgb(hue, saturation, lightness);
  return `rgb(${r},${g},${b})`;
}

export function getFluidLineStyle(fluid: FluidDef | null): {
  color: string;
  dashPattern: number[];
} {
  if (isGas(fluid)) {
    return { color: '#888', dashPattern: [8, 4] };
  }
  const hue = getFluidBaseHue(fluid);
  const { r, g, b } = hslToRgb(hue, 0.6, 0.45);
  return { color: `rgb(${r},${g},${b})`, dashPattern: [] };
}
