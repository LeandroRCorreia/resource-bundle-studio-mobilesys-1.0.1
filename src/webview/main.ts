// -----------------------------------------------------------------------------
//  Resource Bundle Studio — Webview Script
//  Runs inside the VS Code webview sandbox (no Node, no VSCode API).
//  Communicates with the extension host via acquireVsCodeApi().postMessage().
// -----------------------------------------------------------------------------

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface InitPayload {
  locales: string[];
  keys: string[];
  values: Record<string, Record<string, string>>;
  comments: Record<string, string>;
  referenceLocale: string;
  config: {
    highlightMissing: boolean;
    highlightSimilar: boolean;
    referenceLocale: string;
    keyGroupingSeparator: string;
    showStatisticsBar: boolean;
  };
}

interface WebviewMessage {
  type: string;
  payload: unknown;
}

// -- Bootstrap -----------------------------------------------------------------

const vscode = acquireVsCodeApi();

let state: InitPayload | null = null;
const selectedKeys = new Set<string>();
let filterText = '';
let showMissingOnly = false;
let treeViewEnabled = false;
let contextMenuTargetKey: string | null = null;
let editingCell: { key: string; locale: string } | null = null;

// -- DOM refs ------------------------------------------------------------------

const gridHead         = document.getElementById('grid-head')!;
const gridBody         = document.getElementById('grid-body')!;
const searchInput      = document.getElementById('search-input') as HTMLInputElement;
const toggleTree       = document.getElementById('toggle-tree') as HTMLInputElement;
const toggleMissing    = document.getElementById('toggle-missing') as HTMLInputElement;
const btnAdd           = document.getElementById('btn-add')! as HTMLButtonElement;
const btnRename        = document.getElementById('btn-rename')! as HTMLButtonElement;
const btnDuplicate     = document.getElementById('btn-duplicate')! as HTMLButtonElement;
const btnRemove        = document.getElementById('btn-remove')! as HTMLButtonElement;
const btnSort          = document.getElementById('btn-sort')! as HTMLButtonElement;
const btnRefresh       = document.getElementById('btn-refresh')! as HTMLButtonElement;
const contextMenu      = document.getElementById('context-menu')!;
const modalOverlay     = document.getElementById('modal-overlay')!;
const modalTitle       = document.getElementById('modal-title')!;
const modalBody        = document.getElementById('modal-body')!;
const modalOk          = document.getElementById('modal-ok') as HTMLButtonElement;
const modalCancel      = document.getElementById('modal-cancel') as HTMLButtonElement;
const statusKeys       = document.getElementById('status-keys')!;
const statusMissing    = document.getElementById('status-missing')!;
const statusFilter     = document.getElementById('status-filter')!;

// -- Message handler (extension → webview) -------------------------------------

window.addEventListener('message', (event: MessageEvent<WebviewMessage>) => { // NOSONAR typescript:S2819
  const { type, payload } = event.data;
  switch (type) {
    case 'init':
    case 'update':
      state = payload as InitPayload;
      renderGrid();
      break;
    case 'showError':
      showToast(payload as string, 'error');
      break;
    case 'showInfo':
      showToast(payload as string, 'info');
      break;
  }
});

// Signal readiness — extension will respond with 'init'
vscode.postMessage({ type: 'ready', payload: null });

// -- Grid renderer -------------------------------------------------------------

