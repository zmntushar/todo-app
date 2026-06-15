const BOARD_STORAGE_KEY = 'todo_postit_board_v1';

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

let draggingId = null;

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = (els.input.value || '').trim();
  if (!text) return;

  notes.unshift({
    id: cryptoRandomId(),
    text,
    color: sanitizeColor(els.color.value),
    size: clampSize(Number(els.size.value)),
    createdAt: Date.now(),
  });

  els.input.value = '';
  persistNotes();
  render();
});

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

  text.addEventListener('dblclick', () => startInlineEdit(text, note.id));

  root.addEventListener('dragstart', (e) => {
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

function startInlineEdit(textNode, noteId) {
  const current = getNote(noteId);
  if (!current) return;

  const input = document.createElement('textarea');
  input.className = 'note-edit';
  input.value = current.text;

  textNode.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const next = (input.value || '').trim();
    if (!next) {
      notes = notes.filter((n) => n.id !== noteId);
      persistNotes();
      render();
      return;
    }

    updateNote(noteId, { text: next });
  };

  const cancel = () => render();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
        text: x.text,
        color: sanitizeColor(x.color),
        size: clampSize(Number(x.size)),
        createdAt: typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function sanitizeColor(value) {
  const allowed = new Set(['#fff59d', '#ffd8a8', '#b2f2bb', '#a5d8ff', '#ffc9c9', '#e5dbff']);
  return allowed.has(String(value).toLowerCase()) ? String(value).toLowerCase() : '#fff59d';
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