// ── State ──

const state = {
  user: null,
  courses: [],
  currentCourse: null,
  currentConversation: null,
  messages: [],
  topics: [],
  currentTopicId: null,
  topicPath: [],
  isWaiting: false,
  selectedModel: 'gpt-4o-mini',
};

// ── Helpers ──

function humanDelay(base, variance) {
  return base + Math.random() * variance;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function typeInto(target, text) {
  // For short text, type char-by-char; for long text, chunk it
  const chunkSize = text.length > 120 ? 4 : 1;
  for (let i = 0; i < text.length; i += chunkSize) {
    target.textContent += text.slice(i, i + chunkSize);
    await sleep(humanDelay(3, 8));
  }
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 401) return null;
  return res.json();
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    // Extract ==concept== into placeholders BEFORE marked touches the text
    const highlights = [];
    text = text.replace(/==([^=]+)==/g, function(_, concept) {
      highlights.push(concept);
      return 'XSTHL' + (highlights.length - 1) + 'LHTS';
    });

    var html = marked.parse(text, { breaks: true, gfm: true });

    // Re-inject highlights as <mark> elements
    for (var i = 0; i < highlights.length; i++) {
      var safe = highlights[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html = html.replace('XSTHL' + i + 'LHTS', '<mark class="concept-link">' + safe + '</mark>');
    }

    return html;
  }
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attachConceptLinks(el) {
  el.querySelectorAll('.concept-link').forEach(mark => {
    mark.addEventListener('click', (e) => {
      if (state.isWaiting) return;
      e.stopPropagation();
      const chatInput = document.getElementById('chat-input');
      chatInput.textContent = mark.textContent;
      handleSend(mark.textContent);
    });
  });
}

function renderContent(el) {
  if (window.renderMathInElement) {
    renderMathInElement(el, {
      delimiters: [
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
  }
}

// ── Landing animation ──

const el = document.getElementById('typed');
let landingRunning = true;

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

async function runLandingAnimation() {
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

const landing = document.getElementById('landing');
const chat = document.getElementById('chat');

if (window.__isAuthenticated) {
  landingRunning = false;
  landing.style.display = 'none';
  chat.classList.add('visible');
  initApp();
} else {
  runLandingAnimation();
}

// ── Chat typing ──

async function addBotMessage(text, topicId) {
  const messages = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'msg bot';

  const span = document.createElement('span');
  span.className = 'bot-text';
  msg.appendChild(span);

  const wrapper = wrapWithDepthLines(msg, topicId);
  wrapper.dataset.topicId = topicId != null ? String(topicId) : '';

  const inputLine = document.querySelector('.chat-input-line');
  messages.insertBefore(wrapper, inputLine);

  if (text.length > 300) {
    // Long messages: render immediately with fade-in
    msg.style.opacity = '0';
    msg.style.transition = 'opacity 0.3s ease';
    span.innerHTML = renderMarkdown(text);
    renderContent(span);
    attachConceptLinks(span);
    messages.scrollTop = messages.scrollHeight;
    requestAnimationFrame(() => { msg.style.opacity = '1'; });
  } else {
    // Short messages: quick typing then render
    const cur = document.createElement('span');
    cur.className = 'cursor';
    cur.textContent = '|';
    msg.appendChild(cur);
    messages.scrollTop = messages.scrollHeight;

    await typeInto(span, text);
    cur.remove();

    span.innerHTML = renderMarkdown(text);
    renderContent(span);
    attachConceptLinks(span);
    messages.scrollTop = messages.scrollHeight;
  }

  return wrapper;
}

function addStaticMessage(role, text, topicId) {
  const messages = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'msg ' + role;

  if (role === 'bot') {
    const span = document.createElement('span');
    span.className = 'bot-text';
    span.innerHTML = renderMarkdown(text);
    msg.appendChild(span);
    renderContent(span);
    attachConceptLinks(span);
  } else {
    msg.textContent = text;
  }

  const wrapper = wrapWithDepthLines(msg, topicId);
  wrapper.dataset.topicId = topicId != null ? String(topicId) : '';

  const inputLine = document.querySelector('.chat-input-line');
  messages.insertBefore(wrapper, inputLine);
}


function addSuggestionChips(suggestions, topicId) {
  if (!suggestions || suggestions.length === 0) return;

  const messages = document.getElementById('chat-messages');
  const container = document.createElement('div');
  container.className = 'suggestions';
  container.dataset.topicId = topicId != null ? String(topicId) : '';

  suggestions.forEach(s => {
    const chip = document.createElement('span');
    chip.className = 'suggestion-chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      if (state.isWaiting) return;
      container.remove();
      chatInput.textContent = s;
      handleSend();
    });
    container.appendChild(chip);
  });

  const inputLine = document.querySelector('.chat-input-line');
  messages.insertBefore(container, inputLine);
  messages.scrollTop = messages.scrollHeight;
}

// ── Thinking indicator ──

function showThinkingIndicator(topicId) {
  const messages = document.getElementById('chat-messages');
  const inputLine = document.querySelector('.chat-input-line');
  const indicator = document.createElement('div');
  indicator.className = 'thinking-indicator';
  indicator.id = 'thinking';
  indicator.dataset.topicId = topicId != null ? String(topicId) : '';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    indicator.appendChild(dot);
  }
  messages.insertBefore(indicator, inputLine);
  messages.scrollTop = messages.scrollHeight;
}

function hideThinkingIndicator() {
  const el = document.getElementById('thinking');
  if (el) el.remove();
}

// ── User input ──

const chatInput = document.getElementById('chat-input');
const inputLine = document.querySelector('.chat-input-line');

function focusInput() {
  chatInput.focus();
  const range = document.createRange();
  range.selectNodeContents(chatInput);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function lockInput() {
  state.isWaiting = true;
  chatInput.contentEditable = 'false';
  inputLine.classList.add('input-disabled');
}

function unlockInput() {
  state.isWaiting = false;
  chatInput.contentEditable = 'true';
  inputLine.classList.remove('input-disabled');
}

document.querySelector('.chat-messages').addEventListener('click', (e) => {
  if (!window.getSelection().toString()) focusInput();
});

async function handleSend(forceTopic) {
  if (state.isWaiting) return;
  const text = chatInput.textContent.trim();
  if (!text) return;

  // If no course exists yet, treat first message as course creation
  if (!state.currentCourse) {
    await createCourseFromInput(text);
    return;
  }

  // If no conversation, create one
  if (!state.currentConversation) {
    const data = await api('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ course_id: state.currentCourse.id, title: text.slice(0, 80) }),
    });
    if (data) {
      state.currentConversation = data;
    }
  }

  const messages = document.getElementById('chat-messages');
  const topicAtSend = state.currentTopicId;

  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.textContent = text;

  const userWrapper = wrapWithDepthLines(userMsg, topicAtSend);
  userWrapper.dataset.topicId = topicAtSend != null ? String(topicAtSend) : '';
  messages.insertBefore(userWrapper, inputLine);

  chatInput.textContent = '';
  messages.scrollTop = messages.scrollHeight;
  lockInput();
  showThinkingIndicator(topicAtSend);

  try {
    const payload = {
      conversation_id: state.currentConversation.id,
      message: text,
      topic_id: state.currentTopicId,
      model: state.selectedModel,
    };
    if (forceTopic) payload.force_topic = forceTopic;

    const data = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    hideThinkingIndicator();

    if (data && data.reply) {
      const botMsg = await addBotMessage(data.reply, topicAtSend);

      // Update conversation title in state
      if (data.conversation_title) {
        state.currentConversation.title = data.conversation_title;
      }

      // If AI detected a new subtopic from user's question
      if (data.new_topic) {
        const nt = data.new_topic;

        // Re-tag the triggering messages with the new child topic
        userWrapper.dataset.topicId = String(nt.id);
        botMsg.dataset.topicId = String(nt.id);

        // Update current topic to the new one
        state.currentTopicId = nt.id;
        // Reload full topic tree from server
        await loadTopics();
        state.topicPath = buildTopicPath(state.topics, nt.id);
        renderBreadcrumb();

        // Re-render depth lines now that the topic tree is updated
        updateWrapperDepthLines(userWrapper, nt.id);
        updateWrapperDepthLines(botMsg, nt.id);
        updateDepthIndicator();
        filterMessagesByTopic();
      }

      // Show suggestion chips if the AI provided them
      if (data.suggestions && data.suggestions.length > 0) {
        addSuggestionChips(data.suggestions, state.currentTopicId);
      }

    } else {
      await addBotMessage("Something went wrong. Please try again.", topicAtSend);
    }
  } catch (err) {
    hideThinkingIndicator();
    await addBotMessage("Something went wrong. Please try again.", topicAtSend);
  } finally {
    unlockInput();
    focusInput();
  }
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (state.isWaiting) return;
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
    ? '&#9654;'
    : '&#9664;';
});

toggleRight.addEventListener('click', () => {
  chatLayout.classList.toggle('right-collapsed');
  toggleRight.innerHTML = chatLayout.classList.contains('right-collapsed')
    ? '&#9664;'
    : '&#9654;';
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

// ── Model chooser ──

const modelBtn = document.getElementById('model-btn');
const modelDropdown = document.getElementById('model-dropdown');

modelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  modelDropdown.classList.toggle('open');
});

modelDropdown.querySelectorAll('.model-option').forEach(opt => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    state.selectedModel = opt.dataset.model;
    modelBtn.textContent = opt.dataset.model;
    modelDropdown.querySelectorAll('.model-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    modelDropdown.classList.remove('open');
  });
});

