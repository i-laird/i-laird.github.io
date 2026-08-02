// XP desktop — the fake Windows-XP desktop behind the `gui` command (bliss
// hills, icons, taskbar, start menu, and the lazy Stick Fighter 2000 loader),
// lazily loaded the first time `gui` runs (see launchDesktop() in app.js; same
// pattern as stickfighter.js / games.js / sans.js / chess.js / halllm.js).
// Loaded as a CLASSIC script, it exposes one global, initDesktop(api), which
// returns { open }. Everything it needs from app.js arrives through the
// explicit `api` bridge (app.js's desktopBridge(): the #cmd element, openUrl,
// unlockAchievement, plus the passthrough deps Stick Fighter's own sfBridge()
// re-exposes — _chirp, makeRng, HAL_WORKER_URL, and live soundEnabled /
// reduceMotion / activeMusic accessors). This file references NOTHING from
// app.js by free global name, so it can be bundled & obfuscated as an
// independent lazy chunk (stickfighter.js's entry is deliberately read as
// window.openStickFighter). The only contract is the initDesktop name + the
// api key names (keep both on the obfuscator's reserved list).
// NOTE: the moved code is kept at its original app.js indentation on purpose.

function initDesktop(api) {
  // Dependency bridge from app.js (see desktopBridge() there). Stable refs are
  // destructured (call sites unchanged); the live flags Stick Fighter needs are
  // re-read through api inside sfBridge() below.
  const { cmd, openUrl, unlockAchievement, _chirp, makeRng, HAL_WORKER_URL } = api;

      let xpLive = null;   // the open desktop, if any — `gui` twice must not stack two

      function launchXP() {
        if (xpLive) return;
        cmd.blur();

        const xp = document.createElement('div');
        xpLive = xp;
        let dead = false;   // set by shutdown(); gates the async Stick Fighter launch
        xp.style.cssText = `
          position:fixed;inset:0;z-index:500;
          font-family:Tahoma,Arial,sans-serif;font-size:12px;
          background:linear-gradient(180deg,#1e72c8 0%,#4aa3e8 38%,#86c8f5 53%,#86c8f5 54%,#5bba48 57%,#4aaa38 68%,#3a8a28 100%);
          overflow:hidden;opacity:0;transition:opacity 0.8s;user-select:none;
        `;

        // rolling hills
        const hills = document.createElement('div');
        hills.style.cssText = `
          position:absolute;bottom:40px;left:-15%;right:-15%;height:48%;
          background:linear-gradient(180deg,#5bba48 0%,#4aaa38 40%,#3a8028 100%);
          border-radius:50% 50% 0 0/100% 100% 0 0;pointer-events:none;
        `;
        xp.appendChild(hills);

        // desktop area
        const desktop = document.createElement('div');
        desktop.style.cssText = 'position:absolute;inset:0;bottom:40px;';
        xp.appendChild(desktop);

        // icons
        // Stick Fighter is keyboard-only, so the icon appears only where there are
        // keys to press. Capability, not user agent: a narrow desktop window still
        // gets the game, and a tablet without a keyboard correctly does not.
        const isMobile = !api.hasKeyboard();
        const iconData = [
          { emoji:'📄', label:'Resume.pdf',  url:'/assets/documents/ianclaird_resume.pdf', newTab:true  },
          { emoji:'🐙', label:'My GitHub',   url:'https://github.com/i-laird',             newTab:true  },
          { emoji:'💼', label:'LinkedIn',    url:'https://linkedin.com/in/ianclaird',       newTab:true, ach:'networker' },
          { emoji:'📧', label:'Email Ian',   url:'mailto:career@ilaird.com',                newTab:false },
          { emoji:'🗑️', label:'Recycle Bin', url:null },
          ...( isMobile ? [] : [{ emoji:'🥊', label:'Stick Fighter\n2000.exe', action: launchStickFighter }]),
        ];

        iconData.forEach((data, idx) => {
          const icon = document.createElement('div');
          icon.style.cssText = `
            position:absolute;top:${14 + idx * 86}px;left:14px;width:72px;
            display:flex;flex-direction:column;align-items:center;gap:3px;
            padding:4px 4px 6px;cursor:pointer;color:white;text-align:center;
            border:1px dotted transparent;border-radius:2px;
          `;
          icon.innerHTML = `<span style="font-size:30px;line-height:1.2">${data.emoji}</span>`+
            `<span style="font-size:11px;text-shadow:1px 1px 3px #000,0 0 6px #000;word-break:break-word">${data.label}</span>`;

          // hover highlight (lighter than the click-select state)
          icon.addEventListener('mouseover', () => {
            if (!icon.dataset.sel) { icon.style.background = 'rgba(49,106,197,0.25)'; icon.style.borderColor = 'rgba(200,220,255,0.35)'; }
          });
          icon.addEventListener('mouseout', () => {
            if (!icon.dataset.sel) { icon.style.background = ''; icon.style.borderColor = 'transparent'; }
          });
          let lastClick = 0;
          icon.addEventListener('click', e => {
            e.stopPropagation();
            const alreadySelected = !!icon.dataset.sel;
            desktop.querySelectorAll('[data-sel]').forEach(el => {
              delete el.dataset.sel; el.style.background=''; el.style.borderColor='transparent';
            });
            icon.dataset.sel = '1';
            icon.style.background = 'rgba(49,106,197,0.5)';
            icon.style.borderColor = 'rgba(200,220,255,0.7)';
            const now = Date.now();
            if (now - lastClick < 380 || alreadySelected) {
              if (data.ach) unlockAchievement(data.ach);
              if (data.action) data.action();
              else if (data.url) {
                if (data.newTab) openUrl(data.url);
                else window.location.href = data.url;
              }
            }
            lastClick = now;
          });
          desktop.appendChild(icon);
        });

        desktop.addEventListener('click', () => {
          desktop.querySelectorAll('[data-sel]').forEach(el => {
            delete el.dataset.sel; el.style.background=''; el.style.borderColor='transparent';
          });
        });

        // taskbar
        const taskbar = document.createElement('div');
        taskbar.style.cssText = `
          position:absolute;bottom:0;left:0;right:0;height:40px;
          background:linear-gradient(180deg,#3c7fd4 0%,#245ec0 45%,#1e54b8 50%,#2a66cc 100%);
          border-top:2px solid #5090e8;display:flex;align-items:center;
          padding:0 4px;z-index:10;box-shadow:0 -2px 8px rgba(0,0,0,0.4);
        `;

        const startBtn = document.createElement('div');
        startBtn.innerHTML = '<span style="font-size:15px">⊞</span>&nbsp;<b>start</b>';
        startBtn.style.cssText = `
          height:34px;padding:0 14px 0 10px;
          background:linear-gradient(180deg,#62c44a 0%,#3ea828 40%,#308a20 55%,#4ab838 100%);
          border:1px solid #1a6a10;border-radius:0 16px 16px 0;
          color:white;font-size:14px;cursor:pointer;
          display:flex;align-items:center;gap:6px;
          text-shadow:1px 1px 2px rgba(0,0,0,0.6);
          box-shadow:inset 0 1px rgba(255,255,255,0.3);
        `;

        const clock = document.createElement('div');
        clock.style.cssText = `
          margin-left:auto;color:white;font-size:11px;padding:2px 10px;text-align:center;
          text-shadow:1px 1px 2px rgba(0,0,0,0.5);background:rgba(0,0,0,0.15);
          border:1px solid rgba(255,255,255,0.15);height:30px;
          display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
        `;
        const tickClock = () => {
          const n = new Date();
          clock.innerHTML =
            '<span>' + n.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + '</span>' +
            '<span style="font-size:10px">' + n.toLocaleDateString([],{month:'short',day:'numeric'}) + '</span>';
        };
        tickClock();
        const clockId = setInterval(tickClock, 1000);

        taskbar.appendChild(startBtn);
        taskbar.appendChild(clock);
        xp.appendChild(taskbar);

        // start menu
        const menu = document.createElement('div');
        menu.style.cssText = `
          position:absolute;bottom:40px;left:0;width:260px;background:white;
          border:1px solid #6688cc;box-shadow:4px 0 8px rgba(0,0,0,0.4),0 -2px 8px rgba(0,0,0,0.3);
          display:none;z-index:20;border-radius:0 8px 0 0;overflow:hidden;
        `;

        const mHead = document.createElement('div');
        mHead.style.cssText = `background:linear-gradient(90deg,#1e5ab8,#4a8ae8);padding:10px 14px;
          color:white;font-size:15px;font-weight:bold;display:flex;align-items:center;gap:10px;`;
        mHead.innerHTML = '<span style="font-size:26px">👤</span>Ian Laird';
        menu.appendChild(mHead);

        const mList = document.createElement('div');
        mList.style.cssText = 'padding:4px 0;';
        [
          { emoji:'📄', label:'Resume',           url:'/assets/documents/ianclaird_resume.pdf', newTab:true  },
          { emoji:'🐙', label:'GitHub',            url:'https://github.com/i-laird',             newTab:true  },
          { emoji:'💼', label:'LinkedIn',          url:'https://linkedin.com/in/ianclaird',       newTab:true, ach:'networker' },
          { emoji:'📧', label:'Email',             url:'mailto:career@ilaird.com',                newTab:false },
          null,
          { emoji:'↩️', label:'Back to Terminal',  action: shutdown },
        ].forEach(item => {
          if (!item) {
            const sep = document.createElement('div');
            sep.style.cssText = 'height:1px;background:#ddd;margin:3px 0;';
            mList.appendChild(sep); return;
          }
          const el = document.createElement('div');
          el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 14px;cursor:pointer;font-size:13px;';
          el.innerHTML = `<span style="font-size:18px">${item.emoji}</span>${item.label}`;
          el.addEventListener('mouseover', () => { el.style.background='#316ac5'; el.style.color='white'; });
          el.addEventListener('mouseout',  () => { el.style.background=''; el.style.color=''; });
          el.addEventListener('click', () => {
            toggleMenu(false);
            if (item.ach) unlockAchievement(item.ach);
            if (item.action) { item.action(); return; }
            if (item.newTab) openUrl(item.url);
            else window.location.href = item.url;
          });
          mList.appendChild(el);
        });
        menu.appendChild(mList);
        xp.appendChild(menu);

        let menuOpen = false;
        function toggleMenu(open) {
          menuOpen = open !== undefined ? open : !menuOpen;
          if (!menuOpen) { menu.style.display = 'none'; return; }
          menu.style.display = 'block';
          if (!api.reduceMotion) {   // the quick XP slide-up
            menu.style.transition = 'none';
            menu.style.transform = 'translateY(10px)';
            menu.style.opacity = '0';
            requestAnimationFrame(() => {
              menu.style.transition = 'transform 0.14s ease-out, opacity 0.14s ease-out';
              menu.style.transform = 'translateY(0)';
              menu.style.opacity = '1';
            });
          }
        }
        startBtn.addEventListener('mouseover', () => { startBtn.style.filter = 'brightness(1.12)'; });
        startBtn.addEventListener('mouseout',  () => { startBtn.style.filter = ''; });
        startBtn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
        xp.addEventListener('click', () => toggleMenu(false));

        // ── Stick Fighter 2000 (lazy-loaded on first launch) ─────────
        // The game (~4,500 lines) lives in stickfighter.js and is fetched on
        // demand the first time the icon is opened. It's a classic script sharing
        // the global scope, so it reads app.js globals and defines a global
        // openStickFighter(xp). The running game parks its teardown on
        // xp._sfCleanup so shutdown() can stop it when the desktop closes.
        let sfLoading = null;
        // Explicit dependency bridge: stickfighter.js used to read these app.js/lib
        // globals as free variables (shared global scope). Passing them in instead
        // means the game references nothing by free name — so it can be bundled/
        // obfuscated as an independent lazy chunk without the cross-file name-mangling
        // breaking. Live flags are getters (read current value); activeMusic also gets
        // a setter (the game writes it). The KEYS here are the stable contract — keep
        // them on the obfuscator's reserved-names list. See stickfighter.js header.
        function sfBridge() {
          return {
            unlockAchievement,
            _chirp,
            makeRng,
            HAL_WORKER_URL,
            get soundEnabled() { return api.soundEnabled; },
            get reduceMotion() { return api.reduceMotion; },
            get activeMusic() { return api.activeMusic; },
            set activeMusic(v) { api.activeMusic = v; },
          };
        }
        function launchStickFighter() {
          if (dead) return;   // Escape during the shutdown fade — icons are still clickable
          if (typeof window.openStickFighter === 'function') { window.openStickFighter(xp, sfBridge()); return; }
          if (!sfLoading) {
            sfLoading = new Promise((resolve, reject) => {
              const s = document.createElement('script');
              s.src = 'stickfighter.js';
              s.onload = resolve; s.onerror = reject;
              document.head.appendChild(s);
            });
          }
          // the chunk can land AFTER the desktop was shut down (Escape during the
          // fetch) — booting then would leak the game's document-level listeners
          // forever, since shutdown() already ran and nothing calls _sfCleanup
          sfLoading.then(() => { if (!dead && xp.isConnected) window.openStickFighter(xp, sfBridge()); })
                   .catch(() => { sfLoading = null; });
        }
        // ────────────────────────────────────────────────────────────

        function shutdown() {
          if (dead) return;
          dead = true;
          if (xp._sfCleanup) { xp._sfCleanup(); xp._sfCleanup = null; }
          clearInterval(clockId);
          document.removeEventListener('keydown', escHandler);
          xp.style.transition = 'opacity 0.5s';
          xp.style.opacity = '0';
          setTimeout(() => { xp.remove(); if (xpLive === xp) xpLive = null; cmd.focus(); }, 500);
        }
        function escHandler(e) { if (e.key === 'Escape') shutdown(); }
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(xp);
        requestAnimationFrame(() => requestAnimationFrame(() => { xp.style.opacity = '1'; }));
      }

  return { open: launchXP };
}

// Explicit window export: survives the obfuscated build's IIFE wrap (see
// build.js reservedNames). This is the only name this chunk shares with app.js.
window.initDesktop = initDesktop;
