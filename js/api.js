// Base URLs for the two backend services. Edit these if you're not running
// everything on localhost with the default ports.
const AUTH_BASE = window.PUNKOLINK_AUTH_BASE || 'http://127.0.0.1:8081';
const BACKEND_BASE = window.PUNKOLINK_BACKEND_BASE || 'http://127.0.0.1:8080';

/**
 * Thin fetch wrapper: builds the URL, always sends/expects JSON unless
 * told otherwise, attaches the logged-in user's JWT if one exists, and
 * normalizes the result to { ok, status, data } instead of throwing on
 * non-2xx (every route in this API returns a JSON body on error too, so
 * callers almost always want that body).
 */
async function apiRequest(base, path, options) {
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
    response = await fetch(base + path, init);
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
  register: function (username, password) {
    return apiRequest(AUTH_BASE, '/register', { method: 'POST', body: { username: username, password: password } });
  },
  login: function (username, password) {
    return apiRequest(AUTH_BASE, '/login', { method: 'POST', body: { username: username, password: password } });
  },
  account: function (userId) {
    return apiRequest(AUTH_BASE, '/account/' + userId, { method: 'GET' });
  },
};

const BackendApi = {
  catalog: function () {
    return apiRequest(BACKEND_BASE, '/catalog', { method: 'GET' });
  },
  regions: function () {
    return apiRequest(BACKEND_BASE, '/regions', { method: 'GET' });
  },
  listServices: function (userId) {
    return apiRequest(BACKEND_BASE, '/services/' + userId, { method: 'GET' });
  },
  createService: function (serviceName, userId, regionName) {
    return apiRequest(BACKEND_BASE, '/services/' + encodeURIComponent(serviceName) + '/' + userId, { method: 'POST', body: { region_name: regionName } });
  },
  deleteService: function (serviceName, userId, id) {
    return apiRequest(BACKEND_BASE, '/services/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'DELETE' });
  },
  launchService: function (serviceName, userId, id) {
    return apiRequest(BACKEND_BASE, '/launch/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'POST' });
  },
  stopService: function (serviceName, userId, id) {
    return apiRequest(BACKEND_BASE, '/stop/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'POST' });
  },
  setEnv: function (serviceName, userId, envText) {
    return apiRequest(BACKEND_BASE, '/env/' + encodeURIComponent(serviceName) + '/' + userId, { method: 'POST', body: envText, raw: true, headers: { 'Content-Type': 'text/plain' } });
  },
  setSettings: function (serviceName, userId, onExit) {
    return apiRequest(BACKEND_BASE, '/settings/' + encodeURIComponent(serviceName) + '/' + userId, { method: 'POST', body: { on_exit: onExit } });
  },
  uploadPayload: function (serviceName, userId, file) {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest(BACKEND_BASE, '/payload/' + encodeURIComponent(serviceName) + '/' + userId, { method: 'POST', body: formData, form: true });
  },
};