document.addEventListener('click', () => {
  modelDropdown.classList.remove('open');
});

// ── Topic tree helpers ──

function findTopicById(topics, id) {
  for (const t of topics) {
    if (t.id === id) return t;
    if (t.children) {
      const found = findTopicById(t.children, id);
      if (found) return found;
    }
  }
  return null;
}


function buildTopicPath(topics, targetId) {
  // Build path from root to target
  function search(nodes, path) {
    for (const t of nodes) {
      const newPath = [...path, { id: t.id, title: t.title }];
      if (t.id === targetId) return newPath;
      if (t.children) {
        const found = search(t.children, newPath);
        if (found) return found;
      }
    }
    return null;
  }
  return search(topics, []) || [];
}

// ── Message depth lines ──

function createMessageDepthLines(topicId) {
  const container = document.createElement('div');
  container.className = 'msg-depth-lines';

  if (topicId == null) return container;

  const topicPath = buildTopicPath(state.topics, parseInt(topicId));
  if (topicPath.length === 0) return container;

  // Full path: course root + topic ancestors (exclude current topic)
  const fullPath = [
    { id: null, title: state.currentCourse?.name || 'Topic' },
    ...topicPath
  ];

  for (let i = 0; i < fullPath.length - 1; i++) {
    const level = fullPath[i];
    const line = document.createElement('div');
    line.className = 'depth-line';
    line.dataset.tooltip = level.title;
    line.addEventListener('click', () => {
      if (state.isWaiting) return;
      if (i === 0) {
        state.currentTopicId = null;
        state.topicPath = [];
      } else {
        state.currentTopicId = fullPath[i].id;
        state.topicPath = topicPath.slice(0, i);
      }
      renderBreadcrumb();
      renderKnowledgeMap();
      filterMessagesByTopic();
      updateDepthIndicator();
      focusInput();
    });
    container.appendChild(line);
  }

  return container;
}

