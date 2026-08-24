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
  register: function (username, password) {
    return apiRequest('/register', { method: 'POST', body: { username: username, password: password } });
  },
  login: function (username, password) {
    return apiRequest('/login', { method: 'POST', body: { username: username, password: password } });
  },
  account: function (userId) {
    return apiRequest('/account/' + userId, { method: 'GET' });
  },
  paddleConfig: function () {
    return apiRequest('/paddle/config', { method: 'GET' });
  },
};

const BackendApi = {
  catalog: function () {
    return apiRequest('/catalog', { method: 'GET' });
  },
  regions: function () {
    return apiRequest('/regions', { method: 'GET' });
  },
  listServices: function (userId) {
    return apiRequest('/services/' + userId, { method: 'GET' });
  },
  createService: function (serviceName, userId, regionName, customName, envText) {
    return apiRequest('/services/' + encodeURIComponent(serviceName) + '/' + userId, {
      method: 'POST',
      body: { region_name: regionName, custom_name: customName || null, env: envText || null },
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
  setSettings: function (serviceName, userId, id, onExit) {
    return apiRequest('/settings/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'POST', body: { on_exit: onExit } });
  },
  uploadPayload: function (serviceName, userId, id, file) {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest('/payload/' + encodeURIComponent(serviceName) + '/' + userId + '/' + id, { method: 'POST', body: formData, form: true });
  },
};
