# Pneumania — Physics & Code Review (2026-03-13)

**Reviewer**: Claude (Physics + Software Engineering)  
**Scope**: TLM solver, fluid models, hydraulic/mechanical components, simulation loop  
**Tests run**: `npm test` (hydraulic-sim) ✅

---

## Current State
- Core TLM formulation, fluid property models, and cylinder coupling are solid. The previous review’s major physics issues have been addressed (entrained-air density now polytropic, check valve and DCVs use TLM-coupled NR solves, TLM line stores internal pressure, single-acting cylinder spring is semi-implicit, mass load is semi-implicit, orifice Jacobian is blended, frame loop now caps catch-up work).  
- Fluid presets look reasonable; LHM+ density is now in-spec (`rho_base = 890`, `kappa = 1.15`).

---

## Findings (ordered by impact)

1) Variable orifice bypasses TLM impedance coupling (flow overestimation under load)  
- File: `hydraulic-sim/src/components/models/qTypes.ts:304-340`  
- The proportional orifice computes `dp = p1.c - p2.c` and calls `orificeFlow` directly. Unlike the orifice/check valve/DCV paths, it does not iterate with `(Zc1 + Zc2)` feedback, so actual `dp_actual = (c1 - c2) - (Zc1 + Zc2)·q` is ignored. Under stiff lines or high flow areas, this over-predicts flow and can mask load-induced throttling.  
- Fix: Reuse the existing `solveOrificeFlowNR` helper for the variable orifice path.

2) Solver reset leaves component state “hot” (ramp, trapped pressure, spools)  
- File: `hydraulic-sim/src/solver/engine.ts:258-316`  
- `reset()` zeroes ports and only reinitializes cylinder positions/pressures. It does not re-run `initComponentState`, so: pressure source ramp counters, TLM line `p_internal`, junction `p_junction`, accumulator/baloon states, DCV `actual_spool`, variable orifice `actual_position`, etc., retain their prior values. Pressing Reset after a high-pressure run immediately restarts from the old trapped states (no soft-start ramp), which is physically inconsistent with “cold start”.  
- Fix: Reinitialize each component state in `reset()` (or store a compiled default state to clone) so all C/Q/S components return to their param-defined initial conditions.

---

## Verified as Correct (spot checks)
- Entrained air density and bulk modulus use the same polytropic `kappa` (`hydraulic-sim/src/fluid/properties.ts`).  
- Check valve, DCV 4/3 and 3/2, and one-way flow control all solve with Newton-Raphson TLM coupling (same Jacobian blend as the orifice).  
- TLM hydraulic line uses persistent `p_internal` with semi-implicit impedance (`Zc = β·dt/(2V)`) and trapped-volume updates.  
- Cylinder contact model uses semi-implicit penalty (stiffness+damping) and trapezoidal integration; mechanical ports zeroed for unconnected cases.  
- Canvas loop now caps catch-up steps and spreads deficit to avoid frame spirals.

---

## Recommendations
- Fix variable orifice to use `solveOrificeFlowNR` so proportional valves respect line impedance and load-induced `dp`.  
- Make `reset()` fully reinitialize component state (pressure source ramp counts, TLM line/junction pressures, accumulator/balloon states, valve spools/positions, controller states).  
- Optional polish: expose a “warm start” flag if the current reset semantics are desired for debugging.
