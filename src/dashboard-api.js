import "./chat-history.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000/api").replace(/\/+$/, "");
const workflowIcons = {
  "calculation-explainer": "calculate",
  "daily-briefing": "today",
  "file-organizer": "folder_zip",
  "goal-planning": "flag",
  "project-assistant": "assignment",
  "research-study": "menu_book",
  "system-check": "verified",
};
const workflowDefaults = {
  expression: "25 * 48",
  topics: "technology, science",
  directory: "",
  title: "",
  projectPath: "",
  topic: "",
  check: "all",
};
let chatBusy = false;
let chatHistoryVersion = 0;
let activeConversationId = null;
let conversations = [];
let pendingDeleteConversationId = null;
let pendingProjectToolToken = null;
let projectToolBusy = false;

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(`Could not connect to Snabbler AI backend at ${API_BASE}. Start the backend with "node server.js".`);
  }

  if (response.status === 204) return null;
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Backend returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const requestId = body.requestId ? ` (request ${body.requestId})` : "";
    throw new Error(`${body.error || `Request failed with HTTP ${response.status}`}${requestId}`);
  }
  return body;
}

function requestJson(method, body) {
  return { method, body: JSON.stringify(body) };
}

function projectToolElements() {
  return {
    projectPath: document.getElementById("manual-project-path"),
    operation: document.getElementById("manual-operation-type"),
    destination: document.getElementById("manual-dest-path"),
    modal: document.getElementById("project-tools-modal"),
  };
}

window.handleOperationChange = function handleOperationChange() {
  const { operation, destination } = projectToolElements();
  const label = document.getElementById("destination-path-label");
  if (!operation || !destination || !label) return;

  const settings = {
    rename: ["New project folder name (same parent)", "renamed-project"],
    move: ["Destination parent folder (absolute)", "C:\\Projects\\destination"],
    create: ["New folder path (relative to project)", "docs"],
    copy: ["Destination parent folder (absolute)", "C:\\Projects\\backups"],
  };
  const [labelText, placeholder] = settings[operation.value] || settings.rename;
  label.textContent = labelText;
  destination.placeholder = placeholder;
};

window.openProjectToolsModal = async function openProjectToolsModal() {
  if (projectToolBusy) return;
  const { projectPath, operation, destination, modal } = projectToolElements();
  const previewButton = document.getElementById("btn-preview-operation");
  const planButton = document.getElementById("btn-plan-operation");
  if (!projectPath || !operation || !destination || !modal) return;
  const projectPathValue = projectPath.value.trim();
  const destinationValue = destination.value.trim();
  const notes = document.getElementById("nl-operation-input")?.value.trim();
  const buttons = [previewButton, planButton].filter(Boolean);

  projectToolBusy = true;
  buttons.forEach(button => { button.disabled = true; });
  try {
    const preview = await apiRequest("/project-tools/preview", requestJson("POST", {
      operation: operation.value,
      projectPath: projectPathValue,
      destination: destinationValue,
    }));
    pendingProjectToolToken = preview.token;
    document.getElementById("modal-operation-desc").textContent = preview.description;
    const details = [...preview.details];
    if (notes) details.push(`Note: ${notes}`);
    const detailElement = document.getElementById("modal-operation-detail");
    detailElement.textContent = details.join("\n");
    detailElement.classList.add("whitespace-pre-wrap");
    const status = modal.querySelector(".text-primary-fixed-dim.font-bold");
    if (status) status.textContent = "PREVIEW READY";
    const confirmButton = modal.querySelector('button[onclick="confirmProjectOperation()"]');
    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.textContent = "Approve & Execute";
    }
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  } catch (error) {
    pendingProjectToolToken = null;
    showStatus(error.message, true);
  } finally {
    projectToolBusy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
};

window.closeProjectToolsModal = function closeProjectToolsModal() {
  const { modal } = projectToolElements();
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  pendingProjectToolToken = null;
};

window.confirmProjectOperation = async function confirmProjectOperation() {
  if (!pendingProjectToolToken || projectToolBusy) return;
  const { modal } = projectToolElements();
  const token = pendingProjectToolToken;
  const confirmButton = modal?.querySelector('button[onclick="confirmProjectOperation()"]');
  const status = modal?.querySelector(".text-primary-fixed-dim.font-bold");
  const description = document.getElementById("modal-operation-desc");
  const details = document.getElementById("modal-operation-detail");

  projectToolBusy = true;
  pendingProjectToolToken = null;
  if (confirmButton) confirmButton.disabled = true;
  if (status) status.textContent = "EXECUTING";
  try {
    const result = await apiRequest("/project-tools/execute", requestJson("POST", { token }));
    if (status) status.textContent = "COMPLETED";
    if (description) description.textContent = result.message;
    if (details) details.textContent = "Operation completed successfully.";
    window.setTimeout(() => window.closeProjectToolsModal(), 1200);
  } catch (error) {
    if (status) status.textContent = "FAILED";
    if (details) details.textContent = error.message;
    showStatus(error.message, true);
  } finally {
    projectToolBusy = false;
    if (confirmButton) confirmButton.disabled = true;
  }
};

function initializeProjectTools() {
  const { projectPath, operation, destination } = projectToolElements();
  if (!projectPath || !operation || !destination) return;

  projectPath.value = "";
  projectPath.placeholder = "Enter the full absolute path to the project folder";
  destination.value = "";
  const notesInput = document.getElementById("nl-operation-input");
  if (notesInput) notesInput.value = "";
  const notesLabel = document.querySelector('label[for="nl-operation-input"]');
  if (notesLabel) notesLabel.textContent = "Operation notes (optional)";

  document.getElementById("folder-picker-input")?.remove();
  projectPath.nextElementSibling?.remove();
  const pathSection = projectPath.parentElement?.parentElement;
  const quickPicks = [...(pathSection?.children || [])].find(child => child.textContent.trim().startsWith("Quick picks:"));
  quickPicks?.remove();
  const pathHelp = document.createElement("p");
  pathHelp.className = "text-label-sm text-on-surface-variant/70";
  pathHelp.textContent = "Enter the real absolute path. Browsers cannot provide it from a folder picker.";
  projectPath.parentElement?.insertAdjacentElement("afterend", pathHelp);

  window.handleOperationChange();
}

