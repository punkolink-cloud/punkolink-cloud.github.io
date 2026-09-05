(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const RUN_SERVICES = ['run', 'run-linux', 'run-linux-1024'];

  const TYPE_TILES = [
    { key: 'database', label: 'Database', href: 'database.html' },
    { key: 'in-memory', label: 'In-memory', href: 'in-memory.html' },
    { key: 'document', label: 'Document', href: 'document.html' },
    { key: 'middleware', label: 'Middleware', href: 'middleware.html' },
    { key: 'drp', label: 'DRP Compute', href: 'drp.html' },
    { key: 'ipv4', label: 'IPv4 Addresses', href: 'network.html' },
    { key: 'ipv6', label: 'IPv6 Addresses', href: 'network.html' },
    // Anything with no category (e.g. meilisearch/qdrant instances,
    // still valid but not surfaced in any Workspace section) — shown
    // only when non-zero, and not clickable since there's nowhere to
    // send it.
    { key: 'other', label: 'Other', href: null },
  ];

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

  function renderTile(label, href, count) {
    const tag = href ? 'a' : 'div';
    const attrs = href ? ' href="' + escapeHtml(href) + '"' : '';
    return (
      '<' + tag + ' class="stat-tile"' + attrs + '>' +
        '<div class="stat-label">' + escapeHtml(label) + '</div>' +
        '<div class="stat-value">' + count + '</div>' +
      '</' + tag + '>'
    );
  }

  async function load() {
    const banner = document.getElementById('dashboardBanner');
    const [catalogResult, servicesResult, addressesResult] = await Promise.all([
      BackendApi.catalog(),
      BackendApi.listServices(session.userId),
      L3Api.list(session.userId, ''),
    ]);

    if (!catalogResult.ok || !servicesResult.ok) {
      showBanner(banner, 'Couldn’t load account state. Is the backend running?', true);
      return;
    }

    const categoryByName = {};
    ((catalogResult.data && catalogResult.data.services) || []).forEach(function (entry) {
      categoryByName[entry.name] = entry.category;
    });

    const services = (servicesResult.data && servicesResult.data.services) || [];
    const addresses = (addressesResult.ok && addressesResult.data && addressesResult.data.addresses) || [];

    document.getElementById('statTotalServices').textContent = services.length;
    document.getElementById('statActiveServices').textContent =
      services.filter(function (s) { return s.status === 'active'; }).length;
    document.getElementById('statAddresses').textContent = addresses.length;

    const counts = { database: 0, 'in-memory': 0, document: 0, middleware: 0, drp: 0, ipv4: 0, ipv6: 0, other: 0 };

    services.forEach(function (s) {
      if (RUN_SERVICES.indexOf(s.service_name) !== -1) {
        counts.drp += 1;
        return;
      }
      const category = categoryByName[s.service_name];
      if (category && counts.hasOwnProperty(category)) {
        counts[category] += 1;
      } else {
        counts.other += 1;
      }
    });

    addresses.forEach(function (a) {
      if (a.family === 'ipv4' || a.family === 'ipv6') counts[a.family] += 1;
    });

    const byTypeRow = document.getElementById('byTypeRow');
    byTypeRow.innerHTML = TYPE_TILES
      .filter(function (tile) { return tile.key !== 'other' || counts.other > 0; })
      .map(function (tile) { return renderTile(tile.label, tile.href, counts[tile.key]); })
      .join('');
  }

  load();
})();
