const el = document.getElementById('typed');
let landingRunning = true;

// ── Helpers ──

function humanDelay(base, variance) {
  return base + Math.random() * variance;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function typeInto(target, text) {
  for (const char of text) {
    target.textContent += char;
    const delay = char === ' '
      ? humanDelay(15, 25)
      : humanDelay(8, 18);
    await sleep(delay);
  }
}

async function backspaceFrom(target, count) {
  for (let i = 0; i < count; i++) {
    target.textContent = target.textContent.slice(0, -1);
    await sleep(humanDelay(70, 100));
  }
}

// Landing-only wrappers (stop if user clicked "Let's go")
async function type(text) {
  for (const char of text) {
    if (!landingRunning) return;
    el.textContent += char;
    const delay = char === ' '
      ? humanDelay(160, 180)
      : humanDelay(100, 150);
    await sleep(delay);
  }
}

async function backspace(count) {
  for (let i = 0; i < count; i++) {
    if (!landingRunning) return;
    el.textContent = el.textContent.slice(0, -1);
    await sleep(humanDelay(70, 100));
  }
}

// ── Landing animation ──

async function run() {
  await sleep(1200);
  await type('Learn more precise.');
  await sleep(2000);
  await backspace(' precise.'.length);
  await sleep(500);
  await type('.');
  await sleep(1800);
  await backspace(' more.'.length);
  await sleep(500);
  await type('.');

  await sleep(15000);

  const topics = [
    'Python.', 'Control Theory.', 'Cooking.', 'Chess.',
    'Linear Algebra.', 'Philosophy.', 'Music Theory.',
    'Machine Learning.', 'History.', 'Economics.',
  ];

  let i = 0;
  while (landingRunning) {
    const topic = topics[i % topics.length];
    await backspace('.'.length);
    await sleep(300);
    await type(' ' + topic);
    await sleep(3000);
    await backspace((' ' + topic).length);
    await sleep(400);
    await type('.');
    await sleep(2000);
    i++;
  }
}

run();

// ── Transition: landing → chat ──

const landing = document.getElementById('landing');
const chat = document.getElementById('chat');
const btnGo = document.getElementById('btn-go');

function splitIntoChars(element) {
  const chars = [];
  // Walk through child nodes to handle mixed text + spans
  const nodes = Array.from(element.childNodes);
  element.innerHTML = '';

  for (const node of nodes) {
    const text = node.textContent || '';
    for (const ch of text) {
      const span = document.createElement('span');
      span.className = 'fall-char';
      span.textContent = ch === ' ' ? '\u00A0' : ch;
      element.appendChild(span);
      chars.push(span);
    }
  }
  return chars;
}

btnGo.addEventListener('click', (e) => {
  e.preventDefault();
  landingRunning = false;

  // Collect all fall-items and split every character (skip the button)
  const items = landing.querySelectorAll('.fall-item:not(.btn-go)');
  let allChars = [];

  items.forEach(item => {
    const chars = splitIntoChars(item);
    allChars = allChars.concat(chars);
  });

  // Stagger left-to-right with random drift per character
  allChars.forEach((span, i) => {
    const delay = i * 35;
    const xDrift = (Math.random() - 0.5) * 200;
    const rotation = (Math.random() - 0.5) * 60;

    span.style.transitionDelay = delay + 'ms';
    span.style.transform = '';

    // Trigger in next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        span.classList.add('drop');
        span.style.transform =
          `translateY(120vh) translateX(${xDrift}px) rotate(${rotation}deg)`;
      });
    });
  });

  // Drop the button immediately on click
  btnGo.style.transition = 'transform 1.2s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.8s ease';
  btnGo.style.transform = 'translateY(120vh) rotate(5deg)';
  btnGo.style.opacity = '0';

  // Show chat after all chars + button have fallen
  const totalTime = allChars.length * 35 + 1200;
  setTimeout(() => {
    chat.classList.add('visible');
    showWelcome();
  }, totalTime);
});

// ── Folder toggle ──

document.querySelectorAll('.folder-name').forEach(name => {
  name.addEventListener('click', () => {
    name.parentElement.classList.toggle('open');
  });
});

// ── Chat typing (reuses same blinking cursor) ──

async function addBotMessage(text) {
  const messages = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'msg bot';

  const span = document.createElement('span');
  span.className = 'bot-text';
  msg.appendChild(span);

  const cur = document.createElement('span');
  cur.className = 'cursor';
  cur.textContent = '|';
  msg.appendChild(cur);

  const inputLine = document.querySelector('.chat-input-line');
  messages.insertBefore(msg, inputLine);
  messages.scrollTop = messages.scrollHeight;

  await typeInto(span, text);

  cur.remove();
  messages.scrollTop = messages.scrollHeight;
}

async function showWelcome() {
  await sleep(600);
  await addBotMessage("Hey! Welcome to Studium.");
  await sleep(800);
  await addBotMessage("I'm here to help you learn. What would you like to study today?");
  focusInput();
}

// ── User input (terminal style) ──

const chatInput = document.getElementById('chat-input');
const inputLine = document.querySelector('.chat-input-line');

function focusInput() {
  chatInput.focus();
  // Move caret to end
  const range = document.createRange();
  range.selectNodeContents(chatInput);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Click anywhere in chat area to focus the input
document.querySelector('.chat-messages').addEventListener('click', (e) => {
  if (!window.getSelection().toString()) focusInput();
});

async function handleSend() {
  const text = chatInput.textContent.trim();
  if (!text) return;

  const messages = document.getElementById('chat-messages');

  // Insert user message before the input line
  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.textContent = text;
  messages.insertBefore(userMsg, inputLine);

  chatInput.textContent = '';
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    await addBotMessage(data.reply);
  } catch (err) {
    await addBotMessage("Something went wrong. Please try again.");
  }
  focusInput();
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleSend();
  }
});

// ── Sidebar toggle ──

const chatLayout = document.getElementById('chat');
const toggleLeft = document.getElementById('toggle-left');
const toggleRight = document.getElementById('toggle-right');

toggleLeft.addEventListener('click', () => {
  chatLayout.classList.toggle('left-collapsed');
  toggleLeft.innerHTML = chatLayout.classList.contains('left-collapsed')
    ? '&#9654;'   // ▶ point right = "open left sidebar"
    : '&#9664;';  // ◀ point left  = "close left sidebar"
});

toggleRight.addEventListener('click', () => {
  chatLayout.classList.toggle('right-collapsed');
  toggleRight.innerHTML = chatLayout.classList.contains('right-collapsed')
    ? '&#9664;'   // ◀ point left  = "open right sidebar"
    : '&#9654;';  // ▶ point right = "close right sidebar"
});

// ── Drag to resize sidebars ──

function initDrag(handleId, side) {
  const handle = document.getElementById(handleId);
  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;

    if (side === 'left') {
      const width = Math.max(140, Math.min(e.clientX, 500));
      chatLayout.style.setProperty('--left-w', width + 'px');
    } else {
      const width = Math.max(140, Math.min(window.innerWidth - e.clientX, 500));
      chatLayout.style.setProperty('--right-w', width + 'px');
    }
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

initDrag('drag-left', 'left');
initDrag('drag-right', 'right');