function showStatus(message, isError = false) {
  let status = document.getElementById("dashboard-api-status");
  if (!status) {
    status = document.createElement("div");
    status.id = "dashboard-api-status";
    status.className = "mx-auto mt-2 max-w-4xl rounded-lg px-3 py-2 text-label-md";
    const input = document.getElementById("prompt-input");
    const promptPanel = input?.closest(".w-full.bg-surface-container-low");
    promptPanel?.insertAdjacentElement("afterend", status);
  }
  status.classList.toggle("hidden", !message);
  status.classList.toggle("text-error", isError);
  status.classList.toggle("text-primary-fixed-dim", !isError);
  status.textContent = message;
}

function ensureChatPanel() {
  let panel = document.getElementById("dashboard-chat-messages");
  if (panel) return panel;
  panel = document.createElement("div");
  panel.id = "dashboard-chat-messages";
  panel.className = "mx-auto mb-3 w-full max-w-4xl rounded-xl bg-surface-container-low p-3";
  const heading = document.createElement("div");
  heading.className = "mb-2 flex items-center justify-between";
  const title = document.createElement("span");
  title.className = "text-label-sm text-on-surface-variant";
  title.textContent = "Conversation";
  const clearButton = document.createElement("button");
  clearButton.id = "dashboard-chat-clear";
  clearButton.className = "text-label-sm text-on-surface-variant hover:text-error transition-colors";
  clearButton.type = "button";
  clearButton.setAttribute("aria-label", "Clear all chat history");
  clearButton.textContent = "Clear all chats";
  clearButton.addEventListener("click", () => { void window.clearChatHistory(); });
  heading.append(title, clearButton);
  const messages = document.createElement("div");
  messages.id = "dashboard-chat-message-list";
  messages.className = "max-h-52 overflow-y-auto";
  panel.append(heading, messages);
  const prompt = document.getElementById("prompt-input")?.closest(".w-full.bg-surface-container-low");
  prompt?.insertAdjacentElement("beforebegin", panel);
  return panel;
}

function appendChatMessage(role, content) {
  const panel = ensureChatPanel();
  const messages = panel.querySelector("#dashboard-chat-message-list");
  messages?.querySelector(".chat-empty-state")?.remove();
  const row = document.createElement("div");
  row.className = `mb-2 rounded-lg px-3 py-2 text-body-sm whitespace-pre-wrap ${role === "user" ? "ml-8 bg-surface-container-high text-on-surface" : "mr-8 bg-surface-container text-on-surface"}`;
  row.textContent = content;
  messages?.appendChild(row);
  if (messages) messages.scrollTop = messages.scrollHeight;
  return row;
}

function showEmptyChat(messages) {
  const empty = document.createElement("p");
  empty.className = "chat-empty-state py-5 text-center text-body-sm text-on-surface-variant";
  empty.textContent = "Your conversation will appear here.";
  messages.replaceChildren(empty);
}

function renderConversationList() {
  const list = document.getElementById("dashboard-conversation-list");
  if (!list) return;
  list.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty-state px-3 py-5 text-center text-body-sm text-on-surface-variant";
    empty.textContent = "Your conversations will appear here.";
    list.appendChild(empty);
    return;
  }

  for (const conversation of conversations) {
    const item = document.createElement("div");
    item.className = "conversation-history-item";
    item.classList.toggle("selected", conversation.id === activeConversationId);

    const select = document.createElement("button");
    select.type = "button";
    select.className = "conversation-history-select";
    select.disabled = chatBusy;
    select.setAttribute("aria-label", `Open conversation: ${conversation.title || "New conversation"}`);
    select.addEventListener("click", () => { void loadConversation(conversation.id); });
    const title = document.createElement("span");
    title.className = "conversation-history-title";
    title.textContent = conversation.title || "New conversation";
    const preview = document.createElement("span");
    preview.className = "conversation-history-preview";
    preview.textContent = conversation.preview || "No messages yet";
    const date = document.createElement("time");
    date.className = "conversation-history-date";
    const updatedAt = new Date(conversation.updatedAt);
    date.textContent = Number.isNaN(updatedAt.getTime()) ? "" : updatedAt.toLocaleDateString();
    select.append(title, preview, date);

    if (pendingDeleteConversationId === conversation.id) {
      const confirmation = document.createElement("div");
      confirmation.className = "conversation-delete-confirmation";
      const prompt = document.createElement("span");
      prompt.textContent = "Delete this chat?";
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "conversation-delete-confirm";
      confirm.textContent = "Delete";
      confirm.disabled = chatBusy;
      confirm.addEventListener("click", () => { void deleteConversation(conversation); });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "conversation-delete-cancel";
      cancel.textContent = "Cancel";
      cancel.disabled = chatBusy;
      cancel.addEventListener("click", () => {
        pendingDeleteConversationId = null;
        renderConversationList();
      });
      confirmation.append(prompt, confirm, cancel);
      item.append(select, confirmation);
    } else {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "conversation-delete-button";
      remove.disabled = chatBusy;
      remove.setAttribute("aria-label", `Delete conversation: ${conversation.title || "New conversation"}`);
      remove.title = "Delete this conversation";
      remove.textContent = "×";
      remove.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        pendingDeleteConversationId = conversation.id;
        renderConversationList();
      });
      item.append(select, remove);
    }
    list.appendChild(item);
  }
}

async function deleteConversation(conversation) {
  if (chatBusy) return;
  chatBusy = true;
  chatHistoryVersion += 1;
  renderConversationList();
  try {
    await apiRequest(`/conversations/${encodeURIComponent(conversation.id)}`, { method: "DELETE" });
    conversations = conversations.filter(item => item.id !== conversation.id);
    if (activeConversationId === conversation.id) activeConversationId = null;
    pendingDeleteConversationId = null;
    showStatus("Conversation deleted.");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    chatBusy = false;
    renderConversationList();
  }

  await loadChatHistory();
}

function renderConversationMessages(messages) {
  const container = ensureChatPanel().querySelector("#dashboard-chat-message-list");
  container.replaceChildren();
  for (const message of messages) appendChatMessage(message.role, message.content);
  if (!messages.length) showEmptyChat(container);
}

