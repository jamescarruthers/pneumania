# Pneumania — Physics & Code Review

**Reviewer**: Claude (Physics + Software Engineering perspective)
**Date**: 2026-03-12
**Scope**: Full TLM solver engine, fluid models, all component models (C/Q/S types), simulation loop

---

## Executive Summary

Pneumania is a well-architected TLM (Transmission Line Method) hydraulic simulator. The physics foundation is sound — the TLM formulation, fluid compressibility models, and component coupling are generally correct. However, I've identified **5 physics bugs** (2 significant, 3 moderate), **4 numerical stability concerns**, and **several code quality issues** that should be addressed.

---

## PHYSICS BUGS

### BUG 1 (Significant): Inconsistent Entrained Air Density Model
**File**: `src/fluid/properties.ts:42-46`

```ts
const rho_air = 1.225 * (p_safe / params.p_atm);
return fluid.rho_base * (1.0 - x_air) + rho_air * x_air;
```

The entrained air fraction `x_air` is computed using the **polytropic** gas law with exponent `kappa`:

```ts
x_air = x_air_0 * (p_atm / p_safe)^(1/kappa)
```

But the air density uses an **isothermal** model (`rho ∝ p`, i.e. `kappa = 1`) regardless of the fluid's actual `kappa` setting. For a polytropic process with index κ, the air density should be:

```
ρ_air = ρ_air_0 × (p / p_atm)^(1/κ)
```

For ISO oils with `kappa = 1.2`, this gives a ~15% error in the entrained air density at 200 bar. While the bulk modulus (which is correct) dominates the wave speed calculation, the density error propagates into orifice flow calculations (`orificeFlow` uses `effectiveDensity`) and any momentum-dependent behavior.

**Fix**: Replace line 45 with:
```ts
const rho_air = 1.225 * Math.pow(p_safe / params.p_atm, 1.0 / fluid.kappa);
```

---

### BUG 2 (Significant): Check Valve Uses Uncorrected Wave-Variable dp
**File**: `src/components/models/qTypes.ts:215-228`

```ts
const dp = c1 - c2;  // wave variables, not actual pressures
```

The check valve computes `dp` from raw wave variables `c1 - c2`. In TLM, the actual pressure difference depends on the flow: `dp_actual = (c1 - c2) - (Zc1 + Zc2) * q`. Using the uncorrected value overestimates the pressure drop, especially at high flow rates or with high line impedances.

The orifice model correctly handles this with Newton-Raphson iteration (lines 161-174), but the check valve does not. This can cause:
- Premature opening (the valve "sees" more dp than actually exists)
- Flow overshoot
- Oscillations in circuits with check valves

Additionally, in the partially-open regime (line 225), there is an arbitrary correction `dp - (Zc1 + Zc2) * leakageFlow` that is physically inconsistent — it subtracts the impedance drop for leakage flow, but the actual flow in this regime is much larger than leakage.

**Fix**: Add Newton-Raphson iteration similar to the orifice model, or at minimum use `dp_corrected = dp - (Zc1 + Zc2) * q_prev` as a first-order correction.

---

### BUG 3 (Moderate): TLM Line Lumped Model Uses p_avg Instead of State Variable
**File**: `src/components/models/cTypes.ts:73-84`

```ts
const p_avg = 0.5 * (p1.p + p2.p);
...
const p_new = p_avg + (beta * params.dt / volume) * q_net;
```

The TLM line's internal pressure is derived from the average of port pressures rather than tracked as a persistent state variable (like the junction model correctly does at line 100-110). When port pressures diverge due to impedance effects, using their average introduces an error. The junction model (`updateTeeJunction`) handles this correctly with `comp.state.p_junction`.

**Fix**: Add a `p_internal` state variable to the TLM line, initialized to atmospheric pressure, and integrate it like the junction model does.

---

### BUG 4 (Moderate): DCV and One-Way Flow Control Lack TLM Impedance Coupling
**Files**: `src/components/models/qTypes.ts` — `updateDcv43` (lines 328-398), `updateDcv32` (lines 404-448), `updateOneWayFlowControl` (lines 246-285)

