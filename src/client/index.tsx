import * as React from "react";

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

const panelStyle: React.CSSProperties = {
  boxSizing: "border-box",
  height: "100%",
  padding: "24px 28px",
  color: "var(--dsw-alias-text-primary, #1b2333)",
  background: "var(--dsw-alias-bg-base, #ffffff)",
  font: "13px/1.6 system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};

function PanelIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="5" height="11" rx="1" stroke="currentColor" />
      <rect x="9.5" y="2.5" width="5" height="11" rx="1" stroke="currentColor" />
    </svg>
  );
}

function PanelRoot(): React.ReactElement {
  return (
    <section style={panelStyle}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>双作用域配置</h2>
      <p style={{ margin: "8px 0 0", color: "var(--dsw-alias-text-secondary, #6b7280)" }}>
        插件骨架已就绪。prompt、skill 与 mcp 在全局与工作区两个作用域中的配置视图将在这里实现。
      </p>
    </section>
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
