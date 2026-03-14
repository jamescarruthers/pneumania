import { useSimulationStore, type SimSpeed } from '../store/simulationStore';
import { useCircuitStore } from '../store/circuitStore';
import { EXAMPLE_CIRCUITS } from '../store/exampleCircuits';
import { downloadCircuit, uploadCircuit, saveToLocalStorage } from '../store/persistence';
import type { SolverBackend } from '../solver/interface';

const SPEED_OPTIONS: SimSpeed[] = [0.1, 0.25, 0.5, 1, 2, 5, 10];

export function Toolbar() {
  const running = useSimulationStore((s) => s.running);
  const speed = useSimulationStore((s) => s.speed);
  const solver = useSimulationStore((s) => s.solver);
  const simParams = useSimulationStore((s) => s.simParams);
  const solverBackend = useSimulationStore((s) => s.solverBackend);
  const switchingBackend = useSimulationStore((s) => s.switchingBackend);
  const setSolverBackend = useSimulationStore((s) => s.setSolverBackend);
  const togglePlayPause = useSimulationStore((s) => s.togglePlayPause);
  const stepOnce = useSimulationStore((s) => s.stepOnce);
  const reset = useSimulationStore((s) => s.reset);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const circuit = useCircuitStore((s) => s.circuit);
  const loadCircuit = useCircuitStore((s) => s.loadCircuit);

  const handleCompile = () => {
    solver.init(circuit);
    useSimulationStore.getState().updateFromSolver();
  };

  const handlePlayPause = () => {
    // Auto-compile before starting if no compiled circuit exists
    if (!running && !solver.getCompiledCircuit()) {
      solver.init(circuit);
      useSimulationStore.getState().updateFromSolver();
    }
    togglePlayPause();
  };

  const handleLoadExample = (idx: number) => {
    if (running) return;
    const example = EXAMPLE_CIRCUITS[idx];
    if (example) {
      const c = example.create();
      loadCircuit(c);
    }
  };

  const handleSave = () => {
    saveToLocalStorage(circuit);
    downloadCircuit(circuit);
  };

  const handleLoad = async () => {
    if (running) return;
    const c = await uploadCircuit();
    if (c) loadCircuit(c);
  };

  return (
    <div style={styles.toolbar}>
      <div style={styles.group}>
        <select
          style={styles.select}
          value=""
          onChange={(e) => {
            const idx = parseInt(e.target.value);
            if (!isNaN(idx)) handleLoadExample(idx);
          }}
          disabled={running}
        >
          <option value="" disabled>Examples...</option>
          {EXAMPLE_CIRCUITS.map((ex, i) => (
            <option key={i} value={i}>{ex.name}</option>
          ))}
        </select>
        <button style={styles.button} onClick={handleSave} title="Save circuit">
          Save
        </button>
        <button style={styles.button} onClick={handleLoad} disabled={running} title="Load circuit">
          Load
        </button>
      </div>

      <div style={styles.divider} />

      <div style={styles.group}>
        <button style={styles.button} onClick={handleCompile} title="Compile circuit">
          Build
        </button>
        <button
          style={{ ...styles.button, ...(running ? styles.activeButton : {}) }}
          onClick={handlePlayPause}
          title={running ? 'Pause' : 'Play'}
        >
          {running ? 'Pause' : 'Play'}
        </button>
        <button style={styles.button} onClick={stepOnce} title="Step one frame">
          Step
        </button>
        <button style={styles.button} onClick={reset} title="Reset simulation">
          Reset
        </button>
      </div>

      <div style={styles.divider} />

      <div style={styles.group}>
        <label style={styles.label}>Speed:</label>
        <select
          style={styles.select}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value) as SimSpeed)}
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>
      </div>

      <div style={styles.divider} />

      <div style={styles.group}>
        <label style={styles.label}>Engine:</label>
        <select
          style={styles.select}
          value={solverBackend}
          onChange={(e) => setSolverBackend(e.target.value as SolverBackend)}
          disabled={running || switchingBackend}
        >
          <option value="js">TLM (JS)</option>
          <option value="rapier">Rapier (hybrid)</option>
        </select>
        {switchingBackend && <span style={styles.info}>loading...</span>}
      </div>

      <div style={styles.divider} />

      <div style={styles.group}>
        <span style={styles.info}>
          dt: {(simParams.dt * 1000).toFixed(3)}ms
        </span>
        <span style={styles.info}>
          Step: {simParams.step.toLocaleString()}
        </span>
        <span style={styles.info}>
          t: {simParams.time.toFixed(3)}s
        </span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: '#16213e',
    borderBottom: '1px solid #2d3436',
    height: 40,
    flexShrink: 0,
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  divider: {
    width: 1,
    height: 24,
    background: '#636e72',
    margin: '0 4px',
  },
  button: {
    padding: '4px 12px',
    background: '#2d3436',
    color: '#dfe6e9',
    border: '1px solid #636e72',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  activeButton: {
    background: '#0984e3',
    borderColor: '#0984e3',
  },
  select: {
    padding: '3px 6px',
    background: '#2d3436',
    color: '#dfe6e9',
    border: '1px solid #636e72',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  label: {
    color: '#b2bec3',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  info: {
    color: '#636e72',
    fontSize: 11,
    fontFamily: 'monospace',
  },
};
