(function () {
  const session = Session.requireAuth();
  if (!session) return;

  // The DRP section is the home for run-micro/run-medium instances: the
  // user brings their own payload (a binary or a zipped Node.js project),
  // uploaded on the container's page after it's created.
  const RUN_SERVICES = ['run-micro', 'run-medium', 'run-linux'];

  const TIER_LABELS = {
    'run-micro': 'micro · 128 MB',
    'run-medium': 'medium · 256 MB',
    'run-linux': 'linux · 512 MB',
  };

  function tierLabel(name) {
    return TIER_LABELS[name] || name;
  }

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

  const tbody = document.getElementById('containersBody');
  const countEl = document.getElementById('containerCount');
  const drpBanner = document.getElementById('drpBanner');

  function renderRow(service) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';

    const isActive = service.status === 'active';
    const statusClass = isActive ? 'is-active' : 'is-stopped';
    const statusText = isActive && service.needs_restart
      ? service.status + ' · needs restart'
      : service.status;

    tr.innerHTML =
      '<td>' + escapeHtml(service.custom_name || service.service_name) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(tierLabel(service.service_name)) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(service.region || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml((service.vm && service.vm.hostname) || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(service.port != null ? String(service.port) : '—') + '</td>' +
      '<td><span class="status ' + statusClass + '"><span class="status-dot"></span>' + escapeHtml(statusText) + '</span></td>' +
      '<td class="cell-actions"></td>';

    const actionsCell = tr.querySelector('.cell-actions');

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost btn-sm';
    toggleBtn.textContent = isActive ? 'Stop' : 'Run';
    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleService(service, toggleBtn);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteService(service, tr);
    });

    actionsCell.appendChild(toggleBtn);
    actionsCell.appendChild(deleteBtn);

    tr.addEventListener('click', function () {
      window.location.href = 'service.html?id=' + service.id;
    });

    return tr;
  }

  async function toggleService(service, button) {
    button.disabled = true;
    const action = service.status === 'active' ? BackendApi.stopService : BackendApi.launchService;
    const result = await action(service.service_name, session.userId, service.id);
    if (!result.ok) {
      let reason = (result.data && (result.data.message || result.data.reason)) || 'Action failed.';
      if (reason === 'no_payload_uploaded') {
        reason = 'Upload a payload on the container page before running it.';
      }
      showBanner(drpBanner, reason, true);
    }
    loadContainers();
  }

  async function deleteService(service, row) {
    if (!window.confirm('Delete ' + (service.custom_name || service.service_name) + '? This cannot be undone.')) return;
    row.style.opacity = '0.5';
    const result = await BackendApi.deleteService(service.service_name, session.userId, service.id);
    if (!result.ok) {
      showBanner(drpBanner, 'Failed to delete container.', true);
      row.style.opacity = '';
      return;
    }
    loadContainers();
  }

  async function loadContainers() {
    hideBanner(drpBanner);
    const result = await BackendApi.listServices(session.userId);

    if (!result.ok) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Couldn’t load containers. Is the backend running?</td></tr>';
      countEl.textContent = '';
      return;
    }

    // Only run-micro/run-medium belong here; managed images live under
    // Managed Services.
    const services = ((result.data && result.data.services) || []).filter(function (s) {
      return RUN_SERVICES.indexOf(s.service_name) !== -1;
    });
    countEl.textContent = services.length + (services.length === 1 ? ' container' : ' containers');

    if (services.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No containers yet. Add one, then upload a binary or a Node.js zip on its page.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    services.forEach(function (service) {
      tbody.appendChild(renderRow(service));
    });
  }

  // ── add-container modal ──
  const addModal = document.getElementById('addContainerModal');
  const addModalBanner = document.getElementById('addContainerBanner');
  const tierSelect = document.getElementById('tierSelect');
  const regionSelect = document.getElementById('containerRegionSelect');
  const nameInput = document.getElementById('containerNameInput');
  const envInput = document.getElementById('containerEnvInput');
  const addForm = document.getElementById('addContainerForm');
  const addSubmit = document.getElementById('addContainerSubmit');

  function openAddModal() {
    nameInput.value = '';
    envInput.value = '';
    addModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeAddModal() {
    addModal.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  document.getElementById('addContainerBtn').addEventListener('click', async function () {
    hideBanner(addModalBanner);
    tierSelect.innerHTML = '<option>Loading…</option>';
    regionSelect.innerHTML = '<option>Loading…</option>';
    openAddModal();

    const [catalogResult, regionsResult] = await Promise.all([BackendApi.catalog(), BackendApi.regions()]);

    if (!catalogResult.ok) {
      tierSelect.innerHTML = '<option>Unavailable</option>';
      showBanner(addModalBanner, 'Couldn’t load the tier catalog.', true);
    } else {
      const names = ((catalogResult.data && catalogResult.data.services) || [])
        .map(function (entry) { return entry.name; })
        .filter(function (name) {
          return RUN_SERVICES.indexOf(name) !== -1;
        });
      tierSelect.innerHTML = names.map(function (name) {
        return '<option value="' + escapeHtml(name) + '">' + escapeHtml(tierLabel(name)) + '</option>';
      }).join('');
    }

    if (!regionsResult.ok) {
      regionSelect.innerHTML = '<option>Unavailable</option>';
      showBanner(addModalBanner, 'Couldn’t load the region list.', true);
    } else {
      const regionNames = (regionsResult.data && regionsResult.data.regions) || [];
      regionSelect.innerHTML = regionNames.map(function (name) {
        return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
      }).join('');
    }
  });

  document.getElementById('addContainerClose').addEventListener('click', closeAddModal);
  addModal.addEventListener('click', function (e) {
    if (e.target === addModal) closeAddModal();
  });

  addForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const serviceName = tierSelect.value;
    const regionName = regionSelect.value;
    if (!serviceName || !regionName || RUN_SERVICES.indexOf(serviceName) === -1) return;

    addSubmit.disabled = true;
    addSubmit.textContent = 'Creating…';
    hideBanner(addModalBanner);

    const result = await BackendApi.createService(
      serviceName,
      session.userId,
      regionName,
      nameInput.value.trim(),
      envInput.value
    );

    addSubmit.disabled = false;
    addSubmit.textContent = 'Create';

    if (!result.ok) {
      const reason = (result.data && result.data.reason) || 'Failed to create container.';
      showBanner(addModalBanner, reason === 'insufficient_balance' ? 'Insufficient balance.' : reason, true);
      return;
    }

    closeAddModal();
    loadContainers();
  });

  loadContainers();
})();
