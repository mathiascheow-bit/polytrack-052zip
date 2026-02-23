  
    let adminPassword = '';

    document.getElementById('adminPass').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('loginBtn').click();
    });

    // ===== LOGIN HANDLER (PROPERLY CLOSED) =====
    document.getElementById('loginBtn').addEventListener('click', async () => {
      const pass = document.getElementById('adminPass').value;
      const errorEl = document.getElementById('loginError');
      try {
        const res = await fetch('/api/admin/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass })
        });
        if (res.ok) {
          adminPassword = pass;
          document.getElementById('loginScreen').style.display = 'none';
          document.getElementById('adminPanel').style.display = 'block';
          
          // Load saved banner data
          try {
            const bannerRes = await fetch('/api/admin/banner/current');
            const bannerData = await bannerRes.json();
            if (bannerData.message) {
              document.getElementById('bannerMessage').value = bannerData.message;
              document.getElementById('bannerDuration').value = bannerData.duration;
              document.getElementById('bannerFrequency').value = bannerData.frequency;
            }
          } catch (e) {
            console.log("No saved banner found");
          }
          
          // ===== BANNER EVENT LISTENERS (MOVED INSIDE LOGIN) =====
          document.getElementById('saveBannerBtn').addEventListener('click', async () => {
            const btn = document.getElementById('saveBannerBtn');
            const status = document.getElementById('bannerStatus');
            const message = document.getElementById('bannerMessage').value.trim();
            const duration = parseInt(document.getElementById('bannerDuration').value);
            const frequency = parseInt(document.getElementById('bannerFrequency').value);

            if (!message) {
              showStatus(status, 'error', 'Enter a banner message');
              return;
            }

            btn.disabled = true;
            try {
              const res = await fetch('/api/admin/banner', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: adminPassword, message, duration, frequency })
              });
              const data = await res.json();
              if (data.success) {
                showStatus(status, 'success', 'Banner saved and cycle started!');
              } else {
                showStatus(status, 'error', data.error || 'Failed to save banner');
              }
            } catch (e) {
              showStatus(status, 'error', 'Connection error');
            }
            btn.disabled = false;
          });

          document.getElementById('deleteBannerBtn').addEventListener('click', async () => {
            if (!confirm('Are you sure you want to delete the banner? This will stop the cycle for all players.')) return;
            const status = document.getElementById('bannerStatus');
            try {
              const res = await fetch('/api/admin/banner', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: adminPassword })
              });
              const data = await res.json();
              if (data.success) {
                showStatus(status, 'success', 'Banner deleted successfully!');
                document.getElementById('bannerMessage').value = '';
              } else {
                showStatus(status, 'error', data.error || 'Failed to delete banner');
              }
            } catch (e) {
              showStatus(status, 'error', 'Connection error');
            }
          });

          loadTracks();
          loadEntries();
        } else {
          errorEl.textContent = 'Wrong password';
        }
      } catch (e) {
        errorEl.textContent = 'Connection error';
      }
    }); // ===== LOGIN HANDLER ENDS HERE =====

    // ===== TAB SWITCHING =====
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'manage') loadEntries();
      });
    });

    document.getElementById('trackSelect').addEventListener('change', (e) => {
      if (e.target.value) {
        document.getElementById('trackId').value = e.target.value;
      }
    });

    document.getElementById('existingPlayer').addEventListener('change', (e) => {
      const sel = e.target;
      if (sel.value) {
        document.getElementById('playerName').value = sel.options[sel.selectedIndex].dataset.name;
      }
    });

    // ===== LOAD FUNCTIONS =====
    async function loadTracks() {
      try {
        const res = await fetch('/api/admin/tracks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPassword })
        });
        const data = await res.json();
        const select = document.getElementById('trackSelect');
        select.innerHTML = '<option value="">Select a track...</option>';
        if (data.tracks) {
          data.tracks.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.track_id;
            const label = t.track_name ? friendlyTrackName(t.track_name) : ('Track ' + t.track_id.substring(0, 8) + '...');
            opt.textContent = label + ' (' + t.player_count + ' players)';
            select.appendChild(opt);
          });
        }
      } catch (e) {
        console.error('Error loading tracks:', e);
      }
    }

    let allEntries = [];
    async function loadEntries() {
      const list = document.getElementById('entriesList');
      list.innerHTML = '<div class="no-entries">Loading...</div>';
      try {
        const res = await fetch('/api/admin/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPassword })
        });
        const data = await res.json();
        allEntries = data.entries || [];
        updateExistingPlayerDropdown();
        if (!data.entries || data.entries.length === 0) {
          list.innerHTML = '<div class="no-entries">No recordings yet</div>';
          return;
        }
        list.innerHTML = data.entries.map(e => {
          const timeSeconds = (e.frames / 60).toFixed(2);
          const date = new Date(e.created_at).toLocaleDateString();
          return `
            <div class="entry-card">
              <div class="entry-info">
                <div class="entry-name">${escapeHtml(e.name)}</div>
                <div class="entry-details">
                  <span class="entry-track">${escapeHtml(displayTrackName(e))}</span>
                  &middot; <span class="entry-time">${timeSeconds}s (${e.frames} frames)</span>
                  &middot; ${date}
                </div>
              </div>
              <button class="btn btn-danger" onclick="deleteEntry(${e.id})">Delete</button>
            </div>
          `;
        }).join('');
      } catch (e) {
        list.innerHTML = '<div class="no-entries">Error loading entries</div>';
      }
    }

    function updateExistingPlayerDropdown() {
      const select = document.getElementById('existingPlayer');
      select.innerHTML = '<option value="">New player</option>';
      const seen = new Map();
      for (const e of allEntries) {
        if (!seen.has(e.user_id)) {
          seen.set(e.user_id, e.name);
        }
      }
      for (const [uid, name] of seen) {
        const opt = document.createElement('option');
        opt.value = uid;
        opt.dataset.name = name;
        opt.textContent = name;
        select.appendChild(opt);
      }
    }

    // ===== UTILITY FUNCTIONS =====
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function friendlyTrackName(filename) {
      if (!filename) return 'Unknown Track';
      const name = filename.replace('.track', '');
      const match = name.match(/^([a-zA-Z]+)(\d+)$/);
      if (match) {
        return match[1].charAt(0).toUpperCase() + match[1].slice(1) + ' ' + match[2];
      }
      if (name.length > 20) return name.substring(0, 12) + '...';
      return name;
    }

    function displayTrackName(entry) {
      if (entry.track_name) return friendlyTrackName(entry.track_name);
      return 'Track ' + entry.track_id.substring(0, 8) + '...';
    }

    function colorToHex(colorInput) {
      return colorInput.replace('#', '');
    }

    function showStatus(el, type, msg) {
      el.className = 'status-msg ' + type;
      el.textContent = msg;
      if (type === 'success') {
        setTimeout(() => { el.className = 'status-msg'; }, 5000);
      }
    }

    // ===== ADD RECORDING BUTTON =====
    document.getElementById('addBtn').addEventListener('click', async () => {
      const btn = document.getElementById('addBtn');
      const status = document.getElementById('addStatus');
      const playerName = document.getElementById('playerName').value.trim();
      const trackId = document.getElementById('trackId').value.trim();
      const rawRecording = document.getElementById('recordingData').value.trim();

      const carColors = colorToHex(document.getElementById('colorPrimary').value)
        + colorToHex(document.getElementById('colorSecondary').value)
        + colorToHex(document.getElementById('colorFrame').value)
        + colorToHex(document.getElementById('colorRims').value);

      if (!playerName) { showStatus(status, 'error', 'Enter a player name'); return; }
      if (!trackId) { showStatus(status, 'error', 'Enter or select a track ID'); return; }
      if (!rawRecording) { showStatus(status, 'error', 'Paste recording data'); return; }

      btn.disabled = true;
      btn.textContent = 'Adding...';

      const existingUserId = document.getElementById('existingPlayer').value || undefined;

      try {
        const res = await fetch('/api/admin/add-recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: adminPassword,
            playerName,
            trackId,
            rawRecording,
            carColors,
            existingUserId: existingUserId ? parseInt(existingUserId) : undefined
          })
        });
        const data = await res.json();
        if (data.success) {
          showStatus(status, 'success', `Successfully added "${playerName}" to the leaderboard!`);
          document.getElementById('playerName').value = '';
          document.getElementById('recordingData').value = '';
          document.getElementById('existingPlayer').value = '';
          loadTracks();
          loadEntries();
        } else {
          showStatus(status, 'error', data.error || 'Failed to add recording. Please check your data and try again.');
        }
      } catch (e) {
        showStatus(status, 'error', 'Could not connect to the server. Please try again.');
      }

      btn.disabled = false;
      btn.textContent = 'Add Recording';
    });

    async function deleteEntry(id) {
      if (!confirm('Delete this recording? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/admin/delete-recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: adminPassword, leaderboardId: id })
        });
        const data = await res.json();
        if (data.success) {
          loadEntries();
          loadTracks();
        } else {
          alert(data.error || 'Failed to delete');
        }
      } catch (e) {
        alert('Connection error');
      }
    }

    // ===== AI RECORDING GENERATOR =====
    function generateAIRecording(durationSec, style) {
      if (style === 'interactive') {
        return window.capturedInteractiveRecording || "";
      }
      const lines = [];
      const totalMs = durationSec * 1000;
      const step = 16.67; // ~60fps step
      
      const isPro = style === 'pro';
      let integral = 0;
      let lastError = 0;
      const Kp = 0.5, Ki = 0.01, Kd = 0.1;
      let throttleLimit = 1.0;
      let slipAngle = 0;

      const profiles = {
        cautious:    { accelChance: 0.85, steerInterval: [800,2000], steerDuration: [300,800],  brakeChance: 0.25, brakeInterval: [2000,5000], brakeDuration: [200,600] },
        normal:      { accelChance: 0.92, steerInterval: [500,1500], steerDuration: [200,700],  brakeChance: 0.12, brakeInterval: [3000,7000], brakeDuration: [100,400] },
        aggressive:  { accelChance: 0.97, steerInterval: [300,1000], steerDuration: [150,500],  brakeChance: 0.05, brakeInterval: [5000,10000], brakeDuration: [50,200] },
        pro:         { accelChance: 1.00, steerInterval: [100,400],   steerDuration: [50,200],   brakeChance: 0.02, brakeInterval: [8000,15000], brakeDuration: [20,100] }
      };
      
      const p = profiles[style] || profiles.normal;
      function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

      let accel = true;
      let steerDir = null;
      let braking = false;

      let nextSteerToggle = rand(p.steerInterval[0], p.steerInterval[1]);
      let steerEndMs = 0;
      let nextBrakeToggle = rand(p.brakeInterval[0], p.brakeInterval[1]);
      let brakeEndMs = 0;

      for (let ms = 0; ms <= totalMs; ms += step) {
        let currentMs = Math.round(ms);
        
        if (isPro) {
          const curveIntensity = Math.sin(currentMs / 2000) * Math.cos(currentMs / 5000);
          const curveAhead = Math.sin((currentMs + 1500) / 2000);
          
          if (Math.abs(curveAhead) > 0.8 && !braking) {
            braking = true;
            brakeEndMs = currentMs + 300;
            accel = false;
          }

          slipAngle = Math.abs(curveIntensity) * 1.2;
          throttleLimit = slipAngle > 0.7 ? 0.4 : 1.0;
        }

        if (isPro) {
          const targetPath = Math.sin(currentMs / 2000);
          const error = targetPath - (steerDir === 'd' ? 0.5 : (steerDir === 'a' ? -0.5 : 0));
          
          integral += error * step;
          const derivative = (error - lastError) / step;
          const output = Kp * error + Ki * integral + Kd * derivative;
          lastError = error;

          if (output > 0.1) steerDir = 'd';
          else if (output < -0.1) steerDir = 'a';
          else steerDir = null;
        } else {
          if (currentMs >= nextSteerToggle && steerDir === null) {
            steerDir = Math.random() < 0.5 ? 'a' : 'd';
            steerEndMs = currentMs + rand(p.steerDuration[0], p.steerDuration[1]);
          }
          if (steerDir && currentMs >= steerEndMs) {
            steerDir = null;
            nextSteerToggle = currentMs + rand(p.steerInterval[0], p.steerInterval[1]);
          }
        }

        if (currentMs >= nextBrakeToggle && !braking && Math.random() < p.brakeChance) {
          braking = true;
          accel = false;
          brakeEndMs = currentMs + rand(p.brakeDuration[0], p.brakeDuration[1]);
        }
        
        if (braking && currentMs >= brakeEndMs) {
          braking = false;
          accel = Math.random() < p.accelChance;
          nextBrakeToggle = currentMs + rand(p.brakeInterval[0], p.brakeInterval[1]);
        }

        if (!braking && !accel && Math.random() < 0.3) accel = true;
        
        let keys = '';
        if (accel && Math.random() < throttleLimit) keys += 'w';
        if (steerDir) keys += steerDir;
        if (braking) keys += 's';

        lines.push(currentMs + ',' + keys);
      }
      return lines.join('\n');
    }

    function loadAITracks() {
      const select = document.getElementById('aiTrackSelect');
      const source = document.getElementById('trackSelect');
      select.innerHTML = '<option value="">Select a track...</option>';
      for (const opt of source.options) {
        if (opt.value) {
          const clone = opt.cloneNode(true);
          select.appendChild(clone);
        }
      }
    }

    // ===== AI DRIVER SECTION =====
    document.getElementById('aiStyle').addEventListener('change', (e) => {
      const instr = document.getElementById('interactiveInstructions');
      instr.style.display = e.target.value === 'interactive' ? 'block' : 'none';
    });

    let keysPressed = new Set();
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['w','a','s','d'].includes(k)) keysPressed.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (['w','a','s','d'].includes(k)) keysPressed.delete(k);
    });

    document.getElementById('aiTestBtn').addEventListener('click', async () => {
      const btn = document.getElementById('aiTestBtn');
      const aiStyleVal = document.getElementById('aiStyle').value;

      if (aiStyleVal === 'interactive' && btn.textContent !== 'Finish & Submit') {
        const durationInput = document.getElementById('aiDuration').value;
        const duration = parseInt(durationInput);
        let timeLeft = duration;
        btn.textContent = `Driving... (${timeLeft}s)`;
        btn.disabled = true;
        
        window.capturedInteractiveRecording = "";
        const startTime = Date.now();
        const interval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const currentKeys = Array.from(keysPressed).sort().join('');
          window.capturedInteractiveRecording += `${elapsed},${currentKeys}\n`;
          
          const remaining = Math.max(0, duration - Math.floor(elapsed / 1000));
          if (remaining !== timeLeft) {
            timeLeft = remaining;
            btn.textContent = `Driving... (${timeLeft}s)`;
          }

          if (elapsed >= duration * 1000) {
            clearInterval(interval);
            btn.textContent = 'Finish & Submit';
            btn.disabled = false;
          }
        }, 16.67);
        return;
      }

      const status = document.getElementById('aiStatus');
      const name = document.getElementById('aiDriverName').value.trim();
      const trackId = document.getElementById('aiTrackSelect').value;
      const finalDuration = parseInt(document.getElementById('aiDuration').value) || 30;
      const finalStyle = document.getElementById('aiStyle').value;

      if (!name) { showStatus(status, 'error', 'Enter a driver name'); return; }
      if (!trackId) { showStatus(status, 'error', 'Select a track'); return; }
      if (finalDuration < 5 || finalDuration > 300) { showStatus(status, 'error', 'Duration must be 5–300 seconds'); return; }

      btn.disabled = true;
      btn.textContent = 'Generating & Submitting...';

      const rawRecording = generateAIRecording(finalDuration, finalStyle);

      document.getElementById('aiPreview').style.display = 'block';
      const previewLines = rawRecording.split('\n');
      document.getElementById('aiPreviewData').value =
        previewLines.slice(0, 20).join('\n') +
        (previewLines.length > 20 ? '\n... (' + previewLines.length + ' total lines)' : '');

      const carColors =
        colorToHex(document.getElementById('aiColorPrimary').value) +
        colorToHex(document.getElementById('aiColorSecondary').value) +
        colorToHex(document.getElementById('aiColorFrame').value) +
        colorToHex(document.getElementById('aiColorRims').value);

      try {
        const res = await fetch('/api/admin/add-recording', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: adminPassword,
            playerName: name,
            trackId,
            rawRecording,
            carColors
          })
        });
        const data = await res.json();
        if (data.success) {
          showStatus(status, 'success', `AI driver "${name}" added to leaderboard! (${finalDuration}s, ${finalStyle} style)`);
          loadEntries();
          loadTracks();
        } else {
          showStatus(status, 'error', data.error || 'Failed to submit AI recording');
        }
      } catch (e) {
        showStatus(status, 'error', 'Connection error');
      }

      btn.disabled = false;
      btn.textContent = 'Run AI Test Driver';
    });

    const origLoadTracks = loadTracks;
    loadTracks = async function() {
      await origLoadTracks();
      loadAITracks();
    };
  