async function loadConversation(conversationId) {
  if (chatBusy) return;
  const historyVersion = ++chatHistoryVersion;
  activeConversationId = conversationId;
  renderConversationList();
  const container = ensureChatPanel().querySelector("#dashboard-chat-message-list");
  container.replaceChildren();
  if (!conversationId) {
    showEmptyChat(container);
    showStatus("");
    return;
  }

  try {
    const messages = await apiRequest(`/conversations/${encodeURIComponent(conversationId)}/messages`);
    if (historyVersion !== chatHistoryVersion) return;
    renderConversationMessages(messages);
    showStatus("");
  } catch (error) {
    if (historyVersion !== chatHistoryVersion) return;
    showStatus(error.message, true);
  }
}

async function loadChatHistory() {
  const historyVersion = ++chatHistoryVersion;
  try {
    const result = await apiRequest("/conversations?limit=100");
    if (historyVersion !== chatHistoryVersion) return;
    conversations = Array.isArray(result) ? result : [];
    const selectedConversation = conversations.some(item => item.id === activeConversationId)
      ? activeConversationId
      : conversations[0]?.id || null;
    activeConversationId = selectedConversation;
    renderConversationList();
    if (!selectedConversation) {
      renderConversationMessages([]);
      return;
    }

    const messages = await apiRequest(`/conversations/${encodeURIComponent(selectedConversation)}/messages`);
    if (historyVersion !== chatHistoryVersion) return;
    renderConversationMessages(messages);
    showStatus("");
  } catch (error) {
    if (historyVersion !== chatHistoryVersion) return;
    showStatus(error.message, true);
  }
}

function startNewConversation() {
  if (chatBusy) return;
  void loadConversation(null);
}

window.clearChatHistory = async function clearChatHistory() {
  if (chatBusy || !window.confirm("Clear all saved chat messages? This cannot be undone.")) return;
  chatBusy = true;
  chatHistoryVersion += 1;
  const clearButton = document.getElementById("dashboard-chat-clear");
  if (clearButton) clearButton.disabled = true;
  try {
    await apiRequest("/chat/history", { method: "DELETE" });
    conversations = [];
    activeConversationId = null;
    renderConversationList();
    renderConversationMessages([]);
    showStatus("All chat history cleared.");
  } catch (error) {
    showStatus(error.message, true);
    await loadChatHistory();
  } finally {
    chatBusy = false;
    if (clearButton) clearButton.disabled = false;
  }
};

window.handleDispatch = async function handleDispatch() {
  const input = document.getElementById("prompt-input");
  const sendButton = input?.parentElement?.querySelector("button");
  const message = input?.value.trim();
  if (!input || !message || chatBusy || sendButton?.disabled) return;

  if (document.getElementById("active-attachments-list")?.children.length) {
    showStatus("File attachments are not connected to the backend yet. Remove them to send a text message.", true);
    return;
  }

  if (message.length > 4000) {
    showStatus("Messages must be 4000 characters or fewer.", true);
    return;
  }

  chatBusy = true;
  renderConversationList();
  sendButton.disabled = true;
  const clearButton = document.getElementById("dashboard-chat-clear");
  if (clearButton) clearButton.disabled = true;
  input.disabled = true;
  input.value = "";
  const userRow = appendChatMessage("user", message);
  const pendingRow = appendChatMessage("assistant", "Thinking…");
  showStatus("");
  try {
    const result = await apiRequest("/chat", requestJson("POST", {
      message,
      ...(activeConversationId ? { conversationId: activeConversationId } : {}),
    }));
    activeConversationId = result.conversationId;
    pendingRow.textContent = result.answer;
    await loadChatHistory();
  } catch (error) {
    userRow.remove();
    pendingRow.remove();
    input.value = message;
    showStatus(error.message, true);
  } finally {
    chatBusy = false;
    renderConversationList();
    sendButton.disabled = false;
    if (clearButton) clearButton.disabled = false;
    input.disabled = false;
    input.focus();
  }
};

function memoryCategoryClass(category) {
  if (category === "Personal") return "text-secondary-fixed-dim";
  if (category === "Goals") return "text-primary";
  if (category === "Directives") return "text-primary-fixed";
  return "text-primary-fixed-dim";
}

function formatMemoryDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Saved" : `Added: ${date.toLocaleDateString()}`;
}

function renderMemoryCard(memory) {
  const card = document.createElement("div");
  card.className = "memory-card bg-surface-container-low p-4 rounded-xl flex flex-col gap-2 shadow-sm transition-all hover:bg-surface-container";
  card.dataset.memoryId = memory.id;
  card.dataset.category = memory.category || "General";
  card.dataset.priority = memory.priority || "Normal";

  const top = document.createElement("div");
  top.className = "flex items-center justify-between";
  const category = document.createElement("span");
  category.className = `font-label-sm text-label-sm ${memoryCategoryClass(memory.category)} bg-surface-container-high px-2 py-0.5 rounded font-semibold uppercase`;
  category.textContent = memory.category;
  const actions = document.createElement("div");
  actions.className = "flex items-center gap-1";

  const edit = document.createElement("button");
  edit.className = "memory-action p-1 text-on-surface-variant hover:text-primary transition-colors";
  edit.type = "button";
  edit.setAttribute("aria-label", "Edit memory");
  edit.innerHTML = '<span class="material-symbols-outlined text-base">edit</span>';
  edit.addEventListener("click", () => { void window.editMemoryCard(edit); });

  const remove = document.createElement("button");
  remove.className = "memory-action p-1 text-on-surface-variant hover:text-error transition-colors";
  remove.type = "button";
  remove.setAttribute("aria-label", "Delete memory");
  remove.innerHTML = '<span class="material-symbols-outlined text-base">delete</span>';
  remove.addEventListener("click", () => { void window.deleteMemoryCard(remove); });

  actions.append(edit, remove);
  top.append(category, actions);
  const text = document.createElement("p");
  text.className = "memory-text font-body-md text-body-md text-on-surface";
  text.textContent = memory.text;
  const meta = document.createElement("span");
  meta.className = "memory-meta font-label-sm text-label-sm text-on-surface-variant/70";
  meta.textContent = `${formatMemoryDate(memory.createdAt)} · Priority: ${memory.priority}`;
  card.append(top, text, meta);
  return card;
}

