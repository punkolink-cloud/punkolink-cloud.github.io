(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const banner = document.getElementById('financeBanner');

  async function load() {
    const result = await AuthApi.account(session.userId);

    if (!result.ok) {
      banner.textContent = 'Couldn’t load account. Is the auth service running?';
      banner.classList.add('visible');
      document.getElementById('balanceValue').textContent = '—';
      return;
    }

    const data = result.data || {};
    document.getElementById('balanceValue').innerHTML = data.balance + '<span class="unit">units</span>';
  }

  load();
})();
