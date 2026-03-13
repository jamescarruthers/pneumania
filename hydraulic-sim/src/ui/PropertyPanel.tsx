import { useState, useEffect, useCallback } from 'react';
import { useCircuitStore } from '../store/circuitStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUIStore } from '../store/uiStore';
import { formatPressure } from '../utils/units';
import { type PortType, MIN_LINE_LENGTH } from '../solver/types';

function NumericInput({
  value,
  onChange,
  disabled,
  step,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  step: string;
  min: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const commit = useCallback(() => {
    const num = Number(draft);
    const minVal = Number(min);
    if (Number.isFinite(num) && num >= minVal) {
      onChange(num);
    } else {
      setDraft(String(value));
    }
  }, [draft, min, onChange, value]);

  return (
    <input
      style={styles.input}
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      disabled={disabled}
      step={step}
      min={min}
    />
  );
}

function getPortType(
  comp: { ports: Array<{ id: string; type: PortType }> } | undefined,
  portId: string,
): PortType | undefined {
  return comp?.ports.find((p) => p.id === portId)?.type;
}

export function PropertyPanel() {
  const circuit = useCircuitStore((s) => s.circuit);
  const updateParams = useCircuitStore((s) => s.updateComponentParams);
  const updateLabel = useCircuitStore((s) => s.updateComponentLabel);
  const updateConnectionDiameter = useCircuitStore((s) => s.updateConnectionDiameter);
  const updateConnectionLength = useCircuitStore((s) => s.updateConnectionLength);
  const selectedIds = useUIStore((s) => s.selectedComponentIds);
  const selectedConnectionIds = useUIStore((s) => s.selectedConnectionIds);
  const componentStates = useSimulationStore((s) => s.componentStates);
  const running = useSimulationStore((s) => s.running);

  const selectedId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
  const comp = selectedId
    ? circuit.components.find((c) => c.id === selectedId)
    : null;

  const selectedConnId = selectedConnectionIds.size === 1 ? Array.from(selectedConnectionIds)[0] : null;
  const conn = selectedConnId
    ? circuit.connections.find((c) => c.id === selectedConnId)
    : null;

  if (conn) {
    const fromComp = circuit.components.find((c) => c.id === conn.from.component);
    const toComp = circuit.components.find((c) => c.id === conn.to.component);
    const connLabel = `${fromComp?.label || '?'} → ${toComp?.label || '?'}`;
    const fromType = getPortType(fromComp, conn.from.port);
    const toType = getPortType(toComp, conn.to.port);
    const isHydraulic = fromType === 'hydraulic' && toType === 'hydraulic';

    return (
      <div style={styles.panel}>
        <div style={styles.header}>{isHydraulic ? 'Pipe Properties' : 'Connection Properties'}</div>
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Connection</div>
          <div style={{ ...styles.fieldLabel, padding: '2px 0 6px' }}>{connLabel}</div>
        </div>
        {isHydraulic ? (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Parameters</div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>diameter</label>
              <NumericInput
                value={conn.line_params.inner_diameter}
                onChange={(v) => updateConnectionDiameter(conn.id, v)}
                disabled={running}
                step="0.001"
                min="0.001"
              />
              <span style={styles.unit}>m</span>
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>length</label>
              <NumericInput
                value={conn.line_params.length}
                onChange={(v) => updateConnectionLength(conn.id, v)}
                disabled={running}
                step="0.1"
                min={String(MIN_LINE_LENGTH)}
              />
              <span style={styles.unit}>m</span>
            </div>
          </div>
        ) : (
          <div style={styles.section}>
            <div style={{ ...styles.fieldLabel, padding: '4px 0', color: '#636e72', fontSize: 11 }}>
              {!fromType || !toType
                ? 'Non-hydraulic connection — pipe parameters do not apply'
                : fromType === toType
                  ? `${fromType} connection — pipe parameters do not apply`
                  : `Cross-domain connection (${fromType} → ${toType}) — pipe parameters do not apply`}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!comp) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>Properties</div>
        <div style={styles.empty}>Select a component or pipe</div>
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
  if (key.includes('diameter') || key.includes('length') || key.includes('stroke') || key === 'bore' || key === 'R_') return 'm';
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
  if (key.includes('pressure') || key.startsWith('p_cap')) return formatPressure(val);
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