function wrapWithDepthLines(element, topicId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-wrapper';
  wrapper.dataset.topicId = element.dataset.topicId || '';

  const depthLines = createMessageDepthLines(topicId);
  wrapper.appendChild(depthLines);
  wrapper.appendChild(element);

  return wrapper;
}

function updateWrapperDepthLines(wrapper, topicId) {
  const oldLines = wrapper.querySelector('.msg-depth-lines');
  const newLines = createMessageDepthLines(topicId);
  if (oldLines) {
    wrapper.replaceChild(newLines, oldLines);
  } else {
    wrapper.insertBefore(newLines, wrapper.firstChild);
  }
}

// ── Topic filtering ──

function getVisibleTopicIds(topicId) {
  if (topicId == null) return null; // null = show all
  const path = buildTopicPath(state.topics, topicId);
  if (path.length === 0) return null; // topic not found, show all
  return new Set(path.map(p => p.id));
}

function filterMessagesByTopic() {
  const container = document.getElementById('chat-messages');
  const inputLine = document.querySelector('.chat-input-line');
  const visibleIds = getVisibleTopicIds(state.currentTopicId);

  let child = container.firstChild;
  while (child && child !== inputLine) {
    if (child.dataset && 'topicId' in child.dataset) {
      const tid = child.dataset.topicId;
      if (tid === '' || visibleIds === null || visibleIds.has(parseInt(tid))) {
        child.classList.remove('topic-hidden');
      } else {
        child.classList.add('topic-hidden');
      }
    }
    child = child.nextSibling;
  }

  container.scrollTop = container.scrollHeight;
}