function renderGrid(): void { // NOSONAR typescript:S3776
  if (!state) { return; }

  const { locales, keys, values, comments, referenceLocale, config } = state;
  const sep = config.keyGroupingSeparator;

  // Apply filters
  const visibleKeys = keys.filter((key) => {
    const matchesFilter = filterText === '' ||
      key.toLowerCase().includes(filterText) ||
      locales.some((l) => (values[key]?.[l] ?? '').toLowerCase().includes(filterText));

    const hasMissing = locales.some((l) => (values[key]?.[l] ?? '').trim() === '');
    const matchesMissingFilter = !showMissingOnly || hasMissing;

    return matchesFilter && matchesMissingFilter;
  });

  // Compute stats
  let totalMissing = 0;
  for (const key of keys) {
    for (const locale of locales) {
      if ((values[key]?.[locale] ?? '').trim() === '') { totalMissing++; }
    }
  }

  // -- Header ----------------------------------------------------------------
  gridHead.innerHTML = '';
  const headRow = document.createElement('tr');

  // Checkbox select-all
  const thCheck = document.createElement('th');
  thCheck.className = 'col-check';
  const checkAll = document.createElement('input');
  checkAll.type = 'checkbox';
  checkAll.title = 'Select all';
  checkAll.addEventListener('change', () => {
    if (checkAll.checked) {
      visibleKeys.forEach((k) => selectedKeys.add(k));
    } else {
      selectedKeys.clear();
    }
    updateCheckboxes();
    updateToolbarState();
  });
  thCheck.appendChild(checkAll);
  headRow.appendChild(thCheck);

  // Key column
  const thKey = document.createElement('th');
  thKey.className = 'col-key';
  thKey.textContent = 'Key';
  thKey.dataset.sort = 'key';
  headRow.appendChild(thKey);

  // Locale columns
  for (const locale of locales) {
    const th = document.createElement('th');
    th.className = 'col-locale';
    th.dataset.locale = locale;

    const missingCount = keys.filter(
      (k) => (values[k]?.[locale] ?? '').trim() === ''
    ).length;

    th.innerHTML = `
      <span class="locale-label">${locale === '' ? '(default)' : locale}</span>
      ${locale === referenceLocale ? '<span class="badge badge-ref">ref</span>' : ''}
      ${missingCount > 0 && config.highlightMissing
        ? `<span class="badge badge-missing">${missingCount} missing</span>`
        : ''}
    `;
    headRow.appendChild(th);
  }

  // Comment column
  const thComment = document.createElement('th');
  thComment.className = 'col-comment';
  thComment.textContent = 'Comment';
  headRow.appendChild(thComment);

  gridHead.appendChild(headRow);

  // -- Body ------------------------------------------------------------------
  gridBody.innerHTML = '';

  if (treeViewEnabled) {
    renderTreeRows(visibleKeys, locales, values, comments, referenceLocale, config, sep);
  } else {
    renderFlatRows(visibleKeys, locales, values, comments, referenceLocale, config);
  }

  // -- Status bar ------------------------------------------------------------
  statusKeys.textContent = `${keys.length} key${keys.length === 1 ? '' : 's'}`;
  statusMissing.textContent = totalMissing > 0
    ? `⚠ ${totalMissing} missing`
    : '✓ Complete';
  statusMissing.className = totalMissing > 0 ? 'status-warn' : 'status-ok';
  statusFilter.textContent = filterText || showMissingOnly
    ? `Showing ${visibleKeys.length} of ${keys.length}`
    : '';

  updateToolbarState();
}

// -- Flat row renderer ---------------------------------------------------------

function renderFlatRows(
  keys: string[],
  locales: string[],
  values: Record<string, Record<string, string>>,
  comments: Record<string, string>,
  refLocale: string,
  config: InitPayload['config']
): void {
  for (const key of keys) {
    const tr = buildRow(key, locales, values, comments, refLocale, config, 0);
    tr.draggable = true;
    tr.dataset.key = key;
    attachDragHandlers(tr, key);
    gridBody.appendChild(tr);
  }
}

// -- Tree row renderer ---------------------------------------------------------

function renderTreeRows(
  keys: string[],
  locales: string[],
  values: Record<string, Record<string, string>>,
  comments: Record<string, string>,
  refLocale: string,
  config: InitPayload['config'],
  sep: string
): void {
  // Build prefix tree
  const groups = new Map<string, string[]>();
  for (const key of keys) {
    const parts = key.split(sep);
    const group = parts.length > 1 ? parts[0] : '';
    if (!groups.has(group)) { groups.set(group, []); }
    groups.get(group)!.push(key);
  }

  for (const [group, groupKeys] of groups) {
    if (group !== '') {
      // Group header row
      const groupRow = document.createElement('tr');
      groupRow.className = 'group-header-row';
      groupRow.innerHTML = `
        <td></td>
        <td class="group-header" colspan="${locales.length + 2}">
          <span class="group-icon">▾</span> ${escapeHtml(group)}
          <span class="group-count">${groupKeys.length}</span>
        </td>`;
      groupRow.addEventListener('click', () => toggleGroup(group, groupRow));
      gridBody.appendChild(groupRow);
    }

    for (const key of groupKeys) {
      const tr = buildRow(key, locales, values, comments, refLocale, config, group ? 1 : 0);
      tr.dataset.key = key;
      tr.dataset.group = group;
      tr.draggable = true;
      attachDragHandlers(tr, key);
      gridBody.appendChild(tr);
    }
  }
}

