export interface AgentSessionRef {
  agent: string;
  kind: string;
  source?: string;
  value?: string;
}

export interface PaneInfo {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  cwd?: string;
  agent?: string;
  agent_session?: AgentSessionRef;
  agent_status?: string;
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  label?: string;
}
