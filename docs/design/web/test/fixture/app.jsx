// A small React 18 page, built like the application, that reports what the browser allowed it to do
// under the document's headers. Used by container_test.mjs.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const allows = (f) => (document.featurePolicy ? document.featurePolicy.allowsFeature(f) : 'unknown');

function probe() {
  const r = { doc: document.title, path: location.pathname, inlineRan: window.inlineRan === true };
  try { document.createElement('div').innerHTML = '<b>x</b>'; r.innerHTMLBlocked = false; } catch { r.innerHTMLBlocked = true; }
  try { new Function('return 1')(); r.evalBlocked = false; } catch { r.evalBlocked = true; }
  r.camera = allows('camera');
  r.geolocation = allows('geolocation');
  r.inlineStyleBlocked = getComputedStyle(document.getElementById('inline-style-target')).color !== 'rgb(255, 0, 0)';
  r.stylesheetApplied = getComputedStyle(document.body).backgroundColor === 'rgb(250, 250, 245)';
  return r;
}

function App() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const r = probe();
    r.reactRendered = document.getElementById('react-text')?.textContent === 'Rendered by React';
    r.styleProp = getComputedStyle(document.getElementById('react-text')).color === 'rgb(1, 2, 3)';
    const api = fetch('/api/v1/ping', { credentials: 'same-origin' }).then((x) => x.json()).then((j) => j, () => null);
    const ws = new Promise((resolve) => {
      try {
        const s = new WebSocket(`ws://${location.host}/socket.io/?EIO=4&transport=websocket`);
        s.onmessage = (e) => { resolve(e.data); s.close(); };
        s.onerror = () => resolve('error');
      } catch (e) { resolve('blocked: ' + e.message); }
    });
    Promise.all([api, ws]).then(([a, w]) => { r.api = a; r.ws = w; window.__report = r; });
  }, []);
  return (
    <main>
      <p id="react-text" style={{ color: 'rgb(1, 2, 3)' }}>Rendered by React</p>
      <button id="inc" onClick={() => setCount((c) => c + 1)}>Clicked {count}</button>
    </main>
  );
}
createRoot(document.getElementById('root')).render(<App />);