// -- Row builder ---------------------------------------------------------------

function buildRow(
  key: string,
  locales: string[],
  values: Record<string, Record<string, string>>,
  comments: Record<string, string>,
  refLocale: string,
  config: InitPayload['config'],
  indent: number
): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'data-row';
  if (selectedKeys.has(key)) { tr.classList.add('selected'); }

  // -- Checkbox --------------------------------------------------------------
  const tdCheck = document.createElement('td');
  tdCheck.className = 'col-check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selectedKeys.has(key);
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    if (checkbox.checked) { selectedKeys.add(key); tr.classList.add('selected'); }
    else { selectedKeys.delete(key); tr.classList.remove('selected'); }
    updateToolbarState();
  });
  tdCheck.appendChild(checkbox);
  tr.appendChild(tdCheck);

  // -- Key cell --------------------------------------------------------------
  const tdKey = document.createElement('td');
  tdKey.className = 'col-key';
  tdKey.style.paddingLeft = `${8 + indent * 20}px`;
  tdKey.title = key;

  const keySpan = document.createElement('span');
  keySpan.className = 'key-text';
  keySpan.textContent = key;
  tdKey.appendChild(keySpan);

  // Row select on key click
  tr.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') { return; }
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      selectedKeys.clear();
      document.querySelectorAll('.data-row.selected').forEach((el) => el.classList.remove('selected'));
    }
    selectedKeys.add(key);
    tr.classList.add('selected');
    updateToolbarState();
  });

  // Context menu on right-click
  tr.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextMenuTargetKey = key;
    showContextMenu(e.clientX, e.clientY);
  });

  tr.appendChild(tdKey);

  // -- Value cells -----------------------------------------------------------
  const refValue = values[key]?.[refLocale] ?? '';

  for (const locale of locales) {
    const value = values[key]?.[locale] ?? '';
    const isMissing = value.trim() === '';
    const isSimilar =
      config.highlightSimilar &&
      locale !== refLocale &&
      !isMissing &&
      value === refValue &&
      refValue !== '';

    const td = document.createElement('td');
    td.className = 'col-value';
    td.dataset.key = key;
    td.dataset.locale = locale;

    if (isMissing && config.highlightMissing) { td.classList.add('cell-missing'); }
    else if (isSimilar) { td.classList.add('cell-similar'); }

    const valueSpan = document.createElement('span');
    valueSpan.className = 'value-text';
    valueSpan.textContent = isMissing ? '' : value;
    if (isMissing) {
      const placeholder = document.createElement('span');
      placeholder.className = 'missing-placeholder';
      placeholder.textContent = '— missing —';
      td.appendChild(placeholder);
    }

    if (isSimilar) {
      td.title = `Same as reference locale "${refLocale}" — possibly untranslated`;
    }

    td.appendChild(valueSpan);

    // -- Inline editing on double-click --------------------------------------
    td.addEventListener('dblclick', () => startEdit(td, key, locale, value));
    td.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'F2') { startEdit(td, key, locale, value); }
    });
    td.tabIndex = 0;

    tr.appendChild(td);
  }

  // -- Comment cell ----------------------------------------------------------
  const tdComment = document.createElement('td');
  tdComment.className = 'col-comment';
  tdComment.textContent = comments[key] ?? '';
  tdComment.title = comments[key] ?? '';
  tr.appendChild(tdComment);

  return tr;
}

// -- Inline cell editor --------------------------------------------------------

