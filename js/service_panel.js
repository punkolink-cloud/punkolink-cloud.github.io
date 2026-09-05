// Shared "edit service" panel — used to be its own page (service.html);
// now it expands as a table row directly below the service's own row,
// pushing the rows beneath it down, on Database/In-memory/Document/DRP.
// Each caller owns which service (if any) is currently expanded and the
// table-reload/re-attach cycle around it; this module just builds one
// self-contained <tr> and wires up everything inside it.
const ServicePanel = (function () {
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function envMapToText(envVars) {
    return Object.keys(envVars || {}).map(function (key) {
      return key + '=' + envVars[key];
    }).join('\n');
  }

  const REASON_TEXT = {
    managed_by_extension: 'This instance carries an extension — stop/start it from the extension’s own row instead.',
    has_active_extension: 'Remove its extension first, then delete it.',
    no_payload_uploaded: 'Upload a payload below before pressing Run.',
    address_not_rented: 'That address isn’t one you rent anymore. Pick another, or Default.',
  };

  function reasonText(result, fallback) {
    const reason = result.data && (result.data.message || result.data.reason);
    return REASON_TEXT[reason] || reason || fallback;
  }

  const TEMPLATE = '' +
    '<td colspan="6">' +
      '<div class="row-detail-outer">' +
        '<div class="row-detail-inner">' +
          '<div class="row-detail-body">' +
            '<div class="banner" data-el="banner"></div>' +
            '<div class="banner" data-el="restartNotice"></div>' +
            '<p class="section-desc hidden" data-el="actionsHint"></p>' +
            '<div class="detail-grid">' +
              '<div>' +
                '<div class="detail-card">' +
                  '<h3>Overview</h3>' +
                  '<div class="kv-list">' +
                    '<div class="kv-row"><span class="kv-key">Instance ID</span><span class="kv-val" data-el="kvId"></span></div>' +
                    '<div class="kv-row"><span class="kv-key">Hostname</span><span class="kv-val" data-el="kvHostname"></span></div>' +
                    '<div class="kv-row"><span class="kv-key">Port</span><span class="kv-val" data-el="kvPort"></span></div>' +
                    '<div class="kv-row hidden" data-el="kvContainerPortRow"><span class="kv-key">Container Port</span><span class="kv-val" data-el="kvContainerPort"></span></div>' +
                  '</div>' +
                '</div>' +
                '<div class="detail-card hidden" data-el="sshSection">' +
                  '<h3>SSH</h3>' +
                  '<div class="kv-list">' +
                    '<div class="kv-row"><span class="kv-key">Port</span><span class="kv-val" data-el="kvSshPort"></span></div>' +
                    '<div class="kv-row hidden" data-el="kvExtraPortsRow"><span class="kv-key">Extra Ports</span><span class="kv-val" data-el="kvExtraPorts"></span></div>' +
                  '</div>' +
                  '<p class="form-hint" style="margin-top: var(--space-3);">The password was shown once, right after creation — it isn’t stored, so it can’t be shown again here. If it’s lost, delete this instance and create a new one.</p>' +
                '</div>' +
                '<div class="detail-card">' +
                  '<h3>Actions</h3>' +
                  '<div class="detail-actions">' +
                    '<button class="btn btn-secondary btn-sm" data-el="toggleBtn" type="button"></button>' +
                    '<button class="btn btn-secondary btn-sm hidden" data-el="restartBtn" type="button">Restart</button>' +
                    '<button class="btn btn-danger btn-sm" data-el="deleteBtn" type="button">Delete</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div>' +
                '<div class="section-card">' +
                  '<h3>Environment Variables</h3>' +
                  '<p class="section-desc">One <code>KEY=value</code> pair per line. Replaces whatever is currently set. <code>PORT</code> is assigned automatically and can’t be set here.</p>' +
                  '<form data-el="envForm">' +
                    '<div class="form-group">' +
                      '<textarea class="form-textarea" data-el="envText" rows="6" placeholder="API_KEY=...&#10;DEBUG=true"></textarea>' +
                      '<span class="form-error" data-el="envError"></span>' +
                    '</div>' +
                    '<div class="form-actions">' +
                      '<button type="submit" class="btn btn-primary btn-sm">Save Environment</button>' +
                    '</div>' +
                  '</form>' +
                '</div>' +
                '<div class="section-card hidden" data-el="payloadSection">' +
                  '<h3>Payload</h3>' +
                  '<p class="section-desc">A zipped Node.js project, or a standalone binary.</p>' +
                  '<div class="kv-list" data-el="payloadInfo" style="margin-bottom: var(--space-4);"></div>' +
                  '<form data-el="payloadForm">' +
                    '<div class="form-group">' +
                      '<input class="form-file" type="file" data-el="payloadFile" required>' +
                    '</div>' +
                    '<div class="form-actions">' +
                      '<button type="submit" class="btn btn-primary btn-sm">Upload Payload</button>' +
                    '</div>' +
                  '</form>' +
                '</div>' +
                '<div class="section-card">' +
                  '<h3>Settings</h3>' +
                  '<p class="section-desc">What should happen to the container when it exits.</p>' +
                  '<form data-el="settingsForm">' +
                    '<div class="form-group">' +
                      '<label class="form-label">On Exit</label>' +
                      '<select class="form-select" data-el="onExitSelect">' +
                        '<option value="restart">Restart</option>' +
                        '<option value="leave">Leave</option>' +
                        '<option value="remove">Remove</option>' +
                      '</select>' +
                    '</div>' +
                    '<div class="form-group hidden" data-el="restartDelayGroup">' +
                      '<label class="form-label">Restart Delay (seconds)</label>' +
                      '<input class="form-input" type="number" data-el="restartDelayInput" min="5" max="86400">' +
                      '<p class="form-hint">How long to wait after a crash before trying again.</p>' +
                    '</div>' +
                    '<div class="form-group hidden" data-el="startCommandGroup">' +
                      '<label class="form-label">Start Command <span class="optional">(optional)</span></label>' +
                      '<input class="form-input" type="text" data-el="startCommandInput" placeholder="./payload --flag">' +
                      '<p class="form-hint">Run inside the container via <code>sh -c</code>, replacing the default. Leave empty to run the uploaded binary directly, or <code>npm install &amp;&amp; npm start</code> for a Node.js project.</p>' +
                    '</div>' +
                    '<div class="form-actions">' +
                      '<button type="submit" class="btn btn-primary btn-sm">Save Settings</button>' +
                    '</div>' +
                  '</form>' +
                '</div>' +
                '<div class="section-card">' +
                  '<h3>Networking</h3>' +
                  '<p class="section-desc">By default the container is reachable only through this node’s address, on an automatically assigned port. Point it at an address you rent under <a href="network.html">Network</a> to publish it there instead — then you set the port.</p>' +
                  '<form data-el="networkForm">' +
                    '<div class="form-group" data-el="customIpGroup">' +
                      '<label class="form-label">Address</label>' +
                      '<select class="form-select" data-el="customIpSelect"></select>' +
                    '</div>' +
                    '<p class="form-hint hidden" data-el="customIpHint"></p>' +
                    '<div class="form-group">' +
                      '<label class="form-label">Port</label>' +
                      '<input class="form-input" type="number" data-el="customPortInput" min="1" max="65535" disabled>' +
                      '<span class="form-error" data-el="networkError"></span>' +
                      '<p class="form-hint">Editable once an address is chosen. Pick “Default” to go back to the node address and an automatic port.</p>' +
                    '</div>' +
                    '<div class="form-actions">' +
                      '<button type="submit" class="btn btn-primary btn-sm">Save Networking</button>' +
                    '</div>' +
                  '</form>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</td>';

  /**
   * Builds the <tr> to insert directly after a service's own row.
   * `opts`:
   *   - isRunService: whether this service type brings its own payload
   *     (controls the Payload section + start-command field)
   *   - displayName(name): label mapper, defaults to identity
   *   - getAllServices(): () => the caller's current full service list,
   *     for the custom-IP "already in use by" check
   *   - refresh: async () => reloads the caller's table (and, if this
   *     service is still the expanded one, re-attaches a fresh panel —
   *     see managed_services.js/drp.js)
   */
  function build(service, opts) {
    const displayName = opts.displayName || function (name) { return name; };
    const isRunService = !!opts.isRunService;
    const isLinuxService = service.service_name === 'run-linux';

    const tr = document.createElement('tr');
    tr.className = 'row-detail';
    tr.innerHTML = TEMPLATE;

    const el = {};
    tr.querySelectorAll('[data-el]').forEach(function (node) {
      el[node.getAttribute('data-el')] = node;
    });

    function showBanner(bannerEl, message, isError) {
      bannerEl.textContent = message;
      bannerEl.classList.add('visible');
      bannerEl.classList.toggle('success', !isError);
    }

    function hideBanner(bannerEl) {
      bannerEl.classList.remove('visible');
    }

    const isActive = service.status === 'active';

    function formatPortRange(start, end) {
      if (start == null) return '—';
      return (end != null && end !== start) ? (start + '–' + end) : String(start);
    }

    el.kvId.textContent = service.id;
    el.kvHostname.textContent = (service.vm && service.vm.hostname) || '—';
    el.kvPort.textContent = formatPortRange(service.port, service.port_end);

    const containerStart = service.container_port != null ? service.container_port : service.port;
    const containerEnd = service.container_port_end != null ? service.container_port_end : containerStart;
    const containerDiffers =
      (service.container_port != null && service.container_port !== service.port) ||
      (service.container_port_end != null && service.container_port_end !== service.port_end);
    el.kvContainerPortRow.classList.toggle('hidden', !containerDiffers);
    if (containerDiffers) {
      el.kvContainerPort.textContent = formatPortRange(containerStart, containerEnd);
    }

    el.sshSection.classList.toggle('hidden', !isLinuxService);
    if (isLinuxService) {
      el.kvSshPort.textContent = service.ssh_port != null ? service.ssh_port : '—';
      const extraPorts = service.extra_ports || [];
      el.kvExtraPortsRow.classList.toggle('hidden', extraPorts.length === 0);
      if (extraPorts.length > 0) {
        el.kvExtraPorts.textContent = extraPorts.join(', ');
      }
    }

    el.toggleBtn.textContent = isActive ? (isRunService || isLinuxService ? 'Stop' : 'Turn Off') : (isRunService ? 'Run' : 'Turn On');
    el.restartBtn.classList.toggle('hidden', !((isRunService || isLinuxService) && isActive));

    if ((isRunService || isLinuxService) && service.needs_restart) {
      showBanner(el.restartNotice, 'Configuration changed since this container was last started. Restart it to apply the changes.', false);
    }

    if (isRunService && !isActive) {
      el.actionsHint.textContent = service.payload
        ? 'Not running. Press Run to build and start the container.'
        : 'Not running. Upload a payload below, then press Run.';
      el.actionsHint.classList.remove('hidden');
    }

    el.envText.value = envMapToText(service.env_vars);
    el.onExitSelect.value = service.on_exit || 'restart';
    el.restartDelayInput.value = service.restart_delay_seconds != null ? service.restart_delay_seconds : 15;

    function syncRestartDelayField() {
      el.restartDelayGroup.classList.toggle('hidden', el.onExitSelect.value !== 'restart');
    }
    syncRestartDelayField();
    el.onExitSelect.addEventListener('change', syncRestartDelayField);

    el.startCommandGroup.classList.toggle('hidden', !isRunService);
    el.startCommandInput.value = service.start_command || '';

    el.payloadSection.classList.toggle('hidden', !isRunService);
    if (isRunService) {
      el.payloadInfo.innerHTML = service.payload
        ? '<div class="kv-row"><span class="kv-key">Kind</span><span class="kv-val">' + escapeHtml(service.payload.kind) + '</span></div>' +
          '<div class="kv-row"><span class="kv-key">Path</span><span class="kv-val">' + escapeHtml(service.payload.path) + '</span></div>'
        : '<div class="kv-row"><span class="kv-key">Status</span><span class="kv-val">No payload uploaded yet</span></div>';
    }

    // ── networking: pick a rented address, or Default ──
    function renderNetworking(heldAddresses) {
      const usedBy = {};
      (opts.getAllServices() || []).forEach(function (s) {
        if (String(s.id) !== String(service.id) && s.custom_ip) {
          usedBy[s.custom_ip] = s.custom_name || displayName(s.service_name);
        }
      });

      el.customPortInput.value = service.port != null ? service.port : '';

      if (heldAddresses.length === 0 && !service.custom_ip) {
        el.customIpGroup.classList.add('hidden');
        el.customIpHint.classList.remove('hidden');
        el.customIpHint.innerHTML =
          'No rented addresses yet. Rent one under <a href="network.html">Network</a> and it shows up here.';
        el.customPortInput.disabled = true;
        return;
      }

      el.customIpGroup.classList.remove('hidden');
      el.customIpHint.classList.add('hidden');

      const seen = {};
      let optionsHtml = '<option value="">Default — node address, automatic port</option>';
      heldAddresses.forEach(function (a) {
        seen[a.address] = true;
        const used = usedBy[a.address];
        optionsHtml +=
          '<option value="' + escapeHtml(a.address) + '"' + (used ? ' disabled' : '') + '>' +
          escapeHtml(a.address) + (used ? ' — in use by ' + escapeHtml(used) : '') +
          '</option>';
      });
      if (service.custom_ip && !seen[service.custom_ip]) {
        optionsHtml += '<option value="' + escapeHtml(service.custom_ip) + '">' + escapeHtml(service.custom_ip) + ' — not currently rented</option>';
      }
      el.customIpSelect.innerHTML = optionsHtml;
      el.customIpSelect.value = service.custom_ip || '';
      syncPortField();
    }

    function syncPortField() {
      el.customPortInput.disabled = el.customIpSelect.value === '';
    }

    L3Api.list(opts.session.userId).then(function (result) {
      const addresses = (result.ok && result.data && result.data.addresses) || [];
      renderNetworking(addresses);
    });

    el.customIpSelect.addEventListener('change', syncPortField);

    // ── actions ──
    el.toggleBtn.addEventListener('click', async function () {
      el.toggleBtn.disabled = true;
      const action = service.status === 'active' ? BackendApi.stopService : BackendApi.launchService;
      const result = await action(service.service_name, opts.session.userId, service.id);
      el.toggleBtn.disabled = false;
      if (!result.ok) {
        showBanner(el.banner, reasonText(result, 'Action failed.'), true);
        return;
      }
      opts.refresh();
    });

    el.restartBtn.addEventListener('click', async function () {
      el.restartBtn.disabled = true;
      const result = await BackendApi.launchService(service.service_name, opts.session.userId, service.id);
      el.restartBtn.disabled = false;
      if (!result.ok) {
        showBanner(el.banner, reasonText(result, 'Restart failed.'), true);
        return;
      }
      opts.refresh();
    });

    el.deleteBtn.addEventListener('click', async function () {
      if (!window.confirm('Delete ' + (service.custom_name || displayName(service.service_name)) + '? This cannot be undone.')) return;
      el.deleteBtn.disabled = true;
      const result = await BackendApi.deleteService(service.service_name, opts.session.userId, service.id);
      if (!result.ok) {
        showBanner(el.banner, reasonText(result, 'Failed to delete service.'), true);
        el.deleteBtn.disabled = false;
        return;
      }
      opts.onDeleted();
    });

    el.envForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideBanner(el.banner);
      el.envError.textContent = '';
      const result = await BackendApi.setEnv(service.service_name, opts.session.userId, service.id, el.envText.value);
      if (!result.ok) {
        el.envError.textContent = (result.data && result.data.reason) || 'Failed to save environment variables.';
        return;
      }
      showBanner(el.banner, 'Environment variables saved.', false);
      opts.refresh();
    });

    el.payloadForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const file = el.payloadFile.files[0];
      if (!file) return;
      const result = await BackendApi.uploadPayload(service.service_name, opts.session.userId, service.id, file);
      if (!result.ok) {
        showBanner(el.banner, (result.data && result.data.reason) || 'Failed to upload payload.', true);
        return;
      }
      el.payloadFile.value = '';
      showBanner(
        el.banner,
        isActive ? 'Payload uploaded. Restart the container to run it.' : 'Payload uploaded. Press Run to build and start the container.',
        false
      );
      opts.refresh();
    });

    el.settingsForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const onExit = el.onExitSelect.value;
      const restartDelay = parseInt(el.restartDelayInput.value, 10) || 15;
      const startCommand = isRunService ? el.startCommandInput.value.trim() : '';
      const result = await BackendApi.setSettings(service.service_name, opts.session.userId, service.id, onExit, restartDelay, startCommand);
      if (!result.ok) {
        showBanner(el.banner, (result.data && result.data.reason) || 'Failed to save settings.', true);
        return;
      }
      showBanner(el.banner, 'Settings saved.', false);
    });

    el.networkForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      el.networkError.textContent = '';

      const customIp = el.customIpSelect.value;
      const portRaw = el.customPortInput.value.trim();
      let port = null;

      if (customIp) {
        port = parseInt(portRaw, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          el.networkError.textContent = 'Pick a port between 1 and 65535 for this address.';
          return;
        }
      }

      const result = await BackendApi.setNetwork(service.service_name, opts.session.userId, service.id, customIp || null, port);
      if (!result.ok) {
        showBanner(el.banner, reasonText(result, 'Failed to save networking.'), true);
        return;
      }
      showBanner(
        el.banner,
        customIp
          ? 'Networking saved. It takes effect on the next launch — turn the service off and on.'
          : 'Back to the node address; a fresh automatic port was assigned. Restart to apply.',
        false
      );
      opts.refresh();
    });

    // Clicks inside the panel (links aside) shouldn't bubble up to the
    // trigger row and toggle it closed again.
    tr.addEventListener('click', function (e) { e.stopPropagation(); });

    return tr;
  }

  /** Inserts a freshly built detail row right after `afterRow`, animating
   *  it open (see .row-detail-outer in style.css). Returns the <tr>. */
  function open(afterRow, service, opts) {
    const tr = build(service, opts);
    afterRow.parentNode.insertBefore(tr, afterRow.nextSibling);
    const outer = tr.querySelector('.row-detail-outer');
    // Two frames, not one: the row has to actually paint at
    // grid-template-rows: 0fr before switching to 1fr, or the browser
    // coalesces both into one frame and the transition never runs.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { outer.classList.add('is-open'); });
    });
    return tr;
  }

  /** Like open(), but inserted already expanded, with no entrance
   *  animation — for restoring an already-open panel after the table
   *  around it gets rebuilt (e.g. the reload a save inside the panel
   *  itself triggers), where replaying the open animation every time
   *  would just flicker. */
  function attach(afterRow, service, opts) {
    const tr = build(service, opts);
    afterRow.parentNode.insertBefore(tr, afterRow.nextSibling);
    tr.querySelector('.row-detail-outer').classList.add('is-open');
    return tr;
  }

  /** Animates a previously-opened row closed, then removes it from the
   *  DOM. Returns a promise that resolves once it's gone. */
  function close(tr) {
    return new Promise(function (resolve) {
      const outer = tr.querySelector('.row-detail-outer');
      if (!outer) {
        tr.remove();
        resolve();
        return;
      }
      outer.addEventListener('transitionend', function handler() {
        outer.removeEventListener('transitionend', handler);
        tr.remove();
        resolve();
      });
      outer.classList.remove('is-open');
    });
  }

  return { open: open, attach: attach, close: close };
})();
