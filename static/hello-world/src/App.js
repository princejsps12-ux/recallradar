import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';

const styles = {
  list: { listStyle: 'none', margin: 0, padding: 0 },
  item: { padding: '8px 0', borderBottom: '1px solid #dfe1e6' },
  title: { fontWeight: 600 },
  meta: { color: '#5e6c84', fontSize: '12px' },
  detail: { fontSize: '12px', marginTop: '2px' },
};

function Recall({ recall }) {
  return (
    <li style={styles.item}>
      <div style={styles.title}>
        {recall.recallNumber} · Class {recall.recallClass || '?'}
      </div>
      <div style={styles.meta}>
        {recall.firm || 'Unknown firm'} · {recall.date || 'No date'}
      </div>
      <div style={styles.detail}>{recall.product}</div>
      {recall.codeInfo && (
        <div style={styles.meta}>Model/lot info: {recall.codeInfo}</div>
      )}
    </li>
  );
}

function App() {
  const [state, setState] = useState({ status: 'loading', recalls: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    invoke('fetchRecalls')
      .then((result) => {
        if (cancelled) return;
        if (result && result.ok) {
          setState({ status: 'done', recalls: result.recalls, error: '' });
        } else {
          setState({ status: 'error', recalls: [], error: (result && result.error) || 'Unknown error' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error', recalls: [], error: 'Could not reach RecallRadar.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') return <div>Loading latest FDA recalls...</div>;
  if (state.status === 'error') return <div>{state.error}</div>;
  if (state.recalls.length === 0) return <div>No recalls found.</div>;

  return (
    <div>
      <div style={styles.meta}>Latest {state.recalls.length} FDA device recalls</div>
      <ul style={styles.list}>
        {state.recalls.map((recall) => (
          <Recall key={recall.recallNumber} recall={recall} />
        ))}
      </ul>
    </div>
  );
}

export default App;
