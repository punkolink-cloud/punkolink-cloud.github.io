// Every request goes through the reverse proxy on this single host,
// which forwards each path to whichever microservice actually owns it.
// The client has no notion of "auth service" vs "backend service"
// anymore — just one API.
const API_BASE = window.PUNKOLINK_API_BASE || 'https://gc-25.europe-central2-a.network.punkolink.com';

/**
 * Thin fetch wrapper: builds the URL, always sends/expects JSON unless
 * told otherwise, attaches the logged-in user's JWT if one exists, and
 * normalizes the result to { ok, status, data } instead of throwing on
 * non-2xx (every route in this API returns a JSON body on error too, so
 * callers almost always want that body).
 */
async function apiRequest(path, options) {
  options = options || {};
  const init = {
    method: options.method || 'GET',
    headers: Object.assign({}, options.headers),
  };

  // Session is defined in session.js, loaded alongside this file on
  // every page; register/login run before a session exists, so there's
  // simply no token to attach yet for those calls.
  const session = typeof Session !== 'undefined' ? Session.get() : null;
  if (session && !init.headers.Authorization) {
    init.headers.Authorization = 'Bearer ' + session.token;
  }

  if (options.body !== undefined) {
    if (options.raw) {
      init.body = options.body;
    } else if (options.form) {
      init.body = options.body; // FormData sets its own Content-Type
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
  }

  let response;
  try {
    response = await fetch(API_BASE + path, init);
  } catch (err) {
    return { ok: false, status: 0, data: null, networkError: true };
  }

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.indexOf('application/json') !== -1) {
    data = await response.json().catch(function () { return null; });
  } else {
    data = await response.text().catch(function () { return null; });
  }

  return { ok: response.ok, status: response.status, data: data };
}

const AuthApi = {
  register: function (email, password) {
    return apiRequest('/register', { method: 'POST', body: { email: email, password: password } });
  },
  login: function (email, password) {
    return apiRequest('/login', { method: 'POST', body: { email: email, password: password } });
  },
  account: function (userId) {
    return apiRequest('/account/' + userId, { method: 'GET' });
  },
  stripeCheckout: function (quantity) {
    return apiRequest('/stripe/checkout', { method: 'POST', body: { quantity: quantity } });
  },
};

const BackendApi = {
  catalog: function () {
    return apiRequest('/catalog', { method: 'GET' });
  },
  listServices: function (userId) {
    return apiRequest('/services/' + userId, { method: 'GET' });
  },
  // Placement (which region a new instance lands in) is entirely the
  // backend's call — the console never asks, so there's no regionName
  // parameter here to pass one.
  createService: function (serviceName, userId, customName, envText, parentInstanceId) {
    return apiRequest('/services/' + encodeURIComponent(serviceName) + '/' + userId, {
      method: 'POST',
      body: {
        custom_name: customName || null,
        env: envText || null,
        parent_instance_id: parentInstanceId || null,
      },
    });
  },
  deleteService: function (serviceName, userId, id) {
    return apiRequest('/services/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'DELETE' });
  },
  launchService: function (serviceName, userId, id) {
    return apiRequest('/launch/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'POST' });
  },
  stopService: function (serviceName, userId, id) {
    return apiRequest('/stop/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'POST' });
  },
  setEnv: function (serviceName, userId, id, envText) {
    return apiRequest('/env/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'POST', body: envText, raw: true, headers: { 'Content-Type': 'text/plain' } });
  },
  setSettings: function (serviceName, userId, id, onExit, restartDelaySeconds, startCommand) {
    return apiRequest('/settings/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, {
      method: 'POST',
      body: { on_exit: onExit, restart_delay_seconds: restartDelaySeconds || 15, start_command: startCommand || null },
    });
  },
  setNetwork: function (serviceName, userId, id, customIp, port) {
    return apiRequest('/network/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, {
      method: 'POST',
      body: { custom_ip: customIp || null, port: port != null ? Number(port) : null },
    });
  },
  uploadPayload: function (serviceName, userId, id, file) {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest('/payload/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'POST', body: formData, form: true });
  },
};

// L3 — rented IPv4/IPv6 addresses. The address pool lives on a DRP node;
// the orchestrator tracks which ones an account holds and bills for
// them. Region is never the console's concern — every call here omits
// it and gets the backend's own pick.
const L3Api = {
  list: function (userId) {
    return apiRequest('/addresses/' + userId, { method: 'GET' });
  },
  rent: function (userId, family) {
    return apiRequest('/addresses/' + userId, { method: 'POST', body: { family: family } });
  },
  release: function (userId, id) {
    return apiRequest('/addresses/' + userId + '/' + id, { method: 'DELETE' });
  },
};

// Executable — the user's own catalog of uploaded binaries/Node.js
// projects, kept independent of any one DRP instance. Upload once, Host
// as many times as wanted.
const ExecutableApi = {
  list: function (userId) {
    return apiRequest('/executables/' + userId, { method: 'GET' });
  },
  upload: function (userId, name, file) {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('file', file);
    return apiRequest('/executables/' + userId, { method: 'POST', body: formData, form: true });
  },
  remove: function (userId, id) {
    return apiRequest('/executables/' + userId + '/' + id, { method: 'DELETE' });
  },
};

// Run — one DRP container running exactly one Executable, with full
// control over env vars, port ranges, IP, and crash policy, all at
// creation time.
const RunApi = {
  create: function (userId, options) {
    return apiRequest('/run/' + userId, { method: 'POST', body: options });
  },
};

// Isolated Linux environment — a persistent Ubuntu box with SSH access.
const LinuxApi = {
  create: function (userId, options) {
    return apiRequest('/linux/' + userId, { method: 'POST', body: options });
  },
};

// L3 — network routes: each rented address's single route (its
// protocol/port/ACL and which of the user's own instances it forwards
// to), enforced on the target's DRP node via iptables. Unified with the
// address itself: GET /routes returns every held address, each already
// carrying its route (or null if it hasn't been configured yet).
const RouteApi = {
  list: function (userId) {
    return apiRequest('/routes/' + userId, { method: 'GET' });
  },
  // Creates the address's route if it doesn't have one yet, otherwise
  // replaces its configuration wholesale — one call either way.
  update: function (userId, addressId, body) {
    return apiRequest('/routes/' + userId + '/addresses/' + addressId, { method: 'POST', body: body });
  },
};
