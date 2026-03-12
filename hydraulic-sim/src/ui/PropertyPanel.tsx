import { useCircuitStore } from '../store/circuitStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUIStore } from '../store/uiStore';
import { formatPressure } from '../utils/units';

export function PropertyPanel() {
  const circuit = useCircuitStore((s) => s.circuit);
  const updateParams = useCircuitStore((s) => s.updateComponentParams);
  const updateLabel = useCircuitStore((s) => s.updateComponentLabel);
  const selectedIds = useUIStore((s) => s.selectedComponentIds);
  const componentStates = useSimulationStore((s) => s.componentStates);
  const running = useSimulationStore((s) => s.running);

  const selectedId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
  const comp = selectedId
    ? circuit.components.find((c) => c.id === selectedId)
    : null;

  if (!comp) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>Properties</div>
        <div style={styles.empty}>Select a component</div>
      </div>
    );
  }

  const compState = componentStates.get(comp.id);

  const handleParamChange = (key: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      updateParams(comp.id, { [key]: num });
    }
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>Properties</div>
      <div style={styles.section}>
        <label style={styles.fieldLabel}>Label</label>
        <input
          style={styles.input}
          value={comp.label}
          onChange={(e) => updateLabel(comp.id, e.target.value)}
        />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          {comp.type.replace(/_/g, ' ')}
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Parameters</div>
        {Object.entries(comp.params).map(([key, val]) => {
          if (typeof val === 'boolean') return null;
          if (typeof val === 'string') return null;
          return (
            <div key={key} style={styles.field}>
              <label style={styles.fieldLabel}>
                {key.replace(/_/g, ' ')}
              </label>
              <input
                style={styles.input}
                type="number"
                value={typeof val === 'number' ? val : ''}
                onChange={(e) => handleParamChange(key, e.target.value)}
                disabled={running}
                step="any"
              />
              <span style={styles.unit}>{getUnitForParam(key)}</span>
            </div>
          );
        })}
      </div>

      {running && compState && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Live State</div>
          {Object.entries(compState).map(([key, val]) => (
            <div key={key} style={styles.field}>
              <label style={styles.fieldLabel}>{key.replace(/_/g, ' ')}</label>
              <span style={styles.value}>
                {formatStateValue(key, val)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getUnitForParam(key: string): string {
  if (key.includes('pressure') || key === 'p_vapour' || key === 'p_external') return 'Pa';
  if (key.includes('diameter') || key.includes('length') || key.includes('stroke') || key === 'bore' || key.startsWith('R_')) return 'm';
  if (key.includes('mass')) return 'kg';
  if (key.includes('force')) return 'N';
  if (key.includes('viscous') || key === 'damping') return 'N·s/m';
  if (key.includes('rate') && !key.includes('response')) return 'N/m';
  if (key.includes('volume')) return 'm³';
  if (key.includes('area')) return 'm²';
  if (key === 'Cd' || key.includes('ratio') || key.includes('setting') || key.includes('position') || key.includes('overlap')) return '';
  if (key.includes('time')) return 's';
  if (key.includes('modulus')) return 'Pa';
  return '';
}

function formatStateValue(key: string, val: number): string {
  if (key === 'position') return `${(val * 1000).toFixed(1)} mm`;
  if (key === 'velocity') return `${(val * 1000).toFixed(1)} mm/s`;
  if (key === 'piston_position') return `${(val * 1000).toFixed(1)} mm`;
  if (key.includes('pressure')) return formatPressure(val);
  return val.toFixed(4);
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 220,
    background: '#16213e',
    borderLeft: '1px solid #2d3436',
    overflowY: 'auto',
    flexShrink: 0,
    padding: '8px 0',
  },
  header: {
    color: '#dfe6e9',
    fontSize: 13,
    fontWeight: 'bold',
    padding: '4px 12px 8px',
    fontFamily: 'monospace',
  },
  section: {
    padding: '4px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  sectionTitle: {
    color: '#636e72',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: '4px 0',
    fontFamily: 'monospace',
  },
  field: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 0',
  },
  fieldLabel: {
    color: '#b2bec3',
    fontSize: 11,
    fontFamily: 'monospace',
    flex: '0 0 auto',
    minWidth: 80,
  },
  input: {
    flex: 1,
    padding: '2px 4px',
    background: '#2d3436',
    color: '#dfe6e9',
    border: '1px solid #636e72',
    borderRadius: 3,
    fontSize: 11,
    fontFamily: 'monospace',
    minWidth: 0,
  },
  unit: {
    color: '#636e72',
    fontSize: 10,
    fontFamily: 'monospace',
    flex: '0 0 auto',
    minWidth: 24,
  },
  value: {
    color: '#48dbfb',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  empty: {
    color: '#636e72',
    fontSize: 12,
    padding: '20px 12px',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
};