function startEdit(
  td: HTMLTableCellElement,
  key: string,
  locale: string,
  currentValue: string
): void {
  if (editingCell) { commitEdit(); }
  editingCell = { key, locale };

  td.classList.add('editing');
  td.innerHTML = '';

  const textarea = document.createElement('textarea');
  textarea.className = 'cell-editor';
  textarea.value = currentValue;
  textarea.rows = Math.min(Math.max(currentValue.split('\n').length, 1), 6);
  td.appendChild(textarea);
  textarea.focus();
  textarea.select();

  // Auto-resize as user types
  textarea.addEventListener('input', () => {
    textarea.rows = Math.min(Math.max(textarea.value.split('\n').length, 1), 6);
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cancelEdit(td, key, locale, currentValue);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      focusNextCell(key, locale, e.shiftKey);
    }
  });

  textarea.addEventListener('blur', () => {
    // Short delay allows click on another cell to register first
    setTimeout(() => { if (editingCell) { commitEdit(); } }, 150);
  });
}

function commitEdit(): void {
  if (!editingCell || !state) { return; }
  const { key, locale } = editingCell;

  const td = document.querySelector<HTMLTableCellElement>(
    `td[data-key="${CSS.escape(key)}"][data-locale="${CSS.escape(locale)}"]`
  );
  const textarea = td?.querySelector<HTMLTextAreaElement>('.cell-editor');
  if (!textarea) { editingCell = null; return; }

  const newValue = textarea.value;
  const oldValue = state.values[key]?.[locale] ?? '';

  editingCell = null;

  if (newValue !== oldValue) {
    // Optimistic update in local state
    if (!state.values[key]) { state.values[key] = {}; }
    state.values[key][locale] = newValue;

    vscode.postMessage({ type: 'edit', payload: { key, locale, value: newValue } });
  }

  // Re-render just this cell
  renderGrid();
}

function cancelEdit(
  td: HTMLTableCellElement,
  key: string,
  locale: string,
  originalValue: string
): void {
  editingCell = null;
  td.classList.remove('editing');
  td.innerHTML = '';

  const valueSpan = document.createElement('span');
  valueSpan.className = 'value-text';
  valueSpan.textContent = originalValue;
  td.appendChild(valueSpan);
}

/** Move keyboard focus to the next/previous value cell in tab order. */
function focusNextCell(currentKey: string, currentLocale: string, reverse: boolean): void {
  if (!state) { return; }
  const { keys, locales } = state;
  const ki = keys.indexOf(currentKey);
  const li = locales.indexOf(currentLocale);

  let nextKi = ki;
  let nextLi = reverse ? li - 1 : li + 1;

  if (nextLi >= locales.length) { nextLi = 0; nextKi = ki + 1; }
  if (nextLi < 0) { nextLi = locales.length - 1; nextKi = ki - 1; }
  if (nextKi < 0) { nextKi = keys.length - 1; }
  if (nextKi >= keys.length) { nextKi = 0; }

  const nextKey = keys[nextKi];
  const nextLocale = locales[nextLi];
  const nextTd = document.querySelector<HTMLTableCellElement>(
    `td[data-key="${CSS.escape(nextKey)}"][data-locale="${CSS.escape(nextLocale)}"]`
  );
  nextTd?.focus();
}

// -- Drag-and-drop row reordering ----------------------------------------------

let dragSrcKey: string | null = null;

function attachDragHandlers(tr: HTMLTableRowElement, key: string): void {
  tr.addEventListener('dragstart', (e) => {
    dragSrcKey = key;
    tr.classList.add('dragging');
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', key);
  });

  tr.addEventListener('dragend', () => {
    tr.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    dragSrcKey = null;
  });

  tr.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    if (dragSrcKey && dragSrcKey !== key) {
      document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      tr.classList.add('drag-over');
    }
  });

  tr.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragSrcKey || dragSrcKey === key) { return; }
    vscode.postMessage({
      type: 'reorderKey',
      payload: { key: dragSrcKey, afterKey: key },
    });
    dragSrcKey = null;
  });
}

// -- Tree group collapse / expand ----------------------------------------------

function toggleGroup(group: string, headerRow: HTMLTableRowElement): void {
  const icon = headerRow.querySelector<HTMLSpanElement>('.group-icon')!;
  const isCollapsed = icon.textContent === '▸';
  icon.textContent = isCollapsed ? '▾' : '▸';

  const allRows = gridBody.querySelectorAll<HTMLTableRowElement>(`tr[data-group="${group}"]`);
  allRows.forEach((row) => {
    row.style.display = isCollapsed ? '' : 'none';
  });
}

