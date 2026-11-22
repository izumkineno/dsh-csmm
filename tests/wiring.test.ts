import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { USE_MOCK, createGateway, PanelProvider } from "../src/composition/wiring";
import { createPanelViewModel } from "../src/viewmodel/panelViewModel";
import { PANEL_ID, apply } from "../src/client/index";
import { PanelPage, PanelStatusBar, diagnosticsForKey, listEmptyText } from "../src/client/PanelPage";
import { PanelRow } from "../src/client/PanelRow";
import { WORKSPACE_DIAGNOSTICS, WORKSPACE_ITEMS } from "../src/mock/fixtures";
import { entityKey } from "../src/shared";

const INITIAL_STATE = {
  status: "idle",
  scope: { kind: "global" },
  scopes: [],
  kind: "all",
  items: [],
  counts: { prompt: 0, skill: 0, mcp: 0 },
  diagnostics: [],
  selectedKey: null,
  effectiveChain: null,
  error: null,
  lastLoadedAt: null,
};

test("USE_MOCK 为 true，createGateway 返回四方法齐全的 mock 网关", () => {
  assert.equal(USE_MOCK, true);
  const gateway = createGateway();
  assert.equal(typeof gateway.getSnapshot, "function");
  assert.equal(typeof gateway.listScopes, "function");
  assert.equal(typeof gateway.getDiagnostics, "function");
  assert.equal(typeof gateway.apply, "function");
});

test("createPanelViewModel(createGateway()) 初始态正确并可加载 mock 快照与两个作用域", async () => {
  const viewModel = createPanelViewModel(createGateway());
  assert.deepEqual(viewModel.getState(), INITIAL_STATE);
  await viewModel.load();
  const state = viewModel.getState();
  assert.equal(state.status, "ready");
  assert.deepEqual(state.items.map((entry) => entry.key), [
    "prompt:system-base",
    "prompt:base",
    "prompt:legacy",
    "skill:code-review",
    "mcp:github",
  ]);
  assert.deepEqual(
    state.scopes.map((summary) => [summary.label, summary.hint]),
    [
      ["global", "默认层"],
      ["workspace:acme", "工作区层"],
    ],
  );
});

test("apply 注册两项：panellist 图标项与自带 PanelProvider 的 main 组件", () => {
  const components: unknown[] = [];
  const options: Readonly<Record<string, unknown>>[] = [];
  const slots = {
    inject(_name: string, register: () => () => void): () => void {
      return register();
    },
    register(next: Readonly<Record<string, unknown>>, component: unknown): () => void {
      options.push(next);
      components.push(component);
      return () => undefined;
    },
  };
  apply({ slots });
  assert.equal(components.length, 2);
  assert.equal(options.length, 2);
  assert.equal(options[0].name, "sidebar.panellist");
  assert.equal(options[0].id, PANEL_ID);
  assert.equal(options[0].order, 1);
  assert.equal((options[0].label as () => string)(), "CSMM");
  assert.equal(options[1].name, "main");
  assert.equal(options[1].key, PANEL_ID);

  const Main = components[1] as () => ReactElement;
  const html = renderToStaticMarkup(createElement(Main));
  assert.ok(html.includes("CSMM"));
  assert.ok(html.includes("\u53cc\u4f5c\u7528\u57df"));
});
test("apply 的注册回调延迟执行且 register 抛错时不向宿主抛出，并记录错误", () => {
  const callbacks: Array<() => void> = [];
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    apply({
      slots: {
        inject(_name: string, register: () => () => void): () => void {
          callbacks.push(register);
          return () => undefined;
        },
        register(): () => void {
          throw new Error("boom");
        },
      },
    });
    assert.equal(callbacks.length, 2);
    assert.doesNotThrow(() => {
      callbacks[0]();
    });
    assert.doesNotThrow(() => {
      callbacks[1]();
    });
  } finally {
    console.error = original;
  }
  assert.ok(logged.some((args) => String(args[0]).includes("register sidebar.panellist failed")));
  assert.ok(logged.some((args) => String(args[0]).includes("register main failed")));
});

