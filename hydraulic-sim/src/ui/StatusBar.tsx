import { useSimulationStore } from '../store/simulationStore';
import { useCircuitStore } from '../store/circuitStore';

export function StatusBar() {
  const running = useSimulationStore((s) => s.running);
  const simParams = useSimulationStore((s) => s.simParams);
  const circuit = useCircuitStore((s) => s.circuit);

  return (
    <div style={styles.bar}>
      <span style={styles.item}>
        Solver: JS {running ? '▶' : '⏸'}
      </span>
      <span style={styles.item}>
        Components: {circuit.components.length}
      </span>
      <span style={styles.item}>
        Connections: {circuit.connections.length}
      </span>
      <span style={styles.item}>
        Step: {simParams.step.toLocaleString()}
      </span>
      <span style={styles.item}>
        dt: {(simParams.dt * 1000).toFixed(3)}ms
      </span>
      <span style={styles.item}>
        t: {simParams.time.toFixed(3)}s
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '4px 12px',
    background: '#0f3460',
    borderTop: '1px solid #2d3436',
    height: 24,
    flexShrink: 0,
  },
  item: {
    color: '#636e72',
    fontSize: 11,
    fontFamily: 'monospace',
  },
};
