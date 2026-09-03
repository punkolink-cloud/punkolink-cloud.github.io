(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const banner = document.getElementById('l3Banner');
  const regionSelect = document.getElementById('regionSelect');

  const FAMILY_LABELS = { ipv4: 'IPv4', ipv6: 'IPv6' };
  const RUN_SERVICES = ['run-micro', 'run-medium', 'run-linux'];
  const SERVICE_DISPLAY_NAMES = {
    postgres: 'PostgreSQL', pgvector: 'pgvector', 'apache-age': 'Apache AGE', paradedb: 'ParadeDB',
    valkey: 'Valkey', nats: 'NATS', seaweedfs: 'SeaweedFS',
    'run-micro': 'Micro', 'run-medium': 'Medium', 'run-linux': 'Linux',
  };
  function serviceDisplayName(name) {
    return SERVICE_DISPLAY_NAMES[name] || name;
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

  // "2026-08-30T12:34:56Z" / "2026-08-30 12:34:56+00" -> "2026-08-30 12:34"
  function shortTime(value) {
    if (!value) return '—';
    return String(value).replace('T', ' ').replace(/:\d\d(\.\d+)?(Z|[+-]\d\d.*)?$/, '');
  }

  function linesToList(text) {
    return text.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  }

  let heldAddresses = [];
  let services = [];

  async function loadRegions() {
    const result = await BackendApi.regions();
    const names = (result.ok && result.data && result.data.regions) || [];
    regionSelect.innerHTML = names.map(function (name) {
      return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
    }).join('');
    if (names.length === 0) regionSelect.innerHTML = '<option value="">No regions</option>';
  }

  // ── Rent Address: cards + inline panel ──
  const rentCardsEl = document.getElementById('rentCards');
  const rentPanel = document.getElementById('rentPanel');
  const rentPanelTitle = document.getElementById('rentPanelTitle');
  const rentPanelBanner = document.getElementById('rentPanelBanner');
  const rentForm = document.getElementById('rentForm');
  const rentSubmit = document.getElementById('rentSubmit');
  let selectedFamily = null;

  function renderRentCards() {
    rentCardsEl.innerHTML = '';
    ['ipv4', 'ipv6'].forEach(function (family) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'service-card' + (family === selectedFamily ? ' active' : '');
      btn.innerHTML = '<div class="service-card-name">' + FAMILY_LABELS[family] + '</div>';
      btn.addEventListener('click', function () { toggleRentCard(family); });
      rentCardsEl.appendChild(btn);
    });
  }

  function toggleRentCard(family) {
    if (selectedFamily === family) {
      selectedFamily = null;
      rentPanel.classList.remove('is-open');
    } else {
      selectedFamily = family;
      rentPanelTitle.textContent = 'Rent an ' + FAMILY_LABELS[family] + ' Address';
      hideBanner(rentPanelBanner);
      rentPanel.classList.add('is-open');
    }
    renderRentCards();
  }

  rentForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const regionName = regionSelect.value;
    if (!selectedFamily || !regionName) return;

    rentSubmit.disabled = true;
    rentSubmit.textContent = 'Renting…';
    hideBanner(rentPanelBanner);

    const result = await L3Api.rent(session.userId, regionName, selectedFamily);

    rentSubmit.disabled = false;
    rentSubmit.textContent = 'Rent';

    if (!result.ok) {
      const reason = (result.data && result.data.reason) || 'Failed to bind an address.';
      showBanner(
        rentPanelBanner,
        reason === 'no_addresses_available' ? 'No free addresses in this region.' :
        reason === 'unknown_region' ? 'That region is not known.' : reason,
        true
      );
      return;
    }

    selectedFamily = null;
    rentPanel.classList.remove('is-open');
    renderRentCards();
    loadAll();
  });

  // ── held addresses table ──
  const ipsBody = document.getElementById('ipsBody');
  const ipCountEl = document.getElementById('ipCount');

  function renderAddressRow(ip) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="cell-mono">' + escapeHtml(ip.address) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(FAMILY_LABELS[ip.family] || ip.family) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(ip.region || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(shortTime(ip.assigned_at)) + '</td>' +
      '<td class="cell-actions"></td>';

    const releaseBtn = document.createElement('button');
    releaseBtn.className = 'btn btn-danger btn-sm';
    releaseBtn.textContent = 'Release';
    releaseBtn.addEventListener('click', async function () {
      if (!window.confirm('Release ' + ip.address + '? Any routes on it stop working, and billing for it stops at the next tick.')) return;
      releaseBtn.disabled = true;
      const result = await L3Api.release(session.userId, ip.id);
      if (!result.ok) {
        showBanner(banner, 'Failed to release the address.', true);
        releaseBtn.disabled = false;
        return;
      }
      loadAll();
    });
    tr.querySelector('.cell-actions').appendChild(releaseBtn);

    return tr;
  }

  async function loadAddresses() {
    const result = await L3Api.list(session.userId, '');
    if (!result.ok) {
      ipsBody.innerHTML = '<tr class="empty-row"><td colspan="5">Couldn’t load addresses.</td></tr>';
      ipCountEl.textContent = '';
      heldAddresses = [];
      return;
    }

    heldAddresses = (result.data && result.data.addresses) || [];
    ipCountEl.textContent = heldAddresses.length + (heldAddresses.length === 1 ? ' address held' : ' addresses held');

    if (heldAddresses.length === 0) {
      ipsBody.innerHTML = '<tr class="empty-row"><td colspan="5">No addresses held yet. Rent one above.</td></tr>';
      return;
    }

    ipsBody.innerHTML = '';
    heldAddresses.forEach(function (ip) {
      ipsBody.appendChild(renderAddressRow(ip));
    });
  }

  // ── Network Routes: cards + inline panel ──
  const routeCardsEl = document.getElementById('routeCards');
  const routePanel = document.getElementById('routePanel');
  const routePanelTitle = document.getElementById('routePanelTitle');
  const routePanelBanner = document.getElementById('routePanelBanner');
  const routeForm = document.getElementById('routeForm');
  const routeSubmit = document.getElementById('routeSubmit');
  const routeAddressGroup = document.getElementById('routeAddressGroup');
  const routeAddressSelect = document.getElementById('routeAddressSelect');
  const routeAddressHint = document.getElementById('routeAddressHint');
  const routeInstanceSelect = document.getElementById('routeInstanceSelect');
  const routeProtocolSelect = document.getElementById('routeProtocolSelect');
  const routePortInput = document.getElementById('routePortInput');
  const routeWhitelistInput = document.getElementById('routeWhitelistInput');
  const routeBlacklistInput = document.getElementById('routeBlacklistInput');

  const ROUTE_TYPES = [
    { key: 'default', label: 'Default IPv4', family: 'ipv4', rented: false },
    { key: 'rented-ipv4', label: 'Rented IPv4', family: 'ipv4', rented: true },
    { key: 'rented-ipv6', label: 'Rented IPv6', family: 'ipv6', rented: true },
  ];
  let selectedRouteType = null;

  function renderRouteCards() {
    routeCardsEl.innerHTML = '';
    ROUTE_TYPES.forEach(function (type) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'service-card' + (type.key === selectedRouteType ? ' active' : '');
      btn.innerHTML = '<div class="service-card-name">' + escapeHtml(type.label) + '</div>';
      btn.addEventListener('click', function () { toggleRouteCard(type.key); });
      routeCardsEl.appendChild(btn);
    });
  }

  function syncRouteAddressOptions(family) {
    const candidates = heldAddresses.filter(function (a) { return a.family === family; });
    if (candidates.length === 0) {
      routeAddressSelect.innerHTML = '';
      routeAddressSelect.disabled = true;
      routeAddressHint.textContent = 'You need a rented ' + FAMILY_LABELS[family] + ' address first.';
      routeAddressHint.classList.remove('hidden');
      return;
    }
    routeAddressSelect.disabled = false;
    routeAddressHint.classList.add('hidden');
    routeAddressSelect.innerHTML = candidates.map(function (a) {
      return '<option value="' + a.id + '">' + escapeHtml(a.address) + '</option>';
    }).join('');
  }

  // A route DNATs to the instance's own default binding — one already
  // directly bound to a custom IP (the legacy per-service Networking
  // card) isn't listening there, so it can't take a new route yet.
  function syncRouteInstanceOptions() {
    const candidates = services.filter(function (s) { return !s.custom_ip; });
    if (candidates.length === 0) {
      routeInstanceSelect.innerHTML = '<option value="">No eligible instances</option>';
      return;
    }
    routeInstanceSelect.innerHTML = candidates.map(function (s) {
      return '<option value="' + s.id + '">' + escapeHtml(s.custom_name || serviceDisplayName(s.service_name)) + '</option>';
    }).join('');
  }

  function toggleRouteCard(key) {
    if (selectedRouteType === key) {
      selectedRouteType = null;
      routePanel.classList.remove('is-open');
      renderRouteCards();
      return;
    }

    selectedRouteType = key;
    const type = ROUTE_TYPES.filter(function (t) { return t.key === key; })[0];

    routePanelTitle.textContent = 'New ' + type.label + ' Route';
    routeAddressGroup.classList.toggle('hidden', !type.rented);
    if (type.rented) syncRouteAddressOptions(type.family);
    syncRouteInstanceOptions();
    routeProtocolSelect.value = 'tcp';
    routePortInput.value = '';
    routeWhitelistInput.value = '';
    routeBlacklistInput.value = '';
    hideBanner(routePanelBanner);
    routePanel.classList.add('is-open');
    renderRouteCards();
  }

  const ROUTE_REASON_TEXT = {
    instance_has_direct_binding: 'That instance already has a direct custom IP bound on its own page — clear it there first.',
    address_not_held: 'That address is not one you rent anymore.',
    port_in_use: 'That port is already routed on this address.',
    invalid_port_range: 'Pick a port between 1 and 65535.',
    unknown_instance: 'Pick a valid target instance.',
  };

  function routeReasonText(result) {
    const reason = result.data && result.data.reason;
    return ROUTE_REASON_TEXT[reason] || reason || 'Failed to save the route.';
  }

  routeForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!selectedRouteType) return;
    const type = ROUTE_TYPES.filter(function (t) { return t.key === selectedRouteType; })[0];
    const instanceId = routeInstanceSelect.value;
    const port = parseInt(routePortInput.value, 10);
    if (!instanceId || !Number.isInteger(port)) return;
    if (type.rented && !routeAddressSelect.value) return;

    routeSubmit.disabled = true;
    routeSubmit.textContent = 'Creating…';
    hideBanner(routePanelBanner);

    const result = await RouteApi.create(session.userId, {
      instance_id: Number(instanceId),
      rented_address_id: type.rented ? Number(routeAddressSelect.value) : null,
      protocol: routeProtocolSelect.value,
      port_start: port,
      whitelist: linesToList(routeWhitelistInput.value),
      blacklist: linesToList(routeBlacklistInput.value),
    });

    routeSubmit.disabled = false;
    routeSubmit.textContent = 'Create';

    if (!result.ok) {
      showBanner(routePanelBanner, routeReasonText(result), true);
      return;
    }

    selectedRouteType = null;
    routePanel.classList.remove('is-open');
    renderRouteCards();
    loadAll();
  });

  // ── routes table ──
  const routesBody = document.getElementById('routesBody');

  function renderRouteRow(route) {
    const tr = document.createElement('tr');
    const portLabel = route.port_start === route.port_end
      ? String(route.port_start)
      : route.port_start + '-' + route.port_end;

    tr.innerHTML =
      '<td class="cell-mono">' + (route.rented_address_id == null ? 'Default' : 'Rented') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(FAMILY_LABELS[route.family] || route.family) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(route.address || '(node address)') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(route.protocol.toUpperCase()) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(portLabel) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(route.whitelist.join(', ') || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(route.blacklist.join(', ') || '—') + '</td>' +
      '<td class="cell-target"></td>' +
      '<td class="cell-enabled"></td>' +
      '<td class="cell-actions"></td>';

    const targetSelect = document.createElement('select');
    targetSelect.className = 'form-select';
    targetSelect.innerHTML = services.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === route.instance_id ? ' selected' : '') + '>' +
        escapeHtml(s.custom_name || serviceDisplayName(s.service_name)) + '</option>';
    }).join('');
    targetSelect.addEventListener('change', async function () {
      targetSelect.disabled = true;
      const result = await RouteApi.update(session.userId, route.id, { instance_id: Number(targetSelect.value) });
      if (!result.ok) showBanner(banner, routeReasonText(result), true);
      loadAll();
    });
    tr.querySelector('.cell-target').appendChild(targetSelect);

    const enabledToggle = document.createElement('input');
    enabledToggle.type = 'checkbox';
    enabledToggle.checked = route.enabled;
    enabledToggle.addEventListener('change', async function () {
      enabledToggle.disabled = true;
      const result = await RouteApi.update(session.userId, route.id, { enabled: enabledToggle.checked });
      if (!result.ok) showBanner(banner, 'Failed to update the route.', true);
      loadAll();
    });
    tr.querySelector('.cell-enabled').appendChild(enabledToggle);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async function () {
      if (!window.confirm('Delete this route? This cannot be undone.')) return;
      deleteBtn.disabled = true;
      const result = await RouteApi.release(session.userId, route.id);
      if (!result.ok) {
        showBanner(banner, 'Failed to delete the route.', true);
        deleteBtn.disabled = false;
        return;
      }
      loadAll();
    });
    tr.querySelector('.cell-actions').appendChild(deleteBtn);

    return tr;
  }

  async function loadRoutes() {
    const result = await RouteApi.list(session.userId);
    if (!result.ok) {
      routesBody.innerHTML = '<tr class="empty-row"><td colspan="10">Couldn’t load routes.</td></tr>';
      return;
    }

    const routes = (result.data && result.data.routes) || [];
    if (routes.length === 0) {
      routesBody.innerHTML = '<tr class="empty-row"><td colspan="10">No routes yet. Pick a type above to get started.</td></tr>';
      return;
    }

    routesBody.innerHTML = '';
    routes.forEach(function (route) {
      routesBody.appendChild(renderRouteRow(route));
    });
  }

  async function loadAll() {
    hideBanner(banner);
    const servicesResult = await BackendApi.listServices(session.userId);
    services = (servicesResult.ok && servicesResult.data && servicesResult.data.services) || [];

    await loadAddresses();
    renderRentCards();
    renderRouteCards();
    await loadRoutes();
  }

  (async function init() {
    await loadRegions();
    await loadAll();
  })();
})();
