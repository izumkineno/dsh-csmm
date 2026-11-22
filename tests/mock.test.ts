import test from "node:test";
import assert from "node:assert/strict";
import { createMockGateway } from "../src/mock";
import { GLOBAL_SCOPE, workspaceScope } from "../src/shared";

test("两个作用域都能取到快照，generatedAt 固定", async () => {
  const gateway = createMockGateway();
  const globalSnapshot = await gateway.getSnapshot(GLOBAL_SCOPE);
  const workspaceSnapshot = await gateway.getSnapshot(workspaceScope("acme"));
  assert.equal(globalSnapshot.scope.kind, "global");
  assert.equal(workspaceSnapshot.scope.kind, "workspace");
  assert.equal(globalSnapshot.generatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(workspaceSnapshot.generatedAt, "2026-01-01T00:00:00.000Z");
});

test("listScopes 返回全局与 acme 工作区两个作用域", async () => {
  const scopes = await createMockGateway().listScopes();
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes[0], GLOBAL_SCOPE);
  assert.deepEqual(scopes[1], workspaceScope("acme"));
});

test("三类 kind、锁定项、未信任项与工作区覆盖都在演示数据里", async () => {
  const snapshot = await createMockGateway().getSnapshot(workspaceScope("acme"));
  assert.equal(new Set(snapshot.items.map((entry) => entry.kind)).size, 3);
  assert.ok(snapshot.items.some((entry) => entry.locked));
  assert.ok(snapshot.items.some((entry) => entry.requiresTrust && !entry.trusted && !entry.effective));
  const base = snapshot.items.find((entry) => entry.key === "prompt:base");
  assert.equal(base?.origin, "workspace");
  assert.equal(base?.order, 120);
  assert.equal(snapshot.diagnostics.length, 2);
});

test("未知工作区以 PROTOCOL 拒绝，apply 返回 failed 占位", async () => {
  const gateway = createMockGateway();
  await assert.rejects(
    () => gateway.getSnapshot(workspaceScope("other")),
    (error: unknown) => (error as { code?: string }).code === "PROTOCOL",
  );
  const result = await gateway.apply(GLOBAL_SCOPE, []);
  assert.equal(result.status, "failed");
  assert.equal(result.applyState, "failed");
  assert.deepEqual(result.writtenFiles, []);
  assert.equal((await gateway.getDiagnostics(GLOBAL_SCOPE)).length, 0);
});
test("演示数据包含 enabled=false 的禁用条目，禁用态可被 UI 演练", async () => {
  const snapshot = await createMockGateway().getSnapshot(GLOBAL_SCOPE);
  const legacy = snapshot.items.find((entry) => entry.key === "prompt:legacy");
  assert.equal(legacy?.enabled, false);
  assert.equal(legacy?.effective, false);
  assert.equal(legacy?.blockedReason, "disabled");
});
