(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const banner = document.getElementById('billingBanner');
  const balanceValueEl = document.getElementById('balanceValue');
  const packLoading = document.getElementById('packLoading');
  const packCard = document.getElementById('packCard');
  const packSizeEl = document.getElementById('packSize');
  const packQuantityEl = document.getElementById('packQuantity');
  const packTotalEl = document.getElementById('packTotal');
  const buyBtn = document.getElementById('buyBtn');
  const buyBtnStripe = document.getElementById('buyBtnStripe');

  // The exact picocredit balance, as a BigInt — used only to detect
  // "did this actually go up yet", never for display (the formatted
  // `balance` string from the API is what's shown).
  let startingBalanceRaw = null;
  let creditsPerPack = 5;
  let packPriceId = null;

  function showBanner(message, isError) {
    banner.textContent = message;
    banner.classList.add('visible');
    banner.classList.toggle('success', !isError);
  }

  function currentQuantity() {
    const quantity = parseInt(packQuantityEl.value, 10);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function updateTotal() {
    packTotalEl.textContent = currentQuantity() * creditsPerPack;
  }

  async function loadBalance() {
    const result = await AuthApi.account(session.userId);
    if (!result.ok) return null;
    const data = result.data || {};
    balanceValueEl.innerHTML = (data.balance || '0.00000') + '<span class="unit">credits</span>';
    return data.balance_picocredits || null;
  }

  function openCheckout() {
    if (typeof Paddle === 'undefined') {
      showBanner('Paddle failed to load. Check your connection and try again.', true);
      return;
    }

    Paddle.Checkout.open({
      items: [{ priceId: packPriceId, quantity: currentQuantity() }],
      customData: { user_id: String(session.userId) },
    });
  }

  /** Credits are applied by the backend once Paddle's webhook confirms
   *  the payment, not by anything on this page — so once checkout
   *  reports success, poll the balance for a little while and report
   *  once it actually moves, instead of pretending it's instant. Raw
   *  picocredit strings compare exactly via BigInt — a plain Number
   *  comparison would silently lose precision above ~9007 credits. */
  function watchForCredit() {
    showBanner('Payment received — crediting your balance…', false);

    let attempts = 0;
    const poll = setInterval(async function () {
      attempts += 1;
      const rawBalance = await loadBalance();

      if (rawBalance !== null && startingBalanceRaw !== null && BigInt(rawBalance) > BigInt(startingBalanceRaw)) {
        clearInterval(poll);
        showBanner('Credits added.', false);
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

  /** Stripe path: the backend creates a hosted Checkout Session and hands
   *  back its URL — we just redirect there, no Stripe.js needed. The
   *  current raw balance is stashed before leaving so that, on return,
   *  watchForCredit() has the balance from *before* checkout as its
   *  baseline even if Stripe's webhook already credited it by the time
   *  this page reloads (a real race for a full-page redirect flow, unlike
   *  Paddle's overlay). */
  async function openStripeCheckout() {
    try {
      sessionStorage.setItem('stripeCheckoutStartingBalance', startingBalanceRaw || '');
    } catch (err) {
      // sessionStorage unavailable — the success-page comparison below
      // just falls back to a fresh balance reading in that case.
    }

    const result = await AuthApi.stripeCheckout(currentQuantity());
    if (!result.ok || !result.data || !result.data.url) {
      showBanner('Could not start Stripe checkout.', true);
      return;
    }
    window.location.href = result.data.url;
  }

  /** Handles landing back on this page after a Stripe redirect (see
   *  success_url/cancel_url in stripe_service::create_checkout_session).
   *  Runs once per load; strips the query param afterward so a refresh
   *  doesn't re-trigger it. */
  function handleStripeRedirectReturn() {
    const params = new URLSearchParams(window.location.search);
    const stripeResult = params.get('stripe');
    if (!stripeResult) return;

    window.history.replaceState({}, '', window.location.pathname);

    if (stripeResult === 'success') {
      let stashedBalance = null;
      try {
        stashedBalance = sessionStorage.getItem('stripeCheckoutStartingBalance');
        sessionStorage.removeItem('stripeCheckoutStartingBalance');
      } catch (err) {
        // ignore — watchForCredit() falls back to the fresh reading below
      }
      if (stashedBalance) startingBalanceRaw = stashedBalance;
      watchForCredit();
    } else if (stripeResult === 'cancel') {
      showBanner('Checkout cancelled.', true);
    }
  }

  async function init() {
    startingBalanceRaw = await loadBalance();
    if (startingBalanceRaw === null) {
      showBanner('Couldn’t load account. Is the auth service running?', true);
    }

    const configResult = await AuthApi.paddleConfig();
    if (!configResult.ok) {
      showBanner('Couldn’t load the Paddle configuration. Is the auth service running?', true);
      packLoading.textContent = 'Unavailable.';
      return;
    }

    const config = configResult.data || {};
    creditsPerPack = config.credits_per_pack || 5;
    packPriceId = config.pack_price_id || '';
    packSizeEl.textContent = creditsPerPack;
    updateTotal();

    packLoading.classList.add('hidden');
    packCard.classList.remove('hidden');

    // Stripe's test path is wired up independently of Paddle's own
    // config/token checks below, so it keeps working for testing even
    // while Paddle itself is unconfigured (as it currently is).
    buyBtnStripe.addEventListener('click', openStripeCheckout);
    handleStripeRedirectReturn();

    if (!config.client_token || !packPriceId) {
      showBanner('Paddle isn’t configured yet — purchases are disabled for now.', true);
      buyBtn.disabled = true;
      buyBtn.textContent = 'Not available yet';
      return;
    }

    if (config.environment === 'sandbox') {
      Paddle.Environment.set('sandbox');
    }
    Paddle.Initialize({ token: config.client_token, eventCallback: onPaddleEvent });

    packQuantityEl.addEventListener('input', updateTotal);
    buyBtn.addEventListener('click', openCheckout);
  }

  init();
})();
