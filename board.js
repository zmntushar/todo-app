const BOARD_STORAGE_KEY = 'todo_postit_board_v1';
const NOTE_TEXT_MAX_LENGTH = 500;
const TEXTAREA_MAX_HEIGHT = 320;

/** @type {{id:string,text:string,color:string,size:number,createdAt:number}[]} */
let notes = loadNotes();

const els = {
  form: document.querySelector('#note-form'),
  input: document.querySelector('#note-input'),
  color: document.querySelector('#note-color'),
  size: document.querySelector('#note-size'),
  board: document.querySelector('#note-board'),
  count: document.querySelector('#note-count'),
  empty: document.querySelector('#board-empty'),
  tpl: document.querySelector('#note-template'),
};

els.input.maxLength = NOTE_TEXT_MAX_LENGTH;
setupAutoGrow(els.input);
submitOnEnter(els.input, () => addNote());

let draggingId = null;

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  addNote();
});

function addNote() {
  const text = normalizeText(els.input.value);
  if (!text) return;

  notes.unshift({
    id: cryptoRandomId(),
    text,
    color: sanitizeColor(els.color.value),
    size: clampSize(Number(els.size.value)),
    createdAt: Date.now(),
  });

  els.input.value = '';
  autoGrow(els.input);
  persistNotes();
  render();
}

els.board.addEventListener('dragover', (e) => {
  e.preventDefault();
  const target = e.target && e.target.closest ? e.target.closest('.note') : null;
  if (!target || !target.dataset.id || target.dataset.id === draggingId) return;

  clearDragOver();
  target.classList.add('drag-over');
});

els.board.addEventListener('drop', (e) => {
  e.preventDefault();
  const target = e.target && e.target.closest ? e.target.closest('.note') : null;
  if (!target || !target.dataset.id || !draggingId || target.dataset.id === draggingId) return;

  reorderNotes(draggingId, target.dataset.id);
  draggingId = null;
  persistNotes();
  render();
});

els.board.addEventListener('dragend', () => {
  draggingId = null;
  clearDragOver();
  Array.from(els.board.querySelectorAll('.note.dragging')).forEach((n) => n.classList.remove('dragging'));
});

function render() {
  els.board.innerHTML = '';

  for (const note of notes) {
    const node = createNoteNode(note);
    els.board.appendChild(node);
  }

  const count = notes.length;
  els.count.textContent = `${count} note${count === 1 ? '' : 's'}`;
  els.empty.style.display = count === 0 ? 'block' : 'none';
}

function createNoteNode(note) {
  const frag = els.tpl.content.cloneNode(true);
  const root = frag.querySelector('.note');
  const text = frag.querySelector('.note-text');
  const colorSelect = frag.querySelector('.note-color');
  const sizeSelect = frag.querySelector('.note-size');
  const delBtn = frag.querySelector('[data-action="delete"]');

  root.dataset.id = note.id;
  root.style.setProperty('--note-bg', sanitizeColor(note.color));
  root.style.setProperty('--note-glow', getNoteGlow(note.color));
  root.style.setProperty('--note-font-size', `${clampSize(note.size)}px`);

  text.textContent = note.text;

  colorSelect.value = sanitizeColor(note.color);
  sizeSelect.value = String(clampSize(note.size));

  colorSelect.addEventListener('change', () => {
    updateNote(note.id, { color: sanitizeColor(colorSelect.value) });
  });

  sizeSelect.addEventListener('change', () => {
    updateNote(note.id, { size: clampSize(Number(sizeSelect.value)) });
  });

  delBtn.addEventListener('click', () => {
    notes = notes.filter((n) => n.id !== note.id);
    persistNotes();
    render();
  });

  text.addEventListener('dblclick', () => startInlineEdit(root, text, note.id));

  root.addEventListener('dragstart', (e) => {
    if (root.classList.contains('editing')) {
      e.preventDefault();
      return;
    }
    draggingId = note.id;
    root.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', note.id); } catch {}
    e.dataTransfer.effectAllowed = 'move';
  });

  root.addEventListener('dragend', () => {
    root.classList.remove('dragging');
    clearDragOver();
  });

  return frag;
}

