(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const banner = document.getElementById('l3Banner');

  const FAMILY_LABELS = { ipv4: 'IPv4', ipv6: 'IPv6' };
  const SERVICE_DISPLAY_NAMES = {
    postgres: 'PostgreSQL', pgvector: 'pgvector', 'apache-age': 'Apache AGE', paradedb: 'ParadeDB',
    valkey: 'Valkey', seaweedfs: 'SeaweedFS',
    run: 'Run', 'run-linux': 'Isolated Linux',
    l7: 'L7', nginx: 'Nginx',
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

  function linesToList(text) {
    return text.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  }

  const ROUTE_REASON_TEXT = {
    instance_has_direct_binding: 'That instance already has a direct custom IP bound on its own page — clear it there first.',
    address_not_held: 'That address is not one you rent anymore.',
    port_in_use: 'That port range overlaps another route already on this address.',
    invalid_port_range: 'Pick a port (or range) between 1 and 65535.',
    unknown_instance: 'Pick a valid target instance.',
    unknown_route: 'That route no longer exists — reload the page.',
  };

  function routeReasonText(result, fallback) {
    const reason = result.data && result.data.reason;
    return ROUTE_REASON_TEXT[reason] || reason || fallback || 'Failed to save the route.';
  }

  let services = [];

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
    if (!selectedFamily) return;

    rentSubmit.disabled = true;
    rentSubmit.textContent = 'Renting…';
    hideBanner(rentPanelBanner);

    const result = await L3Api.rent(session.userId, selectedFamily);

    rentSubmit.disabled = false;
    rentSubmit.textContent = 'Rent';

    if (!result.ok) {
      const reason = (result.data && result.data.reason) || 'Failed to bind an address.';
      showBanner(
        rentPanelBanner,
        reason === 'no_addresses_available' ? 'No free addresses available right now.' : reason,
        true
      );
      return;
    }

    selectedFamily = null;
    rentPanel.classList.remove('is-open');
    renderRentCards();
    loadAll();
  });

  // ── unified table: one row per rented address, its route (if any)
  // inline-editable by expanding the row — same pattern as the
  // Database/In-memory/Document/DRP service tables. ──
  const tbody = document.getElementById('addressesBody');
  const ipCountEl = document.getElementById('ipCount');

  let expandedId = null;
  let expandedRowEl = null;

  function openRow(afterRow, trContent) {
    afterRow.parentNode.insertBefore(trContent, afterRow.nextSibling);
    const outer = trContent.querySelector('.row-detail-outer');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { outer.classList.add('is-open'); });
    });
    return trContent;
  }

  function attachRow(afterRow, trContent) {
    afterRow.parentNode.insertBefore(trContent, afterRow.nextSibling);
    trContent.querySelector('.row-detail-outer').classList.add('is-open');
    return trContent;
  }

  function closeRow(trContent) {
    return new Promise(function (resolve) {
      const outer = trContent.querySelector('.row-detail-outer');
      if (!outer) { trContent.remove(); resolve(); return; }
      outer.addEventListener('transitionend', function handler() {
        outer.removeEventListener('transitionend', handler);
        trContent.remove();
        resolve();
      });
      outer.classList.remove('is-open');
    });
  }

  // One address can carry several independent routes (each its own port
  // range, to the same or a different instance) -- this builds ONE
  // route's own form + Save/Delete, or (route === null) a blank
  // "add another route" form. Each is a fully self-contained DOM
  // subtree so several can coexist in the same expanded row without
  // their data-el lookups clobbering each other.
  function buildRouteForm(addressRow, route) {
    const wrapper = document.createElement('div');
    wrapper.className = 'section-card';

    const instanceOptions = services.filter(function (s) {
      // A route DNATs to the instance's own default binding -- one
      // already directly bound to a custom IP (the legacy per-service
      // Networking card) isn't listening there.
      return !s.custom_ip || (route && s.id === route.instance_id);
    });

    wrapper.innerHTML =
      '<h3>' + (route ? 'Route' : 'Add Another Route') + '</h3>' +
      '<div class="banner" data-el="banner"></div>' +
      '<form data-el="form">' +
        '<div class="form-group">' +
          '<label class="form-label">Routes To</label>' +
          '<select class="form-select" data-el="instance" required></select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Protocol</label>' +
          '<select class="form-select" data-el="protocol">' +
            '<option value="tcp">TCP</option>' +
            '<option value="udp">UDP</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Port <span class="optional">(or a range)</span></label>' +
          '<div class="port-grid" style="grid-template-columns: 1fr 1fr;">' +
            '<input class="form-input" type="number" min="1" max="65535" data-el="portStart" placeholder="Port" required>' +
            '<input class="form-input" type="number" min="1" max="65535" data-el="portEnd" placeholder="…through (optional)">' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Source IP Whitelist <span class="optional">(optional)</span></label>' +
          '<textarea class="form-textarea" rows="2" placeholder="One IP or CIDR per line" data-el="whitelist"></textarea>' +
          '<p class="form-hint">If set, only these sources reach it — the blacklist below is ignored.</p>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">Source IP Blacklist <span class="optional">(optional)</span></label>' +
          '<textarea class="form-textarea" rows="2" placeholder="One IP or CIDR per line" data-el="blacklist"></textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" style="display: flex; align-items: center; gap: var(--space-2); text-transform: none; letter-spacing: normal;">' +
            '<input type="checkbox" data-el="enabled"> Enabled' +
          '</label>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="submit" class="btn btn-primary btn-sm">' + (route ? 'Save' : 'Add Route') + '</button>' +
          (route ? '<button type="button" class="btn btn-danger btn-sm" data-el="deleteBtn">Delete</button>' : '') +
        '</div>' +
      '</form>';

    const el = {};
    wrapper.querySelectorAll('[data-el]').forEach(function (node) { el[node.getAttribute('data-el')] = node; });

    el.instance.innerHTML = instanceOptions.map(function (s) {
      return '<option value="' + s.id + '">' + escapeHtml(s.custom_name || serviceDisplayName(s.service_name)) + '</option>';
    }).join('');

    if (route) {
      el.instance.value = route.instance_id;
      el.protocol.value = route.protocol;
      el.portStart.value = route.port_start;
      el.portEnd.value = route.port_end !== route.port_start ? route.port_end : '';
      el.whitelist.value = route.whitelist.join('\n');
      el.blacklist.value = route.blacklist.join('\n');
      el.enabled.checked = route.enabled;
    } else {
      el.enabled.checked = true;
    }

    el.form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const portStart = parseInt(el.portStart.value, 10);
      if (!el.instance.value || !Number.isInteger(portStart)) return;
      const portEndRaw = el.portEnd.value.trim();

      const body = {
        instance_id: Number(el.instance.value),
        protocol: el.protocol.value,
        port_start: portStart,
        port_end: portEndRaw ? parseInt(portEndRaw, 10) : null,
        whitelist: linesToList(el.whitelist.value),
        blacklist: linesToList(el.blacklist.value),
        enabled: el.enabled.checked,
      };

      const submitBtn = el.form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      hideBanner(el.banner);

      const result = route
        ? await RouteApi.update(session.userId, route.id, body)
        : await RouteApi.add(session.userId, addressRow.address_id, body);

      submitBtn.disabled = false;

      if (!result.ok) {
        showBanner(el.banner, routeReasonText(result), true);
        return;
      }

      showBanner(el.banner, route ? 'Saved.' : 'Route added.', false);
      loadAll();
    });

    if (route && el.deleteBtn) {
      el.deleteBtn.addEventListener('click', async function () {
        if (!window.confirm('Remove this route? This cannot be undone.')) return;
        el.deleteBtn.disabled = true;
        const result = await RouteApi.remove(session.userId, route.id);
        if (!result.ok) {
          showBanner(el.banner, 'Failed to remove the route.', true);
          el.deleteBtn.disabled = false;
          return;
        }
        loadAll();
      });
    }

    return wrapper;
  }

  function buildDetailRow(addressRow) {
    const tr = document.createElement('tr');
    tr.className = 'row-detail';

    const td = document.createElement('td');
    td.colSpan = 6;
    const outer = document.createElement('div');
    outer.className = 'row-detail-outer';
    const inner = document.createElement('div');
    inner.className = 'row-detail-inner';
    const body = document.createElement('div');
    body.className = 'row-detail-body';

    addressRow.routes.forEach(function (route) {
      body.appendChild(buildRouteForm(addressRow, route));
    });
    body.appendChild(buildRouteForm(addressRow, null));

    inner.appendChild(body);
    outer.appendChild(inner);
    td.appendChild(outer);
    tr.appendChild(td);

    tr.addEventListener('click', function (e) { e.stopPropagation(); });

    return tr;
  }

  async function toggleExpand(addressRow, summaryTr) {
    if (expandedId === addressRow.address_id) {
      const closing = expandedRowEl;
      expandedId = null;
      expandedRowEl = null;
      if (closing) await closeRow(closing);
      return;
    }
    if (expandedRowEl) await closeRow(expandedRowEl);
    expandedId = addressRow.address_id;
    expandedRowEl = openRow(summaryTr, buildDetailRow(addressRow));
  }

  function renderSummaryRow(addressRow) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.dataset.id = addressRow.address_id;

    const routes = addressRow.routes;
    let routesTo = '<span class="cell-hint">Not configured</span>';
    let protoPort = '—';
    let status = '<span class="cell-hint">Idle</span>';

    if (routes.length === 1) {
      const route = routes[0];
      routesTo = escapeHtml(route.instance_custom_name || serviceDisplayName(route.instance_service_name));
      protoPort = escapeHtml(route.protocol.toUpperCase()) + ' :' + route.port_start +
        (route.port_end !== route.port_start ? '-' + route.port_end : '');
      status = route.enabled
        ? '<span class="status is-active"><span class="status-dot"></span>enabled</span>'
        : '<span class="status is-stopped"><span class="status-dot"></span>disabled</span>';
    } else if (routes.length > 1) {
      routesTo = routes.length + ' routes';
      protoPort = '<span class="cell-hint">see below</span>';
      const enabledCount = routes.filter(function (r) { return r.enabled; }).length;
      status = '<span class="status is-active"><span class="status-dot"></span>' + enabledCount + '/' + routes.length + ' enabled</span>';
    }

    tr.innerHTML =
      '<td class="cell-mono">' + escapeHtml(addressRow.address) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(FAMILY_LABELS[addressRow.family] || addressRow.family) + '</td>' +
      '<td>' + routesTo + '</td>' +
      '<td class="cell-mono">' + protoPort + '</td>' +
      '<td>' + status + '</td>' +
      '<td class="cell-actions"></td>';

    const releaseBtn = document.createElement('button');
    releaseBtn.className = 'btn btn-danger btn-sm';
    releaseBtn.textContent = 'Release';
    releaseBtn.addEventListener('click', async function (e) {
      e.stopPropagation();
      if (!window.confirm(
        'Release ' + addressRow.address + '?\n\nThis cannot be undone — the address goes back to the free pool, ' +
        'any route configured on it is torn down immediately, and someone else may rent it next.'
      )) return;

      releaseBtn.disabled = true;
      const result = await L3Api.release(session.userId, addressRow.address_id);
      if (!result.ok) {
        showBanner(banner, 'Failed to release the address.', true);
        releaseBtn.disabled = false;
        return;
      }
      if (expandedId === addressRow.address_id) {
        expandedId = null;
        expandedRowEl = null;
      }
      loadAll();
    });
    tr.querySelector('.cell-actions').appendChild(releaseBtn);

    tr.addEventListener('click', function () { toggleExpand(addressRow, tr); });

    return tr;
  }

  async function loadAll() {
    hideBanner(banner);

    const servicesResult = await BackendApi.listServices(session.userId);
    services = (servicesResult.ok && servicesResult.data && servicesResult.data.services) || [];

    const result = await RouteApi.list(session.userId);
    if (!result.ok) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Couldn’t load addresses. Is the backend running?</td></tr>';
      ipCountEl.textContent = '';
      renderRentCards();
      return;
    }

    const addresses = (result.data && result.data.addresses) || [];
    ipCountEl.textContent = addresses.length + (addresses.length === 1 ? ' address held' : ' addresses held');

    if (addresses.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No addresses held yet. Rent one above.</td></tr>';
      expandedId = null;
      expandedRowEl = null;
      renderRentCards();
      return;
    }

    tbody.innerHTML = '';
    let stillExpanded = null;
    addresses.forEach(function (addressRow) {
      const tr = renderSummaryRow(addressRow);
      tbody.appendChild(tr);
      if (addressRow.address_id === expandedId) stillExpanded = { addressRow: addressRow, tr: tr };
    });

    expandedRowEl = null;
    if (stillExpanded) {
      expandedRowEl = attachRow(stillExpanded.tr, buildDetailRow(stillExpanded.addressRow));
    } else {
      expandedId = null;
    }

    renderRentCards();
  }

  loadAll();
})();
