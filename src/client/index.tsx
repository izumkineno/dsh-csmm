import * as React from "react";
import cssText from "../UI/styles.css";
import { AppViewModelProvider } from "../UI/viewmodel/useAppViewModel";
import App from "../UI/view/App";
import { createRemoteHost, requestRpc, type RemoteHost } from "./hostPort";

export const PANEL_ID = "dsh-csmm";
export const inject = ["slots"];

interface SlotRegistration {
  name: string;
  id?: string;
  key?: string;
  order?: number;
  label?: () => string;
  registrant?: string;
}

interface SlotsService {
  inject(name: string, register: () => (() => void) | void): void;
  register(spec: SlotRegistration, component: React.ComponentType): () => void;
}

export interface ClientContext {
  slots: SlotsService;
}

let stylesInjected = false;

function ensureStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset.dshCsmm = "true";
  style.textContent = cssText;
  document.head.appendChild(style);
  stylesInjected = true;
}

function PanelIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="5" height="11" rx="1" stroke="currentColor" />
      <rect x="9.5" y="2.5" width="5" height="11" rx="1" stroke="currentColor" />
    </svg>
  );
}

type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; host: RemoteHost };

function PanelRoot(): React.ReactElement {
  const [state, setState] = React.useState<PanelState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    ensureStyles();
  }, []);

  React.useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    requestRpc({ method: "snapshot" })
      .then((result) => {
        if (!alive) return;
        if (!result.snapshot) throw new Error("快照为空");
        setState({ status: "ready", host: createRemoteHost(result.snapshot) });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setState({ status: "error", message: (error as Error).message ?? String(error) });
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return (
      <div style={{ padding: 24, color: "var(--dsw-alias-text-secondary, #6b7280)" }}>
        正在加载 CSMM 配置…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ margin: 0 }}>CSMM 后端未连接：{state.message}</p>
        <p style={{ margin: "8px 0 0", color: "var(--dsw-alias-text-secondary, #6b7280)" }}>
          确认插件 host 已加载，且当前页面与 <code>/dsh-csmm/rpc</code> 同源。
        </p>
        <button style={{ marginTop: 12 }} onClick={() => setAttempt((value) => value + 1)}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
      <AppViewModelProvider host={state.host}>
        <App />
      </AppViewModelProvider>
    </div>
  );
}

function safeRegister(name: string, register: () => (() => void) | void): () => void {
  try {
    return register() ?? (() => {});
  } catch (error) {
    console.error(`dsh-csmm: register ${name} failed`, error);
    return () => {};
  }
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject("sidebar.panellist", () =>
    safeRegister("sidebar.panellist", () =>
      ctx.slots.register(
        {
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 1,
          label: () => "CSMM",
          registrant: PANEL_ID,
        },
        PanelIcon,
      ),
    ),
  );

  ctx.slots.inject("main", () =>
    safeRegister("main", () =>
      ctx.slots.register({ name: "main", key: PANEL_ID, registrant: PANEL_ID }, PanelRoot),
    ),
  );
}
