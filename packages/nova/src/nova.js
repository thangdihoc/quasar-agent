// Nova Desktop Mascot — Frontend Controller
// Handles: Tauri event listening, state switching, drag, context menu

(function () {
  'use strict';

  // ── State Management ──
  const STATES = ['idle', 'thinking', 'speaking', 'listening'];
  const STATE_LABELS = {
    idle: 'Nova',
    thinking: 'Đang suy nghĩ...',
    speaking: 'Đang nói...',
    listening: 'Đang nghe...',
  };

  let currentState = 'idle';

  function setState(newState) {
    if (!STATES.includes(newState)) return;
    currentState = newState;
    document.body.setAttribute('data-state', newState);
    document.getElementById('nova-label').textContent = STATE_LABELS[newState];
  }

  // ── Tauri Event Listener ──
  // Listen for state changes from Rust backend via Tauri events
  async function initTauriEvents() {
    try {
      // Tauri v2: use window.__TAURI__.event.listen
      if (window.__TAURI__) {
        const { listen } = window.__TAURI__.event;
        
        await listen('nova-state', (event) => {
          const payload = event.payload;
          if (payload && payload.state) {
            setState(payload.state);
          }
        });

        console.log('[Nova] Tauri event listener registered');
      } else {
        console.log('[Nova] No Tauri runtime, running in standalone mode');
        // Standalone demo: cycle through states
        startDemoMode();
      }
    } catch (err) {
      console.error('[Nova] Failed to init Tauri events:', err);
      startDemoMode();
    }
  }

  // ── Demo Mode (when running without Tauri) ──
  function startDemoMode() {
    let idx = 0;
    setInterval(() => {
      idx = (idx + 1) % STATES.length;
      setState(STATES[idx]);
    }, 3000);
  }

  // ── Eye Tracking (follow cursor) ──
  function initEyeTracking() {
    const pupils = document.querySelectorAll('.nova-pupil');
    const body = document.getElementById('nova-body');

    document.addEventListener('mousemove', (e) => {
      const rect = body.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;
      const angle = Math.atan2(dy, dx);
      const distance = Math.min(Math.sqrt(dx * dx + dy * dy) / 15, 4);

      const offsetX = Math.cos(angle) * distance;
      const offsetY = Math.sin(angle) * distance;

      pupils.forEach((pupil) => {
        pupil.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
      });
    });
  }

  // ── Drag Window ──
  function initDrag() {
    const container = document.getElementById('nova-container');

    container.addEventListener('mousedown', async (e) => {
      // Only left-click drag
      if (e.button !== 0) return;

      // Don't drag on context menu
      if (e.target.closest('#context-menu')) return;

      try {
        if (window.__TAURI__) {
          const { getCurrentWindow } = window.__TAURI__.window;
          await getCurrentWindow().startDragging();
        }
      } catch (err) {
        // Ignore drag errors in standalone mode
      }
    });
  }

  // ── Context Menu ──
  function initContextMenu() {
    const menu = document.getElementById('context-menu');

    // Show on right-click
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu.classList.remove('hidden');
      menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
      menu.style.top = `${Math.min(e.clientY, window.innerHeight - 120)}px`;
    });

    // Hide on click elsewhere
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#context-menu')) {
        menu.classList.add('hidden');
      }
    });

    // Menu actions
    document.getElementById('menu-toggle-click').addEventListener('click', async () => {
      menu.classList.add('hidden');
      try {
        if (window.__TAURI__) {
          const { getCurrentWindow } = window.__TAURI__.window;
          const win = getCurrentWindow();
          // Toggle click-through via Tauri
          const ignoring = await win.isIgnoreCursorEvents?.();
          await win.setIgnoreCursorEvents?.(!ignoring);
        }
      } catch {
        // Not supported in standalone
      }
    });

    document.getElementById('menu-minimize').addEventListener('click', async () => {
      menu.classList.add('hidden');
      try {
        if (window.__TAURI__) {
          const { getCurrentWindow } = window.__TAURI__.window;
          await getCurrentWindow().hide();
        }
      } catch {}
    });

    document.getElementById('menu-exit').addEventListener('click', async () => {
      menu.classList.add('hidden');
      try {
        if (window.__TAURI__) {
          const { exit } = window.__TAURI__.process;
          await exit(0);
        }
      } catch {
        window.close();
      }
    });
  }

  // ── Initialize ──
  document.addEventListener('DOMContentLoaded', () => {
    setState('idle');
    initEyeTracking();
    initDrag();
    initContextMenu();
    initTauriEvents();
  });
})();
