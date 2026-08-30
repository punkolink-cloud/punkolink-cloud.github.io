(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const banner = document.getElementById('l3Banner');
  const regionSelect = document.getElementById('regionSelect');
  const tbody = document.getElementById('ipsBody');
  const countEl = document.getElementById('ipCount');
  const rentBtn = document.getElementById('rentBtn');

  // Keep in step with auth's IP_PRICE_PER_MINUTE_PICOCREDITS — display only.
  const RATE_PER_MINUTE = '0.0000462963';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function showBanner(message, isError) {
    banner.textContent = message;
    banner.classList.add('visible');
    banner.classList.toggle('success', !isError);
  }

  function hideBanner() {
    banner.classList.remove('visible');
  }

  function currentRegion() {
    return regionSelect.value || '';
  }

  // "2026-08-30T12:34:56Z" / "2026-08-30 12:34:56+00" -> "2026-08-30 12:34"
  function shortTime(value) {
    if (!value) return '—';
    return String(value).replace('T', ' ').replace(/:\d\d(\.\d+)?(Z|[+-]\d\d.*)?$/, '');
  }

  async function loadRegions() {
    const result = await BackendApi.regions();
    const names = (result.ok && result.data && result.data.regions) || [];
    regionSelect.innerHTML = names
      .map(function (name) {
        return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
      })
      .join('');
    if (names.length === 0) {
      regionSelect.innerHTML = '<option value="">No regions</option>';
    }
  }

  function renderRow(ip) {
    const tr = document.createElement('tr');

    tr.innerHTML =
      '<td class="cell-mono">' + escapeHtml(ip.address) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(ip.region || '—') + '</td>' +
      '<td class="cell-mono">' + escapeHtml(shortTime(ip.assigned_at)) + '</td>' +
      '<td class="cell-actions"></td>';

    const releaseBtn = document.createElement('button');
    releaseBtn.className = 'btn btn-danger btn-sm';
    releaseBtn.textContent = 'Release';
    releaseBtn.addEventListener('click', function () {
      releaseAddress(ip, releaseBtn);
    });
    tr.querySelector('.cell-actions').appendChild(releaseBtn);

    return tr;
  }

  async function loadAddresses() {
    hideBanner();
    const region = currentRegion();

    const result = await L3Api.list(session.userId, region);
    if (!result.ok) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="4">Couldn’t load addresses.</td></tr>';
      countEl.textContent = '';
      rentBtn.disabled = true;
      return;
    }

    const data = result.data || {};
    const addresses = data.addresses || [];
    const available = data.available_count;

    countEl.textContent =
      addresses.length +
      (addresses.length === 1 ? ' address held' : ' addresses held') +
      (available != null ? ' · ' + available + ' free in region' : '');

    rentBtn.disabled = !(currentRegion() && available > 0);

    if (addresses.length === 0) {
      tbody.innerHTML =
        '<tr class="empty-row"><td colspan="4">No addresses held here yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    addresses.forEach(function (ip) {
      tbody.appendChild(renderRow(ip));
    });
  }

  async function rentAddress() {
    const region = currentRegion();
    if (!region) return;

    if (
      !window.confirm(
        'Bind a free IPv6 address in ' +
          region +
          ' to your account?\n\nBilling starts at the next minute tick, ' +
          RATE_PER_MINUTE +
          ' credits/minute, until you release it.'
      )
    ) {
      return;
    }

    rentBtn.disabled = true;
    rentBtn.textContent = 'Binding…';
    hideBanner();

    const result = await L3Api.rent(session.userId, region);

    rentBtn.textContent = 'Rent Address';

    if (!result.ok) {
      const reason = (result.data && result.data.reason) || 'Failed to bind an address.';
      showBanner(
        reason === 'no_addresses_available'
          ? 'No free addresses in this region.'
          : reason === 'unknown_region'
          ? 'That region is not known.'
          : reason,
        true
      );
      rentBtn.disabled = false;
      return;
    }

    loadAddresses();
  }

  async function releaseAddress(ip, button) {
    if (!window.confirm('Release ' + ip.address + '? Billing for it stops at the next tick.')) {
      return;
    }
    button.disabled = true;
    const result = await L3Api.release(session.userId, ip.id);
    if (!result.ok) {
      showBanner('Failed to release the address.', true);
      button.disabled = false;
      return;
    }
    loadAddresses();
  }

  regionSelect.addEventListener('change', loadAddresses);
  rentBtn.addEventListener('click', rentAddress);

  (async function init() {
    await loadRegions();
    loadAddresses();
  })();
})();
