import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const ACTIVE_RUN_STATES = new Set(["ready", "in_progress"]);

function getApi() {
  if (!window.electronAPI) {
    throw new Error("The Electron API is unavailable. Open Friday-pAI as a desktop app.");
  }
  return window.electronAPI;
}

function formatStatus(status) {
  return String(status || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}

function sanitizeDisplayValue(value, depth = 0) {
  if (depth > 8) return "[Nested output omitted]";
  if (Array.isArray(value)) return value.map(item => sanitizeDisplayValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["sourceHash", "apiKey", "accessToken", "refreshToken", "password"].includes(key))
      .map(([key, item]) => [key, sanitizeDisplayValue(item, depth + 1)]));
  }
  return value;
}

function pretty(value) {
  if (value === undefined || value === null || value === "") return "No output recorded.";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(sanitizeDisplayValue(value), null, 2);
  } catch {
    return String(value);
  }
}

function createInitialInputs(workflow) {
  return Object.fromEntries((workflow?.inputs || []).map(input => [
    input.name,
    input.type === "boolean" ? false : input.type === "object" ? "{}" : "",
  ]));
}

function App() {
  const [view, setView] = useState("chat");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [workflows, setWorkflows] = useState([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [inputValues, setInputValues] = useState({});
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [currentRun, setCurrentRun] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [runEvents, setRunEvents] = useState([]);
  const [actionError, setActionError] = useState("");
  const [memoryFacts, setMemoryFacts] = useState([]);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryCategory, setMemoryCategory] = useState("general");
  const [editingMemory, setEditingMemory] = useState("");
  const [editMemoryText, setEditMemoryText] = useState("");
  const [editMemoryCategory, setEditMemoryCategory] = useState("general");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState("");

  const selectedWorkflow = useMemo(
    () => workflows.find(workflow => workflow.id === selectedWorkflowId && workflow.valid),
    [workflows, selectedWorkflowId],
  );

  const refreshWorkflows = useCallback(async () => {
    setWorkflowsLoading(true);
    setWorkflowError("");
    try {
      const result = await getApi().listWorkflows();
      const items = Array.isArray(result) ? result : [];
      setWorkflows(items);
      const nextId = items.some(item => item.id === selectedWorkflowId && item.valid)
        ? selectedWorkflowId
        : items.find(item => item.valid)?.id || "";
      setSelectedWorkflowId(nextId);
      setInputValues(createInitialInputs(items.find(item => item.id === nextId)));
      setActionError("");
    } catch (error) {
      setWorkflowError(error?.message || "Could not load workflows.");
    } finally {
      setWorkflowsLoading(false);
    }
  }, [selectedWorkflowId]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await getApi().listWorkflowRuns();
      const items = Array.isArray(result) ? [...result] : [];
      items.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
      setRunHistory(items);
    } catch (error) {
      setHistoryError(error?.message || "Could not load workflow history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentRun?.runId || !ACTIVE_RUN_STATES.has(currentRun.status)) return undefined;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const latest = await getApi().getWorkflowRun(currentRun.runId);
        if (stopped) return;
        setCurrentRun(latest);
        setRunHistory(previous => {
          const exists = previous.some(item => item.runId === latest.runId);
          return exists
            ? previous.map(item => item.runId === latest.runId ? latest : item)
            : [latest, ...previous];
        });
      } catch (error) {
        if (!stopped) setActionError(error?.message || "Could not refresh the workflow run.");
      }
    }, 900);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [currentRun?.runId, currentRun?.status]);

  useEffect(() => {
    if (!currentRun?.runId || ACTIVE_RUN_STATES.has(currentRun.status)) return undefined;
    let cancelled = false;
    getApi().listWorkflowEvents(currentRun.runId)
      .then(events => { if (!cancelled) setRunEvents(Array.isArray(events) ? events : []); })
      .catch(() => { if (!cancelled) setRunEvents([]); });
    return () => { cancelled = true; };
  }, [currentRun?.runId, currentRun?.status]);

  useEffect(() => {
    if (view !== "history" || !selectedHistoryId) return undefined;
    let cancelled = false;
    async function loadSelectedRun() {
      setHistoryError("");
      try {
        const [run, events] = await Promise.all([
          getApi().getWorkflowRun(selectedHistoryId),
          getApi().listWorkflowEvents(selectedHistoryId),
        ]);
        if (cancelled) return;
        setCurrentRun(run);
        setRunEvents(Array.isArray(events) ? events : []);
      } catch (error) {
        if (!cancelled) setHistoryError(error?.message || "Could not load that workflow run.");
      }
    }
    void loadSelectedRun();
    return () => { cancelled = true; };
  }, [view, selectedHistoryId]);

  async function refreshMemory() {
    setMemoryError("");
    try {
      const result = await getApi().getMemory();
      setMemoryFacts(Array.isArray(result?.facts) ? result.facts : []);
    } catch (error) {
      setMemoryError(error?.message || "Could not load saved memory.");
    }
  }

  async function addMemoryFact(event) {
    event.preventDefault();
    if (!memoryDraft.trim() || memoryBusy) return;
    setMemoryBusy(true); setMemoryError("");
    try {
      const result = await getApi().addMemory({ text: memoryDraft.trim(), category: memoryCategory });
      setMemoryFacts(Array.isArray(result?.facts) ? result.facts : []);
      setMemoryDraft("");
    } catch (error) { setMemoryError(error?.message || "Could not save memory."); }
    finally { setMemoryBusy(false); }
  }

  function beginMemoryEdit(fact) {
    setEditingMemory(fact.text); setEditMemoryText(fact.text); setEditMemoryCategory(fact.category || "general"); setMemoryError("");
  }

  async function saveMemoryEdit(event) {
    event.preventDefault();
    if (!editingMemory || memoryBusy) return;
    setMemoryBusy(true); setMemoryError("");
    try {
      const result = await getApi().updateMemory({ oldText: editingMemory, text: editMemoryText.trim(), category: editMemoryCategory });
      setMemoryFacts(Array.isArray(result?.facts) ? result.facts : []); setEditingMemory("");
    } catch (error) { setMemoryError(error?.message || "Could not update memory."); }
    finally { setMemoryBusy(false); }
  }

  async function removeMemoryFact(text) {
    if (memoryBusy || !window.confirm("Delete this saved memory? This cannot be undone.")) return;
    setMemoryBusy(true); setMemoryError("");
    try {
      const result = await getApi().deleteMemory(text);
      setMemoryFacts(Array.isArray(result?.facts) ? result.facts : []);
      if (editingMemory === text) setEditingMemory("");
    } catch (error) { setMemoryError(error?.message || "Could not delete memory."); }
    finally { setMemoryBusy(false); }
  }

  async function sendMessage() {
    const text = message.trim();
    if (!text || thinking) return;
    const updatedMessages = [...messages, { role: "user", content: text }];
    setMessages(updatedMessages);
    setMessage("");
    setThinking(true);
    try {
      const reply = await getApi().askAI(updatedMessages);
      setMessages([...updatedMessages, { role: "assistant", content: String(reply || "") }]);
    } catch (error) {
      setMessages([...updatedMessages, {
        role: "assistant",
        content: `I couldn't complete that request. ${error?.message || "Please check the desktop app connection."}`,
      }]);
    } finally {
      setThinking(false);
    }
  }

  function parseInputs(workflow) {
    const parsed = {};
    for (const definition of workflow.inputs || []) {
      const raw = inputValues[definition.name];
      if (raw === "" || raw === undefined || raw === null) {
        if (definition.required) throw new Error(`${definition.name} is required.`);
        continue;
      }
      if (definition.type === "array") {
        const values = Array.isArray(raw) ? raw : String(raw).split(",");
        const cleaned = values.map(value => String(value).trim()).filter(Boolean);
        if (definition.required && cleaned.length === 0) throw new Error(`${definition.name} needs at least one item.`);
        if (cleaned.length) parsed[definition.name] = cleaned;
      } else if (definition.type === "number") {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`${definition.name} must be a valid number.`);
        parsed[definition.name] = value;
      } else if (definition.type === "boolean") {
        parsed[definition.name] = Boolean(raw);
      } else if (definition.type === "object") {
        try {
          const value = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
          parsed[definition.name] = value;
        } catch {
          throw new Error(`${definition.name} must be valid JSON representing an object.`);
        }
      } else {
        parsed[definition.name] = String(raw);
      }
    }
    return parsed;
  }

  async function startSelectedWorkflow(event) {
    event.preventDefault();
    if (!selectedWorkflow || workflowBusy) return;
    setWorkflowBusy(true);
    setActionError("");
    setRunEvents([]);
    try {
      const inputs = parseInputs(selectedWorkflow);
      const run = await getApi().startWorkflow({ workflowId: selectedWorkflow.id, inputs });
      setCurrentRun(run);
      setSelectedHistoryId(run.runId);
      setRunHistory(previous => [run, ...previous.filter(item => item.runId !== run.runId)]);
      await refreshHistory();
    } catch (error) {
      setActionError(error?.message || "Could not start this workflow.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function cancelRun(run) {
    if (!run?.runId || workflowBusy) return;
    if (!window.confirm("Cancel this workflow? The current tool call may finish, but no subsequent steps will start.")) return;
    setWorkflowBusy(true); setActionError("");
    try {
      const updated = await getApi().cancelWorkflow(run.runId);
      setCurrentRun(updated);
      await refreshHistory();
    } catch (error) { setActionError(error?.message || "Could not cancel the workflow."); }
    finally { setWorkflowBusy(false); }
  }

  async function resolveApproval(stepId, approved) {
    if (!currentRun) return;
    setWorkflowBusy(true);
    setActionError("");
    try {
      const updated = await getApi().resolveWorkflowApproval({
        runId: currentRun.runId,
        stepId,
        approved,
      });
      setCurrentRun(updated);
      await refreshHistory();
    } catch (error) {
      setActionError(error?.message || "Could not resolve the approval.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function resumeRun(run) {
    if (!run) return;
    setWorkflowBusy(true);
    setActionError("");
    try {
      const updated = await getApi().resumeWorkflow(run.runId);
      setCurrentRun(updated);
      await refreshHistory();
    } catch (error) {
      setActionError(error?.message || "Could not resume this run.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  function selectWorkflow(id) {
    setSelectedWorkflowId(id);
    setInputValues(createInitialInputs(workflows.find(workflow => workflow.id === id)));
    setCurrentRun(null);
    setRunEvents([]);
    setActionError("");
  }

  function renderInput(definition) {
    const value = inputValues[definition.name] ?? (definition.type === "boolean" ? false : "");
    const common = {
      id: `workflow-input-${definition.name}`,
      name: definition.name,
      value: typeof value === "string" || typeof value === "number" ? value : "",
      required: Boolean(definition.required),
      onChange: event => setInputValues(previous => ({ ...previous, [definition.name]: event.target.value })),
    };
    return (
      <label className="workflow-field" key={definition.name} htmlFor={common.id}>
        <span>{definition.name}<small>{definition.required ? "Required" : "Optional"} · {definition.type}</small></span>
        {definition.type === "boolean" ? (
          <input
            id={common.id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={event => setInputValues(previous => ({ ...previous, [definition.name]: event.target.checked }))}
          />
        ) : definition.type === "object" ? (
          <textarea {...common} rows="3" placeholder='{"key": "value"}' />
        ) : definition.type === "array" ? (
          <textarea {...common} rows="2" placeholder="Enter items separated by commas" />
        ) : (
          <input {...common} type={definition.type === "number" ? "number" : "text"} placeholder={`Enter ${definition.name}`} />
        )}
      </label>
    );
  }

  function renderRunDetails(run, compact = false) {
    if (!run) return <div className="empty-state">Choose a workflow run to see its details.</div>;
    return (
      <section className={`run-details ${compact ? "compact" : ""}`}>
        <div className="run-heading">
          <div>
            <p className="eyebrow">WORKFLOW RUN</p>
            <h3>{workflows.find(item => item.id === run.workflowId)?.name || run.workflowId}</h3>
            <p className="run-id">{run.runId}</p>
          </div>
          <span className={`status-pill status-${String(run.status || "unknown").replaceAll("_", "-")}`}>{formatStatus(run.status)}</span>
        </div>
        <div className="run-meta">
          <span>Started {run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}</span>
          <span>Updated {run.updatedAt ? new Date(run.updatedAt).toLocaleTimeString() : "—"}</span>
        </div>
        {run.error && <div className="inline-error">{run.error}</div>}
        {Array.isArray(run.criteriaResults) && run.criteriaResults.length > 0 && (
          <section className="criteria-results" aria-label="Workflow success checks">
            <h4>Outcome verification</h4>
            <ul>
              {run.criteriaResults.map(item => (
                <li key={item.id} className={item.passed ? "criterion-passed" : "criterion-failed"}>
                  <span aria-hidden="true">{item.passed ? "✓" : "!"}</span>
                  <span>{item.id.replaceAll("-", " ")}</span>
                  <small>{item.message}</small>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!["completed", "completed_with_skips", "failed", "cancelled"].includes(run.status) && <div className="run-cancel-row"><button className="secondary-button" disabled={workflowBusy} onClick={() => void cancelRun(run)}>Cancel workflow</button></div>}
        <div className="step-list">
          {(run.steps || []).map((step, index) => (
            <article className="step-card" key={step.stepId}>
              <div className="step-topline">
                <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="step-title-wrap">
                  <strong>{step.stepId}</strong>
                  <small>{step.tool}</small>
                </div>
                <span className={`status-pill status-${String(step.state || "pending").replaceAll("_", "-")}`}>{formatStatus(step.state)}</span>
              </div>
              {step.error && <p className="step-error">{step.error}</p>}
              {step.result !== null && step.result !== undefined && (
                <pre className="step-output">{pretty(step.result)}</pre>
              )}
              {step.state === "waiting_for_approval" && (
                <div className="approval-actions">
                  <p>This step needs your approval before it can continue. Review the exact planned changes first.</p>
                  {step.approvalPreview && <pre className="step-output approval-preview">{pretty(step.approvalPreview)}</pre>}
                  <button className="primary-button" disabled={workflowBusy} onClick={() => resolveApproval(step.stepId, true)}>Approve</button>
                  <button className="secondary-button" disabled={workflowBusy} onClick={() => resolveApproval(step.stepId, false)}>Reject</button>
                </div>
              )}
            </article>
          ))}
        </div>
        {run.status === "paused" && (
          <button className="primary-button" disabled={workflowBusy} onClick={() => resumeRun(run)}>Resume workflow</button>
        )}
        {runEvents.length > 0 && (
          <details className="event-details">
            <summary>Run event log ({runEvents.length})</summary>
            <ul>{runEvents.map((event, index) => <li key={`${event.timestamp}-${index}`}><time>{event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ""}</time><span>{formatStatus(event.type)}</span>{event.error && <small>{event.error}</small>}</li>)}</ul>
          </details>
        )}
      </section>
    );
  }

  return (
    <div className="assistant">
      <header className="top-nav">
        <button className="logo logo-button" onClick={() => setView("chat")} aria-label="Open chat home">
          <span className="logo-mark">✦</span><span>Personal AI</span>
        </button>
        <nav className="top-actions" aria-label="Main navigation">
          <button className={`top-button ${view === "chat" ? "active" : ""}`} onClick={() => setView("chat")}>Chat</button>
          <button className={`top-button ${view === "workflows" ? "active" : ""}`} onClick={() => { setView("workflows"); void refreshWorkflows(); }}>Workflows</button>
          <button className={`top-button ${view === "history" ? "active" : ""}`} onClick={() => { setView("history"); void refreshHistory(); }}>History</button>
          <button className={`top-button ${view === "memory" ? "active" : ""}`} onClick={() => { setView("memory"); void refreshMemory(); }}>Memory</button>
        </nav>
      </header>

      {view === "chat" ? (
        <main className="hero">
          <div className="hero-content">
            {messages.length === 0 ? (
              <>
                <p className="greeting">YOUR PERSONAL ASSISTANT</p>
                <h1>How can I<br /><span>help you today?</span></h1>
                <p className="description">Ask me anything, get things done, or just have a conversation.</p>
              </>
            ) : (
              <div className="chat-container"><div className="messages">
                {messages.map((msg, index) => (
                  <div key={index} className={`chat-message ${msg.role === "user" ? "user" : "ai"}`}>{msg.content}</div>
                ))}
                {thinking && <div className="chat-message ai">Thinking...</div>}
              </div></div>
            )}
            <div className="ai-visual" aria-hidden="true"><div className="glow glow-one"></div><div className="glow glow-two"></div><div className="orb"><div className="orb-inner"></div><div className="orb-light"></div></div></div>
            <form className="prompt-wrapper" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
              <div className="prompt-box">
                <input type="text" placeholder="Ask your personal AI..." value={message} onChange={event => setMessage(event.target.value)} disabled={thinking} aria-label="Message your personal AI" />
                <div className="prompt-actions"><button className="send-button" type="submit" disabled={thinking || !message.trim()} aria-label="Send message">↑</button></div>
              </div>
              <div className="prompt-footer"><span>Press Enter to send</span><span>● {thinking ? "Thinking..." : "AI ready"}</span></div>
            </form>
          </div>
        </main>
      ) : view === "workflows" ? (
        <main className="workflow-page">
          <div className="workflow-shell">
            <div className="page-intro"><div><p className="eyebrow">PERSONAL AI · REUSABLE SKILLS</p><h1>Workflows</h1><p>Run repeatable tasks with your chosen tools, and review each step before taking sensitive actions.</p></div><button className="secondary-button" onClick={() => void refreshWorkflows()} disabled={workflowsLoading}>{workflowsLoading ? "Refreshing…" : "Refresh"}</button></div>
            {workflowError && <div className="inline-error">{workflowError}</div>}
            {actionError && <div className="inline-error">{actionError}</div>}
            <div className="workflow-grid">
              <section className="panel workflow-catalog">
                <div className="panel-heading"><h2>Available workflows</h2><span>{workflows.filter(item => item.valid).length} valid</span></div>
                {workflowsLoading && workflows.length === 0 ? <div className="empty-state">Loading workflows…</div> : workflows.length === 0 ? <div className="empty-state">No workflow definitions were found.</div> : (
                  <div className="workflow-cards">
                    {workflows.map(workflow => (
                      <button key={workflow.id} className={`workflow-card ${selectedWorkflowId === workflow.id ? "selected" : ""} ${!workflow.valid ? "invalid" : ""}`} disabled={!workflow.valid} onClick={() => selectWorkflow(workflow.id)}>
                        <span className="workflow-card-icon">{workflow.valid ? "✦" : "!"}</span>
                        <span className="workflow-card-copy"><strong>{workflow.name || workflow.id}</strong><small>{workflow.description || workflow.error || "No description available."}</small><span className="workflow-card-meta">{workflow.steps?.length || 0} steps · {workflow.valid ? "Definition loaded" : "Invalid definition"}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className="panel workflow-config">
                {!selectedWorkflow ? <div className="empty-state">Select a valid workflow to configure its inputs.</div> : <>
                  <div className="panel-heading"><div><p className="eyebrow">CONFIGURE</p><h2>{selectedWorkflow.name}</h2></div><span className="subtle-tag">v{selectedWorkflow.version || "1.0.0"}</span></div>
                  <p className="workflow-description">{selectedWorkflow.description}</p>
                  {(selectedWorkflow.steps || []).some(step => step.capabilityStatus !== "available") && <div className="warning-note">This workflow contains steps that are not implemented yet. The run will stop with an explicit error if it reaches one.</div>}
                  {(selectedWorkflow.steps || []).length > 0 && <div className="planned-steps"><strong>Steps</strong>{selectedWorkflow.steps.map((step, index) => <div key={step.id} className="planned-step"><span>{index + 1}</span><div><b>{step.id}</b><small>{step.tool}{step.approval === "required" ? " · approval required" : ""}</small></div>{step.capabilityStatus !== "available" && <em>Unavailable</em>}</div>)}</div>}
                  <form className="workflow-form" onSubmit={startSelectedWorkflow}>
                    <h3>Inputs</h3>
                    {(selectedWorkflow.inputs || []).length === 0 ? <p className="field-hint">This workflow does not require any inputs.</p> : selectedWorkflow.inputs.map(renderInput)}
                    <button className="primary-button start-button" type="submit" disabled={workflowBusy || workflowsLoading}>{workflowBusy ? "Working…" : "Start workflow"}<span>↗</span></button>
                  </form>
                </>}
              </section>
            </div>
            {currentRun && <section className="panel current-run-panel"><div className="panel-heading"><h2>Current run</h2><button className="text-button" onClick={() => { setView("history"); void refreshHistory(); setSelectedHistoryId(currentRun.runId); }}>Open history →</button></div>{renderRunDetails(currentRun, true)}</section>}
          </div>
        </main>
      ) : view === "history" ? (
        <main className="workflow-page">
          <div className="workflow-shell">
            <div className="page-intro"><div><p className="eyebrow">PERSISTENT ACTIVITY</p><h1>Workflow history</h1><p>Inspect previous runs, results, failures, and approval events.</p></div><button className="secondary-button" onClick={() => void refreshHistory()} disabled={historyLoading}>{historyLoading ? "Refreshing…" : "Refresh"}</button></div>
            {historyError && <div className="inline-error">{historyError}</div>}
            <div className="history-grid">
              <section className="panel history-list-panel"><div className="panel-heading"><h2>Previous runs</h2><span>{runHistory.length} runs</span></div>
                {historyLoading && runHistory.length === 0 ? <div className="empty-state">Loading history…</div> : runHistory.length === 0 ? <div className="empty-state">No workflow runs yet. Start a workflow to create your first run.</div> : <div className="history-list">{runHistory.map(run => <button key={run.runId} className={`history-item ${selectedHistoryId === run.runId ? "selected" : ""}`} onClick={() => setSelectedHistoryId(run.runId)}><span className="history-item-title"><strong>{workflows.find(item => item.id === run.workflowId)?.name || run.workflowId}</strong><span className={`status-pill status-${String(run.status || "unknown").replaceAll("_", "-")}`}>{formatStatus(run.status)}</span></span><small>{run.createdAt ? new Date(run.createdAt).toLocaleString() : "Timestamp unavailable"}</small><code>{run.runId}</code></button>)}</div>}
              </section>
              <section className="panel history-details-panel"><div className="panel-heading"><h2>Run details</h2></div>{renderRunDetails(currentRun && currentRun.runId === selectedHistoryId ? currentRun : null, true)}</section>
            </div>
          </div>
        </main>
      ) : (
        <main className="workflow-page">
          <div className="workflow-shell">
            <div className="page-intro"><div><p className="eyebrow">PERSONAL CONTEXT</p><h1>Memory</h1><p>Review and manage facts Friday can use in future conversations and relevant workflows. Avoid saving passwords, API keys, or other secrets.</p></div><button className="secondary-button" onClick={() => void refreshMemory()}>Refresh</button></div>
            {memoryError && <div className="inline-error">{memoryError}</div>}
            <section className="panel memory-panel">
              <div className="panel-heading"><h2>Add a memory</h2><span>{memoryFacts.length} saved</span></div>
              <form className="workflow-form" onSubmit={addMemoryFact}>
                <label className="workflow-field"><span>Memory text</span><textarea value={memoryDraft} onChange={event => setMemoryDraft(event.target.value)} maxLength={1000} required placeholder="Example: I prefer concise explanations with examples." /></label>
                <label className="workflow-field"><span>Category</span><select value={memoryCategory} onChange={event => setMemoryCategory(event.target.value)}><option value="general">General</option><option value="preferences">Preferences</option><option value="project">Project</option><option value="skills">Skills</option><option value="task">Ongoing task</option></select></label>
                <button className="primary-button" type="submit" disabled={memoryBusy || !memoryDraft.trim()}>{memoryBusy ? "Saving…" : "Save memory"}</button>
              </form>
            </section>
            <section className="panel memory-panel">
              <div className="panel-heading"><h2>Saved memories</h2><span>Stored locally</span></div>
              {memoryFacts.length === 0 ? <div className="empty-state">No saved memories yet. Add a useful preference, project detail, or ongoing task above.</div> : <div className="memory-list">{memoryFacts.map((fact, index) => <article className="memory-item" key={`${fact.text}-${index}`}>
                {editingMemory === fact.text ? <form className="workflow-form" onSubmit={saveMemoryEdit}><label className="workflow-field"><span>Memory text</span><textarea value={editMemoryText} onChange={event => setEditMemoryText(event.target.value)} maxLength={1000} required /></label><label className="workflow-field"><span>Category</span><select value={editMemoryCategory} onChange={event => setEditMemoryCategory(event.target.value)}><option value="general">General</option><option value="preferences">Preferences</option><option value="project">Project</option><option value="skills">Skills</option><option value="task">Ongoing task</option></select></label><div className="memory-actions"><button className="primary-button" type="submit" disabled={memoryBusy}>Save changes</button><button className="secondary-button" type="button" onClick={() => setEditingMemory("")}>Cancel</button></div></form> : <><div className="memory-item-copy"><span className="subtle-tag">{fact.category || "general"}</span><p>{fact.text}</p><small>{fact.updatedAt ? `Updated ${new Date(fact.updatedAt).toLocaleString()}` : fact.createdAt ? `Saved ${new Date(fact.createdAt).toLocaleString()}` : "Saved memory"}</small></div><div className="memory-actions"><button className="secondary-button" onClick={() => beginMemoryEdit(fact)}>Edit</button><button className="secondary-button" disabled={memoryBusy} onClick={() => void removeMemoryFact(fact.text)}>Delete</button></div></>}
              </article>)}</div>}
            </section>
          </div>
        </main>
      )}

      <footer className="bottom-nav"><div className="footer-left"><span className="online-dot"></span><span>Personal AI</span></div><div className="footer-right"><span>Local workflow history</span><span>•</span><span>Configured AI/search providers may process requests</span></div></footer>
    </div>
  );
}

export default App;
