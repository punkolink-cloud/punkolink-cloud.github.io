(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const RUN_SERVICES = ['run-medium', 'run-micro'];

  function serviceType(name) {
    return RUN_SERVICES.indexOf(name) !== -1 ? 'Compute' : 'Managed Image';
  }

  function showBanner(el, message, isError) {
    el.textContent = message;
    el.classList.add('visible');
    el.classList.toggle('success', !isError);
  }

  function hideBanner(el) {
    el.classList.remove('visible');
  }

  const tbody = document.getElementById('servicesBody');
  const countEl = document.getElementById('serviceCount');
  const dashboardBanner = document.getElementById('dashboardBanner');

  function renderRow(service) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';

    const isActive = service.status === 'active';
    const statusClass = isActive ? 'is-active' : 'is-stopped';

    tr.innerHTML =
      '<td>' + escapeHtml(service.custom_name || service.service_name) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(service.service_name) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(service.region || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml((service.vm && service.vm.hostname) || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(service.port != null ? String(service.port) : '—') + '</td>' +
      '<td><span class="status ' + statusClass + '"><span class="status-dot"></span>' + escapeHtml(service.status) + '</span></td>' +
      '<td class="cell-actions"></td>';

    const actionsCell = tr.querySelector('.cell-actions');

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost btn-sm';
    toggleBtn.textContent = isActive ? 'Turn Off' : 'Turn On';
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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  async function toggleService(service, button) {
    button.disabled = true;
    const action = service.status === 'active' ? BackendApi.stopService : BackendApi.launchService;
    const result = await action(service.service_name, session.userId, service.id);
    if (!result.ok) {
      const reason = (result.data && (result.data.message || result.data.reason)) || 'Action failed.';
      showBanner(dashboardBanner, reason, true);
    }
    loadServices();
  }

  async function deleteService(service, row) {
    if (!window.confirm('Delete ' + (service.custom_name || service.service_name) + '? This cannot be undone.')) return;
    row.style.opacity = '0.5';
    const result = await BackendApi.deleteService(service.service_name, session.userId, service.id);
    if (!result.ok) {
      showBanner(dashboardBanner, 'Failed to delete service.', true);
      row.style.opacity = '';
      return;
    }
    loadServices();
  }

  async function loadServices() {
    hideBanner(dashboardBanner);
    const result = await BackendApi.listServices(session.userId);

    if (!result.ok) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Couldn’t load services. Is the backend running?</td></tr>';
      countEl.textContent = '';
      return;
    }

    const services = (result.data && result.data.services) || [];
    countEl.textContent = services.length + (services.length === 1 ? ' service' : ' services');

    if (services.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No services yet. Add one to get started.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    services.forEach(function (service) {
      tbody.appendChild(renderRow(service));
    });
  }

  // ── add-service modal ──
  const addModal = document.getElementById('addModal');
  const addModalBanner = document.getElementById('addModalBanner');
  const serviceSelect = document.getElementById('serviceSelect');
  const regionSelect = document.getElementById('regionSelect');
  const customNameInput = document.getElementById('customNameInput');
  const envTextInput = document.getElementById('envTextInput');
  const addServiceForm = document.getElementById('addServiceForm');
  const addServiceSubmit = document.getElementById('addServiceSubmit');

  function openAddModal() {
    customNameInput.value = '';
    envTextInput.value = '';
    addModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeAddModal() {
    addModal.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  document.getElementById('addServiceBtn').addEventListener('click', async function () {
    hideBanner(addModalBanner);
    serviceSelect.innerHTML = '<option>Loading…</option>';
    regionSelect.innerHTML = '<option>Loading…</option>';
    openAddModal();

    const [catalogResult, regionsResult] = await Promise.all([BackendApi.catalog(), BackendApi.regions()]);

    if (!catalogResult.ok) {
      serviceSelect.innerHTML = '<option>Unavailable</option>';
      showBanner(addModalBanner, 'Couldn’t load the service catalog.', true);
    } else {
      const names = (catalogResult.data && catalogResult.data.services) || [];
      serviceSelect.innerHTML = names.map(function (name) {
        return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + ' — ' + escapeHtml(serviceType(name)) + '</option>';
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

  document.getElementById('addModalClose').addEventListener('click', closeAddModal);
  addModal.addEventListener('click', function (e) {
    if (e.target === addModal) closeAddModal();
  });

  addServiceForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const serviceName = serviceSelect.value;
    const regionName = regionSelect.value;
    if (!serviceName || !regionName) return;

    addServiceSubmit.disabled = true;
    addServiceSubmit.textContent = 'Creating…';
    hideBanner(addModalBanner);

    const result = await BackendApi.createService(
      serviceName,
      session.userId,
      regionName,
      customNameInput.value.trim(),
      envTextInput.value
    );

    addServiceSubmit.disabled = false;
    addServiceSubmit.textContent = 'Create';

    if (!result.ok) {
      const reason = (result.data && result.data.reason) || 'Failed to create service.';
      showBanner(addModalBanner, reason === 'insufficient_balance' ? 'Insufficient balance.' : reason, true);
      return;
    }

    closeAddModal();
    loadServices();
  });

  loadServices();
})();
