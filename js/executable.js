(function () {
  const session = Session.requireAuth();
  if (!session) return;

  const KIND_LABELS = { binary: 'Binary', node_zip: 'Node.js project' };
  const UPLOAD_CARDS = [
    { kind: 'binary', label: 'Binary', hint: 'Uploaded as-is' },
    { kind: 'node_zip', label: 'Node.js project', hint: 'Uploaded as a .zip archive' },
  ];

  const SERVICE_LABELS = { run: 'Run', 'run-linux': 'Small Isolated Linux', 'run-linux-1024': 'Medium Isolated Linux' };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function showBanner(el, message, isError) {
    el.textContent = message;
    el.classList.add('visible');
    el.classList.toggle('success', !isError);
  }

  function hideBanner(el) {
    el.classList.remove('visible');
  }

  const execBanner = document.getElementById('execBanner');
  const tbody = document.getElementById('execBody');
  const countEl = document.getElementById('execCount');

  let executables = [];

  function usedByText(usedBy) {
    if (!usedBy || usedBy.length === 0) return '—';
    return usedBy
      .map(function (u) { return u.custom_name || SERVICE_LABELS[u.service_name] || u.service_name; })
      .join(', ');
  }

  // ── table ──

  function renderRow(executable) {
    const tr = document.createElement('tr');
    tr.dataset.id = executable.id;

    tr.innerHTML =
      '<td>' + escapeHtml(executable.name) + '</td>' +
      '<td>' + escapeHtml(KIND_LABELS[executable.kind] || executable.kind) + '</td>' +
      '<td class="cell-mono">' + escapeHtml(executable.file_name) + '</td>' +
      '<td>' + escapeHtml(usedByText(executable.used_by)) + '</td>' +
      '<td class="cell-actions"></td>';

    const actionsCell = tr.querySelector('.cell-actions');

    const hostLink = document.createElement('a');
    hostLink.className = 'btn btn-secondary btn-sm';
    hostLink.textContent = 'Host as Run';
    hostLink.href = 'drp.html?host_executable_id=' + encodeURIComponent(executable.id);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger btn-sm';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function () { removeExecutable(executable, tr); });

    actionsCell.appendChild(hostLink);
    actionsCell.appendChild(removeBtn);

    return tr;
  }

  async function removeExecutable(executable, row) {
    if (!window.confirm('Remove ' + executable.name + '? Anything already hosted on DRP keeps running, but you won’t be able to host it again.')) return;
    row.style.opacity = '0.5';
    const result = await ExecutableApi.remove(session.userId, executable.id);
    if (!result.ok) {
      showBanner(execBanner, 'Failed to remove.', true);
      row.style.opacity = '';
      return;
    }
    loadExecutables();
  }

  async function loadExecutables() {
    hideBanner(execBanner);
    const result = await ExecutableApi.list(session.userId);
    if (!result.ok) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Couldn’t load executables. Is the backend running?</td></tr>';
      countEl.textContent = '';
      return;
    }

    executables = (result.data && result.data.executables) || [];
    countEl.textContent = executables.length + (executables.length === 1 ? ' executable' : ' executables');

    if (executables.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Nothing uploaded yet. Upload a binary or a Node.js project above to get started.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    executables.forEach(function (executable) {
      tbody.appendChild(renderRow(executable));
    });
  }

  // ── upload CTA ──

  const cardsEl = document.getElementById('uploadCards');
  const uploadPanel = document.getElementById('uploadPanel');
  const uploadPanelTitle = document.getElementById('uploadPanelTitle');
  const uploadPanelHint = document.getElementById('uploadPanelHint');
  const uploadPanelBanner = document.getElementById('uploadPanelBanner');
  const nameInput = document.getElementById('execNameInput');
  const fileLabel = document.getElementById('execFileLabel');
  const fileInput = document.getElementById('execFileInput');
  const fileHint = document.getElementById('execFileHint');
  const uploadForm = document.getElementById('uploadForm');
  const uploadSubmit = document.getElementById('uploadSubmit');

  let selectedKind = null;

  function renderCards() {
    cardsEl.innerHTML = '';
    UPLOAD_CARDS.forEach(function (card) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'service-card' + (card.kind === selectedKind ? ' active' : '');
      btn.innerHTML =
        '<div class="service-card-name">' + escapeHtml(card.label) + '</div>' +
        '<div class="service-card-hint">' + escapeHtml(card.hint) + '</div>';
      btn.addEventListener('click', function () { toggleCard(card.kind); });
      cardsEl.appendChild(btn);
    });
  }

  function openPanelFor(kind) {
    selectedKind = kind;
    renderCards();
    const isNode = kind === 'node_zip';
    uploadPanelTitle.textContent = 'Upload ' + (isNode ? 'a Node.js project' : 'a binary');
    uploadPanelHint.textContent = isNode
      ? 'Zip your project (package.json at the root) and upload the .zip here.'
      : 'Upload the compiled executable file itself — no archive needed.';
    fileLabel.textContent = isNode ? 'Node.js project (.zip)' : 'Binary file';
    fileInput.accept = isNode ? '.zip' : '';
    fileHint.textContent = isNode
      ? 'Must be a .zip archive.'
      : 'Anything other than a .zip is treated as a binary.';
    nameInput.value = '';
    fileInput.value = '';
    hideBanner(uploadPanelBanner);
    uploadPanel.classList.add('is-open');
  }

  function closePanel() {
    selectedKind = null;
    renderCards();
    uploadPanel.classList.remove('is-open');
  }

  function toggleCard(kind) {
    if (selectedKind === kind) {
      closePanel();
    } else {
      openPanelFor(kind);
    }
  }

  uploadForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!selectedKind) return;

    const file = fileInput.files[0];
    if (!file) return;

    const isZip = /\.zip$/i.test(file.name);
    if (selectedKind === 'node_zip' && !isZip) {
      showBanner(uploadPanelBanner, 'A Node.js project has to be uploaded as a .zip archive.', true);
      return;
    }
    if (selectedKind === 'binary' && isZip) {
      showBanner(uploadPanelBanner, 'That looks like a .zip — use the Node.js project card instead.', true);
      return;
    }

    uploadSubmit.disabled = true;
    uploadSubmit.textContent = 'Uploading…';
    hideBanner(uploadPanelBanner);

    const result = await ExecutableApi.upload(session.userId, nameInput.value.trim(), file);

    uploadSubmit.disabled = false;
    uploadSubmit.textContent = 'Upload';

    if (!result.ok) {
      const reason = (result.data && (result.data.message || result.data.reason)) || 'Failed to upload.';
      showBanner(uploadPanelBanner, reason, true);
      return;
    }

    closePanel();
    loadExecutables();
  });

  renderCards();
  loadExecutables();
})();
