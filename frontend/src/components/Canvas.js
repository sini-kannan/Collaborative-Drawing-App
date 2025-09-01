import React, { useRef, useEffect, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import io from 'socket.io-client';

const SOCKET_SERVER_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

function getRoomId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('room') || 'lobby';
}

function throttle(fn, wait) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, args);
    }
  };
}

const Canvas = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [cursors, setCursors] = useState({}); // {id: {x, y, color}}
  const socketRef = useRef();
  const strokeIdRef = useRef(null);
  const [roomInput, setRoomInput] = useState(getRoomId());
  const [toast, setToast] = useState(null);

  // Toast helper
  const showToast = (msg) => {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 2000);
  };

  // Setup canvas and socket
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    // HiDPI scaling
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      setDpr(ratio);
      // Compute responsive size based on container and viewport
      const container = containerRef.current || canvas.parentElement;
      const maxWidth = container ? container.clientWidth : 800;
      const desiredWidth = Math.min(maxWidth, 1200);
      const desiredHeight = Math.min(Math.floor(desiredWidth * 0.75), Math.max(320, window.innerHeight - 180));
      // set CSS size for layout
      canvas.style.width = `${desiredWidth}px`;
      canvas.style.height = `${desiredHeight}px`;
      // set internal pixel buffer for crisp rendering
      canvas.width = Math.floor(desiredWidth * ratio);
      canvas.height = Math.floor(desiredHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineCap = 'round';
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
    };
    resize();
    window.addEventListener('resize', resize);

    setCtx(context);

    // Socket connection with room query
    const room = getRoomId();
    socketRef.current = io(SOCKET_SERVER_URL, { query: { room } });

    const replay = (strokes = []) => {
      // Redraw sequentially
      strokes.forEach(({ x, y, type, color: drawColor, width }) => {
        if (type === 'start') {
          context.beginPath();
          context.moveTo(x, y);
        } else if (type === 'draw') {
          const prevColor = context.strokeStyle;
          const prevWidth = context.lineWidth;
          context.strokeStyle = drawColor || prevColor;
          context.lineWidth = width || prevWidth;
          context.lineTo(x, y);
          context.stroke();
        }
      });
      // ensure new strokes use current UI settings
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
    };

    // Replay history when delivered by server
    socketRef.current.on('history', replay);

    // Remote draw handler
    socketRef.current.on('draw', (data) => {
      const { x, y, type, color: drawColor, width } = data;
      if (type === 'start') {
        context.beginPath();
        context.moveTo(x, y);
      } else if (type === 'draw') {
        context.strokeStyle = drawColor;
        context.lineWidth = width;
        context.lineTo(x, y);
        context.stroke();
      }
    });

    // Clear sync
    socketRef.current.on('clear', () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
    });

    // Reset with provided history (after undo or snapshot apply)
    socketRef.current.on('resetWithHistory', (strokes = []) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      replay(strokes);
    });

    // Live cursors
    socketRef.current.on('cursor', ({ id, x, y, color: c }) => {
      setCursors((prev) => ({ ...prev, [id]: { x, y, color: c || '#4a6fa5' } }));
    });
    socketRef.current.on('cursor:left', ({ id }) => {
      setCursors((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    });

    return () => {
      window.removeEventListener('resize', resize);
      socketRef.current && socketRef.current.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update stroke style when color/width changes
  useEffect(() => {
    if (ctx) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
    }
  }, [ctx, color, lineWidth]);

  // Helpers to get coords relative to canvas
  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    return { x, y };
  };

  const start = (e) => {
    e.preventDefault();
    const { x, y } = getPos(e);
    setIsDrawing(true);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // create a new stroke id
    const sid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    strokeIdRef.current = sid;
    socketRef.current.emit('draw', { x, y, type: 'start', color, width: lineWidth, strokeId: sid });
  };

  const moveThrottled = throttle((x, y) => {
    if (!isDrawing) return;
    ctx.lineTo(x, y);
    ctx.stroke();
    socketRef.current.emit('draw', { x, y, type: 'draw', color, width: lineWidth, strokeId: strokeIdRef.current });
  }, 16); // ~60fps

  const move = (e) => {
    const { x, y } = getPos(e);
    moveThrottled(x, y);
    // emit cursor always (throttled separately)
    emitCursorThrottled(x, y);
  };

  const end = () => {
    setIsDrawing(false);
    ctx.closePath();
  };

  const clearCanvas = () => {
    if (ctx) {
      const c = canvasRef.current;
      ctx.clearRect(0, 0, c.width, c.height);
      socketRef.current.emit('clear');
    }
  };

  const exportPNG = () => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `canvas-${getRoomId()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // Actions: undo and snapshots
  const undo = () => {
    socketRef.current.emit('undo');
  };

  const saveSnapshot = async () => {
    const name = window.prompt('Snapshot name (optional):', new Date().toISOString());
    try {
      const resp = await fetch(`${SOCKET_SERVER_URL}/api/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: getRoomId(), name })
      });
      if (!resp.ok) throw new Error('Failed to save snapshot');
      showToast('Snapshot saved');
    } catch (e) {
      showToast(e.message || 'Failed to save snapshot');
    }
  };

  const loadSnapshot = async () => {
    const key = window.prompt('Enter snapshot id or name to load:');
    if (!key) return;
    try {
      const resp = await fetch(`${SOCKET_SERVER_URL}/api/snapshots/${encodeURIComponent(key)}?room=${encodeURIComponent(getRoomId())}`);
      if (!resp.ok) throw new Error('Snapshot not found');
      const history = await resp.json();
      // Ask server to apply (so it persists and syncs)
      socketRef.current.emit('applySnapshot', history);
      showToast('Snapshot loaded');
    } catch (e) {
      showToast(e.message || 'Failed to load snapshot');
    }
  };

  const emitCursorThrottled = throttle((x, y) => {
    socketRef.current.emit('cursor', { x, y, color });
  }, 40);

  // Pointer events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onPointerDown = (e) => {
      canvas.setPointerCapture(e.pointerId);
      start(e);
    };
    const onPointerMove = (e) => move(e);
    const onPointerUp = () => end();
    const onPointerCancel = () => end();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, color, lineWidth, isDrawing]);

  return (
    <div className="canvas-container" ref={containerRef} style={{ position: 'relative' }}>
      <div className="toolbar">
        {/* Room controls */}
        <input
          type="text"
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
          placeholder="room name"
          className="input-room"
        />
        <button
          onClick={() => {
            const name = (roomInput || '').trim();
            if (!name) return;
            const url = `${window.location.origin}/?room=${encodeURIComponent(name)}`;
            window.location.href = url;
          }}
          className="btn-with-icon"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 10l-5 5 5 5"/><path d="M4 15h12a4 4 0 004-4V5"/></svg>
          <span>Join</span>
        </button>
        <button
          onClick={() => {
            const rand = `room-${Math.random().toString(36).slice(2, 8)}`;
            setRoomInput(rand);
            const url = `${window.location.origin}/?room=${encodeURIComponent(rand)}`;
            window.location.href = url;
          }}
          style={{ marginLeft: 6 }}
          className="btn-with-icon btn-secondary"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3h4v4H5zM15 3h4v4h-4zM5 17h4v4H5zM15 17h4v4h-4z"/><path d="M9 7l6 6M9 17l6-6"/></svg>
          <span>Random</span>
        </button>
        <button
          onClick={async () => {
            const url = `${window.location.origin}/?room=${encodeURIComponent(getRoomId())}`;
            try {
              await navigator.clipboard.writeText(url);
              showToast('Invite link copied');
            } catch {
              // Fallback
              const _ = window.prompt('Copy this invite link:', url);
            }
          }}
          style={{ marginLeft: 6 }}
          className="btn-with-icon"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 10-7.07-7.07L10 5"/><path d="M14 11a5 5 0 00-7.07 0L5.5 12.43a5 5 0 107.07 7.07L14 19"/></svg>
          <span>Copy Invite</span>
        </button>
        <span style={{ margin: '0 10px', color: '#666' }}>Current room: {getRoomId()}</span>
        <button
          onClick={() => setShowColorPicker(!showColorPicker)}
          style={{ backgroundColor: color, width: '30px', height: '30px', marginRight: '10px' }}
          title="Change color"
        />
        {showColorPicker && (
          <div className="color-picker">
            <HexColorPicker color={color} onChange={setColor} />
          </div>
        )}
        <input
          type="range"
          min="1"
          max="20"
          value={lineWidth}
          onChange={(e) => setLineWidth(parseInt(e.target.value))}
        />
        <button onClick={clearCanvas} className="btn-with-icon btn-secondary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          <span>Clear</span>
        </button>
        <button onClick={undo} className="btn-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14l-4-4 4-4"/><path d="M5 10h8a5 5 0 010 10h-1"/></svg>
          <span>Undo</span>
        </button>
        <button onClick={saveSnapshot} className="btn-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h10l4 4v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z"/><path d="M7 3v8h10V3"/></svg>
          <span>Save</span>
        </button>
        <button onClick={loadSnapshot} className="btn-with-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M20 21H4"/></svg>
          <span>Load</span>
        </button>
        <button onClick={exportPNG} className="btn-with-icon btn-secondary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 17l5-5 4 4 3-3 4 4"/><circle cx="8" cy="9" r="1"/></svg>
          <span>Export</span>
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ border: '1px solid #000', marginTop: '10px', touchAction: 'none', maxWidth: '100%' }}
      />
      {/* live cursors */}
      {Object.entries(cursors).map(([id, c]) => (
        <div
          key={id}
          style={{
            position: 'absolute',
            left: (c.x || 0) + 'px',
            top: (c.y || 0) + 'px',
            width: 8,
            height: 8,
            background: c.color || '#4a6fa5',
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        />
      ))}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

export default Canvas;