// ── Render functions ──

function renderTopicList() {
  const container = document.getElementById('topic-list');
  container.innerHTML = '';

  if (state.courses.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No topics yet.';
    container.appendChild(empty);
    return;
  }

  state.courses.forEach(c => {
    const item = document.createElement('div');
    item.className = 'topic-item';
    if (state.currentCourse && c.id === state.currentCourse.id) {
      item.classList.add('active');
    }
    item.textContent = c.name;
    item.addEventListener('click', async () => {
      if (state.isWaiting) return;
      if (state.currentCourse && c.id === state.currentCourse.id) return;

      state.currentCourse = c;
      state.currentTopicId = null;
      state.topicPath = [];
      renderTopicList();
      await loadConversation();
      await loadTopics();
      renderBreadcrumb();
      clearChatMessages();

      if (state.currentConversation) {
        await loadAndDisplayMessages();
      } else {
        await addBotMessage("Welcome! What would you like to study?");
      }
      focusInput();
    });
    container.appendChild(item);
  });
}

document.getElementById('new-topic-btn').addEventListener('click', () => {
  if (state.isWaiting) return;
  const footer = document.querySelector('.sidebar-footer');
  const btn = document.getElementById('new-topic-btn');
  btn.style.display = 'none';

  const inputRow = document.createElement('div');
  inputRow.className = 'new-topic-input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'new-topic-input';
  input.placeholder = 'Topic name...';
  input.spellcheck = false;

  inputRow.appendChild(input);
  footer.insertBefore(inputRow, btn);
  input.focus();

  async function submit() {
    const name = input.value.trim();
    if (!name) { cancel(); return; }
    inputRow.remove();
    btn.style.display = '';

    const data = await api('/api/courses', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (data) {
      await loadCourses();
      state.currentCourse = state.courses.find(c => c.id === data.id);
      renderTopicList();
      state.currentConversation = { id: data.conversation_id, title: name };
      state.currentTopicId = null;
      state.topicPath = [];
      await loadTopics();
      renderBreadcrumb();
      clearChatMessages();

      lockInput();
      showThinkingIndicator(null);
      try {
        const chatData = await api('/api/chat', {
          method: 'POST',
          body: JSON.stringify({
            conversation_id: data.conversation_id,
            message: `I want to learn about ${name}`,
            topic_id: null,
            model: state.selectedModel,
          }),
        });
        hideThinkingIndicator();
        if (chatData && chatData.reply) {
          await addBotMessage(chatData.reply);
          if (chatData.suggestions && chatData.suggestions.length > 0) {
            addSuggestionChips(chatData.suggestions, null);
          }
        }
      } catch (e) {
        hideThinkingIndicator();
        await addBotMessage(`Welcome to ${name}! What would you like to start with?`);
      } finally {
        unlockInput();
      }
      focusInput();
    }
  }

  function cancel() {
    inputRow.remove();
    btn.style.display = '';
  }

  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') submit();
    if (ev.key === 'Escape') cancel();
  });
});

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = '';

  if (!state.currentCourse) return;

  // Course name (root)
  const root = document.createElement('span');
  root.className = 'breadcrumb-segment breadcrumb-root';
  root.textContent = state.currentCourse.name;
  root.addEventListener('click', () => {
    state.currentTopicId = null;
    state.topicPath = [];
    renderBreadcrumb();

    renderKnowledgeMap();
    filterMessagesByTopic();
    updateDepthIndicator();
  });
  bc.appendChild(root);

  // Topic path segments
  state.topicPath.forEach((seg, i) => {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = ' > ';
    bc.appendChild(sep);

    const span = document.createElement('span');
    span.className = 'breadcrumb-segment';
    if (i === state.topicPath.length - 1) {
      span.classList.add('breadcrumb-current');
    }
    span.textContent = seg.title;
    span.addEventListener('click', () => {
      // Navigate to this point in the path
      state.currentTopicId = seg.id;
      state.topicPath = state.topicPath.slice(0, i + 1);
      renderBreadcrumb();
  
      renderKnowledgeMap();
      filterMessagesByTopic();
      updateDepthIndicator();
    });
    bc.appendChild(span);
  });
}