async function refreshMemories() {
  const container = document.getElementById("memory-cards-container");
  if (!container) return;
  container.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "empty-state font-body-sm text-on-surface-variant";
  loading.textContent = "Loading saved memories…";
  container.appendChild(loading);
  try {
    const memories = await apiRequest("/memories");
    container.replaceChildren();
    if (!memories.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state font-body-sm text-on-surface-variant";
      empty.textContent = "No saved memories yet. Add one using the form.";
      container.appendChild(empty);
    } else {
      memories.forEach(memory => container.appendChild(renderMemoryCard(memory)));
    }
    const count = document.getElementById("mem-count");
    if (count) count.textContent = String(memories.length);
    const encryptionLabel = [...document.querySelectorAll("#view-memory span")]
      .find(element => element.textContent.trim().startsWith("Encryption:"));
    if (encryptionLabel) encryptionLabel.textContent = "Stored in local SQLite";
  } catch (error) {
    container.replaceChildren();
    const failure = document.createElement("div");
    failure.className = "empty-state font-body-sm text-error";
    failure.textContent = error.message;
    container.appendChild(failure);
  }
}

window.updateMemCharCount = function updateMemCharCount() {
  const input = document.getElementById("mem-content-input");
  const count = document.getElementById("mem-char-count");
  if (input && count) count.textContent = `${input.value.length} / 500`;
};

window.clearMemoryForm = function clearMemoryForm() {
  const input = document.getElementById("mem-content-input");
  if (input) input.value = "";
  window.updateMemCharCount();
};

window.showMemoryToast = function showMemoryToast(message, isError = false) {
  const toast = document.getElementById("mem-feedback-toast");
  const text = document.getElementById("mem-feedback-msg");
  if (!toast || !text) return;
  text.textContent = message;
  toast.classList.toggle("text-error", isError);
  toast.classList.toggle("text-primary", !isError);
  const icon = toast.querySelector(".material-symbols-outlined");
  if (icon) icon.textContent = isError ? "error" : "check_circle";
  toast.classList.remove("hidden");
  toast.classList.add("flex");
  window.setTimeout(() => {
    toast.classList.add("hidden");
    toast.classList.remove("flex");
  }, 3500);
};

window.saveMemory = async function saveMemory() {
  const content = document.getElementById("mem-content-input");
  const category = document.getElementById("mem-category-select")?.value || "General";
  const requestedPriority = document.getElementById("mem-priority-select")?.value;
  const priority = ["Low", "Normal", "High", "Critical"].includes(requestedPriority) ? requestedPriority : "Normal";
  const text = content?.value.trim();
  if (!text) {
    content?.focus();
    return;
  }
  if (text.length > 500) {
    window.showMemoryToast("Memory text must be 500 characters or fewer.", true);
    return;
  }
  const button = document.getElementById("btn-commit-memory");
  if (button) button.disabled = true;
  try {
    await apiRequest("/memories", requestJson("POST", { text, category, priority }));
    window.clearMemoryForm();
    await refreshMemories();
    window.showMemoryToast(`Committed "${category}" node into memory.`);
  } catch (error) {
    window.showMemoryToast(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
};

window.editMemoryCard = function editMemoryCard(button) {
  const card = button.closest(".memory-card");
  const memoryText = card?.querySelector(".memory-text");
  if (!card || !memoryText || card.querySelector(".memory-edit-form")) return;

  const form = document.createElement("form");
  form.className = "memory-edit-form flex flex-col gap-2";
  const editor = document.createElement("textarea");
  editor.className = "w-full bg-surface-container-lowest border border-surface-container-highest rounded-lg p-2.5 text-on-surface font-body-sm focus:outline-none focus:border-primary-container/60";
  editor.setAttribute("aria-label", "Edit memory content");
  editor.maxLength = 500;
  editor.rows = 4;
  editor.required = true;
  editor.value = memoryText.textContent || "";

  const actions = document.createElement("div");
  actions.className = "flex items-center justify-end gap-2";
  const cancel = document.createElement("button");
  cancel.className = "px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface text-label-md hover:bg-surface-container-highest";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    form.remove();
    memoryText.hidden = false;
    card.querySelector(".memory-meta")?.removeAttribute("hidden");
    card.querySelectorAll(".memory-action").forEach(action => { action.disabled = false; });
  });

  const save = document.createElement("button");
  save.className = "px-3 py-1.5 rounded-lg bg-primary-container text-on-primary-container text-label-md font-semibold hover:bg-primary-fixed-dim";
  save.type = "submit";
  save.textContent = "Save changes";
  actions.append(cancel, save);
  form.append(editor, actions);
  form.addEventListener("submit", event => {
    event.preventDefault();
    void window.saveMemoryCard(form);
  });

  memoryText.hidden = true;
  card.querySelector(".memory-meta")?.setAttribute("hidden", "");
  card.querySelectorAll(".memory-action").forEach(action => { action.disabled = true; });
  memoryText.insertAdjacentElement("afterend", form);
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
};

window.saveMemoryCard = async function saveMemoryCard(form) {
  const card = form.closest(".memory-card");
  const editor = form.querySelector("textarea");
  const text = editor?.value.trim();
  if (!card || !editor || !text) {
    editor?.focus();
    return;
  }
  if (text.length > 500) {
    window.showMemoryToast("Memory text must be 500 characters or fewer.", true);
    return;
  }

  const buttons = [...form.querySelectorAll("button")];
  buttons.forEach(button => { button.disabled = true; });
  try {
    await apiRequest(`/memories/${encodeURIComponent(card.dataset.memoryId)}`, requestJson("PUT", {
      text: text.trim(),
      category: card.dataset.category || "General",
      priority: card.dataset.priority || "Normal",
    }));
    await refreshMemories();
    window.showMemoryToast("Memory updated.");
  } catch (error) {
    window.showMemoryToast(error.message, true);
    buttons.forEach(button => { button.disabled = false; });
  }
};

window.deleteMemoryCard = async function deleteMemoryCard(button) {
  const card = button.closest(".memory-card");
  if (!card || !window.confirm("Delete this saved memory? This cannot be undone.")) return;
  try {
    await apiRequest(`/memories/${encodeURIComponent(card.dataset.memoryId)}`, { method: "DELETE" });
    await refreshMemories();
    window.showMemoryToast("Memory deleted.");
  } catch (error) {
    window.showMemoryToast(error.message, true);
  }
};

