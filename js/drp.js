(function () {
  const session = Session.requireAuth();
  if (!session) return;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function showBanner(el, message, isError) {
    el.textContent = message;
    el.classList.add('visible');
    el.classList.toggle('success', !isError);
  }

  function hideBanner(el) {
    el.classList.remove('visible');
  }

  function displayName(name) {
    return name === 'run' ? 'Run' : name === 'run-linux' ? 'Isolated Linux' : name;
  }

  const drpBanner = document.getElementById('drpBanner');

  let allServices = []; // every instance this user has, any category — for the panel's custom-IP "used by" check
  let addresses = []; // rented ipv4/ipv6 addresses, shared by both IP selects
  let executables = []; // for the Run executable picker

  function renderIpOptions(selectEl, currentValue, usedBy) {
    let optionsHtml = '<option value="">Default — node address, automatic port</option>';
    addresses.forEach(function (a) {
      const used = usedBy[a.address];
      optionsHtml +=
        '<option value="' + escapeHtml(a.address) + '"' + (used ? ' disabled' : '') + (a.address === currentValue ? ' selected' : '') + '>' +
        escapeHtml(a.address) + (used ? ' — in use by ' + escapeHtml(used) : '') +
        '</option>';
    });
    selectEl.innerHTML = optionsHtml;
    if (currentValue) selectEl.value = currentValue;
  }

  function usedByMap(excludeId) {
    const usedBy = {};
    allServices.forEach(function (s) {
      if (String(s.id) !== String(excludeId) && s.custom_ip) {
        usedBy[s.custom_ip] = s.custom_name || displayName(s.service_name);
      }
    });
    return usedBy;
  }

  async function loadShared() {
    const [addrResult, execResult] = await Promise.all([
      L3Api.list(session.userId),
      ExecutableApi.list(session.userId),
    ]);
    addresses = (addrResult.ok && addrResult.data && addrResult.data.addresses) || [];
    executables = (execResult.ok && execResult.data && execResult.data.executables) || [];
  }

  // ── row-detail (shared ServicePanel, same as Database/In-memory/Document) ──

  let expandedId = null;
  let expandedRowEl = null;

  function panelOpts(service, isRunService) {
    return {
      session: session,
      isRunService: isRunService,
      displayName: displayName,
      getAllServices: function () { return allServices; },
      refresh: loadAll,
      onDeleted: function () {
        expandedId = null;
        expandedRowEl = null;
        loadAll();
      },
    };
  }

  async function toggleExpand(service, tr, isRunService) {
    if (expandedId === service.id) {
      const closing = expandedRowEl;
      expandedId = null;
      expandedRowEl = null;
      if (closing) await ServicePanel.close(closing);
      return;
    }
    if (expandedRowEl) await ServicePanel.close(expandedRowEl);
    expandedId = service.id;
    expandedRowEl = ServicePanel.open(tr, service, panelOpts(service, isRunService));
  }

  function reattachExpanded(tbody, services) {
    if (expandedId == null) return;
    const service = services.filter(function (s) { return s.id === expandedId; })[0];
    const row = Array.prototype.filter.call(tbody.children, function (tr) {
      return tr.dataset.id === String(expandedId);
    })[0];
    if (!service || !row) return;
    expandedRowEl = ServicePanel.attach(row, service, panelOpts(service, service.service_name === 'run'));
  }

  async function toggleService(service, button) {
    button.disabled = true;
    const action = service.status === 'active' ? BackendApi.stopService : BackendApi.launchService;
    const result = await action(service.service_name, session.userId, service.id);
    if (!result.ok) {
      let reason = (result.data && (result.data.message || result.data.reason)) || 'Action failed.';
      if (reason === 'no_payload_uploaded') {
        reason = 'Attach an Executable before running it.';
      }
      showBanner(drpBanner, reason, true);
    }
    loadAll();
  }

  async function deleteService(service, row) {
    if (!window.confirm('Delete ' + (service.custom_name || displayName(service.service_name)) + '? This cannot be undone.')) return;
    row.style.opacity = '0.5';
    const result = await BackendApi.deleteService(service.service_name, session.userId, service.id);
    if (!result.ok) {
      showBanner(drpBanner, 'Failed to delete.', true);
      row.style.opacity = '';
      return;
    }
    loadAll();
  }

  // ── Run ──

  const runCardsEl = document.getElementById('runCards');
  const runPanel = document.getElementById('runPanel');
  const runPanelBanner = document.getElementById('runPanelBanner');
  const runForm = document.getElementById('runForm');
  const runSubmit = document.getElementById('runSubmit');
  const runNameInput = document.getElementById('runNameInput');
  const runExecutableSelect = document.getElementById('runExecutableSelect');
  const runEnvInput = document.getElementById('runEnvInput');
  const runPortInput = document.getElementById('runPortInput');
  const runPortEndInput = document.getElementById('runPortEndInput');
  const runContainerPortInput = document.getElementById('runContainerPortInput');
  const runContainerPortEndInput = document.getElementById('runContainerPortEndInput');
  const runIpSelect = document.getElementById('runIpSelect');
  const runOnExitSelect = document.getElementById('runOnExitSelect');
  const runRestartDelayGroup = document.getElementById('runRestartDelayGroup');
  const runRestartDelayInput = document.getElementById('runRestartDelayInput');
  const runStartCommandInput = document.getElementById('runStartCommandInput');
  const runBody = document.getElementById('runBody');
  const runCountEl = document.getElementById('runCount');

  let runPanelOpen = false;

  function renderRunCard() {
    runCardsEl.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'service-card' + (runPanelOpen ? ' active' : '');
    btn.innerHTML =
      '<div class="service-card-name">Run</div>' +
      '<div class="service-card-hint">256 MB</div>';
    btn.addEventListener('click', toggleRunPanel);
    runCardsEl.appendChild(btn);
  }

  function syncRunRestartDelayVisibility() {
    runRestartDelayGroup.classList.toggle('hidden', runOnExitSelect.value !== 'restart');
  }
  runOnExitSelect.addEventListener('change', syncRunRestartDelayVisibility);

  function openRunPanel(prefillExecutableId) {
    runPanelOpen = true;
    renderRunCard();

    runExecutableSelect.innerHTML = '<option value="">None — attach later</option>' +
      executables.map(function (e) {
        return '<option value="' + e.id + '">' + escapeHtml(e.name) + '</option>';
      }).join('');
    if (prefillExecutableId) runExecutableSelect.value = String(prefillExecutableId);

    renderIpOptions(runIpSelect, '', usedByMap(null));

    runNameInput.value = '';
    runEnvInput.value = '';
    runPortInput.value = '';
    runPortEndInput.value = '';
    runContainerPortInput.value = '';
    runContainerPortEndInput.value = '';
    runOnExitSelect.value = 'restart';
    runRestartDelayInput.value = '15';
    runStartCommandInput.value = '';
    syncRunRestartDelayVisibility();
    hideBanner(runPanelBanner);
    runPanel.classList.add('is-open');
  }

  function closeRunPanel() {
    runPanelOpen = false;
    renderRunCard();
    runPanel.classList.remove('is-open');
  }

  function toggleRunPanel() {
    if (runPanelOpen) {
      closeRunPanel();
    } else {
      openRunPanel(null);
    }
  }

  function intOrNull(input) {
    const value = input.value.trim();
    return value === '' ? null : parseInt(value, 10);
  }

  runForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    runSubmit.disabled = true;
    runSubmit.textContent = 'Creating…';
    hideBanner(runPanelBanner);

    const result = await RunApi.create(session.userId, {
      custom_name: runNameInput.value.trim() || null,
      executable_id: runExecutableSelect.value ? Number(runExecutableSelect.value) : null,
      env: runEnvInput.value || null,
      port: intOrNull(runPortInput),
      port_end: intOrNull(runPortEndInput),
      container_port: intOrNull(runContainerPortInput),
      container_port_end: intOrNull(runContainerPortEndInput),
      custom_ip: runIpSelect.value || null,
      on_exit: runOnExitSelect.value,
      restart_delay_seconds: parseInt(runRestartDelayInput.value, 10) || 15,
      start_command: runStartCommandInput.value.trim() || null,
    });

    runSubmit.disabled = false;
    runSubmit.textContent = 'Create';

    if (!result.ok) {
      const reason = (result.data && (result.data.message || result.data.reason)) || 'Failed to create.';
      showBanner(runPanelBanner, reason === 'insufficient_balance' ? 'Insufficient balance.' : reason, true);
      return;
    }

    closeRunPanel();
    showBanner(drpBanner, 'Run instance created. Press Run on it below to start it.', false);
    loadAll();
  });

  function renderRunRow(service) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.dataset.id = service.id;

    const isActive = service.status === 'active';
    const statusClass = isActive ? 'is-active' : 'is-stopped';
    const statusText = isActive && service.needs_restart ? service.status + ' · needs restart' : service.status;
    const portLabel = service.port == null ? '—' : (service.port_end && service.port_end !== service.port ? service.port + '–' + service.port_end : service.port);

    tr.innerHTML =
      '<td>' + escapeHtml(service.custom_name || 'Run') + '</td>' +
      '<td class="cell-mono">' + escapeHtml((service.vm && service.vm.hostname) || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(String(portLabel)) + '</td>' +
      '<td><span class="status ' + statusClass + '"><span class="status-dot"></span>' + escapeHtml(statusText) + '</span></td>' +
      '<td class="cell-actions"></td>';

    const actionsCell = tr.querySelector('.cell-actions');

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost btn-sm';
    toggleBtn.textContent = isActive ? 'Stop' : 'Run';
    toggleBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleService(service, toggleBtn); });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', function (e) { e.stopPropagation(); deleteService(service, tr); });

    actionsCell.appendChild(toggleBtn);
    actionsCell.appendChild(deleteBtn);

    tr.addEventListener('click', function () { toggleExpand(service, tr, true); });
    return tr;
  }

  function renderRunTable(runInstances) {
    runCountEl.textContent = runInstances.length + (runInstances.length === 1 ? ' instance' : ' instances');
    if (runInstances.length === 0) {
      runBody.innerHTML = '<tr class="empty-row"><td colspan="5">No Run instances yet. Pick an Executable above to get started.</td></tr>';
      return;
    }
    runBody.innerHTML = '';
    runInstances.forEach(function (service) { runBody.appendChild(renderRunRow(service)); });
    reattachExpanded(runBody, runInstances);
  }

  // ── Isolated Linux ──

  const linuxCardsEl = document.getElementById('linuxCards');
  const linuxPanel = document.getElementById('linuxPanel');
  const linuxPanelBanner = document.getElementById('linuxPanelBanner');
  const linuxForm = document.getElementById('linuxForm');
  const linuxSubmit = document.getElementById('linuxSubmit');
  const linuxNameInput = document.getElementById('linuxNameInput');
  const linuxPortInput = document.getElementById('linuxPortInput');
  const linuxPortEndInput = document.getElementById('linuxPortEndInput');
  const linuxContainerPortInput = document.getElementById('linuxContainerPortInput');
  const linuxContainerPortEndInput = document.getElementById('linuxContainerPortEndInput');
  const linuxIpSelect = document.getElementById('linuxIpSelect');
  const linuxSshPortInput = document.getElementById('linuxSshPortInput');
  const linuxOnExitSelect = document.getElementById('linuxOnExitSelect');
  const linuxRestartDelayGroup = document.getElementById('linuxRestartDelayGroup');
  const linuxRestartDelayInput = document.getElementById('linuxRestartDelayInput');
  const linuxBody = document.getElementById('linuxBody');
  const linuxCountEl = document.getElementById('linuxCount');

  let linuxPanelOpen = false;

  function renderLinuxCard() {
    linuxCardsEl.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'service-card' + (linuxPanelOpen ? ' active' : '');
    btn.innerHTML =
      '<div class="service-card-name">Isolated Linux</div>' +
      '<div class="service-card-hint">512 MB</div>';
    btn.addEventListener('click', toggleLinuxPanel);
    linuxCardsEl.appendChild(btn);
  }

  function syncLinuxRestartDelayVisibility() {
    linuxRestartDelayGroup.classList.toggle('hidden', linuxOnExitSelect.value !== 'restart');
  }
  linuxOnExitSelect.addEventListener('change', syncLinuxRestartDelayVisibility);

  function openLinuxPanel() {
    linuxPanelOpen = true;
    renderLinuxCard();
    renderIpOptions(linuxIpSelect, '', usedByMap(null));
    linuxNameInput.value = '';
    linuxPortInput.value = '';
    linuxPortEndInput.value = '';
    linuxContainerPortInput.value = '';
    linuxContainerPortEndInput.value = '';
    linuxSshPortInput.value = '';
    linuxOnExitSelect.value = 'restart';
    linuxRestartDelayInput.value = '15';
    syncLinuxRestartDelayVisibility();
    hideBanner(linuxPanelBanner);
    linuxPanel.classList.add('is-open');
  }

  function closeLinuxPanel() {
    linuxPanelOpen = false;
    renderLinuxCard();
    linuxPanel.classList.remove('is-open');
  }

  function toggleLinuxPanel() {
    if (linuxPanelOpen) {
      closeLinuxPanel();
    } else {
      openLinuxPanel();
    }
  }

  linuxForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    linuxSubmit.disabled = true;
    linuxSubmit.textContent = 'Creating…';
    hideBanner(linuxPanelBanner);

    const result = await LinuxApi.create(session.userId, {
      custom_name: linuxNameInput.value.trim() || null,
      port: intOrNull(linuxPortInput),
      port_end: intOrNull(linuxPortEndInput),
      container_port: intOrNull(linuxContainerPortInput),
      container_port_end: intOrNull(linuxContainerPortEndInput),
      custom_ip: linuxIpSelect.value || null,
      ssh_port: intOrNull(linuxSshPortInput),
      on_exit: linuxOnExitSelect.value,
      restart_delay_seconds: parseInt(linuxRestartDelayInput.value, 10) || 15,
    });

    linuxSubmit.disabled = false;
    linuxSubmit.textContent = 'Create';

    if (!result.ok) {
      const reason = (result.data && (result.data.message || result.data.reason)) || 'Failed to create.';
      showBanner(linuxPanelBanner, reason === 'insufficient_balance' ? 'Insufficient balance.' : reason, true);
      return;
    }

    closeLinuxPanel();
    const data = result.data || {};
    showBanner(
      drpBanner,
      'Isolated Linux created — SSH port ' + data.ssh_port + ', password ' + data.ssh_password +
      '. Copy this now; you can also see it later from the instance’s own row. ' + (data.boot_notice || ''),
      false
    );
    loadAll();
  });

  function renderLinuxRow(service) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.dataset.id = service.id;

    const isActive = service.status === 'active';
    const statusClass = isActive ? 'is-active' : 'is-stopped';
    const statusText = isActive && service.needs_restart ? service.status + ' · needs restart' : service.status;
    const sshLabel = ((service.custom_ip) || (service.vm && service.vm.hostname) || '—') + (service.ssh_port ? ':' + service.ssh_port : '');

    tr.innerHTML =
      '<td>' + escapeHtml(service.custom_name || 'Isolated Linux') + '</td>' +
      '<td class="cell-mono">' + escapeHtml((service.vm && service.vm.hostname) || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(sshLabel) + '</td>' +
      '<td><span class="status ' + statusClass + '"><span class="status-dot"></span>' + escapeHtml(statusText) + '</span></td>' +
      '<td class="cell-actions"></td>';

    const actionsCell = tr.querySelector('.cell-actions');

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost btn-sm';
    toggleBtn.textContent = isActive ? 'Stop' : 'Turn On';
    toggleBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleService(service, toggleBtn); });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', function (e) { e.stopPropagation(); deleteService(service, tr); });

    actionsCell.appendChild(toggleBtn);
    actionsCell.appendChild(deleteBtn);

    tr.addEventListener('click', function () { toggleExpand(service, tr, false); });
    return tr;
  }

  function renderLinuxTable(linuxInstances) {
    linuxCountEl.textContent = linuxInstances.length + (linuxInstances.length === 1 ? ' instance' : ' instances');
    if (linuxInstances.length === 0) {
      linuxBody.innerHTML = '<tr class="empty-row"><td colspan="5">No Isolated Linux instances yet.</td></tr>';
      return;
    }
    linuxBody.innerHTML = '';
    linuxInstances.forEach(function (service) { linuxBody.appendChild(renderLinuxRow(service)); });
    reattachExpanded(linuxBody, linuxInstances);
  }

  // ── load ──

  async function loadAll() {
    hideBanner(drpBanner);
    await loadShared();

    const servicesResult = await BackendApi.listServices(session.userId);
    if (!servicesResult.ok) {
      runBody.innerHTML = '<tr class="empty-row"><td colspan="5">Couldn’t load. Is the backend running?</td></tr>';
      linuxBody.innerHTML = '<tr class="empty-row"><td colspan="5">Couldn’t load. Is the backend running?</td></tr>';
      runCountEl.textContent = '';
      linuxCountEl.textContent = '';
      return;
    }

    allServices = (servicesResult.data && servicesResult.data.services) || [];

    renderRunCard();
    renderLinuxCard();
    renderRunTable(allServices.filter(function (s) { return s.service_name === 'run'; }));
    renderLinuxTable(allServices.filter(function (s) { return s.service_name === 'run-linux'; }));
  }

  // A link from the Executable page ("Host as Run") pre-opens the Run
  // panel with that executable already picked.
  const hostExecutableId = new URLSearchParams(window.location.search).get('host_executable_id');

  loadAll().then(function () {
    if (hostExecutableId) openRunPanel(hostExecutableId);
  });
})();