function updateDepthIndicator() {
  const container = document.getElementById('depth-indicator');
  if (!container) return;

  container.innerHTML = '';

  // No lines if at root (no topic path)
  if (!state.topicPath || state.topicPath.length === 0) return;

  // Create a line for each level in the path
  // Include the course root as level 0
  const fullPath = [
    { id: null, title: state.currentCourse?.name || 'Topic' },
    ...state.topicPath
  ];

  // Show lines for each level (skip the last one since that's current)
  for (let i = 0; i < fullPath.length - 1; i++) {
    const level = fullPath[i];
    const line = document.createElement('div');
    line.className = 'depth-line';
    line.dataset.tooltip = `Back to: ${level.title}`;
    line.dataset.levelIndex = i;

    line.addEventListener('click', () => {
      if (i === 0) {
        // Navigate to root
        state.currentTopicId = null;
        state.topicPath = [];
      } else {
        // Navigate to this level in the path
        const targetLevel = fullPath[i];
        state.currentTopicId = targetLevel.id;
        state.topicPath = state.topicPath.slice(0, i);
      }
      renderBreadcrumb();
  
      renderKnowledgeMap();
      filterMessagesByTopic();
      updateDepthIndicator();
      focusInput();
    });

    container.appendChild(line);
  }
}

function renderUserInfo() {
  const el = document.getElementById('user-info');
  if (state.user) {
    el.innerHTML = `
      <span class="user-name">${state.user.name}</span>
      <a href="/auth/logout" class="logout-link">Log out</a>
    `;
  }
}

function clearChatMessages() {
  const messages = document.getElementById('chat-messages');
  const inputLine = document.querySelector('.chat-input-line');
  while (messages.firstChild !== inputLine) {
    messages.removeChild(messages.firstChild);
  }
}

// ── Knowledge Map ──