function statusLabel(status) {
  return String(status || "unknown").replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function friendlyDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

let workflows = [];
let selectedWorkflow = null;
let selectedRun = null;
let historyFilter = "";
let pollTimer = null;

function renderWorkflowCards() {
  const container = document.getElementById("studio-workflow-list");
  if (!container) return;
  container.replaceChildren();
  for (const workflow of workflows) {
    const card = document.createElement("div");
    card.className = "p-3.5 rounded-xl hover:bg-surface-container-high cursor-pointer transition-all flex items-center justify-between border hover:border-primary-container/20 bg-surface-container-low border-transparent";
    card.dataset.workflowId = workflow.id;
    card.addEventListener("click", () => window.selectStudioWorkflow(workflow.id));

    const detail = document.createElement("div");
    detail.className = "flex items-center gap-3";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-on-surface-variant";
    icon.textContent = workflowIcons[workflow.id] || "account_tree";
    const copy = document.createElement("div");
    const title = document.createElement("h4");
    title.className = "font-headline-sm text-headline-sm font-medium text-on-surface";
    title.textContent = workflow.name;
    const description = document.createElement("p");
    description.className = "font-body-sm text-body-sm text-on-surface-variant";
    description.textContent = workflow.description;
    copy.append(title, description);
    detail.append(icon, copy);
    const version = document.createElement("span");
    version.className = "font-label-sm text-label-sm text-on-surface-variant bg-surface-container px-2 py-0.5 rounded font-mono";
    version.textContent = `v${workflow.version}`;
    card.append(detail, version);
    container.appendChild(card);
  }
  const countLabel = document.querySelector("#view-studio .uppercase.tracking-wider");
  if (countLabel) countLabel.textContent = `Available Workflows (${workflows.length})`;
}

function renderWorkflowInputs(workflow) {
  const container = document.getElementById("studio-inputs-container");
  if (!container) return;
  container.replaceChildren();
  for (const definition of workflow.inputs || []) {
    const row = document.createElement("div");
    row.className = "flex flex-col gap-1.5";
    const header = document.createElement("div");
    header.className = "flex items-center justify-between text-body-sm px-1";
    const label = document.createElement("label");
    label.className = "text-on-surface font-semibold flex items-center gap-1.5";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-primary-fixed-dim text-base";
    icon.textContent = "tune";
    label.append(icon, document.createTextNode(definition.name.replaceAll("_", " ")));
    const meta = document.createElement("span");
    meta.className = "text-on-surface-variant/70 text-label-sm font-mono";
    meta.textContent = `${definition.required ? "Required" : "Optional"} · ${definition.type}`;
    header.append(label, meta);

    const input = document.createElement(definition.type === "array" || definition.type === "object" ? "textarea" : "input");
    input.id = `studio-input-${definition.name}`;
    input.dataset.workflowInput = definition.name;
    input.className = "w-full bg-surface-container-lowest border border-surface-container-highest rounded-xl p-3.5 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary-container/60 transition-colors text-body-md font-mono";
    input.placeholder = `Enter ${definition.name.replaceAll("_", " ")}`;
    input.required = Boolean(definition.required);
    if (definition.type === "number") input.type = "number";
    if (definition.type === "boolean") {
      input.type = "checkbox";
      input.className = "h-5 w-5 accent-cyan-400";
    } else {
      input.value = workflowDefaults[definition.name] || "";
      if (definition.type === "object") input.placeholder = '{"key":"value"}';
      if (definition.type === "array") input.placeholder = "Enter items separated by commas";
    }
    label.htmlFor = input.id;
    row.append(header, input);
    container.appendChild(row);
  }
}

function renderWorkflowSteps(workflow) {
  const list = document.getElementById("studio-steps-list");
  if (!list) return;
  list.replaceChildren();
  workflow.steps.forEach((step, index) => {
    const row = document.createElement("div");
    row.id = `studio-step-${index + 1}`;
    row.className = "flex items-center gap-4 w-full p-2.5 rounded-xl transition-all border border-surface-container-highest/40 bg-surface-container-lowest/50";
    const number = document.createElement("span");
    number.className = "w-8 h-8 rounded-full bg-surface-container-highest/60 border border-surface-container-highest flex items-center justify-center text-label-sm text-on-surface-variant font-mono font-medium shrink-0";
    number.textContent = String(index + 1);
    const copy = document.createElement("div");
    copy.className = "flex flex-col flex-1";
    const title = document.createElement("span");
    title.className = "text-body-md font-semibold text-on-surface";
    title.textContent = step.id;
    const tool = document.createElement("span");
    tool.className = "text-label-sm text-on-surface-variant/70 font-mono";
    tool.textContent = `${step.tool}${step.approval === "required" ? " · approval required" : ""}`;
    copy.append(title, tool);
    const state = document.createElement("span");
    state.className = "text-label-sm text-on-surface-variant/50 material-symbols-outlined text-base";
    state.textContent = "radio_button_unchecked";
    row.append(number, copy, state);
    list.appendChild(row);
  });
  const count = document.getElementById("pipeline-total-steps");
  if (count) count.textContent = `${workflow.steps.length} STEPS`;
}

window.selectStudioWorkflow = function selectStudioWorkflow(workflowIdOrName) {
  const workflow = workflows.find(item => item.id === workflowIdOrName || item.name === workflowIdOrName);
  if (!workflow) return;
  selectedWorkflow = workflow;
  window.currentWorkflow = workflow.id;
  const title = document.getElementById("studio-title");
  const version = document.getElementById("studio-version-tag");
  const description = document.getElementById("studio-description");
  if (title) title.textContent = workflow.name;
  if (version) version.textContent = `v${workflow.version}`;
  if (description) description.textContent = workflow.description;
  document.querySelectorAll("#studio-workflow-list > div").forEach(card => {
    const active = card.dataset.workflowId === workflow.id;
    card.classList.toggle("bg-surface-container-high", active);
    card.classList.toggle("shadow-sm", active);
    card.classList.toggle("border-primary-container/30", active);
    card.classList.toggle("bg-surface-container-low", !active);
    card.classList.toggle("border-transparent", !active);
    card.querySelector("h4")?.classList.toggle("text-primary", active);
    card.querySelector("h4")?.classList.toggle("text-on-surface", !active);
    card.querySelector(".material-symbols-outlined")?.classList.toggle("text-primary-fixed-dim", active);
    card.querySelector(".material-symbols-outlined")?.classList.toggle("text-on-surface-variant", !active);
  });
  renderWorkflowInputs(workflow);
  renderWorkflowSteps(workflow);
  const status = document.getElementById("studio-status");
  status?.classList.add("hidden");
  document.getElementById("studio-telemetry-result-wrapper")?.classList.add("hidden");
  const badge = document.getElementById("studio-status-badge");
  badge?.classList.add("hidden");
};

function getWorkflowInputs(workflow) {
  const inputs = {};
  for (const definition of workflow.inputs || []) {
    const control = document.querySelector(`[data-workflow-input="${CSS.escape(definition.name)}"]`);
    if (!control) continue;
    let value = definition.type === "boolean" ? control.checked : control.value.trim();
    if (typeof value === "string" && !value) {
      if (definition.required) throw new Error(`${definition.name} is required.`);
      continue;
    }
    if (definition.type === "array") value = value.split(",").map(item => item.trim()).filter(Boolean);
    if (definition.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value)) throw new Error(`${definition.name} must be a valid number.`);
    }
    if (definition.type === "object") {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error(`${definition.name} must be valid JSON.`);
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${definition.name} must be a JSON object.`);
    }
    inputs[definition.name] = value;
  }
  return inputs;
}

function renderStudioRun(run) {
  const status = document.getElementById("studio-status");
  const badge = document.getElementById("studio-status-badge");
  status?.classList.remove("hidden");
  badge?.classList.remove("hidden");
  const badgeText = document.getElementById("studio-status-badge-text");
  if (badgeText) badgeText.textContent = statusLabel(run.status);
  const headline = document.getElementById("studio-status-headline");
  if (headline) headline.textContent = `Workflow ${statusLabel(run.status)}`;
  const description = document.getElementById("studio-status-desc");
  if (description) description.textContent = run.error || `Workflow run ${run.runId}`;
  const icon = document.getElementById("studio-status-icon");
  if (icon) icon.textContent = ["completed", "completed_with_skips"].includes(run.status) ? "check_circle" : run.status === "failed" ? "error" : "sync";
  const timer = document.getElementById("studio-status-timer");
  if (timer) timer.textContent = friendlyDate(run.updatedAt);
  const result = document.getElementById("studio-telemetry-result");
  if (result) {
    const lastResult = [...(run.steps || [])].reverse().find(step => step.result !== null && step.result !== undefined)?.result;
    result.textContent = lastResult === undefined ? "No step output recorded." : JSON.stringify(lastResult, null, 2);
  }
  const summary = document.getElementById("studio-summary-text");
  if (summary) summary.textContent = run.error || `Run status: ${statusLabel(run.status)}.`;
  const resultWrapper = document.getElementById("studio-telemetry-result-wrapper");
  if (resultWrapper) resultWrapper.classList.toggle("hidden", !(run.steps || []).some(step => step.result !== null && step.result !== undefined));
  const log = document.getElementById("studio-live-logs");
  if (log) {
    log.replaceChildren();
    for (const step of run.steps || []) {
      const entry = document.createElement("div");
      entry.className = "flex items-center justify-between text-body-sm text-on-surface-variant";
      entry.textContent = `${step.stepId}: ${statusLabel(step.state)}${step.error ? ` — ${step.error}` : ""}`;
      log.appendChild(entry);
    }
  }
  (run.steps || []).forEach((step, index) => {
    const state = document.querySelector(`#studio-step-${index + 1} .material-symbols-outlined`);
    if (state) state.textContent = step.state === "succeeded" ? "check_circle" : step.state === "failed" ? "error" : step.state === "waiting_for_approval" ? "pending" : step.state === "running" ? "sync" : "radio_button_unchecked";
  });
  if (run.status === "waiting_for_approval") {
    addApprovalControls(document.getElementById("studio-status"), run);
  }
  if (["ready", "in_progress"].includes(run.status)) {
    let cancel = document.getElementById("studio-cancel-workflow");
    if (!cancel) {
      cancel = document.createElement("button");
      cancel.id = "studio-cancel-workflow";
      cancel.className = "px-3 py-2 rounded-lg bg-error-container text-on-error-container text-label-md font-label-md";
      cancel.textContent = "Cancel workflow";
      cancel.addEventListener("click", async () => {
        cancel.disabled = true;
        try {
          await apiRequest(`/workflow-runs/${encodeURIComponent(run.runId)}/cancel`, { method: "POST" });
          await pollWorkflow(run.runId);
        } catch (error) {
          showStatus(error.message, true);
          cancel.disabled = false;
        }
      });
    }
    document.getElementById("studio-status")?.appendChild(cancel);
  } else {
    document.getElementById("studio-cancel-workflow")?.remove();
  }
}

