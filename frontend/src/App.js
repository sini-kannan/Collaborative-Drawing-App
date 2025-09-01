import React from 'react';
import Canvas from './components/Canvas';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Collaborative Drawing App</h1>
        <p>Draw with others in real-time!</p>
      </header>
      <main>
        <Canvas />
      </main>
    </div>
  );
}

export default App;