// -- Context menu --------------------------------------------------------------

function showContextMenu(x: number, y: number): void {
  contextMenu.classList.remove('hidden');
  contextMenu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
  contextMenu.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
}

function hideContextMenu(): void {
  contextMenu.classList.add('hidden');
  contextMenuTargetKey = null;
}

contextMenu.addEventListener('click', async (e) => {
  const action = (e.target as HTMLElement).dataset.action;
  const key = contextMenuTargetKey;
  hideContextMenu();
  if (!key || !action) { return; }

  switch (action) {
    case 'rename':
      await promptRenameKey(key);
      break;
    case 'duplicate':
      await promptDuplicateKey(key);
      break;
    case 'remove':
      await confirmRemoveKeys([key]);
      break;
    case 'copy-from':
      await promptCopyFromLocale(key);
      break;
    case 'add-after':
      await promptAddKey(key);
      break;
  }
});

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target as Node)) { hideContextMenu(); }
});

// -- Toolbar button wiring -----------------------------------------------------

btnAdd.addEventListener('click', () => promptAddKey(null));
btnRename.addEventListener('click', () => {
  const key = [...selectedKeys][0];
 if (key) { promptRenameKey(key); }
});
btnDuplicate.addEventListener('click', () => {
  const key = [...selectedKeys][0];
  if (key) { promptDuplicateKey(key); }
});
btnRemove.addEventListener('click', () => {
  if (selectedKeys.size > 0) { confirmRemoveKeys([...selectedKeys]); }
});
btnSort.addEventListener('click', () => {
  if (!state) { return; }
  state.keys = [...state.keys].sort((a, b) => a.localeCompare(b));
  vscode.postMessage({ type: 'reorderKey', payload: { key: '__sort__', afterKey: null } });
  // Request a full sort via extension command
  vscode.postMessage({ type: 'requestRefresh', payload: null });
});
btnRefresh.addEventListener('click', () => {
  vscode.postMessage({ type: 'requestRefresh', payload: null });
});

searchInput.addEventListener('input', () => {
  filterText = searchInput.value.toLowerCase().trim();
  renderGrid();
});

toggleTree.addEventListener('change', () => {
  treeViewEnabled = toggleTree.checked;
  renderGrid();
});

toggleMissing.addEventListener('change', () => {
  showMissingOnly = toggleMissing.checked;
  renderGrid();
});

// -- Keyboard shortcuts --------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (modalOverlay.classList.contains('hidden')) {
    /* Kept the code as a reference
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedKeys.size > 0 && !(document.activeElement instanceof HTMLInputElement)) {
        confirmRemoveKeys([...selectedKeys]);
      }
    }*/
    if (e.key === 'F2') {
      const key = [...selectedKeys][0];
      if (key) { promptRenameKey(key); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      promptAddKey(null);
    }
  }
});

// -- Modal helpers -------------------------------------------------------------

function openModal(
  title: string,
  bodyHtml: string,
  onOk: () => void,
  okLabel = 'OK'
): void {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalOk.textContent = okLabel;
  modalOverlay.classList.remove('hidden');

  const firstInput = modalBody.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  firstInput?.focus();
  firstInput?.select();

  modalOk.onclick = () => {
    onOk();
    closeModal();
  };

  modalBody.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      onOk();
      closeModal();
    }
  });
}

function closeModal(): void {
  modalOverlay.classList.add('hidden');
  modalBody.innerHTML = '';
  modalOk.onclick = null;
}

modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) { closeModal(); }
});

// -- Action prompts ------------------------------------------------------------

async function promptAddKey(afterKey: string | null): Promise<void> {
  if (!state) { return; }
  const localeInputs = state.locales
    .map(
      (l) =>
        `<label>${escapeHtml(l === '' ? '(default)' : l)}
           <input type="text" class="locale-val" data-locale="${escapeHtml(l)}" placeholder="(optional initial value)"/>
         </label>`
    )
    .join('');

  openModal(
    'Add New Key',
    `<label>Key name
       <input id="new-key-name" type="text" placeholder="e.g. button.save.label" autocomplete="off"/>
     </label>
     <div class="locale-inputs-section">
       <p>Initial values (optional):</p>
       ${localeInputs}
     </div>`,
    () => {
      const keyName = (document.getElementById('new-key-name') as HTMLInputElement).value.trim();
      if (!keyName) { return; }
      const vals: Record<string, string> = {};
      document.querySelectorAll<HTMLInputElement>('.locale-val').forEach((input) => {
        vals[input.dataset.locale!] = input.value;
      });
      vscode.postMessage({
        type: 'addKey',
        payload: { key: keyName, values: vals, afterKey },
      });
    },
    'Add Key'
  );
}