function addApprovalControls(container, run) {
  container.querySelectorAll(".api-approval-controls").forEach(control => control.remove());
  const step = (run.steps || []).find(item => item.state === "waiting_for_approval");
  if (!step) return;
  const controls = document.createElement("div");
  controls.className = "api-approval-controls flex items-center gap-2";
  for (const approved of [true, false]) {
    const button = document.createElement("button");
    button.className = approved
      ? "px-3 py-2 rounded-lg bg-primary-container text-on-primary-container text-label-md font-label-md"
      : "px-3 py-2 rounded-lg bg-error-container text-on-error-container text-label-md font-label-md";
    button.textContent = approved ? "Approve step" : "Decline step";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const updated = await apiRequest(`/workflow-runs/${encodeURIComponent(run.runId)}/approval`, requestJson("POST", { stepId: step.stepId, approved }));
        await pollWorkflow(updated.runId);
      } catch (error) {
        showStatus(error.message, true);
        button.disabled = false;
      }
    });
    controls.appendChild(button);
  }
  container.appendChild(controls);
}

async function pollWorkflow(runId) {
  if (pollTimer) window.clearTimeout(pollTimer);
  const run = await apiRequest(`/workflow-runs/${encodeURIComponent(runId)}`);
  selectedRun = run;
  renderStudioRun(run);
  await loadWorkflowHistory();
  if (["ready", "in_progress"].includes(run.status)) {
    window.isWorkflowRunning = true;
    pollTimer = window.setTimeout(() => {
      void pollWorkflow(runId).catch(error => showStatus(error.message, true));
    }, 850);
  } else {
    window.isWorkflowRunning = false;
  }
  return run;
}