All these Q-type components compute orifice flows directly from wave-variable pressure differences without the iterative TLM coupling that the standalone orifice model uses. For example, in the DCV:

```ts
const dp_PA = portP.c - portA.c;
const q_PA = orificeFlow(dp_PA, Cd, ...);
```

The `orificeFlow` function receives the raw wave-variable difference, but the actual pressure difference under load is `dp - Zc*q`. Without iteration, the computed flow can overshoot, especially for:
- Large valve openings (high flow rates)
- High characteristic impedance lines (small diameter tubes)
- Rapidly changing conditions

The standalone orifice model (lines 139-186) correctly uses 3 Newton-Raphson iterations to converge.

**Fix**: Add at least 1-2 Newton-Raphson iterations to the DCV flow paths, or use a linearized TLM correction.

---

### BUG 5 (Moderate): Single-Acting Cylinder Spring Force Not Semi-Implicit
**File**: `src/components/models/qTypes.ts:111-118`

```ts
const F_spring = -(springRate * position + springPreload);
...
const denom = mass / params.dt + hydraulicStiffness + frictionViscous;
let v_new = (mass * velocity / params.dt + c_A * A_cap + F_spring + F_atm + F_ext) / denom;
```

The hydraulic stiffness and viscous friction are correctly treated semi-implicitly (included in the denominator), but the spring rate is treated **explicitly** — the spring force uses the old position, and `springRate` is not added to the denominator. This can cause numerical instability when:

```
springRate × dt² / mass > 1
```

For example, with `springRate = 50000 N/m`, `mass = 1 kg`, `dt = 1e-4 s`: criterion = 50000 × 1e-8 / 1 = 5e-4 — stable. But for stiffer springs or lighter masses, this could blow up.

**Fix**: Add the spring rate to the denominator for semi-implicit treatment:
```ts
const springStiffness = springRate * params.dt;
const denom = mass / params.dt + hydraulicStiffness + frictionViscous + springStiffness;
```
And adjust the numerator accordingly.

---

## NUMERICAL STABILITY CONCERNS

### STABILITY 1: Orifice Jacobian Discontinuity
**File**: `src/fluid/properties.ts:97-109` and `src/components/models/qTypes.ts:168-170`

The orifice flow blends smoothly between laminar and turbulent regimes, but the Jacobian in the Newton-Raphson switches abruptly at `|dp| = 100 Pa`:

```ts
const dq_ddp = Math.abs(dp) > 100
  ? Cd * area / Math.sqrt(2 * rho * Math.abs(dp))
  : Cd * area * area / (32 * rho * fluid.nu * Math.sqrt(4 * area / Math.PI));
```

The flow equation uses a smooth blend factor `Math.min(|dp|/100, 1)`, but the Jacobian switches discretely. This mismatch can cause Newton-Raphson to oscillate near the transition zone. Consider blending the Jacobian the same way the flow is blended.

---

### STABILITY 2: Pressure Source Initial Transient
**File**: `src/components/models/cTypes.ts:30-35`

```ts
port.c = 2 * pressure - (port.c || pressure);
```

At initialization, all ports start at atmospheric pressure (101,325 Pa). A 150 bar pressure source immediately reflects to `c = 2 × 15e6 - 101325 ≈ 29.9 MPa` in the first step — a massive step function. While this correctly models a sudden pressure application, it can excite high-frequency oscillations in the TLM grid that take many time steps to damp out. Consider ramping the source pressure over several time steps for smoother startup.

---

### STABILITY 3: Mass Load Forward Euler Integration
**File**: `src/components/models/qTypes.ts:498`

```ts
const v_new = velocity + (params.dt / mass) * force;
```

The mass load uses forward Euler integration, which is only conditionally stable. When connected to stiff elements (springs, hydraulic impedances), this can diverge. The cylinder models correctly use a semi-implicit scheme. The mass load should do the same.

---

### STABILITY 4: Simulation Loop Frame-Dependent Step Count
**File**: `src/canvas/CircuitCanvas.tsx:106-114`

```ts
const elapsed = (now - lastTime) / 1000;
const targetSteps = Math.round((elapsed * speed) / dt);
const maxSteps = 5000;
```

