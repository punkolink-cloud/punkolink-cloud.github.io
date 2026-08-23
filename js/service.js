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
    document.getElementById('kvIp').textContent = (service.vm && service.vm.ip) || '—';
    document.getElementById('kvPort').textContent = service.port != null ? service.port : '—';

    const toggleBtn = document.getElementById('toggleBtn');
    toggleBtn.textContent = isActive ? 'Turn Off' : 'Turn On';

    document.getElementById('envText').value = envMapToText(service.env_vars);
    document.getElementById('onExitSelect').value = service.on_exit || 'restart';

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

    const services = (result.data && result.data.services) || [];
    const service = services.filter(function (s) { return String(s.id) === String(serviceId); })[0];

    if (!service) {
      loadingState.classList.add('hidden');
      notFoundState.classList.add('visible');
      return;
    }

    render(service);
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

  if (!serviceId) {
    loadingState.classList.add('hidden');
    notFoundState.classList.add('visible');
  } else {
    load();
  }
})();
