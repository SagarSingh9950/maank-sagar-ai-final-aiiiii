const { contextBridge, ipcRenderer } = require("electron");

// Expose only the specific IPC operations the renderer needs.
// Keep contextIsolation enabled and do not expose ipcRenderer directly.
contextBridge.exposeInMainWorld("electronAPI", {
  // Existing AI integration — preserved unchanged.
  askAI: (messages) => ipcRenderer.invoke("ask-ai", messages),
  getMemory: () => ipcRenderer.invoke("memory:list"),
  addMemory: (fact) => ipcRenderer.invoke("memory:add", fact),
  updateMemory: (payload) => ipcRenderer.invoke("memory:update", payload),
  deleteMemory: (text) => ipcRenderer.invoke("memory:delete", text),

  // Workflow engine API.
  listWorkflows: () => ipcRenderer.invoke("workflow:list"),

  startWorkflow: (payload) =>
    ipcRenderer.invoke("workflow:start", payload),

  getWorkflowRun: (runId) =>
    ipcRenderer.invoke("workflow:get-run", runId),

  listWorkflowRuns: () =>
    ipcRenderer.invoke("workflow:list-runs"),

  listWorkflowEvents: (runId) =>
    ipcRenderer.invoke("workflow:list-events", runId),

  resumeWorkflow: (runId) =>
    ipcRenderer.invoke("workflow:resume", runId),

  cancelWorkflow: (runId) =>
    ipcRenderer.invoke("workflow:cancel", runId),

  resolveWorkflowApproval: (payload) =>
    ipcRenderer.invoke("workflow:approve", payload),
});
