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

  const TIER_NAMES = { 'run-micro': 'Micro', 'run-medium': 'Medium', 'run-linux': 'Linux' };
  const TIER_MEMORY = { 'run-micro': '128 MB', 'run-medium': '256 MB', 'run-linux': '512 MB' };

  function displayName(name) {
    return TIER_NAMES[name] || name;
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

  let allServices = []; // every instance this user has, any category — for the panel's custom-IP "used by" check

  let expandedId = null;
  let expandedRowEl = null;

  function panelOpts(service) {
    return {
      session: session,
      isRunService: true,
      displayName: displayName,
      getAllServices: function () { return allServices; },
      refresh: loadContainers,
      onDeleted: function () {
        expandedId = null;
        expandedRowEl = null;
        loadContainers();
      },
    };
  }

  async function toggleExpand(service, tr) {
    if (expandedId === service.id) {
      const closing = expandedRowEl;
      expandedId = null;
      expandedRowEl = null;
      if (closing) await ServicePanel.close(closing);
      return;
    }
    if (expandedRowEl) await ServicePanel.close(expandedRowEl);
    expandedId = service.id;
    expandedRowEl = ServicePanel.open(tr, service, panelOpts(service));
  }

  function renderRow(service) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.dataset.id = service.id;

    const isActive = service.status === 'active';
    const statusClass = isActive ? 'is-active' : 'is-stopped';
    const statusText = isActive && service.needs_restart
      ? service.status + ' · needs restart'
      : service.status;

    tr.innerHTML =
      '<td>' + escapeHtml(service.custom_name || service.service_name) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(tierLabel(service.service_name)) + '</td>' +
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
      toggleExpand(service, tr);
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

  const cardsEl = document.getElementById('tierCards');
  let tiers = []; // catalog names in RUN_SERVICES order
  let selectedTier = null;

  function renderCard(name) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'service-card' + (name === selectedTier ? ' active' : '');
    btn.innerHTML =
      '<div class="service-card-name">' + escapeHtml(TIER_NAMES[name] || name) + '</div>' +
      '<div class="service-card-hint">' + escapeHtml(TIER_MEMORY[name] || '') + '</div>';
    btn.addEventListener('click', function () { toggleCard(name); });
    return btn;
  }

  function renderCards() {
    cardsEl.innerHTML = '';
    tiers.forEach(function (name) {
      cardsEl.appendChild(renderCard(name));
    });
  }

  async function loadContainers() {
    hideBanner(drpBanner);
    const [catalogResult, servicesResult] = await Promise.all([
      BackendApi.catalog(),
      BackendApi.listServices(session.userId),
    ]);

    if (catalogResult.ok) {
      tiers = ((catalogResult.data && catalogResult.data.services) || [])
        .map(function (entry) { return entry.name; })
        .filter(function (name) { return RUN_SERVICES.indexOf(name) !== -1; });
      renderCards();
    }

    if (!servicesResult.ok) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Couldn’t load containers. Is the backend running?</td></tr>';
      countEl.textContent = '';
      return;
    }

    allServices = (servicesResult.data && servicesResult.data.services) || [];

    // Only the DRP compute tiers belong here; managed images live under
    // the Workspace sections.
    const services = allServices.filter(function (s) {
      return RUN_SERVICES.indexOf(s.service_name) !== -1;
    });
    countEl.textContent = services.length + (services.length === 1 ? ' container' : ' containers');

    if (services.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No containers yet. Pick a tier above to get started.</td></tr>';
      expandedId = null;
      expandedRowEl = null;
      return;
    }

    tbody.innerHTML = '';
    services.forEach(function (service) {
      tbody.appendChild(renderRow(service));
    });

    reattachExpanded(services);
  }

  // A save/toggle/etc inside the open panel calls loadContainers(),
  // which just rebuilt the whole table — put the panel back if its
  // container is still there, with fresh data and no re-entrance
  // animation.
  function reattachExpanded(services) {
    expandedRowEl = null;
    if (expandedId == null) return;

    const service = services.filter(function (s) { return s.id === expandedId; })[0];
    const row = Array.prototype.filter.call(tbody.children, function (tr) {
      return tr.dataset.id === String(expandedId);
    })[0];

    if (!service || !row) {
      expandedId = null;
      return;
    }

    expandedRowEl = ServicePanel.attach(row, service, panelOpts(service));
  }

  // ── inline create panel ──
  const createPanel = document.getElementById('createPanel');
  const createPanelTitle = document.getElementById('createPanelTitle');
  const addModalBanner = document.getElementById('addContainerBanner');
  const nameInput = document.getElementById('containerNameInput');
  const envInput = document.getElementById('containerEnvInput');
  const addForm = document.getElementById('addContainerForm');
  const addSubmit = document.getElementById('addContainerSubmit');

  function openPanelFor(name) {
    selectedTier = name;
    Array.prototype.forEach.call(cardsEl.children, function (card, i) {
      card.classList.toggle('active', tiers[i] === name);
    });
    createPanelTitle.textContent = 'New ' + (TIER_NAMES[name] || name) + ' Container';
    nameInput.value = '';
    envInput.value = '';
    hideBanner(addModalBanner);
    createPanel.classList.add('is-open');
  }

  function closePanel() {
    selectedTier = null;
    Array.prototype.forEach.call(cardsEl.children, function (card) {
      card.classList.remove('active');
    });
    createPanel.classList.remove('is-open');
  }

  function toggleCard(name) {
    if (selectedTier === name) {
      closePanel();
    } else {
      openPanelFor(name);
    }
  }

  addForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!selectedTier) return;

    addSubmit.disabled = true;
    addSubmit.textContent = 'Creating…';
    hideBanner(addModalBanner);

    const result = await BackendApi.createService(
      selectedTier,
      session.userId,
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

    closePanel();
    loadContainers();
  });

  loadContainers();
})();
