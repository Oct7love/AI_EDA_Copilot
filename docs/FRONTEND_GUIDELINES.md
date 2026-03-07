# AI EDA Copilot — 前端规范文档 (FRONTEND_GUIDELINES)

> 版本：1.0
> 日期：2026-03-08
> 状态：草案

---

## 1. 文档目的

定义 Webview 侧前端开发的规范、组件设计原则、状态管理约定和测试要求。

---

## 2. 组件设计原则

### 2.1 组件分类

| 类型 | 目录 | 职责 |
|------|------|------|
| 页面组件 | `panel/PanelApp.tsx`, `report/ReportApp.tsx` | 路由级组件，管理消息监听和全局布局 |
| 业务组件 | `panel/components/`, `report/components/` | 特定业务逻辑的 UI 封装 |
| 共享组件 | `webview/components/` | 两个 Webview 共用的通用组件 |

### 2.2 组件规范

- 每个组件单一职责
- Props 接口显式定义，禁止 `any`
- 事件处理器命名 `handle{Event}`
- 条件渲染使用早返回模式（空态 → 加载态 → 正常态）
- 复杂组件拆分子组件，每个子组件 < 100 行

### 2.3 禁止的模式

- 组件内直接调用 `vscodeApi.postMessage`（应通过 action 或 handler 封装）
- 在渲染函数中执行副作用
- 使用 `useEffect` 作为事件处理器的替代
- 在组件内硬编码样式（应使用 CSS 文件 + 变量）

---

## 3. 状态管理约定

### 3.1 Zustand Store 规范

- 每个 Webview 独立 Store（`inputStore` / `reportStore`）
- State 与 Action 在同一 interface 中定义
- 派生数据使用 `useMemo` 或选择器函数，不存入 Store
- 编辑态与原始数据分离（如 `editingFields` vs `requirementSpec`）
- devtools middleware 仅在 `import.meta.env.DEV` 时启用

### 3.2 Store 拆分原则

| Store | 管辖范围 |
|-------|---------|
| inputStore | Side Panel 的输入状态、消息列表、生成状态 |
| reportStore | Report Tab 的报告数据、流式内容、编辑态 |

不允许跨 Store 直接引用。共享数据通过消息协议在 Extension Host 中中转。

---

## 4. 样式规范

### 4.1 CSS 策略

- 使用普通 CSS 文件 + BEM 风格类名
- 类名前缀与组件对应（如 `.overview-*`, `.requirements-*`）
- 颜色、间距、圆角统一使用 `--eda-*` CSS 变量
- 禁止硬编码颜色值（必须使用 CSS 变量 + fallback）
- 禁止使用 `!important`

### 4.2 主题适配

- 所有颜色通过 `--eda-*` 变量桥接 VS Code 主题变量
- 明暗主题切换时自动适配
- 每个新组件必须在暗色和亮色主题下验证

---

## 5. 前端测试与 UI 验收规范

### 5.1 组件状态覆盖要求

每个 Report Section 组件至少覆盖以下状态：

| 状态 | 说明 | 必须测试 |
|------|------|----------|
| loading | 数据加载中 | ✅ |
| empty | 无数据（初始状态） | ✅ |
| ready | 数据就绪，正常渲染 | ✅ |
| error | 数据加载或解析失败 | ✅ |
| stale | 数据已过期（Phase 6+） | ✅ |

### 5.2 交互组件测试要求

关键交互组件必须覆盖：

| 测试类型 | 说明 |
|----------|------|
| 受控输入 | 输入值变化 → state 更新 → UI 反映 |
| 事件触发 | 按钮点击 / Enter / 失焦 → handler 调用 |
| message dispatch | 用户操作 → postMessage 发送正确消息 |
| 边界条件 | 空输入、超长输入、特殊字符 |

### 5.3 Zustand Store 测试约定

```typescript
// 测试模式：直接调用 action，验证 state 变化
const store = useReportStore.getState();
store.setRequirementSpec(mockSpec);
expect(useReportStore.getState().requirementSpec).toBe(mockSpec);

store.setEditingField('mcu', 'ESP32-S3');
expect(useReportStore.getState().editingFields['mcu']).toBe('ESP32-S3');

store.clearEditingField('mcu');
expect(useReportStore.getState().editingFields['mcu']).toBeUndefined();
```

### 5.4 消息协议 UI 端测试

验证 Webview 正确处理每种消息类型：

| 消息类型 | 测试要点 |
|----------|----------|
| ai_chat_response (streaming) | 消息追加到列表，isGenerating = true |
| ai_chat_response (final) | 消息追加，isGenerating = false |
| generation_status | 状态文本更新 |
| error | 错误显示，isGenerating = false |
| report_data | spec + overview 存入 store |
| report_stream_chunk | streamContent 累积 |
| report_stream_end | isStreaming = false |

### 5.5 必测的 UI 交互

| 组件 | 必测交互 |
|------|----------|
| ChatInput | Enter 发送、Shift+Enter 换行、空输入拒绝、isGenerating 禁用 |
| FormInput | 字段填写、数组字段逗号分隔、折叠展开、Analyze 提交 |
| InputModeToggle | Chat / Form 切换、状态保持 |
| TemplateSelector | 模板点击 → 预填表单 + 切换模式 |
| RequirementsSection | 字段点击编辑、Enter 提交、Escape 取消、失焦提交 |
| Tab 导航 | Tab 切换、活跃态样式、键盘可达 |

### 5.6 无障碍测试要求

- 所有可交互元素键盘可达（Tab 顺序合理）
- 按钮和输入框有 ARIA 标签
- 进度条使用 `role="progressbar"` + `aria-valuenow`
- Tab 导航使用 `role="tab"` + `aria-selected`
- 颜色对比度满足 WCAG 2.1 AA 标准

### 5.7 性能验收

- Report Tab 首屏渲染 < 200ms
- 流式文本更新不造成明显卡顿
- 大型 BOM 表格（100+ 行）滚动流畅
- Tab 切换无闪烁

---

## 6. 错误处理规范

### 6.1 组件错误边界

- 每个 Report Section 独立 ErrorBoundary（Phase 4+ 实现）
- 错误边界显示友好提示 + 重试按钮
- 错误信息记录到 console，不暴露给用户

### 6.2 空态设计

每个板块的空态必须包含：

- 明确的提示文案（告诉用户下一步做什么）
- 适当的视觉占位
- 不显示 loading spinner（除非确实在加载中）
