import test from "node:test";
import assert from "node:assert/strict";
import { createPanelViewModel } from "../src/viewmodel/panelViewModel";
import type { ApplyResult, CsmmGateway, EntityKey, Scope, Snapshot } from "../src/shared";
import { GLOBAL_SCOPE, entityKey, workspaceScope } from "../src/shared";
import { GLOBAL_ITEMS, WORKSPACE_DIAGNOSTICS, WORKSPACE_ITEMS } from "../src/mock/fixtures";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface ManualGateway {
  readonly gateway: CsmmGateway;
  readonly pending: Deferred<Snapshot>[];
  readonly pendingScopes: Deferred<readonly Scope[]>[];
  readonly calls: { snapshot: number; diagnostics: number; apply: number; scopes: number };
}

function manualGateway(
  scopesQueue: readonly (readonly Scope[])[] = [[]],
  options: { readonly deferScopes?: boolean } = {},
): ManualGateway {
  const pending: Deferred<Snapshot>[] = [];
  const pendingScopes: Deferred<readonly Scope[]>[] = [];
  const calls = { snapshot: 0, diagnostics: 0, apply: 0, scopes: 0 };
  let scopeCall = 0;
  const gateway: CsmmGateway = {
    getSnapshot(_scope: Scope): Promise<Snapshot> {
      calls.snapshot += 1;
      const next = deferred<Snapshot>();
      pending.push(next);
      return next.promise;
    },
    listScopes(): Promise<readonly Scope[]> {
      calls.scopes += 1;
      if (options.deferScopes === true) {
        const next = deferred<readonly Scope[]>();
        pendingScopes.push(next);
        return next.promise;
      }
      const next = scopesQueue[Math.min(scopeCall, scopesQueue.length - 1)];
      scopeCall += 1;
      return Promise.resolve(next);
    },
    getDiagnostics(_scope: Scope): Promise<readonly never[]> {
      calls.diagnostics += 1;
      return Promise.resolve([]);
    },
    apply(_scope: Scope, _keys: readonly EntityKey[]): Promise<ApplyResult> {
      calls.apply += 1;
      return Promise.resolve({ status: "failed", applyState: "failed", writtenFiles: [], diagnostics: [], message: "stub" });
    },
  };
  return { gateway, pending, pendingScopes, calls };
}

function snapshotOf(scope: Scope, items: Snapshot["items"], diagnostics: Snapshot["diagnostics"] = []): Snapshot {
  return { scope, generatedAt: "2026-01-01T00:00:00.000Z", items, diagnostics };
}

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

test("初始态逐字段等于契约（含 scopes 与 effectiveChain）", () => {
  const { gateway } = manualGateway();
  assert.deepEqual(createPanelViewModel(gateway).getState(), INITIAL_STATE);
});

test("load 成功：ready、items 已排序过滤、counts 统计全量、作用域汇总带 hint", async () => {
  const { gateway, pending } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  const loading = viewModel.load();
  assert.equal(viewModel.getState().status, "loading");
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await loading;
  const state = viewModel.getState();
  assert.equal(state.status, "ready");
  assert.equal(state.items.length, 5);
  assert.deepEqual(state.counts, { prompt: 3, skill: 1, mcp: 1 });
  assert.equal(state.lastLoadedAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(state.scopes, [{ scope: GLOBAL_SCOPE, label: "global", hint: "默认层", count: 5 }]);
});

test("load 失败：status=error 且 error 为 message", async () => {
  const { gateway, pending } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  const loading = viewModel.load();
  pending[0].reject(new Error("boom"));
  await loading;
  assert.equal(viewModel.getState().status, "error");
  assert.equal(viewModel.getState().error, "boom");
});

test("二次 load 保留筛选与选中键，只刷新条目", async () => {
  const { gateway, pending, calls } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  const first = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await first;
  viewModel.selectKind("mcp");
  viewModel.selectItem(entityKey("mcp", "github"));
  const second = viewModel.refresh();
  pending[1].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await second;
  const state = viewModel.getState();
  assert.equal(state.status, "ready");
  assert.equal(state.kind, "mcp");
  assert.deepEqual(state.items.map((entry) => entry.key), ["mcp:github"]);
  assert.equal(state.selectedKey, "mcp:github");
  assert.equal(calls.snapshot, 2);
});

test("subscribe 在状态变化时触发，取消后不再触发且取消幂等", async () => {
  const { gateway, pending } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  let calls = 0;
  const unsubscribe = viewModel.subscribe(() => {
    calls += 1;
  });
  const loading = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await loading;
  assert.equal(calls, 2);
  const before = calls;
  unsubscribe();
  unsubscribe();
  viewModel.selectItem(null);
  assert.equal(calls, before);
});

test("selectKind 只重算 items，不调用 gateway", async () => {
  const { gateway, pending, calls } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  const loading = viewModel.load();
  pending[0].resolve(snapshotOf(WORKSPACE_ITEMS[0].scope, WORKSPACE_ITEMS));
  await loading;
  const before = calls.snapshot;
  viewModel.selectKind("mcp");
  assert.equal(calls.snapshot, before);
  assert.deepEqual(viewModel.getState().items.map((entry) => entry.kind), ["mcp"]);
  viewModel.selectKind("all");
  assert.equal(viewModel.getState().items.length, WORKSPACE_ITEMS.length);
});

test("过期响应被丢弃：后发请求先返回时旧响应不得覆盖状态", async () => {
  const { gateway, pending } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  const first = viewModel.load();
  const second = viewModel.refresh();
  pending[1].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await second;
  assert.equal(viewModel.getState().items.length, 5);
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, [GLOBAL_ITEMS[0]]));
  await first;
  assert.equal(viewModel.getState().items.length, 5);
});