async function promptRenameKey(oldKey: string): Promise<void> {
  openModal(
    'Rename Key',
    `<label>New key name
       <input id="rename-input" type="text" value="${escapeHtml(oldKey)}" autocomplete="off"/>
     </label>
     <p class="hint">The key will be renamed in <strong>all</strong> locale files.</p>`,
    () => {
      const newKey = (document.getElementById('rename-input') as HTMLInputElement).value.trim();
      if (!newKey || newKey === oldKey) { return; }
      vscode.postMessage({ type: 'renameKey', payload: { oldKey, newKey } });
      selectedKeys.delete(oldKey);
      selectedKeys.add(newKey);
    },
    'Rename'
  );
}

async function promptDuplicateKey(sourceKey: string): Promise<void> {
  openModal(
    'Duplicate Key',
    `<label>New key name
       <input id="dup-input" type="text" value="${escapeHtml(sourceKey)}_copy" autocomplete="off"/>
     </label>
     <p class="hint">Values will be copied from <strong>${escapeHtml(sourceKey)}</strong> in all locales.</p>`,
    () => {
      const newKey = (document.getElementById('dup-input') as HTMLInputElement).value.trim();
      if (!newKey) { return; }
      vscode.postMessage({ type: 'duplicateKey', payload: { sourceKey, newKey } });
    },
    'Duplicate'
  );
}

async function confirmRemoveKeys(keys: string[]): Promise<void> {
  const keyList = keys.map((k) => `<code>${escapeHtml(k)}</code>`).join(', ');
  openModal(
    'Remove Key(s)',
    `<p>Remove ${keyList} from <strong>all</strong> locale files?</p>
     <p class="hint danger">This cannot be undone.</p>`,
    () => {
      vscode.postMessage({ type: 'removeKey', payload: { keys } });
      keys.forEach((k) => selectedKeys.delete(k));
    },
    'Remove'
  );
}

async function promptCopyFromLocale(key: string): Promise<void> {
  if (!state) { return; }
  const options = state.locales
    .map(
      (l) =>
        `<option value="${escapeHtml(l)}">${escapeHtml(l === '' ? '(default)' : l)}</option>`
    )
    .join('');

  openModal(
    'Copy Value from Locale',
    `<label>Source locale
       <select id="copy-from-select">${options}</select>
     </label>
     <label>Target locale
       <select id="copy-to-select">${options}</select>
     </label>
     <p class="hint">The target cell will be overwritten with the source value.</p>`,
    () => {
      const fromLocale = (document.getElementById('copy-from-select') as HTMLSelectElement).value;
      const toLocale   = (document.getElementById('copy-to-select')   as HTMLSelectElement).value;
      if (fromLocale === toLocale) { return; }
      vscode.postMessage({ type: 'copyValue', payload: { key, fromLocale, toLocale } });
    },
    'Copy'
  );
}

// -- Toolbar state -------------------------------------------------------------

function updateToolbarState(): void {
  const count = selectedKeys.size;
  btnRename.disabled    = count !== 1;
  btnDuplicate.disabled = count !== 1;
  btnRemove.disabled    = count === 0;
}

function updateCheckboxes(): void {
  document.querySelectorAll<HTMLInputElement>('.data-row input[type="checkbox"]').forEach((cb) => {
    const key = cb.closest('tr')?.dataset.key ?? '';
    cb.checked = selectedKeys.has(key);
    cb.closest('tr')?.classList.toggle('selected', cb.checked);
  });
}

// -- Toast notifications -------------------------------------------------------

function showToast(message: string, type: 'info' | 'error'): void {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// -- Utilities -----------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#039;');
}

// Initial toolbar state
updateToolbarState();
