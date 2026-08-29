// The session is the JWT itself, stored as-is. Nothing else is kept
// separately — email/role/user id are all read back out of the
// token's own payload, so there's nothing here that could drift out of
// sync with what the server actually issued.
const Session = {
  KEY: 'punkolink_token',

  save: function (token) {
    localStorage.setItem(Session.KEY, token);
  },

  /** Google sign-in sends the user back to POST_LOGIN_REDIRECT with the
   *  freshly issued punkolink JWT in the URL *fragment* (`#token=<JWT>`).
   *  Call this once, early, on whichever page that redirect lands on:
   *  it stores the token via Session.save and then scrubs the fragment
   *  from the address bar and history so the JWT never lingers there.
   *  Must run BEFORE any Session.get()/requireAuth() check, or a
   *  just-authenticated visitor is bounced to login before the token is
   *  ever read. Returns true if a token was adopted. */
  adoptTokenFromHash: function () {
    const hash = window.location.hash || '';
    if (hash.indexOf('token=') === -1) return false;

    const params = new URLSearchParams(hash.charAt(0) === '#' ? hash.slice(1) : hash);
    const token = params.get('token');
    if (!token) return false;

    Session.save(token);

    // Rebuild the URL without the token fragment. replaceState keeps
    // this out of history so Back can't resurface the JWT.
    params.delete('token');
    const rest = params.toString();
    const clean = window.location.pathname + window.location.search + (rest ? '#' + rest : '');
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', clean);
    } else {
      window.location.hash = '';
    }
    return true;
  },

  /** Decodes a JWT's payload without verifying its signature — fine for
   *  display purposes; every real check happens server-side. */
  decode: function (token) {
    try {
      const payload = token.split('.')[1];
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64)
          .split('')
          .map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join('')
      );
      return JSON.parse(json);
    } catch (err) {
      return null;
    }
  },

  /** Returns { token, userId, role, email } for a valid, unexpired
   *  session, or null. */
  get: function () {
    const token = localStorage.getItem(Session.KEY);
    if (!token) return null;

    const claims = Session.decode(token);
    if (!claims) return null;

    if (claims.exp && Date.now() / 1000 > claims.exp) {
      Session.clear();
      return null;
    }

    return { token: token, userId: claims.sub, role: claims.role, email: claims.email };
  },

  clear: function () {
    localStorage.removeItem(Session.KEY);
  },

  /** Redirects to login and halts the caller if no session exists. */
  requireAuth: function () {
    const session = Session.get();
    if (!session) {
      window.location.href = 'login.html';
      return null;
    }
    return session;
  },
};

/** Fills in the shared header's user tag + logout button, if present. */
function renderNavUser() {
  const session = Session.get();
  const tag = document.getElementById('navUserTag');
  const logoutBtn = document.getElementById('navLogout');
  if (!tag || !logoutBtn) return;

  if (session) {
    tag.textContent = session.email + ' · ' + session.role;
    logoutBtn.classList.remove('hidden');
    logoutBtn.addEventListener('click', function (e) {
      e.preventDefault();
      Session.clear();
      window.location.href = 'login.html';
    });
  } else {
    tag.textContent = '';
    logoutBtn.classList.add('hidden');
  }
}

document.addEventListener('DOMContentLoaded', renderNavUser);