test("selectScope 切换时先清空再加载，并生成跨作用域生效链", async () => {
  const { gateway, pending } = manualGateway([[GLOBAL_SCOPE, workspaceScope("acme")], []]);
  const viewModel = createPanelViewModel(gateway);
  const first = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1].resolve(snapshotOf(workspaceScope("acme"), WORKSPACE_ITEMS));
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    viewModel.getState().scopes.map((summary) => summary.label),
    ["global", "workspace:acme"],
  );

  const switching = viewModel.selectScope(workspaceScope("acme"));
  assert.equal(viewModel.getState().scope.kind, "workspace");
  assert.equal(viewModel.getState().status, "loading");
  assert.equal(viewModel.getState().selectedKey, null);
  assert.deepEqual(viewModel.getState().items, []);
  pending[2].resolve(snapshotOf(workspaceScope("acme"), WORKSPACE_ITEMS));
  await switching;
  assert.equal(viewModel.getState().status, "ready");
  assert.equal(viewModel.getState().items.length, WORKSPACE_ITEMS.length);
  assert.equal(viewModel.getState().selectedKey, null);

  viewModel.selectItem(entityKey("prompt", "base"));
  const chain = viewModel.getState().effectiveChain;
  assert.notEqual(chain, null);
  assert.deepEqual(chain?.layers.map((layer) => layer.state), ["base", "override"]);
  assert.equal(chain?.source, ".dsh/settings.json");
});

test("selectKind 过滤掉选中项时，单次提交内清空 selectedKey 与 effectiveChain", async () => {
  const { gateway, pending } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  const loading = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await loading;
  viewModel.selectItem(entityKey("prompt", "base"));
  assert.equal(viewModel.getState().effectiveChain?.key, "prompt:base");

  const observed: { selectedKey: unknown; chain: unknown; kind: unknown }[] = [];
  const unsubscribe = viewModel.subscribe(() => {
    const current = viewModel.getState();
    observed.push({ selectedKey: current.selectedKey, chain: current.effectiveChain, kind: current.kind });
  });
  viewModel.selectKind("skill");
  unsubscribe();

  assert.deepEqual(observed.map((entry) => entry.kind), ["skill"]);
  assert.equal(observed[0].selectedKey, null);
  assert.equal(observed[0].chain, null);
  const state = viewModel.getState();
  assert.equal(state.selectedKey, null);
  assert.equal(state.effectiveChain, null);
  assert.deepEqual(state.items.map((entry) => entry.key), ["skill:code-review"]);
});

test("refresh 后选中项不在新 items 时清空 selectedKey 与 effectiveChain", async () => {
  const { gateway, pending } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  const first = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await first;
  viewModel.selectItem(entityKey("prompt", "base"));
  assert.equal(viewModel.getState().effectiveChain?.key, "prompt:base");

  const second = viewModel.refresh();
  pending[1].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS.filter((entry) => entry.kind === "skill")));
  await second;
  const state = viewModel.getState();
  assert.deepEqual(state.items.map((entry) => entry.key), ["skill:code-review"]);
  assert.equal(state.selectedKey, null);
  assert.equal(state.effectiveChain, null);
});

