import test from "node:test";
import assert from "node:assert/strict";
import { computeEffectiveChain, countsByKind, filterByKind, findItem, sortItems } from "../src/model/panelModel";
import { GLOBAL_ITEMS, WORKSPACE_ITEMS } from "../src/mock/fixtures";
import { GLOBAL_SCOPE, entityKey, workspaceScope, type Kind, type ResourceItem } from "../src/shared";

function item(kind: Kind, id: string, order: number | null): ResourceItem {
  return {
    key: entityKey(kind, id),
    kind,
    id,
    scope: GLOBAL_SCOPE,
    origin: "global",
    enabled: true,
    locked: false,
    requiresTrust: false,
    trusted: true,
    effective: true,
    blockedReason: null,
    order,
    summary: "s-" + id,
    source: "profiles/default.json",
  };
}

test("prompt 按 order 升序：system-base(10) 在 base(100) 之前", () => {
  const reversed = GLOBAL_ITEMS.slice().reverse();
  const prompts = sortItems(reversed).filter((entry) => entry.kind === "prompt").map((entry) => entry.id);
  assert.deepEqual(prompts, ["system-base", "base", "legacy"]);
});

test("乱序混合 fixture：kind 主序、prompt 按 order、同组按 id 字节序", () => {
  const shuffled = [
    item("mcp", "z", null),
    item("skill", "b", null),
    item("prompt", "c", 300),
    item("prompt", "a", 10),
    item("skill", "a", null),
    item("mcp", "a", null),
  ];
  const sorted = sortItems(shuffled);
  assert.deepEqual(
    sorted.map((entry) => entry.key),
    ["prompt:a", "prompt:c", "skill:a", "skill:b", "mcp:a", "mcp:z"],
  );
  assert.deepEqual(
    shuffled.map((entry) => entry.key),
    ["mcp:z", "skill:b", "prompt:c", "prompt:a", "skill:a", "mcp:a"],
  );
});

test("工作区 prompt：base(120) 在 repo-rules(150) 之前，且不修改入参", () => {
  const input = WORKSPACE_ITEMS.slice().reverse();
  const sorted = sortItems(input);
  const prompts = sorted.filter((entry) => entry.kind === "prompt").map((entry) => entry.id);
  assert.deepEqual(prompts, ["system-base", "base", "repo-rules"]);
  assert.deepEqual(input.map((entry) => entry.id), WORKSPACE_ITEMS.slice().reverse().map((entry) => entry.id));
});

test("kind 次序 prompt < skill < mcp", () => {
  assert.deepEqual(
    sortItems(WORKSPACE_ITEMS).map((entry) => entry.kind),
    ["prompt", "prompt", "prompt", "skill", "skill", "mcp"],
  );
});

test("filterByKind 过滤并排序，all 返回全部条目", () => {
  assert.equal(filterByKind(WORKSPACE_ITEMS, "all").length, WORKSPACE_ITEMS.length);
  assert.deepEqual(filterByKind(WORKSPACE_ITEMS, "mcp").map((entry) => entry.id), ["github"]);
  assert.equal(filterByKind(GLOBAL_ITEMS, "skill").length, 1);
});

test("countsByKind 统计全部入参，三个键恒存在", () => {
  assert.deepEqual(countsByKind(WORKSPACE_ITEMS), { prompt: 3, skill: 2, mcp: 1 });
  assert.deepEqual(countsByKind([]), { prompt: 0, skill: 0, mcp: 0 });
});

test("findItem 按键全等查找", () => {
  assert.equal(findItem(WORKSPACE_ITEMS, entityKey("prompt", "repo-rules"))?.order, 150);
  assert.equal(findItem(WORKSPACE_ITEMS, entityKey("mcp", "missing")), undefined);
});

test("computeEffectiveChain：全局 base + 工作区 override", () => {
  const chain = computeEffectiveChain(GLOBAL_ITEMS, WORKSPACE_ITEMS, entityKey("prompt", "base"), workspaceScope("acme"));
  assert.deepEqual(chain.layers.map((layer) => layer.state), ["base", "override"]);
  assert.equal(chain.layers[0].valueSummary, "order 100 · 通用工程规范");
  assert.equal(chain.layers[1].valueSummary, "order 120 · 本仓覆盖：用 pnpm，提交前跑测试");
  assert.equal(chain.effective, true);
  assert.equal(chain.source, ".dsh/settings.json");
  assert.equal(chain.blockedReason, null);
});

test("computeEffectiveChain：工作区尝试覆盖锁定键被判 dropped，仍取全局值", () => {
  const chain = computeEffectiveChain(GLOBAL_ITEMS, WORKSPACE_ITEMS, entityKey("prompt", "system-base"), workspaceScope("acme"));
  assert.deepEqual(chain.layers.map((layer) => layer.state), ["base", "dropped"]);
  assert.equal(chain.effective, true);
  assert.equal(chain.layers[0].valueSummary, "order 10 · 锁定基线：任何工作区不得覆盖");
});

test("computeEffectiveChain：全局未声明、工作区新增 → absent/override", () => {
  const chain = computeEffectiveChain(GLOBAL_ITEMS, WORKSPACE_ITEMS, entityKey("prompt", "repo-rules"), workspaceScope("acme"));
  assert.deepEqual(chain.layers.map((layer) => layer.present), [false, true]);
  assert.deepEqual(chain.layers.map((layer) => layer.state), ["absent", "override"]);
  assert.equal(chain.effective, true);
});

test("computeEffectiveChain：两层都没有该键 → 不生效且来源为占位", () => {
  const chain = computeEffectiveChain(GLOBAL_ITEMS, WORKSPACE_ITEMS, entityKey("mcp", "ghost"), workspaceScope("acme"));
  assert.deepEqual(chain.layers.map((layer) => layer.state), ["absent", "absent"]);
  assert.equal(chain.effective, false);
  assert.equal(chain.source, "\u2014");
});

test("computeEffectiveChain：未选择工作区时只返回默认层，不虚构 WORKSPACE 层", () => {
  const chain = computeEffectiveChain(GLOBAL_ITEMS, [], entityKey("prompt", "base"));
  assert.equal(chain.layers.length, 1);
  assert.equal(chain.layers[0].label, "global");
  assert.equal(chain.layers[0].state, "base");
  assert.equal(chain.layers[0].present, true);
  assert.equal(chain.effective, true);
});

test("computeEffectiveChain：给定工作区但该层未声明时，第二层标签与数据一致", () => {
  const chain = computeEffectiveChain(GLOBAL_ITEMS, [], entityKey("prompt", "base"), workspaceScope("acme"));
  assert.equal(chain.layers.length, 2);
  assert.equal(chain.layers[1].label, "workspace:acme");
  assert.equal(chain.layers[1].present, false);
  assert.equal(chain.layers[1].state, "absent");
});
