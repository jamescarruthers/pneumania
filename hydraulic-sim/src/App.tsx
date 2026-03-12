import { CircuitCanvas } from './canvas/CircuitCanvas';
import { Toolbar } from './ui/Toolbar';
import { ComponentPalette } from './ui/ComponentPalette';
import { PropertyPanel } from './ui/PropertyPanel';
import { StatusBar } from './ui/StatusBar';

function App() {
  return (
    <div style={styles.app}>
      <Toolbar />
      <div style={styles.main}>
        <ComponentPalette />
        <div style={styles.canvasWrapper}>
          <CircuitCanvas />
        </div>
        <PropertyPanel />
      </div>
      <StatusBar />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    background: '#0a0a1a',
    color: '#dfe6e9',
    fontFamily: 'monospace',
  },
  main: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
  },
  canvasWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
};

export default App;