The number of solver steps per frame depends on wall-clock elapsed time. If a frame takes unusually long (e.g., garbage collection pause, tab backgrounded), `targetSteps` can jump to 5000, which could take significant compute time and cause further frame drops — a cascading slowdown. Consider using a smaller maximum or tracking a deficit to spread catch-up over multiple frames.

---

## PHYSICS MODEL REVIEW (Correct)

The following physics are implemented correctly:

### Effective Bulk Modulus (Yu 1994 / Ruan-Burton 2006) — CORRECT
```
1/β_eff = (1-x_air)/β_base + x_air·κ/p
x_air = x_air_0 · (p_atm/p)^(1/κ)
```
This is the standard model for liquid compressibility with entrained air. The polytropic index κ controls the air compression behavior — isothermal for κ=1 (water), between isothermal and adiabatic for κ=1.2 (oil).

### Wave Speed — CORRECT
```
a = √(β_eff / ρ_eff)
```
For ideal gases this correctly reduces to `a = √(κRT/M)`. Verified: air at 20°C gives ~343 m/s. ✓

### Characteristic Impedance — CORRECT
```
Zc = β / (A × a)
```
Standard TLM characteristic impedance for a fluid-filled tube. Units: Pa·s/m³. ✓

### Polytropic Gas Law (accumulators) — CORRECT
```
P₂ = P₁ × (V₁/V₂)^κ
```
Used correctly in hydropneumatic sphere, piston accumulator, and balloon models.

### Spherical Cap Geometry — CORRECT
```
V_cap(h) = (π·h²/3)(3R - h)
A_eff(h) = π(2Rh - h²)
```
Standard formulas for a spherical cap of height h in a sphere of radius R. ✓

### Laplace's Law (balloon membrane) — CORRECT
```
P = 2σt/R  (sphere)
P = σt/R   (cylinder)
```
Correct application of the Young-Laplace equation for thin-walled pressure vessels. ✓

### Double-Acting Cylinder TLM Coupling — CORRECT
The semi-implicit scheme correctly couples Newton's second law with TLM wave variables:
```
v_new = (m·v_old/dt + c_A·A_cap - c_B·A_rod + F_ext) / (m/dt + Zc_A·A²_cap + Zc_B·A²_rod + b_visc)
```
The hydraulic impedance terms in the denominator provide natural damping and prevent numerical overshoot. This is textbook TLM-mechanical coupling. ✓

### Trapezoidal Position Integration — CORRECT
```
x_new = x_old + dt × 0.5 × (v_old + v_new)
```
Second-order accurate. Better than simple forward Euler. ✓

### Smooth Sign Function — CORRECT
```
smoothSign(x, ε) = x / √(x² + ε²)
```
Standard regularization that avoids the discontinuity at x=0. Approaches ±1 for |x| >> ε. ✓

### DCV Spool Dynamics — CORRECT
First-order lag filter: `spool += (dt/τ) × (target - spool)`. Correctly models valve response time. ✓

---

## FLUID PRESET REVIEW

| Fluid | β (Pa) | ρ (kg/m³) | ν (m²/s) | Verdict |
|-------|---------|-----------|-----------|---------|
| ISO VG 32 | 1.5e9 | 857 | 32e-6 | ✓ Typical values |
| ISO VG 46 | 1.6e9 | 861 | 46e-6 | ✓ Standard reference oil |
| ISO VG 68 | 1.7e9 | 868 | 68e-6 | ✓ Correct trend |
| Water | 2.2e9 | 998 | 1e-6 | ✓ Textbook values |
| Water-Glycol | 1.9e9 | 1050 | 20e-6 | ✓ Reasonable for HFC |
| LHM+ | 1.4e9 | 1008 | 10e-6 | ⚠ Density seems high for mineral fluid (LHM+ is ~870-920 kg/m³ typically). β is on the low side. Worth double-checking against Citroën technical data. |
| Nitrogen | κ=1.4, M=0.028 | 1.165 | 15e-6 | ✓ Correct |
| Air | κ=1.4, M=0.029 | 1.225 | 15e-6 | ✓ ISA standard atmosphere |

