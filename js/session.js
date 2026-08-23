// The session is the JWT itself, stored as-is. Nothing else is kept
// separately — username/role/user id are all read back out of the
// token's own payload, so there's nothing here that could drift out of
// sync with what the server actually issued.
const Session = {
  KEY: 'punkolink_token',

  save: function (token) {
    localStorage.setItem(Session.KEY, token);
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

  /** Returns { token, userId, role, username } for a valid, unexpired
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

    return { token: token, userId: claims.sub, role: claims.role, username: claims.username };
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
    tag.textContent = session.username + ' · ' + session.role;
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