window.triggerStudioRun = async function triggerStudioRun() {
  if (!selectedWorkflow || window.isWorkflowRunning) return;
  let inputs;
  try {
    inputs = getWorkflowInputs(selectedWorkflow);
  } catch (error) {
    showStatus(error.message, true);
    return;
  }
  window.isWorkflowRunning = true;
  const button = document.getElementById("studio-cta-btn");
  const label = document.getElementById("studio-cta-text");
  if (button) button.disabled = true;
  if (label) label.textContent = "Starting workflow…";
  try {
    const run = await apiRequest(`/workflows/${encodeURIComponent(selectedWorkflow.id)}/runs`, requestJson("POST", { inputs }));
    selectedRun = run;
    renderStudioRun(run);
    await pollWorkflow(run.runId);
    const historyNav = document.querySelector('a[data-path="workflow-history"]');
    if (historyNav) historyNav.dataset.latestRunId = run.runId;
  } catch (error) {
    window.isWorkflowRunning = false;
    showStatus(error.message, true);
    const status = document.getElementById("studio-status");
    status?.classList.remove("hidden");
    const desc = document.getElementById("studio-status-desc");
    if (desc) desc.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
    if (label) label.textContent = "Start workflow";
  }
};

window.resetInputField = function resetInputField() {
  if (selectedWorkflow) renderWorkflowInputs(selectedWorkflow);
};

window.clearStudioOutput = function clearStudioOutput() {
  if (window.isWorkflowRunning) return;
  document.getElementById("studio-status")?.classList.add("hidden");
  document.getElementById("studio-telemetry-result-wrapper")?.classList.add("hidden");
  document.getElementById("studio-status-badge")?.classList.add("hidden");
  if (selectedWorkflow) renderWorkflowSteps(selectedWorkflow);
};

window.resetStudioWorkflow = function resetStudioWorkflow() {
  if (selectedWorkflow) window.selectStudioWorkflow(selectedWorkflow.id);
};

window.copyStudioResult = async function copyStudioResult() {
  const result = document.getElementById("studio-telemetry-result")?.textContent;
  if (!result) return;
  try {
    await navigator.clipboard.writeText(result);
    const label = document.getElementById("studio-result-status-tag");
    if (label) label.textContent = "COPIED";
  } catch (error) {
    showStatus(`Could not copy the result: ${error.message}`, true);
  }
};

function renderHistoryCard(run, workflowName) {
  const card = document.createElement("div");
  card.id = `hist-card-${run.runId}`;
  card.dataset.runId = run.runId;
  card.className = "p-4 rounded-xl bg-surface-container-low cursor-pointer transition-all hover:bg-surface-container-high flex flex-col gap-2";
  card.addEventListener("click", () => { void window.selectHistory(run.runId); });
  const top = document.createElement("div");
  top.className = "flex items-center justify-between";
  const name = document.createElement("span");
  name.className = "font-headline-sm text-headline-sm text-on-surface font-semibold";
  name.textContent = workflowName;
  const state = document.createElement("span");
  state.className = "font-label-sm text-label-sm text-primary-fixed-dim bg-surface-container px-2 py-0.5 rounded";
  state.textContent = statusLabel(run.status);
  top.append(name, state);
  const id = document.createElement("p");
  id.className = "font-body-sm text-body-sm text-on-surface-variant truncate";
  id.textContent = `Run ID: ${run.runId}`;
  const bottom = document.createElement("div");
  bottom.className = "flex items-center justify-between pt-1";
  const time = document.createElement("span");
  time.className = "font-label-sm text-label-sm text-on-surface-variant/80";
  time.textContent = friendlyDate(run.updatedAt || run.createdAt);
  const remove = document.createElement("button");
  remove.className = "text-on-surface-variant hover:text-error transition-colors p-1";
  remove.type = "button";
  remove.title = "Delete run";
  remove.innerHTML = '<span class="material-symbols-outlined text-base">delete</span>';
  remove.addEventListener("click", event => {
    event.stopPropagation();
    void window.deleteHistoryItem(remove);
  });
  bottom.append(time, remove);
  card.append(top, id, bottom);
  return card;
}

function historyListElement() {
  const view = document.getElementById("view-history");
  return view?.querySelector(".grid.grid-cols-12 > div:first-child > .flex.flex-col.gap-2");
}

async function loadWorkflowHistory() {
  const list = historyListElement();
  if (!list) return;
  try {
    const runs = await apiRequest("/workflow-runs");
    const workflowsById = new Map(workflows.map(item => [item.id, item.name]));
    const visible = historyFilter ? runs.filter(run => run.status === historyFilter) : runs;
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "p-4 rounded-xl bg-surface-container-low text-body-sm text-on-surface-variant";
      empty.textContent = historyFilter ? `No ${statusLabel(historyFilter).toLowerCase()} runs.` : "No workflow runs yet.";
      list.appendChild(empty);
    } else {
      visible.forEach(run => list.appendChild(renderHistoryCard(run, workflowsById.get(run.workflowId) || run.workflowId)));
    }
    const total = document.querySelector("#view-history .p-3.bg-surface-container-low span:first-child");
    if (total) total.textContent = `Total Runs: ${runs.length}`;
    if (!selectedRun && runs.length) await window.selectHistory(runs[0].runId);
  } catch (error) {
    list.replaceChildren();
    const failure = document.createElement("div");
    failure.className = "p-4 rounded-xl bg-surface-container-low text-body-sm text-error";
    failure.textContent = error.message;
    list.appendChild(failure);
  }
}