function startInlineEdit(root, textNode, noteId) {
  const current = getNote(noteId);
  if (!current) return;

  root.classList.add('editing');
  root.draggable = false;

  const input = document.createElement('textarea');
  input.className = 'note-edit autogrow';
  input.maxLength = NOTE_TEXT_MAX_LENGTH;
  input.value = current.text;

  textNode.replaceWith(input);
  setupAutoGrow(input);
  autoGrow(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let settled = false;

  const commit = () => {
    if (settled) return;
    settled = true;

    const next = normalizeText(input.value);
    if (!next) {
      notes = notes.filter((n) => n.id !== noteId);
      persistNotes();
      render();
      return;
    }

    updateNote(noteId, { text: next });
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    render();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });

  input.addEventListener('blur', commit);
}

function reorderNotes(sourceId, targetId) {
  const from = notes.findIndex((n) => n.id === sourceId);
  const to = notes.findIndex((n) => n.id === targetId);
  if (from < 0 || to < 0) return;

  const next = notes.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  notes = next;
}

function updateNote(id, patch) {
  let changed = false;
  notes = notes.map((n) => {
    if (n.id !== id) return n;
    changed = true;

    return {
      ...n,
      ...patch,
      text: normalizeText(patch.text ?? n.text),
      color: sanitizeColor(patch.color ?? n.color),
      size: clampSize(Number(patch.size ?? n.size)),
    };
  });

  if (changed) {
    persistNotes();
    render();
  }
}

function getNote(id) {
  return notes.find((n) => n.id === id);
}

function persistNotes() {
  localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(notes));
}

function loadNotes() {
  try {
    const raw = localStorage.getItem(BOARD_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((x) => x && typeof x.id === 'string' && typeof x.text === 'string')
      .map((x) => ({
        id: x.id,
        text: normalizeText(x.text),
        color: sanitizeColor(x.color),
        size: clampSize(Number(x.size)),
        createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

/**
 * Keep stored note text tidy so notes render consistently:
 * normalize line endings, strip trailing spaces per line,
 * collapse runs of blank lines to one, and trim the edges.
 */
function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function autoGrow(el) {
  if (!el) return;

  el.style.height = 'auto';

  // scrollHeight excludes borders, but box-sizing is border-box, so add them
  // back or every field loses a couple of pixels and starts scrolling.
  const cs = getComputedStyle(el);
  const borders = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  const full = el.scrollHeight + borders;

  el.style.height = `${Math.min(full, TEXTAREA_MAX_HEIGHT)}px`;
  el.classList.toggle('is-scrolling', full > TEXTAREA_MAX_HEIGHT);
}

function setupAutoGrow(el) {
  if (!el || el._autoGrowBound) return;
  el._autoGrowBound = true;
  el.addEventListener('input', () => autoGrow(el));
  autoGrow(el);
}

function submitOnEnter(el, handler) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handler();
    }
  });
}

function sanitizeColor(value) {
  const allowed = new Set(['#fff59d', '#ffd8a8', '#b2f2bb', '#a5d8ff', '#ffc9c9', '#e5dbff']);
  return allowed.has(String(value).toLowerCase()) ? String(value).toLowerCase() : '#fff59d';
}

function getNoteGlow(value) {
  const glows = {
    '#fff59d': 'rgba(255, 221, 92, .34)',
    '#ffd8a8': 'rgba(255, 171, 94, .3)',
    '#b2f2bb': 'rgba(89, 224, 132, .28)',
    '#a5d8ff': 'rgba(77, 166, 255, .32)',
    '#ffc9c9': 'rgba(255, 111, 145, .28)',
    '#e5dbff': 'rgba(169, 121, 255, .3)',
  };
  return glows[sanitizeColor(value)] || glows['#fff59d'];
}

function clampSize(value) {
  const allowed = [13, 15, 18, 21];
  return allowed.includes(value) ? value : 15;
}

function clearDragOver() {
  Array.from(els.board.querySelectorAll('.note.drag-over')).forEach((n) => n.classList.remove('drag-over'));
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

render();