test("selectScope 切到不含选中键的作用域时清空 selectedKey 与 effectiveChain", async () => {
  const { gateway, pending } = manualGateway([[GLOBAL_SCOPE, workspaceScope("acme")], []]);
  const viewModel = createPanelViewModel(gateway);
  const loading = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await new Promise((resolve) => setImmediate(resolve));
  pending[1].resolve(snapshotOf(workspaceScope("acme"), WORKSPACE_ITEMS));
  await loading;

  const switching = viewModel.selectScope(workspaceScope("acme"));
  pending[2].resolve(snapshotOf(workspaceScope("acme"), WORKSPACE_ITEMS));
  await switching;
  viewModel.selectItem(entityKey("prompt", "repo-rules"));
  assert.equal(viewModel.getState().effectiveChain?.key, "prompt:repo-rules");

  const back = viewModel.selectScope(GLOBAL_SCOPE);
  pending[3].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await back;
  const state = viewModel.getState();
  assert.equal(state.selectedKey, null);
  assert.equal(state.effectiveChain, null);
  assert.equal(state.items.some((entry) => entry.key === entityKey("prompt", "repo-rules")), false);
});
test("B2：selectScope 同 scope 也重新加载（刷新控件存在，没有 no-op 捷径）", async () => {
  const { gateway, pending, calls } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  const loading = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await loading;
  const before = calls.snapshot;
  const reloading = viewModel.selectScope(GLOBAL_SCOPE);
  assert.equal(calls.snapshot, before + 1);
  pending[1].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await reloading;
  assert.equal(viewModel.getState().status, "ready");
  assert.equal(viewModel.getState().items.length, 5);
});

test("B2：refresh 重新调用 getSnapshot，画面加载的是第二次结果", async () => {
  const { gateway, pending, calls } = manualGateway();
  const viewModel = createPanelViewModel(gateway);
  const loading = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await loading;
  const before = calls.snapshot;
  const refreshing = viewModel.refresh();
  assert.equal(viewModel.getState().status, "loading");
  pending[1].resolve(snapshotOf(GLOBAL_SCOPE, [GLOBAL_ITEMS[0]]));
  await refreshing;
  assert.equal(calls.snapshot, before + 1);
  assert.deepEqual(viewModel.getState().items.map((entry) => entry.key), ["prompt:system-base"]);
});

test("B3：deferred listScopes 乱序返回时，旧轮不得覆盖新轮的最终提交", async () => {
  const { gateway, pending, pendingScopes } = manualGateway([], { deferScopes: true });
  const viewModel = createPanelViewModel(gateway);
  const first = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingScopes.length, 1);

  const second = viewModel.refresh();
  pending[1].resolve(snapshotOf(GLOBAL_SCOPE, [GLOBAL_ITEMS[0]]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingScopes.length, 2);

  pendingScopes[1].resolve([]);
  await second;
  assert.deepEqual(viewModel.getState().items.map((entry) => entry.key), ["prompt:system-base"]);

  pendingScopes[0].resolve([]);
  await first;
  assert.deepEqual(viewModel.getState().items.map((entry) => entry.key), ["prompt:system-base"]);
});

test("M6：gateway 永不 settle 时超时收敛为 error，不永久停在 loading", async () => {
  const { gateway } = manualGateway();
  const viewModel = createPanelViewModel(gateway, { timeoutMs: 15 });
  await viewModel.load();
  const state = viewModel.getState();
  assert.equal(state.status, "error");
  assert.match(state.error ?? "", /超时/);
  assert.match(state.error ?? "", /可重试/);
});

test("selectScope 切换时清空 diagnostics 与 counts，loading 期间不残留旧诊断", async () => {
  const diagnostic = { code: "W_TRUST", severity: "warn", level: "key", key: entityKey("mcp", "github"), message: "旧诊断" } as const;
  const { gateway, pending } = manualGateway([[GLOBAL_SCOPE, workspaceScope("acme")], []]);
  const viewModel = createPanelViewModel(gateway);
  const first = viewModel.load();
  pending[0].resolve(snapshotOf(GLOBAL_SCOPE, GLOBAL_ITEMS, [diagnostic]));
  await new Promise((resolve) => setImmediate(resolve));
  pending[1].resolve(snapshotOf(workspaceScope("acme"), WORKSPACE_ITEMS));
  await first;
  assert.equal(viewModel.getState().diagnostics.length, 1);
  assert.deepEqual(viewModel.getState().counts, { prompt: 3, skill: 1, mcp: 1 });

  const switching = viewModel.selectScope(workspaceScope("acme"));
  const during = viewModel.getState();
  assert.equal(during.status, "loading");
  assert.deepEqual(during.diagnostics, []);
  assert.deepEqual(during.counts, { prompt: 0, skill: 0, mcp: 0 });
  pending[2].resolve(snapshotOf(workspaceScope("acme"), WORKSPACE_ITEMS, WORKSPACE_DIAGNOSTICS));
  await switching;
  assert.deepEqual(viewModel.getState().diagnostics.map((entry) => entry.code), ["W_TRUST", "E_LOCKED"]);
});
