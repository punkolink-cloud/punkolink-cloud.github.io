// Shared behind database.html / in-memory.html / document.html — the
// three sections Managed Services was split into. Each page sets
// window.MANAGED_SERVICES_CATEGORY before loading this script; the DOM
// element ids are otherwise identical across all three, copied from the
// original single-page Managed Services layout.
(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const CATEGORY = window.MANAGED_SERVICES_CATEGORY;

  // Friendlier labels than the raw catalog name, for services where the
  // two differ. Anything absent here just shows its raw name.
  const DISPLAY_NAMES = {
    postgres: 'PostgreSQL',
    pgvector: 'pgvector',
    'apache-age': 'Apache AGE',
    paradedb: 'ParadeDB',
    valkey: 'Valkey',
    seaweedfs: 'SeaweedFS',
  };

  function displayName(name) {
    return DISPLAY_NAMES[name] || name;
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

  // reason (from an API error body) -> a message worth showing as-is.
  const REASON_TEXT = {
    insufficient_balance: 'Insufficient balance.',
    parent_required: 'Pick which instance this attaches to.',
    invalid_parent: 'That instance can’t be used as a parent — pick one of your own instances of the right type.',
    parent_already_extended: 'That instance already has an extension attached — only one at a time.',
    managed_by_extension: 'Managed from its extension’s own page — stop/start it there instead.',
    has_active_extension: 'Remove its extension first, then delete it.',
  };

  function reasonText(result, fallback) {
    const reason = result.data && (result.data.message || result.data.reason);
    return REASON_TEXT[reason] || reason || fallback;
  }

  const tbody = document.getElementById('servicesBody');
  const countEl = document.getElementById('serviceCount');
  const pageBanner = document.getElementById('dashboardBanner');

  let catalog = []; // catalog entries in this category: {name, category, parent_service}
  let allServices = []; // every instance this user has, any category

  // Instance ids that already have an extension attached — a parent in
  // this set can't take another one and can't be launched/stopped
  // directly (see service_controller::attempt_launch/stop on the
  // backend).
  function parentedIds() {
    const set = {};
    allServices.forEach(function (s) {
      if (s.parent_instance_id != null) set[s.parent_instance_id] = true;
    });
    return set;
  }

  let expandedId = null;
  let expandedRowEl = null;

  function panelOpts(service) {
    return {
      session: session,
      isRunService: false,
      displayName: displayName,
      getAllServices: function () { return allServices; },
      refresh: loadServices,
      onDeleted: function () {
        expandedId = null;
        expandedRowEl = null;
        loadServices();
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

  function renderRow(service, extendedIds) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.dataset.id = service.id;

    const isActive = service.status === 'active';
    const statusClass = isActive ? 'is-active' : 'is-stopped';
    const isManagedByExtension = extendedIds[service.id];

    let nameCell = escapeHtml(displayName(service.service_name));
    if (service.parent_instance_id != null) {
      const parent = allServices.filter(function (s) { return s.id === service.parent_instance_id; })[0];
      if (parent) {
        nameCell += ' <span class="cell-hint">on ' + escapeHtml(parent.custom_name || displayName(parent.service_name)) + '</span>';
      }
    }

    tr.innerHTML =
      '<td>' + escapeHtml(service.custom_name || displayName(service.service_name)) + '</td>' +
      '<td class="cell-mono">' + nameCell + '</td>' +
      '<td class="cell-mono">' + escapeHtml((service.vm && service.vm.hostname) || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(service.port != null ? String(service.port) : '—') + '</td>' +
      '<td><span class="status ' + statusClass + '"><span class="status-dot"></span>' + escapeHtml(service.status) + '</span></td>' +
      '<td class="cell-actions"></td>';

    const actionsCell = tr.querySelector('.cell-actions');

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost btn-sm';
    toggleBtn.textContent = isActive ? 'Turn Off' : 'Turn On';
    if (isManagedByExtension) {
      toggleBtn.disabled = true;
      toggleBtn.title = REASON_TEXT.managed_by_extension;
    }
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
      showBanner(pageBanner, reasonText(result, 'Action failed.'), true);
    }
    loadServices();
  }

  async function deleteService(service, row) {
    if (!window.confirm('Delete ' + (service.custom_name || displayName(service.service_name)) + '? This cannot be undone.')) return;
    row.style.opacity = '0.5';
    const result = await BackendApi.deleteService(service.service_name, session.userId, service.id);
    if (!result.ok) {
      showBanner(pageBanner, reasonText(result, 'Failed to delete service.'), true);
      row.style.opacity = '';
      return;
    }
    loadServices();
  }

  const cardsEl = document.getElementById('serviceCards');
  let selectedService = null; // catalog name of the card currently open, or null

  function renderCard(entry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'service-card' + (entry.name === selectedService ? ' active' : '');
    btn.innerHTML =
      '<div class="service-card-name">' + escapeHtml(displayName(entry.name)) + '</div>' +
      (entry.parent_service
        ? '<div class="service-card-hint">requires ' + escapeHtml(displayName(entry.parent_service)) + '</div>'
        : '');
    btn.addEventListener('click', function () { toggleCard(entry.name); });
    return btn;
  }

  function renderCards() {
    cardsEl.innerHTML = '';
    catalog.forEach(function (entry) {
      cardsEl.appendChild(renderCard(entry));
    });
  }

  async function loadServices() {
    hideBanner(pageBanner);
    const [catalogResult, servicesResult] = await Promise.all([
      BackendApi.catalog(),
      BackendApi.listServices(session.userId),
    ]);

    if (!servicesResult.ok || !catalogResult.ok) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Couldn’t load services. Is the backend running?</td></tr>';
      countEl.textContent = '';
      return;
    }

    const allCatalog = (catalogResult.data && catalogResult.data.services) || [];
    catalog = allCatalog.filter(function (entry) { return entry.category === CATEGORY; });
    renderCards();

    allServices = (servicesResult.data && servicesResult.data.services) || [];
    const catalogNames = {};
    catalog.forEach(function (entry) { catalogNames[entry.name] = true; });
    const services = allServices.filter(function (s) { return catalogNames[s.service_name]; });

    // A parent candidate list may have just gained or lost a member.
    if (selectedService) syncParentField();

    countEl.textContent = services.length + (services.length === 1 ? ' service' : ' services');

    if (services.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No services yet. Pick one above to get started.</td></tr>';
      expandedId = null;
      expandedRowEl = null;
      return;
    }

    const extendedIds = parentedIds();
    tbody.innerHTML = '';
    services.forEach(function (service) {
      tbody.appendChild(renderRow(service, extendedIds));
    });

    reattachExpanded(services);
  }

  // A save/toggle/etc inside the open panel calls loadServices(), which
  // just rebuilt the whole table — put the panel back if its service is
  // still there, with fresh data and no re-entrance animation.
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
  const addModalBanner = document.getElementById('addModalBanner');
  const customNameInput = document.getElementById('customNameInput');
  const envTextInput = document.getElementById('envTextInput');
  const addServiceForm = document.getElementById('addServiceForm');
  const addServiceSubmit = document.getElementById('addServiceSubmit');
  const parentGroup = document.getElementById('parentGroup');
  const parentSelect = document.getElementById('parentSelect');
  const parentHint = document.getElementById('parentHint');

  // Candidate parents for the currently-open card: the user's own
  // instances of the required parent type that don't already carry an
  // extension.
  function syncParentField() {
    const entry = catalog.filter(function (c) { return c.name === selectedService; })[0];
    const requiredParent = entry && entry.parent_service;

    if (!requiredParent) {
      parentGroup.classList.add('hidden');
      parentSelect.required = false;
      return;
    }

    const extendedIds = parentedIds();
    const candidates = allServices.filter(function (s) {
      return s.service_name === requiredParent && !extendedIds[s.id];
    });

    parentGroup.classList.remove('hidden');
    parentSelect.required = true;

    if (candidates.length === 0) {
      parentSelect.innerHTML = '';
      parentSelect.disabled = true;
      parentHint.textContent = 'You need a ' + displayName(requiredParent) + ' instance without an extension attached first.';
      parentHint.classList.remove('hidden');
      return;
    }

    parentSelect.disabled = false;
    parentHint.classList.add('hidden');
    parentSelect.innerHTML = candidates.map(function (c) {
      return '<option value="' + c.id + '">' + escapeHtml(c.custom_name || displayName(c.service_name)) + '</option>';
    }).join('');
  }

  function openPanelFor(name) {
    selectedService = name;
    Array.prototype.forEach.call(cardsEl.children, function (card, i) {
      card.classList.toggle('active', catalog[i] && catalog[i].name === name);
    });
    createPanelTitle.textContent = 'New ' + displayName(name);
    customNameInput.value = '';
    envTextInput.value = '';
    hideBanner(addModalBanner);
    syncParentField();
    createPanel.classList.add('is-open');
  }

  function closePanel() {
    selectedService = null;
    Array.prototype.forEach.call(cardsEl.children, function (card) {
      card.classList.remove('active');
    });
    createPanel.classList.remove('is-open');
  }

  function toggleCard(name) {
    if (selectedService === name) {
      closePanel();
    } else {
      openPanelFor(name);
    }
  }

  addServiceForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!selectedService) return;
    if (!parentGroup.classList.contains('hidden') && !parentSelect.value) return;

    addServiceSubmit.disabled = true;
    addServiceSubmit.textContent = 'Creating…';
    hideBanner(addModalBanner);

    const result = await BackendApi.createService(
      selectedService,
      session.userId,
      customNameInput.value.trim(),
      envTextInput.value,
      parentGroup.classList.contains('hidden') ? null : parentSelect.value
    );

    addServiceSubmit.disabled = false;
    addServiceSubmit.textContent = 'Create';

    if (!result.ok) {
      showBanner(addModalBanner, reasonText(result, 'Failed to create service.'), true);
      return;
    }

    closePanel();
    loadServices();
  });

  loadServices();
})();
