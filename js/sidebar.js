// Left workspace switcher shared by every authenticated page: Managed
// Services / L7 / DRP. The markup lives in each page's HTML — this only
// wires the toggle button. Two behaviours, picked by viewport:
//   • desktop  — collapse to an icon rail, remembered in localStorage
//   • ≤640px   — slide in/out as an off-canvas drawer over a backdrop
(function () {
  var STORAGE_KEY = 'punkolink_sidebar_collapsed';
  var MOBILE_MQ = '(max-width: 640px)';

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('sidebarToggle');
    var sidebar = document.getElementById('appSidebar');
    var backdrop = document.getElementById('sidebarBackdrop');
    if (!toggle || !sidebar) return;

    var mobileQuery = window.matchMedia(MOBILE_MQ);

    function isMobile() {
      return mobileQuery.matches;
    }

    function openDrawer() {
      sidebar.classList.add('is-open');
      if (backdrop) backdrop.classList.add('is-open');
    }

    function closeDrawer() {
      sidebar.classList.remove('is-open');
      if (backdrop) backdrop.classList.remove('is-open');
    }

    function setCollapsed(collapsed) {
      document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
      try {
        localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
      } catch (e) {}
    }

    toggle.addEventListener('click', function () {
      if (isMobile()) {
        if (sidebar.classList.contains('is-open')) closeDrawer();
        else openDrawer();
      } else {
        setCollapsed(!document.documentElement.classList.contains('sidebar-collapsed'));
      }
    });

    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    // On mobile, choosing a destination should get the drawer out of the way.
    sidebar.addEventListener('click', function (e) {
      if (isMobile() && e.target.closest('.sidebar-link')) closeDrawer();
    });

    // Growing back past the breakpoint with the drawer open would otherwise
    // strand the backdrop over the page.
    var onBreakpointChange = function (e) {
      if (!e.matches) closeDrawer();
    };
    if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onBreakpointChange);
    else if (mobileQuery.addListener) mobileQuery.addListener(onBreakpointChange);
  });
})();
