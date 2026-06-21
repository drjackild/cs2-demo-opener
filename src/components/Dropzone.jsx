import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export default function Dropzone({ onFileSelected }) {
  const [dragOver, setDragOver] = useState(false);
  const onFileSelectedRef = useRef(onFileSelected);
  const isPickingRef = useRef(false);

  // Keep callback ref updated
  useEffect(() => {
    onFileSelectedRef.current = onFileSelected;
  }, [onFileSelected]);

  useEffect(() => {
    let active = true;
    let cleanups = [];

    async function setupListeners() {
      const unlistenOver = await listen('tauri://drag-over', () => {
        if (active) setDragOver(true);
      });
      if (!active) {
        unlistenOver();
      } else {
        cleanups.push(unlistenOver);
      }

      const unlistenLeave = await listen('tauri://drag-leave', () => {
        if (active) setDragOver(false);
      });
      if (!active) {
        unlistenLeave();
      } else {
        cleanups.push(unlistenLeave);
      }

      const unlistenDrop = await listen('tauri://drag-drop', async (event) => {
        if (active) setDragOver(false);

        // Ignore drop events if the native file dialog is open
        if (isPickingRef.current) return;

        const payload = event.payload;
        let paths = [];
        if (payload) {
          if (Array.isArray(payload)) {
            paths = payload;
          } else if (Array.isArray(payload.paths)) {
            paths = payload.paths;
          }
        }

        if (paths && paths.length > 0) {
          const path = paths[0];
          if (path.toLowerCase().endsWith('.dem') || path.toLowerCase().endsWith('.zst')) {
            if (active && onFileSelectedRef.current) {
              onFileSelectedRef.current(path);
            }
          } else {
            alert('Please drop a valid .dem or .zst file!');
          }
        }
      });
      if (!active) {
        unlistenDrop();
      } else {
        cleanups.push(unlistenDrop);
      }
    }

    setupListeners();

    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  const handleClick = async () => {
    if (isPickingRef.current) return;
    isPickingRef.current = true;
    try {
      const path = await invoke('select_demo_file');
      if (path && onFileSelectedRef.current) {
        onFileSelectedRef.current(path);
      }
    } catch (e) {
      console.error('Failed to select file:', e);
      const errorMsg = e && typeof e === 'object' && e.message ? e.message : e;
      alert('Failed to open file picker: ' + errorMsg);
    } finally {
      isPickingRef.current = false;
    }
  };

  return (
    <div
      id="dropzone"
      class={`dropzone glass-panel ${dragOver ? 'dragover' : ''}`}
      onClick={handleClick}
    >
      <div class="dropzone-icon">
        <span class="material-symbols-outlined" style={{ fontSize: '48px' }}>
          upload_file
        </span>
      </div>
      <h3>Drop CS2 Demo File</h3>
      <p>Drag your .dem or .zst file here to begin parsing</p>
    </div>
  );
}
