(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const banner = document.getElementById('financeBanner');
  const balanceValueEl = document.getElementById('balanceValue');
  const packageGrid = document.getElementById('packageGrid');

  let startingBalance = null;

  function showBanner(message, isError) {
    banner.textContent = message;
    banner.classList.add('visible');
    banner.classList.toggle('success', !isError);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  async function loadBalance() {
    const result = await AuthApi.account(session.userId);
    if (!result.ok) return null;
    const balance = (result.data && result.data.balance) || 0;
    balanceValueEl.innerHTML = balance + '<span class="unit">units</span>';
    return balance;
  }

  function renderPackages(packages) {
    if (packages.length === 0) {
      packageGrid.innerHTML = '<div class="loading-row">No credit packages configured.</div>';
      return;
    }

    packageGrid.innerHTML = '';
    packages.forEach(function (pkg) {
      const card = document.createElement('div');
      card.className = 'package-card';

      const configured = !!pkg.price_id;

      card.innerHTML =
        '<div class="package-label">' + escapeHtml(pkg.label) + '</div>' +
        '<div class="package-credits">' + escapeHtml(pkg.credits) + '<span class="unit">credits</span></div>';

      const buyBtn = document.createElement('button');
      buyBtn.className = 'btn btn-primary btn-block';
      buyBtn.textContent = configured ? 'Buy' : 'Not available yet';
      buyBtn.disabled = !configured;
      buyBtn.addEventListener('click', function () {
        openCheckout(pkg);
      });

      card.appendChild(buyBtn);
      packageGrid.appendChild(card);
    });
  }

  function openCheckout(pkg) {
    if (typeof Paddle === 'undefined') {
      showBanner('Paddle failed to load. Check your connection and try again.', true);
      return;
    }

    Paddle.Checkout.open({
      items: [{ priceId: pkg.price_id, quantity: 1 }],
      customData: { user_id: String(session.userId) },
    });
  }

  /** Credits are applied by the backend once Paddle's webhook confirms
   *  the payment, not by anything on this page — so once checkout
   *  reports success, poll the balance for a little while and report
   *  once it actually moves, instead of pretending it's instant. */
  function watchForCredit() {
    showBanner('Payment received — crediting your balance…', false);

    let attempts = 0;
    const poll = setInterval(async function () {
      attempts += 1;
      const balance = await loadBalance();

      if (balance !== null && startingBalance !== null && balance > startingBalance) {
        clearInterval(poll);
        showBanner('Credits added. New balance: ' + balance + '.', false);
        return;
      }

      if (attempts >= 15) {
        clearInterval(poll);
        showBanner('Payment received. It’s taking longer than usual to reflect — refresh in a moment.', false);
      }
    }, 2000);
  }

  function onPaddleEvent(event) {
    if (event.name === 'checkout.completed') {
      watchForCredit();
    }
  }

  async function init() {
    startingBalance = await loadBalance();
    if (startingBalance === null) {
      showBanner('Couldn’t load account. Is the auth service running?', true);
    }

    const configResult = await AuthApi.paddleConfig();
    if (!configResult.ok) {
      showBanner('Couldn’t load the Paddle configuration. Is the auth service running?', true);
      packageGrid.innerHTML = '<div class="loading-row">Unavailable.</div>';
      return;
    }

    const config = configResult.data || {};
    const packages = config.packages || [];
    renderPackages(packages);

    if (!config.client_token) {
      showBanner('Paddle isn’t configured yet (missing client token) — purchases are disabled for now.', true);
      return;
    }

    if (config.environment === 'sandbox') {
      Paddle.Environment.set('sandbox');
    }
    Paddle.Initialize({ token: config.client_token, eventCallback: onPaddleEvent });
  }

  init();
})();
