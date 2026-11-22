import test from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_SCOPE, entityKey, parseEntityKey, scopeEquals, scopeLabel, workspaceScope } from "../src/shared";

test("entityKey 生成 kind:id 并拒绝空 id", () => {
  assert.equal(entityKey("prompt", "base"), "prompt:base");
  assert.equal(entityKey("mcp", "github"), "mcp:github");
  assert.throws(() => entityKey("skill", ""), /id must be non-empty/);
});

test("parseEntityKey 往返成功并拒绝无冒号、冒号在首尾、未知 kind", () => {
  assert.deepEqual(parseEntityKey(entityKey("mcp", "github")), { kind: "mcp", id: "github" });
  assert.throws(() => parseEntityKey("no-colon" as never));
  assert.throws(() => parseEntityKey(":base" as never));
  assert.throws(() => parseEntityKey("prompt:" as never));
  assert.throws(() => parseEntityKey("wat:base" as never));
});

test("scopeLabel 与 scopeEquals 覆盖 global 与 workspace 组合", () => {
  assert.equal(scopeLabel(GLOBAL_SCOPE), "global");
  assert.equal(scopeLabel(workspaceScope("acme")), "workspace:acme");
  assert.equal(scopeEquals(GLOBAL_SCOPE, GLOBAL_SCOPE), true);
  assert.equal(scopeEquals(workspaceScope("acme"), workspaceScope("acme")), true);
  assert.equal(scopeEquals(workspaceScope("acme"), workspaceScope("other")), false);
  assert.equal(scopeEquals(GLOBAL_SCOPE, workspaceScope("acme")), false);
  assert.throws(() => workspaceScope(""), /workspaceId/);
});

import { CSMM_CSS, ensureStyles } from "../src/client/styles";

interface ParsedCss {
  readonly selectors: readonly string[];
  readonly rootBlock: string;
}

function parseCss(css: string): ParsedCss {
  const selectors: string[] = [];
  const pattern = /([^{}]+)\{/g;
  let match = pattern.exec(css);
  while (match !== null) {
    const prelude = match[1].trim().replace(/\s+/g, " ");
    if (!prelude.startsWith("@")) {
      selectors.push(prelude);
    }
    match = pattern.exec(css);
  }
  const rootStart = css.indexOf(".csmm-root {");
  const rootEnd = css.indexOf("}", rootStart);
  return { selectors, rootBlock: rootStart < 0 ? "" : css.slice(rootStart, rootEnd) };
}

const parsed = parseCss(CSMM_CSS);

test("CSS 每条规则选择器都以 .csmm-root 开头（@media 内同样）", () => {
  assert.ok(parsed.selectors.length >= 40, "选择器数量异常：" + String(parsed.selectors.length));
  for (const selector of parsed.selectors) {
    assert.ok(selector.startsWith(".csmm-root"), "越界选择器：" + selector);
  }
});

test("样式文本不含裸 :root/html/body/*/#root 选择器，也没有宿主 id 选择器", () => {
  assert.equal(parsed.selectors.some((selector) => /^(?::root|html|body|\*|#root)\b/.test(selector)), false);
  assert.equal(parsed.selectors.some((selector) => selector.includes("#host-shell")), false);
  assert.equal(parsed.selectors.some((selector) => selector === ".app" || selector === ".body" || selector === ".tabs"), false);
  assert.equal(CSMM_CSS.includes("#host-shell"), false);
});

test("变量与字体声明在 .csmm-root 上", () => {
  assert.ok(parsed.rootBlock.includes("--bg:"));
  assert.ok(parsed.rootBlock.includes("--mono:"));
  assert.ok(parsed.rootBlock.includes("font:"));
  assert.ok(parsed.rootBlock.includes("display: grid"));
});

test("宿主隔离：无关宿主的 #host-shell 与 .app 节点不会命中任何规则", () => {
  // 规则都要求 .csmm-root 祖先；宿主页面里的 #host-shell / .app 没有这个祖先，因此不匹配。
  const hostSelectors = [".app", ".body", ".tabs", ".topbar", ".badge", ".detail"];
  for (const host of hostSelectors) {
    for (const selector of parsed.selectors) {
      const parts = selector.split(",").map((part) => part.trim());
      for (const part of parts) {
        assert.notEqual(part, host, "宿主节点会被规则命中：" + selector);
        assert.equal(part.split(" ").includes(host) && !part.startsWith(".csmm-root"), false, "宿主选择器越界：" + selector);
      }
    }
  }
});

test("M5：键盘焦点样式保留在 .csmm-root 作用域内", () => {
  assert.ok(CSMM_CSS.includes(".csmm-root :focus-visible"));
  assert.ok(parsed.selectors.some((selector) => selector.includes(":focus-visible")));
});

test("ensureStyles 注入一次 style[data-csmm]，重复调用不追加", () => {
  const appended: { attrs: Record<string, string>; textContent: string }[] = [];
  const head = {
    querySelector: () => (appended.length > 0 ? appended[0] : null),
    appendChild: (element: { attrs: Record<string, string>; textContent: string }) => {
      appended.push(element);
    },
  };
  const doc = {
    head,
    createElement: () => ({
      attrs: {} as Record<string, string>,
      textContent: "",
      setAttribute(name: string, value: string) {
        this.attrs[name] = value;
      },
    }),
  } as unknown as Document;
  ensureStyles(doc);
  ensureStyles(doc);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].attrs["data-csmm"], "");
  assert.ok(appended[0].textContent.includes(".csmm-root"));
});