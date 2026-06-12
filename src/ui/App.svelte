<script>
  import { onDestroy } from "svelte";
  import { nextCollapsedSpaces, toggleCollapsedSpace } from "./sidebar-state";

  const lanes = [
    ["todo", "Backlog"],
    ["in_progress", "Active"],
    ["review", "Review"],
    ["done", "Done"]
  ];
  const pages = [
    ["archive", "Runs"],
    ["board", "Board"],
    ["coral", "Coral"],
    ["agents", "Agents"],
    ["logs", "Logs"]
  ];

  let dashboard = null;
  let archive = { runs: [], projectSpaces: [] };
  let page = window.location.hash.replace("#", "") || "archive";
  let selectedTicketId = "";
  let selectedThreadId = "";
  let selectedRunId = new URLSearchParams(window.location.search).get("runId") ?? "";
  let collapsedSpaces = loadCollapsedSpaces();
  let query = "";
  let error = "";
  let lastRefresh = "";

  $: allTickets = dashboard ? Object.values(dashboard.kanban.columns).flat() : [];
  $: filteredTickets = allTickets.filter(ticketMatches);
  $: selectedTicket = allTickets.find((ticket) => ticket.id === selectedTicketId) ?? filteredTickets[0] ?? null;
  $: selectedThread = dashboard?.threads.find((thread) => thread.id === selectedThreadId) ?? dashboard?.threads[0] ?? null;
  $: ticketEvents = selectedTicket && dashboard
    ? dashboard.ticketEvents.filter((event) => event.ticketId === selectedTicket.id)
    : [];
  $: agentIds = dashboard
    ? Array.from(
        new Set([
          ...(dashboard.agents ?? []).map((agent) => agent.agentId),
          ...allTickets.flatMap((ticket) => [ticket.ownerAgent, ...ticket.collaboratorAgents].filter(Boolean)),
          ...dashboard.logs.map((log) => log.agentId),
          ...dashboard.messages.map((message) => message.senderAgent)
        ])
      ).sort()
    : [];
  $: progress = dashboard && allTickets.length
    ? Math.round((dashboard.kanban.columns.done.length / allTickets.length) * 100)
    : 0;

  function loadCollapsedSpaces() {
    try {
      const raw = localStorage.getItem("pi-factory:collapsed-project-spaces");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  function persistCollapsedSpaces() {
    localStorage.setItem("pi-factory:collapsed-project-spaces", JSON.stringify(collapsedSpaces));
  }

  function setPage(next) {
    page = next;
    const runQuery = selectedRunId ? `?runId=${encodeURIComponent(selectedRunId)}` : "";
    window.history.replaceState(null, "", `${window.location.pathname}${runQuery}#${next}`);
  }

  function onHashChange() {
    const next = window.location.hash.replace("#", "") || "archive";
    page = pages.some(([id]) => id === next) ? next : "archive";
  }

  function shortPath(path) {
    return path?.split("/").filter(Boolean).slice(-2).join("/") || "workspace";
  }

  function formatDate(value) {
    if (!value) return "pending";
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function ticketMatches(ticket) {
    if (!query.trim()) return true;
    const haystack = `${ticket.title} ${ticket.description} ${ticket.ownerAgent ?? ""} ${ticket.collaboratorAgents.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function latestTicketEvent(ticketId) {
    return dashboard?.ticketEvents.filter((event) => event.ticketId === ticketId).at(-1) ?? null;
  }

  function threadMessages(threadId) {
    return dashboard?.messages.filter((message) => message.threadId === threadId) ?? [];
  }

  function agentView(agentId) {
    const persisted = dashboard?.agents.find((agent) => agent.agentId === agentId);
    const owned = allTickets.filter((ticket) => ticket.ownerAgent === agentId);
    const collaborated = allTickets.filter((ticket) => ticket.collaboratorAgents.includes(agentId));
    const messages = dashboard?.messages.filter((message) => message.senderAgent === agentId) ?? [];
    const latestLog = dashboard?.logs.filter((log) => log.agentId === agentId).at(-1);
    return {
      persisted,
      owned,
      collaborated,
      messages,
      latestLog,
      status: persisted?.status ?? latestLog?.level ?? (messages.length ? "communicating" : "observed"),
      summary: persisted?.summary ?? latestLog?.message ?? messages.at(-1)?.body ?? "No persisted agent activity yet."
    };
  }

  function relatedCoral(ticket) {
    if (!dashboard || !ticket) return [];
    const participants = new Set([ticket.ownerAgent, ...ticket.collaboratorAgents].filter(Boolean));
    const direct = dashboard.comms.filter((event) => event.agentId && participants.has(event.agentId));
    return direct.length ? direct : dashboard.comms;
  }

  function selectRun(runId, nextPage = page) {
    selectedRunId = runId;
    selectedTicketId = "";
    selectedThreadId = "";
    collapsedSpaces = nextCollapsedSpaces(archive.projectSpaces, collapsedSpaces, selectedRunId);
    persistCollapsedSpaces();
    page = nextPage;
    window.history.replaceState(null, "", `${window.location.pathname}?runId=${encodeURIComponent(runId)}#${nextPage}`);
    void refresh();
  }

  function spaceCollapsed(space) {
    return collapsedSpaces.includes(space.targetDir);
  }

  function toggleSpace(space) {
    collapsedSpaces = toggleCollapsedSpace(collapsedSpaces, space.targetDir);
    persistCollapsedSpaces();
  }

  async function refresh() {
    try {
      const archiveRes = await fetch("/api/runs");
      if (archiveRes.ok) archive = await archiveRes.json();
      selectedRunId = selectedRunId || archive.runs[0]?.runId || "";
      collapsedSpaces = nextCollapsedSpaces(archive.projectSpaces, collapsedSpaces, selectedRunId);
      const path = selectedRunId ? `/api/dashboard?runId=${encodeURIComponent(selectedRunId)}` : "/api/dashboard";
      const res = await fetch(path);
      if (!res.ok) throw new Error(await res.text());
      const nextDashboard = await res.json();
      const nextTickets = Object.values(nextDashboard.kanban.columns).flat();
      dashboard = nextDashboard;
      selectedRunId = dashboard.run.runId;
      if (!nextTickets.some((ticket) => ticket.id === selectedTicketId)) selectedTicketId = nextTickets[0]?.id || "";
      if (!dashboard.threads.some((thread) => thread.id === selectedThreadId)) selectedThreadId = dashboard.threads[0]?.id || "";
      collapsedSpaces = nextCollapsedSpaces(archive.projectSpaces, collapsedSpaces, selectedRunId);
      persistCollapsedSpaces();
      error = "";
      lastRefresh = new Date().toLocaleTimeString();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }

  window.addEventListener("hashchange", onHashChange);
  refresh();
  const interval = setInterval(refresh, 2500);
  onDestroy(() => {
    clearInterval(interval);
    window.removeEventListener("hashchange", onHashChange);
  });
</script>

<svelte:head>
  <title>Pi Factory Gateway</title>
</svelte:head>

<main class="app-shell">
  <aside class="sidebar" aria-label="Factory navigation">
    <div class="brand-block">
      <span class="brand-mark">PF</span>
      <div>
        <p class="eyebrow">Pi Factory</p>
        <h1>Gateway</h1>
      </div>
    </div>

    <nav class="side-nav" aria-label="Gateway pages">
      {#each pages as [id, label]}
        <button class:active={page === id} on:click={() => setPage(id)}>{label}</button>
      {/each}
    </nav>

    <div class="sidebar-section">
      <div class="section-kicker">
        <span>Project spaces</span>
        <strong>{archive.projectSpaces.length}</strong>
      </div>
      <div class="space-stack">
        {#each archive.projectSpaces as space}
          <section class="space-group" class:collapsed={spaceCollapsed(space)}>
            <button class="space-toggle" aria-expanded={!spaceCollapsed(space)} on:click={() => toggleSpace(space)}>
              <span class="chevron" aria-hidden="true"></span>
              <span class="space-title">
                <strong>{shortPath(space.targetDir)}</strong>
                <small>{space.targetDir}</small>
              </span>
              <span class="space-count">{space.runs.length}</span>
            </button>
            {#if !spaceCollapsed(space)}
              <div class="run-list">
                {#each space.runs as run}
                  <button class="run-chip" class:active={dashboard?.run.runId === run.runId} on:click={() => selectRun(run.runId, "board")}>
                    <span>{run.status}</span>
                    <strong>{run.runId}</strong>
                    <small>{run.totalTickets} tickets / {run.coralEventCount} events</small>
                  </button>
                {/each}
              </div>
            {/if}
          </section>
        {:else}
          <p class="empty">No archived runs yet.</p>
        {/each}
      </div>
    </div>
  </aside>

  <section class="workspace">
    <header class="topbar">
      <div class="title-block">
        <p class="eyebrow">{pages.find(([id]) => id === page)?.[1] ?? "Runs"} / {shortPath(dashboard?.run.targetDir)}</p>
        <h2>{dashboard?.kanban.project.title ?? "Factory runs"}</h2>
      </div>
      <div class="top-actions">
        <label class="search">
          <span>Search</span>
          <input bind:value={query} placeholder="Tickets, agents, text" />
        </label>
        <div class="run-pill" class:complete={dashboard?.run.status === "complete"}>{dashboard?.run.status ?? "loading"}</div>
      </div>
    </header>

    {#if error}
      <section class="alert">{error}</section>
    {/if}

    {#if dashboard}
      <section class="stats-row" aria-label="Run metrics">
        <div><span>Progress</span><strong>{progress}%</strong></div>
        <div><span>Tickets</span><strong>{allTickets.length}</strong></div>
        <div><span>Threads</span><strong>{dashboard.threads.length}</strong></div>
        <div><span>Messages</span><strong>{dashboard.messages.length}</strong></div>
        <div><span>Agents</span><strong>{agentIds.length}</strong></div>
        <div><span>Refresh</span><strong>{lastRefresh || "pending"}</strong></div>
      </section>

      {#if page === "archive"}
        <section class="page archive-page">
          <div class="page-heading">
            <div>
              <p class="eyebrow">Run archive</p>
              <h3>Project spaces and historical runs</h3>
            </div>
            <span>{archive.runs.length} runs</span>
          </div>
          <div class="archive-grid">
            {#each archive.projectSpaces as space}
              <section class="archive-space">
                <header>
                  <h4>{shortPath(space.targetDir)}</h4>
                  <p>{space.targetDir}</p>
                </header>
                <div class="archive-runs">
                  {#each space.runs as run}
                    <button class:active={dashboard.run.runId === run.runId} on:click={() => selectRun(run.runId, "board")}>
                      <div>
                        <span>{run.status}</span>
                        <strong>{run.runId}</strong>
                        <small>{formatDate(run.startedAt)}</small>
                      </div>
                      <dl>
                        <dt>Tickets</dt><dd>{run.totalTickets}</dd>
                        <dt>Coral</dt><dd>{run.coralEventCount}</dd>
                        <dt>Logs</dt><dd>{run.logCount}</dd>
                      </dl>
                    </button>
                  {/each}
                </div>
              </section>
            {:else}
              <p class="empty">No run archive is available yet.</p>
            {/each}
          </div>
        </section>
      {:else if page === "board"}
        <section class="page board-page">
          <div class="board-main">
            <div class="page-heading">
              <div>
                <p class="eyebrow">Lifecycle board</p>
                <h3>{dashboard.run.targetDir}</h3>
              </div>
              <span>{filteredTickets.length} visible</span>
            </div>
            <div class="kanban-scroll">
              <div class="kanban-board">
                {#each lanes as [status, label]}
                  {@const laneTickets = dashboard.kanban.columns[status].filter(ticketMatches)}
                  <section class="lane">
                    <header>
                      <h4>{label}</h4>
                      <span>{laneTickets.length}</span>
                    </header>
                    <div class="lane-body">
                      {#each laneTickets as ticket}
                        <button class="ticket-card" class:active={selectedTicket?.id === ticket.id} on:click={() => (selectedTicketId = ticket.id)}>
                          <span>{ticket.ownerAgent ?? "unowned"}</span>
                          <strong>{ticket.title}</strong>
                          <p>{ticket.description}</p>
                          <small>{ticket.collaboratorAgents.join(", ") || "solo"}</small>
                        </button>
                      {:else}
                        <p class="lane-empty">No tickets</p>
                      {/each}
                    </div>
                  </section>
                {/each}
              </div>
            </div>
          </div>

          <aside class="ticket-detail-panel" aria-label="Ticket detail">
            <div class="detail-header">
              <p class="eyebrow">Ticket detail</p>
              <span>{selectedTicket?.status ?? "none"}</span>
            </div>
            {#if selectedTicket}
              <article class="ticket-detail">
                <h3>{selectedTicket.title}</h3>
                <p>{selectedTicket.description}</p>
                <dl class="detail-list">
                  <dt>Owner</dt><dd>{selectedTicket.ownerAgent ?? "unowned"}</dd>
                  <dt>Collaborators</dt><dd>{selectedTicket.collaboratorAgents.join(", ") || "none"}</dd>
                  <dt>Acceptance</dt><dd>{selectedTicket.acceptanceCriteria}</dd>
                </dl>
                <div class="activity-block">
                  <h4>Activity</h4>
                  {#each ticketEvents as event}
                    <article>
                      <span>{event.agentId} / {event.eventType}</span>
                      <p>{event.body}</p>
                    </article>
                  {:else}
                    <p class="empty">No ticket events yet.</p>
                  {/each}
                </div>
                <div class="activity-block">
                  <h4>Related Coral</h4>
                  {#each relatedCoral(selectedTicket).slice(0, 5) as event}
                    <article>
                      <span>{event.eventType} / {event.agentId ?? "server"}</span>
                      <p>{event.body}</p>
                    </article>
                  {:else}
                    <p class="empty">No Coral event has been attached yet.</p>
                  {/each}
                </div>
              </article>
            {:else}
              <p class="empty">Select a ticket to inspect its activity.</p>
            {/if}
          </aside>
        </section>
      {:else if page === "coral"}
        <section class="page coral-page">
          <div class="page-heading">
            <div>
              <p class="eyebrow">Coral audit trail</p>
              <h3>Threads, messages, and mirrored events</h3>
            </div>
            <span>{dashboard.messages.length} persisted messages</span>
          </div>
          <div class="coral-grid">
            <aside class="thread-index">
              <h4>Threads</h4>
              {#each dashboard.threads as thread}
                <button class:active={selectedThread?.id === thread.id} on:click={() => (selectedThreadId = thread.id)}>
                  <strong>{thread.name}</strong>
                  <span>{thread.participants.join(", ") || "no participants"}</span>
                  <small>{threadMessages(thread.id).length} messages</small>
                </button>
              {:else}
                <p class="empty">No persisted Coral threads yet.</p>
              {/each}
            </aside>
            <section class="conversation">
              {#if selectedThread}
                <header>
                  <div>
                    <p class="eyebrow">Thread</p>
                    <h4>{selectedThread.name}</h4>
                  </div>
                  <span>{selectedThread.participants.join(", ")}</span>
                </header>
                <div class="message-stack">
                  {#each threadMessages(selectedThread.id) as message}
                    <article class="message">
                      <div>
                        <strong>{message.senderAgent}</strong>
                        <span>{formatDate(message.createdAt)}</span>
                      </div>
                      <p>{message.body}</p>
                      {#if message.mentions.length}
                        <small>Mentions: {message.mentions.join(", ")}</small>
                      {/if}
                    </article>
                  {:else}
                    <p class="empty">This thread has no persisted messages.</p>
                  {/each}
                </div>
              {:else}
                <p class="empty">No Coral thread selected.</p>
              {/if}
            </section>
          </div>
          <section class="timeline">
            <div class="page-heading compact">
              <h4>Event timeline</h4>
              <span>{dashboard.comms.length} events</span>
            </div>
            <div class="timeline-list">
              {#each dashboard.comms as event}
                <article>
                  <span>{event.eventType} / {event.agentId ?? "server"} / {formatDate(event.createdAt)}</span>
                  <p>{event.body}</p>
                </article>
              {:else}
                <p class="empty">No Coral events have been mirrored yet.</p>
              {/each}
            </div>
          </section>
        </section>
      {:else if page === "agents"}
        <section class="page agents-page">
          <div class="page-heading">
            <div>
              <p class="eyebrow">Agent state</p>
              <h3>Persisted agent activity and task ownership</h3>
            </div>
            <span>{agentIds.length} agents</span>
          </div>
          <div class="agent-grid">
            {#each agentIds as agentId}
              {@const state = agentView(agentId)}
              <article class="agent-card">
                <header>
                  <h4>{agentId}</h4>
                  <span>{state.status}</span>
                </header>
                <p>{state.summary}</p>
                <dl>
                  <dt>Owned</dt><dd>{state.owned.length}</dd>
                  <dt>Coordinated</dt><dd>{state.collaborated.length}</dd>
                  <dt>Messages</dt><dd>{state.messages.length}</dd>
                  <dt>Last seen</dt><dd>{formatDate(state.persisted?.lastSeenAt ?? state.latestLog?.createdAt)}</dd>
                </dl>
              </article>
            {:else}
              <p class="empty">No agent activity has been persisted yet.</p>
            {/each}
          </div>
        </section>
      {:else}
        <section class="page logs-page">
          <div class="page-heading">
            <div>
              <p class="eyebrow">Run logs</p>
              <h3>Conductor and agent log stream</h3>
            </div>
            <span>{dashboard.logs.length} rows</span>
          </div>
          <div class="log-table">
            <div class="log-row head"><span>Time</span><span>Level</span><span>Agent</span><span>Message</span></div>
            {#each dashboard.logs as log}
              <article class="log-row">
                <span>{formatDate(log.createdAt)}</span>
                <span>{log.level}</span>
                <strong>{log.agentId}</strong>
                <p>{log.message}</p>
              </article>
            {:else}
              <p class="empty">No run logs yet.</p>
            {/each}
          </div>
        </section>
      {/if}
    {:else}
      <section class="loading">Loading gateway state...</section>
    {/if}
  </section>
</main>