function seededRandom(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

function countDescendants(topic) {
  if (!topic.children || topic.children.length === 0) return 1;
  let count = 0;
  topic.children.forEach(c => { count += countDescendants(c); });
  return count;
}

function layoutKnowledgeMap(topics) {
  const nodes = [];
  const edges = [];
  const vSpacing = 70;
  const minHSpacing = 55;

  function layoutSubtree(topic, cx, y, availWidth, depth, parentId) {
    const jitterX = (seededRandom(topic.id) - 0.5) * 8;
    const jitterY = (seededRandom(topic.id + 100) - 0.5) * 6;
    const nx = cx + jitterX;
    const ny = y + jitterY;

    nodes.push({
      id: topic.id,
      title: topic.title,
      x: nx,
      y: ny,
      depth: depth,
      status: topic.status || 'not_started',
    });

    if (parentId !== null) {
      edges.push({ from: parentId, to: topic.id });
    }

    if (topic.children && topic.children.length > 0) {
      const totalDesc = topic.children.reduce((s, c) => s + countDescendants(c), 0);
      const childY = y + vSpacing;
      let offsetX = cx - availWidth / 2;

      topic.children.forEach(child => {
        const childDesc = countDescendants(child);
        const childWidth = Math.max(minHSpacing, (childDesc / totalDesc) * availWidth);
        const childCx = offsetX + childWidth / 2;
        layoutSubtree(child, childCx, childY, childWidth, depth + 1, topic.id);
        offsetX += childWidth;
      });
    }
  }

  if (topics.length === 0) return { nodes, edges };

  const totalWidth = Math.max(200, topics.length * 100);
  const segmentWidth = totalWidth / topics.length;

  topics.forEach((topic, i) => {
    const cx = segmentWidth * i + segmentWidth / 2;
    layoutSubtree(topic, cx, 30, segmentWidth, 0, null);
  });

  return { nodes, edges };
}

function renderKnowledgeMap() {
  const container = document.getElementById('knowledge-map');
  if (!container) return;

  if (state.topics.length === 0) {
    container.innerHTML = '<div class="sidebar-empty">Your knowledge map will grow as you explore topics.</div>';
    return;
  }

  // Render topics directly - the backend now creates a real root topic with the course name
  const { nodes, edges } = layoutKnowledgeMap(state.topics);
  if (nodes.length === 0) {
    container.innerHTML = '<div class="sidebar-empty">Your knowledge map will grow as you explore topics.</div>';
    return;
  }

  // Calculate bounding box
  const padding = 40;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  });

  const vbX = minX - padding;
  const vbY = minY - padding;
  const vbW = Math.max(maxX - minX + padding * 2, 120);
  const vbH = Math.max(maxY - minY + padding * 2 + 20, 100);

  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  // Build SVG
  let svg = `<svg class="km-svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMin meet">`;

  // Edges
  edges.forEach(e => {
    const from = nodeMap[e.from];
    const to = nodeMap[e.to];
    if (!from || !to) return;
    const midY = (from.y + to.y) / 2;
    svg += `<path class="km-edge" d="M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}" />`;
  });

  // Nodes
  nodes.forEach(n => {
    const isRoot = n.depth === 0; // Root topic has depth 0
    const isCurrent = n.id === state.currentTopicId;
    const isInProgress = n.status === 'in_progress';
    let nodeClass = 'km-node';
    if (isCurrent) nodeClass += ' km-current';
    else if (isRoot) nodeClass += ' km-root';
    else if (isInProgress) nodeClass += ' km-visited';
    else nodeClass += ' km-unvisited';

    const r = isRoot ? 24 : (n.depth <= 1 ? 20 : (n.depth === 2 ? 16 : 13));
    const truncTitle = n.title.length > 14 ? n.title.slice(0, 12) + '..' : n.title;
    const fontSize = isRoot ? 9 : (n.depth <= 1 ? 8.5 : (n.depth === 2 ? 7.5 : 7));

    svg += `<g class="${nodeClass}" data-topic-id="${n.id}" data-topic-title="${n.title.replace(/"/g, '&quot;')}" style="cursor:pointer">`;
    svg += `<title>${n.title}</title>`;
    svg += `<circle cx="${n.x}" cy="${n.y}" r="${r}" />`;
    svg += `<text x="${n.x}" y="${n.y + r + fontSize + 4}" text-anchor="middle" font-size="${fontSize}">${truncTitle}</text>`;
    svg += `</g>`;
  });

  svg += `</svg>`;
  container.innerHTML = svg;

  // Attach click handlers to all topic nodes
  container.querySelectorAll('.km-node').forEach(g => {
    const id = parseInt(g.dataset.topicId);
    g.addEventListener('click', () => {
      const title = g.dataset.topicTitle;
      drillIntoTopic(id, title, true);
    });
  });
}

// ── Topic navigation ──

async function drillIntoTopic(topicId, topicTitle, insertMarker) {
  // Build the path to this topic
  state.topicPath = buildTopicPath(state.topics, topicId);
  state.currentTopicId = topicId;

  if (insertMarker && state.currentConversation) {
    // Notify backend of the branch
    await api(`/api/conversations/${state.currentConversation.id}/branch`, {
      method: 'POST',
      body: JSON.stringify({ topic_id: topicId, topic_title: topicTitle }),
    });
  }

  renderBreadcrumb();

  renderKnowledgeMap();
  filterMessagesByTopic();
  updateDepthIndicator();
  focusInput();
}

// ── Data loading ──

async function loadCourses() {
  const data = await api('/api/courses');
  if (data) state.courses = data;
}