test("register 返回 rejected Promise 时被捕获，不留下未处理拒绝", async () => {
  const callbacks: Array<() => void> = [];
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    apply({
      slots: {
        inject(_name: string, register: () => () => void): () => void {
          callbacks.push(register);
          return () => undefined;
        },
        register(): () => void {
          return Promise.reject(new Error("late")) as never;
        },
      },
    });
    callbacks[1]();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = original;
  }
  assert.ok(logged.some((args) => String(args[0]).includes("register main failed")));
});

test("L2：safeRegister 保留注册返回的 disposer，并在卸载清理时调用", () => {
  let disposed = 0;
  const cleanups: Array<() => void> = [];
  apply({
    slots: {
      inject(_name: string, register: () => () => void): () => void {
        const cleanup = register();
        cleanups.push(cleanup);
        return cleanup;
      },
      register(): () => void {
        return () => {
          disposed += 1;
        };
      },
    },
  });
  assert.equal(cleanups.length, 2);
  for (const cleanup of cleanups) {
    cleanup();
  }
  assert.equal(disposed, 2);
});

test("M1：行徽标按 origin 显示 GLOBAL/WORKSPACE，行名称显示 item.key", () => {
  const inherited = renderToStaticMarkup(
    createElement(PanelRow, { item: WORKSPACE_ITEMS[0], active: false, onSelect: () => undefined }),
  );
  assert.ok(inherited.includes("prompt:system-base"));
  assert.ok(inherited.includes("GLOBAL"));
  assert.equal(inherited.includes("WORKSPACE"), false);
  assert.ok(inherited.includes("LOCKED"));

  const overridden = renderToStaticMarkup(
    createElement(PanelRow, { item: WORKSPACE_ITEMS[1], active: true, onSelect: () => undefined }),
  );
  assert.ok(overridden.includes("prompt:base"));
  assert.ok(overridden.includes("WORKSPACE"));
  assert.ok(overridden.includes("OVERRIDE"));
  assert.ok(overridden.includes('aria-current="true"'));
});

test("B1：状态栏在 loading / error 下显示对应文案，error 带错误信息与重试按钮", () => {
  const loading = renderToStaticMarkup(
    createElement(PanelStatusBar, { status: "loading", error: null, diagnostics: [], onRetry: () => undefined }),
  );
  assert.ok(loading.includes("加载中"));

  let retried = 0;
  const failed = renderToStaticMarkup(
    createElement(PanelStatusBar, {
      status: "error",
      error: "getSnapshot 超时（15ms），可重试",
      diagnostics: [],
      onRetry: () => {
        retried += 1;
      },
    }),
  );
  assert.ok(failed.includes("错误"));
  assert.ok(failed.includes("超时"));
  assert.ok(failed.includes("重试"));
  assert.equal(retried, 0);
});

test("M3：诊断按选中键过滤，无选中时不把诊断挂到详情", () => {
  assert.deepEqual(
    diagnosticsForKey(WORKSPACE_DIAGNOSTICS, entityKey("mcp", "github")).map((diagnostic) => diagnostic.code),
    ["W_TRUST"],
  );
  assert.deepEqual(
    diagnosticsForKey(WORKSPACE_DIAGNOSTICS, entityKey("prompt", "system-base")).map((diagnostic) => diagnostic.code),
    ["E_LOCKED"],
  );
  assert.deepEqual(diagnosticsForKey(WORKSPACE_DIAGNOSTICS, entityKey("skill", "code-review")), []);
  assert.deepEqual(diagnosticsForKey(WORKSPACE_DIAGNOSTICS, null), []);
});

test("M4：空态文案只在 ready 显示「当前筛选无条目」", () => {
  assert.equal(listEmptyText("ready"), "当前筛选无条目");
  assert.equal(listEmptyText("loading"), null);
  assert.equal(listEmptyText("error"), null);
  assert.equal(listEmptyText("idle"), null);
});

test("B2：顶栏刷新控件存在于页面中，PanelPage 可在 PanelProvider 内渲染", () => {
  const html = renderToStaticMarkup(createElement(PanelProvider, null, createElement(PanelPage)));
  assert.ok(html.includes("CSMM"));
  assert.ok(html.includes("刷新"));
  assert.ok(html.includes("状态：空闲"));
});