**Note on water kappa=1.0**: This means entrained air in water compresses isothermally. For very small bubbles (good heat transfer to surrounding water), this is physically reasonable. For larger air pockets, κ≈1.4 would be more appropriate. This is a defensible modeling choice.

---

## CODE QUALITY ISSUES

### CODE 1: Linear Search in setComponentState
**File**: `src/solver/engine.ts:231`

```ts
const comp = this.circuit.components.find((c) => c.id === componentId);
```

This is O(n) per call. Use the existing `componentById` Map instead:
```ts
const comp = this.circuit.componentById.get(componentId);
```

The same issue exists in `getComponentState` (line 247).

---

### CODE 2: portIndexMap Recomputed Every Frame
**File**: `src/canvas/CircuitCanvas.tsx:71-81`

`portIndexMap()` is called inside the render loop (line 125) and rebuilds the Map every frame. Since the circuit topology doesn't change during simulation, this should be memoized or computed once at compile time.

---

### CODE 3: Redundant Null Check on comp.state
**File**: `src/components/models/qTypes.ts:184`

```ts
if (!comp.state) comp.state = {};
```

`comp.state` is always initialized by `initComponentState` during compilation. This null check is unreachable. Minor, but suggests uncertainty about the data flow.

---

### CODE 4: updateFromSolver Creates New Objects Every Call
**File**: `src/store/simulationStore.ts:70-74`

```ts
portStates: compiled.ports.map((p) => ({ ...p })),
componentStates: new Map(
  compiled.components.map((c) => [c.id, { ...c.state }])
),
```

This creates new arrays/maps on every solver update, triggering React re-renders of every subscribed component. At high step rates (5000 steps/frame), the render overhead could dominate. Consider diffing or throttling updates.

---

### CODE 5: Missing LINKED_CYLINDERS Implementation
**File**: `src/solver/engine.ts:165-203`

`LINKED_CYLINDERS` is defined in `ComponentType` and classified as Q-type, but has no case in `updateQType()`. It will silently do nothing if placed in a circuit.

---

## ARCHITECTURE OBSERVATIONS

### TLM Class Assignment — Appropriate
The C/Q/S classification is physically correct:
- **C-types** (pressure sources, junctions, accumulators): Set pressure, compute impedance — these are the "capacitive" elements that store energy and define boundary conditions.
- **Q-types** (orifices, valves, cylinders): Compute flow from wave variables — these are the "resistive/inertive" elements.
- **S-types** (controls): Signal generation — no physics, just control inputs.

This matches the standard TLM formulation for hydraulic circuits (e.g., Krus 1999, Johnston 2006).

### Execution Order — Correct
The C→S→signal routing→Q→buffer swap order ensures:
1. Boundary conditions are set before flow computation
2. Control signals reach valves within the same time step
3. All components see consistent previous-step data (double buffering)

### dt Determination — Correct but Conservative
Setting `dt = min(L/a)` across all connections ensures the CFL condition is met. However, for circuits with mixed line lengths, shorter lines over-constrain the time step. A multi-rate scheme could improve efficiency but would add significant complexity.

---

## SUMMARY OF RECOMMENDED ACTIONS

| Priority | Issue | Type | Effort |
|----------|-------|------|--------|
| HIGH | Fix entrained air density model | Physics bug | Small |
| HIGH | Add TLM coupling to check valve | Physics bug | Medium |
| MEDIUM | Track TLM line internal pressure as state | Physics bug | Small |
| MEDIUM | Add iteration to DCV flow paths | Physics bug | Medium |
| MEDIUM | Semi-implicit spring in single-acting cylinder | Physics bug | Small |
| MEDIUM | Blend orifice Jacobian smoothly | Numerical | Small |
| LOW | Semi-implicit mass load integration | Numerical | Small |
| LOW | Use componentById Map for lookups | Performance | Trivial |
| LOW | Memoize portIndexMap | Performance | Small |
| LOW | Implement LINKED_CYLINDERS or remove from types | Completeness | Medium |
| LOW | Verify LHM+ density against datasheet | Data accuracy | Trivial |