async function loadConversation() {
  if (!state.currentCourse) {
    state.currentConversation = null;
    return;
  }
  // Get the first (most recent) conversation for this course
  const data = await api(`/api/conversations?course_id=${state.currentCourse.id}`);
  if (data && data.length > 0) {
    state.currentConversation = data[0];
  } else {
    state.currentConversation = null;
  }
}

async function loadTopics() {
  if (!state.currentCourse) {
    state.topics = [];

    renderKnowledgeMap();
    return;
  }
  const data = await api(`/api/courses/${state.currentCourse.id}/topics`);
  if (data) state.topics = data;

  renderKnowledgeMap();
}

async function loadAndDisplayMessages() {
  if (!state.currentConversation) return;

  const data = await api(`/api/conversations/${state.currentConversation.id}`);
  if (!data) return;

  state.currentConversation = data;
  clearChatMessages();

  data.messages.forEach(m => {
    addStaticMessage(m.role === 'assistant' ? 'bot' : 'user', m.content, m.topic_id);
  });

  // Set current topic to the last message's topic
  if (data.messages.length > 0) {
    const lastMsg = data.messages[data.messages.length - 1];
    if (lastMsg.topic_id) {
      state.currentTopicId = lastMsg.topic_id;
      state.topicPath = buildTopicPath(state.topics, lastMsg.topic_id);
    }
  }

  const messages = document.getElementById('chat-messages');
  messages.scrollTop = messages.scrollHeight;
  renderBreadcrumb();

  renderKnowledgeMap();
  filterMessagesByTopic();
  updateDepthIndicator();
}

async function createCourseFromInput(text) {
  const messages = document.getElementById('chat-messages');

  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.textContent = text;

  const userWrapper = wrapWithDepthLines(userMsg, null);
  userWrapper.dataset.topicId = '';
  messages.insertBefore(userWrapper, inputLine);
  chatInput.textContent = '';
  messages.scrollTop = messages.scrollHeight;
  lockInput();

  try {
    const courseData = await api('/api/courses', {
      method: 'POST',
      body: JSON.stringify({ name: text.trim() }),
    });

    if (courseData) {
      await loadCourses();
      state.currentCourse = state.courses.find(c => c.id === courseData.id);
      renderTopicList();

      state.currentConversation = {
        id: courseData.conversation_id,
        title: text.trim(),
      };
      state.currentTopicId = null;
      state.topicPath = [];
      await loadTopics();
      renderBreadcrumb();

      // Send first message to AI to get suggestions
      showThinkingIndicator(null);
      try {
        const data = await api('/api/chat', {
          method: 'POST',
          body: JSON.stringify({
            conversation_id: courseData.conversation_id,
            message: `I want to learn about ${text.trim()}`,
            topic_id: null,
            model: state.selectedModel,
          }),
        });

        hideThinkingIndicator();
        if (data && data.reply) {
          await addBotMessage(data.reply);
          if (data.suggestions && data.suggestions.length > 0) {
            addSuggestionChips(data.suggestions, null);
          }
        }
      } catch (err) {
        hideThinkingIndicator();
        await addBotMessage(`Welcome to ${text.trim()}! What would you like to learn about?`);
      }
    }
  } finally {
    unlockInput();
    focusInput();
  }
}

// ── App initialization ──

async function initApp() {
  const user = await api('/api/me');
  if (!user) return;
  state.user = user;
  renderUserInfo();

  await loadCourses();

  if (state.courses.length > 0) {
    state.currentCourse = state.courses[0];
    renderTopicList();

    await loadConversation();
    await loadTopics();

    if (state.currentConversation) {
      await loadAndDisplayMessages();

      if (state.currentConversation.messages && state.currentConversation.messages.length === 0) {
        await sleep(400);
        await addBotMessage("Welcome back! What would you like to study?");
      }
    } else {
      await sleep(400);
      await addBotMessage("Welcome back! Start exploring or ask me anything.");
    }
  } else {
    renderTopicList();
    await sleep(400);
    await addBotMessage("Hey! Welcome to Studium.");
    await sleep(600);
    await addBotMessage("I'm your study companion. To get started, tell me what subject you'd like to study -- for example, ==Linear Algebra== or ==Python==.");
  }

  focusInput();
}
