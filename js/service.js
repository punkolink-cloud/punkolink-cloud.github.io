(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const RUN_SERVICES = ['run-medium', 'run-micro'];
  const params = new URLSearchParams(window.location.search);
  const serviceId = params.get('id');

  const loadingState = document.getElementById('loadingState');
  const notFoundState = document.getElementById('notFoundState');
  const content = document.getElementById('serviceContent');
  const detailBanner = document.getElementById('detailBanner');

  let current = null;
  let allServices = [];
  let heldAddresses = [];

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function showBanner(message, isError) {
    detailBanner.textContent = message;
    detailBanner.classList.add('visible');
    detailBanner.classList.toggle('success', !isError);
  }

  function envMapToText(envVars) {
    return Object.keys(envVars || {}).map(function (key) {
      return key + '=' + envVars[key];
    }).join('\n');
  }

  function render(service) {
    current = service;
    const isRunService = RUN_SERVICES.indexOf(service.service_name) !== -1;
    const isActive = service.status === 'active';

    document.getElementById('serviceType').textContent =
      service.service_name + ' · ' + (isRunService ? 'Compute' : 'Managed Image');
    document.getElementById('serviceName').textContent = service.custom_name || service.service_name;

    const statusEl = document.getElementById('serviceStatus');
    statusEl.className = 'status ' + (isActive ? 'is-active' : 'is-stopped');
    statusEl.innerHTML = '<span class="status-dot"></span>' + service.status;

    document.getElementById('kvId').textContent = service.id;
    document.getElementById('kvRegion').textContent = service.region || '—';
    document.getElementById('kvHostname').textContent = (service.vm && service.vm.hostname) || '—';
    document.getElementById('kvPort').textContent = service.port != null ? service.port : '—';

    const toggleBtn = document.getElementById('toggleBtn');
    toggleBtn.textContent = isActive ? 'Turn Off' : 'Turn On';

    document.getElementById('envText').value = envMapToText(service.env_vars);
    document.getElementById('onExitSelect').value = service.on_exit || 'restart';

    renderNetworking(service);

    document.getElementById('payloadSection').classList.toggle('hidden', !isRunService);
    const payloadInfo = document.getElementById('payloadInfo');
    if (service.payload) {
      payloadInfo.innerHTML =
        '<div class="kv-row"><span class="kv-key">Kind</span><span class="kv-val">' + service.payload.kind + '</span></div>' +
        '<div class="kv-row"><span class="kv-key">Path</span><span class="kv-val">' + service.payload.path + '</span></div>';
    } else {
      payloadInfo.innerHTML = '<div class="kv-row"><span class="kv-key">Status</span><span class="kv-val">No payload uploaded yet</span></div>';
    }

    loadingState.classList.add('hidden');
    content.classList.remove('hidden');
  }

  async function load() {
    const result = await BackendApi.listServices(session.userId);
    if (!result.ok) {
      loadingState.textContent = 'Couldn’t load service. Is the backend running?';
      return;
    }

    allServices = (result.data && result.data.services) || [];
    const service = allServices.filter(function (s) { return String(s.id) === String(serviceId); })[0];

    if (!service) {
      loadingState.classList.add('hidden');
      notFoundState.classList.add('visible');
      return;
    }

    // The custom-IP picker offers the addresses this user rents in the
    // service's region. A failure here just leaves the picker empty.
    const l3 = await L3Api.list(session.userId, service.region || '');
    heldAddresses = (l3.ok && l3.data && l3.data.addresses) || [];

    render(service);
  }

  // The Networking card: pick a rented L3 address in this region, or
  // Default. Only user_id-side change is which address (+ manual port);
  // the address list itself is operator-managed.
  function renderNetworking(service) {
    const group = document.getElementById('customIpGroup');
    const hintEl = document.getElementById('customIpHint');
    const select = document.getElementById('customIpSelect');
    const portInput = document.getElementById('customPortInput');

    portInput.value = service.port != null ? service.port : '';

    const inRegion = heldAddresses.filter(function (a) { return a.region === service.region; });

    // addresses already bound to another of this user's services
    const usedBy = {};
    allServices.forEach(function (s) {
      if (String(s.id) !== String(service.id) && s.custom_ip) {
        usedBy[s.custom_ip] = s.custom_name || s.service_name;
      }
    });

    if (inRegion.length === 0 && !service.custom_ip) {
      group.classList.add('hidden');
      hintEl.classList.remove('hidden');
      hintEl.innerHTML =
        'No rented addresses in ' +
        escapeHtml(service.region || 'this region') +
        '. Rent one under <a href="l3.html">L3</a> and it shows up here.';
      portInput.disabled = true;
      return;
    }

    group.classList.remove('hidden');
    hintEl.classList.add('hidden');

    const seen = {};
    let opts = '<option value="">Default — node address, automatic port</option>';
    inRegion.forEach(function (a) {
      seen[a.address] = true;
      const used = usedBy[a.address];
      opts +=
        '<option value="' + escapeHtml(a.address) + '"' + (used ? ' disabled' : '') + '>' +
        escapeHtml(a.address) + (used ? ' — in use by ' + escapeHtml(used) : '') +
        '</option>';
    });
    if (service.custom_ip && !seen[service.custom_ip]) {
      opts +=
        '<option value="' + escapeHtml(service.custom_ip) + '">' +
        escapeHtml(service.custom_ip) + ' — not currently rented</option>';
    }
    select.innerHTML = opts;
    select.value = service.custom_ip || '';
    syncPortField();
  }

  document.getElementById('toggleBtn').addEventListener('click', async function () {
    const button = this;
    button.disabled = true;
    const action = current.status === 'active' ? BackendApi.stopService : BackendApi.launchService;
    const result = await action(current.service_name, session.userId, current.id);
    button.disabled = false;
    if (!result.ok) {
      const reason = (result.data && (result.data.message || result.data.reason)) || 'Action failed.';
      showBanner(reason, true);
    }
    load();
  });

  document.getElementById('deleteBtn').addEventListener('click', async function () {
    if (!window.confirm('Delete ' + (current.custom_name || current.service_name) + '? This cannot be undone.')) return;
    const result = await BackendApi.deleteService(current.service_name, session.userId, current.id);
    if (!result.ok) {
      showBanner('Failed to delete service.', true);
      return;
    }
    window.location.href = 'dashboard.html';
  });

  document.getElementById('envForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const errEl = document.getElementById('envError');
    errEl.classList.remove('visible');

    const result = await BackendApi.setEnv(current.service_name, session.userId, current.id, document.getElementById('envText').value);
    if (!result.ok) {
      errEl.textContent = (result.data && result.data.reason) || 'Failed to save environment variables.';
      errEl.classList.add('visible');
      return;
    }
    showBanner('Environment variables saved.', false);
    load();
  });

  document.getElementById('payloadForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const fileInput = document.getElementById('payloadFile');
    const file = fileInput.files[0];
    if (!file) return;

    const result = await BackendApi.uploadPayload(current.service_name, session.userId, current.id, file);
    if (!result.ok) {
      showBanner((result.data && result.data.reason) || 'Failed to upload payload.', true);
      return;
    }
    showBanner('Payload uploaded.', false);
    fileInput.value = '';
    load();
  });

  document.getElementById('settingsForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const onExit = document.getElementById('onExitSelect').value;
    const result = await BackendApi.setSettings(current.service_name, session.userId, current.id, onExit);
    if (!result.ok) {
      showBanner((result.data && result.data.reason) || 'Failed to save settings.', true);
      return;
    }
    showBanner('Settings saved.', false);
  });

  // The manual port only applies once an address is chosen.
  function syncPortField() {
    const hasAddress = document.getElementById('customIpSelect').value !== '';
    document.getElementById('customPortInput').disabled = !hasAddress;
  }

  document.getElementById('customIpSelect').addEventListener('change', syncPortField);

  document.getElementById('networkForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const errEl = document.getElementById('networkError');
    errEl.classList.remove('visible');

    const customIp = document.getElementById('customIpSelect').value;
    const portRaw = document.getElementById('customPortInput').value.trim();
    let port = null;

    if (customIp) {
      port = parseInt(portRaw, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errEl.textContent = 'Pick a port between 1 and 65535 for this address.';
        errEl.classList.add('visible');
        return;
      }
    }

    const result = await BackendApi.setNetwork(
      current.service_name,
      session.userId,
      current.id,
      customIp || null,
      port
    );
    if (!result.ok) {
      const reason = (result.data && result.data.reason) || '';
      showBanner(
        reason === 'address_not_rented'
          ? 'That address isn’t one you rent in this region anymore. Pick another, or Default.'
          : reason || 'Failed to save networking.',
        true
      );
      return;
    }
    showBanner(
      customIp
        ? 'Networking saved. It takes effect on the next launch — turn the service off and on.'
        : 'Back to the node address and an automatic port.',
      false
    );
    load();
  });

  if (!serviceId) {
    loadingState.classList.add('hidden');
    notFoundState.classList.add('visible');
  } else {
    load();
  }
})();