window.selectHistory = async function selectHistory(runId) {
  if (!runId) return;
  try {
    const run = await apiRequest(`/workflow-runs/${encodeURIComponent(runId)}`);
    selectedRun = run;
    const workflow = workflows.find(item => item.id === run.workflowId);
    const title = document.getElementById("hist-detail-title");
    const id = document.getElementById("hist-detail-id");
    const duration = document.getElementById("hist-detail-dur");
    const outcome = document.getElementById("hist-detail-outcome");
    if (title) title.textContent = (workflow?.name || run.workflowId).toUpperCase();
    if (id) id.textContent = run.runId;
    if (duration) {
      const start = new Date(run.createdAt).getTime();
      const end = new Date(run.updatedAt).getTime();
      duration.textContent = Number.isFinite(start) && Number.isFinite(end) ? `${Math.max(0, end - start)} ms` : "—";
    }
    if (outcome) outcome.textContent = run.error || statusLabel(run.status);
    const view = document.getElementById("view-history");
    const trace = view?.querySelector(".bg-surface-container-lowest.p-3\\.5");
    if (trace) {
      trace.replaceChildren();
      for (const step of run.steps || []) {
        const item = document.createElement("div");
        item.className = "flex items-center justify-between text-label-sm text-primary-fixed-dim";
        const name = document.createElement("span");
        name.textContent = step.stepId;
        const state = document.createElement("span");
        state.className = "text-on-surface-variant";
        state.textContent = statusLabel(step.state);
        item.append(name, state);
        trace.appendChild(item);
        if (step.error) {
          const error = document.createElement("p");
          error.className = "text-error text-body-sm";
          error.textContent = step.error;
          trace.appendChild(error);
        }
        if (step.result !== null && step.result !== undefined) {
          const output = document.createElement("pre");
          output.className = "bg-surface-container p-2.5 rounded text-primary text-label-md leading-relaxed whitespace-pre-wrap";
          output.textContent = JSON.stringify(step.result, null, 2);
          trace.appendChild(output);
        }
      }
      if (run.error) {
        const error = document.createElement("p");
        error.className = "text-error text-body-sm";
        error.textContent = run.error;
        trace.appendChild(error);
      }
      const approval = trace.querySelector(".api-approval-controls");
      approval?.remove();
      if (run.status === "waiting_for_approval") addApprovalControls(trace, run);
    }
    view?.querySelectorAll("[data-run-id]").forEach(card => {
      const active = card.dataset.runId === run.runId;
      card.classList.toggle("bg-surface-container-high", active);
      card.classList.toggle("bg-surface-container-low", !active);
    });
  } catch (error) {
    showStatus(error.message, true);
  }
};

window.deleteHistoryItem = async function deleteHistoryItem(button) {
  const card = button.closest("[data-run-id]");
  const runId = card?.dataset.runId || selectedRun?.runId;
  if (!runId || !window.confirm("Delete this workflow run and its event history?")) return;
  try {
    await apiRequest(`/workflow-runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
    if (selectedRun?.runId === runId) selectedRun = null;
    await loadWorkflowHistory();
    showStatus("Workflow history deleted.");
  } catch (error) {
    showStatus(error.message, true);
  }
};

function bindHistoryActions() {
  const view = document.getElementById("view-history");
  const buttons = [...(view?.querySelectorAll("button") || [])];
  const live = buttons.find(button => button.textContent.includes("Live Stream"));
  live?.addEventListener("click", () => { void loadWorkflowHistory(); });
  const filter = buttons.find(button => button.textContent.includes("Filter Runs"));
  filter?.addEventListener("click", () => {
    const states = ["", "completed", "failed", "cancelled", "waiting_for_approval"];
    const current = states.indexOf(historyFilter);
    historyFilter = states[(current + 1) % states.length];
    filter.setAttribute("aria-label", historyFilter ? `Filter: ${statusLabel(historyFilter)}` : "Filter: all runs");
    void loadWorkflowHistory();
  });
  const rerun = buttons.find(button => button.textContent.includes("Rerun"));
  rerun?.addEventListener("click", async () => {
    if (!selectedRun) return;
    try {
      const run = await apiRequest(`/workflows/${encodeURIComponent(selectedRun.workflowId)}/runs`, requestJson("POST", { inputs: selectedRun.inputs || {} }));
      selectedRun = run;
      await pollWorkflow(run.runId);
    } catch (error) {
      showStatus(error.message, true);
    }
  });
  const remove = buttons.find(button => button.textContent.includes("Delete Run"));
  remove?.addEventListener("click", () => { void window.deleteHistoryItem(remove); });
}

async function initializeDashboard() {
  initializeProjectTools();
  ensureChatPanel();
  renderConversationList();
  document.getElementById("dashboard-chat-new")
    ?.addEventListener("click", startNewConversation);
  document.getElementById("prompt-input")?.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    void window.handleDispatch();
  });
  const healthPromise = apiRequest("/health").then(() => showStatus("Backend connected.")).catch(error => showStatus(error.message, true));
  await loadChatHistory();
  await refreshMemories();
  try {
    workflows = (await apiRequest("/workflows")).filter(workflow => workflow.valid);
    window.workflowData = Object.fromEntries(workflows.map(workflow => [workflow.name, workflow]));
    renderWorkflowCards();
    if (workflows.length) window.selectStudioWorkflow(workflows.find(workflow => workflow.id === "system-check")?.id || workflows[0].id);
  } catch (error) {
    const container = document.getElementById("studio-workflow-list");
    if (container) {
      container.replaceChildren();
      const failure = document.createElement("div");
      failure.className = "p-3.5 rounded-xl bg-surface-container-low text-body-sm text-error";
      failure.textContent = error.message;
      container.appendChild(failure);
    }
  }
  bindHistoryActions();
  await loadWorkflowHistory();
  await healthPromise;

  const nav = document.querySelector('a[data-path="workflow-history"]');
  nav?.addEventListener("click", () => { void loadWorkflowHistory(); });
  const memoryNav = document.querySelector('a[data-path="memory-store"]');
  memoryNav?.addEventListener("click", () => { void refreshMemories(); });
  const createWorkflow = [...document.querySelectorAll("#view-studio button")]
    .find(button => button.textContent.includes("Create Workflow"));
  createWorkflow?.addEventListener("click", () => {
    showStatus("Workflow definitions are managed in the workflows folder; this button does not create workflows yet.", true);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { void initializeDashboard(); }, { once: true });
} else {
  void initializeDashboard();
}
