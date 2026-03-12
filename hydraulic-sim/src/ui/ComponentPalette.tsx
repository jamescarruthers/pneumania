import { useUIStore } from '../store/uiStore';
import { useSimulationStore } from '../store/simulationStore';
import { COMPONENT_GROUPS } from '../components/catalogue';
import type { ComponentType } from '../solver/types';

export function ComponentPalette() {
  const startPlacing = useUIStore((s) => s.startPlacing);
  const running = useSimulationStore((s) => s.running);

  return (
    <div style={styles.palette}>
      <div style={styles.header}>Components</div>
      {COMPONENT_GROUPS.map((group) => (
        <div key={group.name}>
          <div style={styles.groupHeader}>{group.name}</div>
          {group.items.map((item) => (
            <button
              key={item.type}
              style={styles.item}
              onClick={() => !running && startPlacing(item.type as ComponentType)}
              disabled={running}
              title={running ? 'Pause to add components' : `Place ${item.label}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  palette: {
    width: 180,
    background: '#16213e',
    borderRight: '1px solid #2d3436',
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
  groupHeader: {
    color: '#636e72',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: '8px 12px 4px',
    fontFamily: 'monospace',
  },
  item: {
    display: 'block',
    width: '100%',
    padding: '5px 12px 5px 20px',
    background: 'transparent',
    color: '#b2bec3',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'monospace',
    transition: 'background 0.1s',
  },
};
