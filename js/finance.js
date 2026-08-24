(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const banner = document.getElementById('financeBanner');
  const tbody = document.getElementById('chargesBody');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  async function load() {
    const result = await AuthApi.account(session.userId);

    if (!result.ok) {
      banner.textContent = 'Couldn’t load account. Is the auth service running?';
      banner.classList.add('visible');
      document.getElementById('balanceValue').textContent = '—';
      tbody.innerHTML = '<tr class="empty-row"><td colspan="3">Unavailable.</td></tr>';
      return;
    }

    const data = result.data || {};
    document.getElementById('balanceValue').innerHTML = data.balance + '<span class="unit">units</span>';

    const charges = data.charges || [];
    document.getElementById('chargeCount').textContent = charges.length;

    if (charges.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="3">No charges yet.</td></tr>';
      return;
    }

    tbody.innerHTML = charges.map(function (charge) {
      return '<tr>' +
        '<td>' + escapeHtml(charge.service_name) + '</td>' +
        '<td class="cell-mono">' + escapeHtml(charge.amount) + '</td>' +
        '<td class="cell-mono">' + escapeHtml(charge.charged_at) + '</td>' +
        '</tr>';
    }).join('');
  }

  load();
})();
