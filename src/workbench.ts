import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { diffAgainstSnapshot } from './diff';
import { SpecStore } from './store';
import type { ComponentExample, ComponentSpec, DeprecationRecord, PreviewDensity, PreviewTheme, PropertySpec, ValidationIssue } from './types';

type EditorTab = 'overview' | 'api' | 'accessibility' | 'examples' | 'history';

export class SpecA11yWorkbench extends LitElement {
  static properties = {
    query: { state: true },
    tab: { state: true },
    previewTheme: { state: true },
    previewDensity: { state: true },
    toast: { state: true },
    showValidation: { state: true }
  };

  private store = new SpecStore();
  private query = '';
  private tab: EditorTab = 'overview';
  private previewTheme: PreviewTheme = 'light';
  private previewDensity: PreviewDensity = 'regular';
  private toast = '';
  private showValidation = true;
  private deprecatingId = '';
  private deprecateReplacement = '';
  private deprecateEol = '';
  private deprecateReason = '';
  private toastTimer?: number;

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      color: var(--spectrum-gray-900);
      background: linear-gradient(135deg, var(--spectrum-gray-100), var(--spectrum-blue-100));
      font-family: var(--spectrum-sans-font-family, Inter, ui-sans-serif, system-ui);
    }
    * { box-sizing: border-box; }
    .app { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    header {
      position: sticky; top: 0; z-index: 20;
      display: flex; align-items: center; gap: 18px; padding: 14px 22px;
      background: color-mix(in srgb, var(--spectrum-gray-50) 92%, transparent);
      border-bottom: 1px solid var(--spectrum-gray-300); backdrop-filter: blur(14px);
    }
    .brand { min-width: 245px; }
    .brand h1 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
    .brand p { margin: 3px 0 0; color: var(--spectrum-gray-700); font-size: 12px; }
    .toolbar { display: flex; align-items: center; gap: 8px; flex: 1; }
    .toolbar sp-search { min-width: 280px; flex: 1; max-width: 520px; }
    .save-state { color: var(--spectrum-gray-700); font-size: 12px; white-space: nowrap; }
    .layout {
      display: grid; grid-template-columns: minmax(245px, 290px) minmax(0, 1fr) minmax(315px, 390px);
      min-height: calc(100vh - 72px);
    }
    .sidebar, .inspector { background: color-mix(in srgb, var(--spectrum-gray-50) 90%, transparent); }
    .sidebar { border-right: 1px solid var(--spectrum-gray-300); padding: 18px 12px; }
    .sidebar-heading { display: flex; justify-content: space-between; align-items: center; padding: 0 8px 12px; }
    .sidebar-heading h2, .panel h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; }
    .component-list { display: grid; gap: 7px; }
    .component-item {
      width: 100%; text-align: left; border: 1px solid transparent; border-radius: 10px;
      background: transparent; color: inherit; padding: 11px 12px; cursor: pointer;
    }
    .component-item:hover { background: var(--spectrum-gray-200); }
    .component-item[aria-current='page'] { border-color: var(--spectrum-blue-600); background: var(--spectrum-blue-200); }
    .item-title { display: flex; justify-content: space-between; gap: 8px; font-weight: 700; }
    .item-meta { display: block; color: var(--spectrum-gray-700); font-size: 12px; margin-top: 5px; }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 7px; font-size: 10px; font-weight: 700; background: var(--spectrum-gray-300); }
    .pill.published { background: var(--spectrum-green-300); }
    .pill.review { background: var(--spectrum-orange-300); }
    .main { min-width: 0; padding: 22px; }
    .title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; margin-bottom: 16px; }
    .title-row h2 { font-size: 28px; margin: 0; letter-spacing: -.035em; }
    .title-row p { margin: 6px 0 0; color: var(--spectrum-gray-700); }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .tabs { display: flex; gap: 5px; overflow-x: auto; padding: 5px; border: 1px solid var(--spectrum-gray-300); border-radius: 12px; background: var(--spectrum-gray-100); margin-bottom: 16px; }
    .tab { border: 0; border-radius: 8px; background: transparent; color: var(--spectrum-gray-800); padding: 8px 12px; font: inherit; cursor: pointer; white-space: nowrap; }
    .tab[aria-selected='true'] { background: var(--spectrum-gray-50); box-shadow: 0 1px 4px rgb(0 0 0 / .12); font-weight: 700; }
    .panel { border: 1px solid var(--spectrum-gray-300); border-radius: 16px; background: var(--spectrum-gray-50); padding: 20px; box-shadow: 0 8px 26px rgb(20 30 50 / .06); }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .field { display: grid; gap: 7px; min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    .field > span { font-size: 12px; font-weight: 700; }
    textarea, input[type='text'], select {
      width: 100%; border: 1px solid var(--spectrum-gray-400); border-radius: 8px;
      padding: 9px 10px; background: var(--spectrum-gray-50); color: var(--spectrum-gray-900);
      font: inherit; line-height: 1.5;
    }
    textarea:focus, input:focus, select:focus { outline: 3px solid var(--spectrum-blue-400); outline-offset: 1px; border-color: var(--spectrum-blue-700); }
    textarea { min-height: 110px; resize: vertical; }
    .property-list, .example-list { display: grid; gap: 12px; }
    .property-card, .example-card { border: 1px solid var(--spectrum-gray-300); border-radius: 12px; padding: 14px; background: var(--spectrum-gray-75, var(--spectrum-gray-100)); }
    .property-head, .example-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .property-head strong, .example-head strong { flex: 1; }
    .inline { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .empty { padding: 28px; border: 1px dashed var(--spectrum-gray-400); border-radius: 12px; text-align: center; color: var(--spectrum-gray-700); }
    .inspector { border-left: 1px solid var(--spectrum-gray-300); padding: 18px; display: grid; align-content: start; gap: 15px; }
    .preview { border-radius: 14px; border: 1px solid var(--spectrum-gray-400); padding: 18px; display: grid; place-items: center; min-height: 150px; transition: .2s; }
    .preview.dark { background: #1b1b1b; color: #f5f5f5; border-color: #444; }
    .preview.light { background: #fff; color: #111; }
    .preview.compact { padding: 9px; }
    .preview.regular { padding: 18px; }
    .preview.spacious { padding: 32px; }
    .demo-button { border: 0; border-radius: 8px; padding: 10px 16px; background: #1473e6; color: white; font: inherit; }
    .issue { border-left: 4px solid var(--spectrum-gray-500); border-radius: 8px; background: var(--spectrum-gray-100); padding: 10px 11px; margin-bottom: 8px; font-size: 12px; }
    .issue.error { border-color: var(--spectrum-red-600); }
    .issue.warning { border-color: var(--spectrum-orange-600); }
    .issue.info { border-color: var(--spectrum-blue-600); }
    .issue strong { display: block; margin-bottom: 3px; }
    .issue button { border: 0; background: transparent; color: var(--spectrum-blue-800); padding: 0; cursor: pointer; text-decoration: underline; }
    .diff { display: grid; gap: 7px; margin-top: 9px; }
    .diff-row { border: 1px solid var(--spectrum-gray-300); border-radius: 8px; padding: 9px; font-size: 11px; }
    .diff-row b { display: block; margin-bottom: 4px; text-transform: capitalize; }
    .before { color: var(--spectrum-red-800); white-space: pre-wrap; }
    .after { color: var(--spectrum-green-900); white-space: pre-wrap; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: 10px; font-weight: 700; }
    .badge.deprecated { background: var(--spectrum-orange-300); }
    .badge.breaking { background: var(--spectrum-red-300); }
    .badge.done { background: var(--spectrum-green-300); }
    .deprecation-banner { border: 1px solid var(--spectrum-orange-500); border-left-width: 4px; border-radius: 8px; background: color-mix(in srgb, var(--spectrum-orange-200) 55%, var(--spectrum-gray-50)); padding: 10px 12px; margin: 0 0 12px; display: grid; gap: 6px; font-size: 12px; }
    .deprecation-banner.completed { border-color: var(--spectrum-green-600); background: color-mix(in srgb, var(--spectrum-green-200) 55%, var(--spectrum-gray-50)); }
    .deprecation-banner strong { font-size: 13px; }
    .deprecation-banner .inline { flex-wrap: wrap; }
    .deprecation-form { border: 1px dashed var(--spectrum-gray-500); border-radius: 10px; padding: 12px; margin-top: 12px; display: grid; gap: 10px; background: var(--spectrum-gray-100); }
    .deprecation-form .form-grid { gap: 10px; }
    .migration-box { border: 1px solid var(--spectrum-gray-400); border-radius: 10px; padding: 11px 12px; margin: 8px 0; display: grid; gap: 7px; font-size: 12px; background: var(--spectrum-gray-100); }
    .migration-box.migrated { border-color: var(--spectrum-green-600); background: color-mix(in srgb, var(--spectrum-green-100) 60%, var(--spectrum-gray-50)); }
    .ref-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .ref-chip { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; border: 1px solid var(--spectrum-red-500); background: color-mix(in srgb, var(--spectrum-red-100) 70%, var(--spectrum-gray-50)); border-radius: 6px; padding: 2px 7px; }
    .ref-context { color: var(--spectrum-gray-700); font-size: 11px; word-break: break-word; }
    .deprecation-log { display: grid; gap: 8px; margin-top: 10px; }
    .deprecation-log .issue { margin-bottom: 0; }
    pre { white-space: pre-wrap; word-break: break-word; background: #202020; color: #f5f5f5; padding: 12px; border-radius: 8px; font-size: 12px; }
    .search-empty { padding: 20px 8px; color: var(--spectrum-gray-700); font-size: 13px; }
    .footer-hint { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); z-index: 30; background: #202020; color: white; border-radius: 999px; padding: 6px 12px; font-size: 11px; opacity: .9; }
    sp-toast { position: fixed; right: 18px; bottom: 18px; z-index: 50; }
    @media (max-width: 1180px) {
      .layout { grid-template-columns: 230px minmax(0, 1fr); }
      .inspector { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--spectrum-gray-300); grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 760px) {
      header { flex-wrap: wrap; padding: 12px; }
      .brand { min-width: 100%; }
      .toolbar { flex-wrap: wrap; }
      .toolbar sp-search { min-width: 100%; }
      .layout { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--spectrum-gray-300); }
      .inspector { grid-template-columns: 1fr; }
      .form-grid { grid-template-columns: 1fr; }
      .field.full { grid-column: auto; }
      .main { padding: 14px; }
      .title-row { display: grid; }
      .actions { justify-content: flex-start; }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.store.addEventListener('change', this.onStoreChange);
    window.addEventListener('keydown', this.onKeyDown);
  }

  disconnectedCallback() {
    this.store.removeEventListener('change', this.onStoreChange);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private onStoreChange = () => {
    this.requestUpdate();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.store.redo() : this.store.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.store.createSnapshot('键盘保存');
      this.flash('已创建版本快照');
      return;
    }
    if (modifier && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.renderRoot.querySelector<HTMLElement>('sp-search')?.focus();
      return;
    }
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.store.addComponent();
      return;
    }
    const tabMap: Record<string, EditorTab> = { '1': 'overview', '2': 'api', '3': 'accessibility', '4': 'examples', '5': 'history' };
    if (event.altKey && tabMap[event.key]) {
      event.preventDefault();
      this.tab = tabMap[event.key];
    }
  };

  protected render(): TemplateResult {
    const selected = this.store.selected;
    const issues = this.store.validate();
    const selectedIssues = selected ? issues.filter((item) => item.componentId === selected.id) : [];
    const filtered = this.filteredComponents;
    return html`
      <sp-theme color=${this.previewTheme === 'dark' ? 'dark' : 'light'} scale=${this.previewDensity === 'compact' ? 'medium' : 'large'}>
        <div class="app">
          <header>
            <div class="brand">
              <h1>Component Contract Studio</h1>
              <p>规范、无障碍与示例失效追踪</p>
            </div>
            <div class="toolbar">
              <sp-search
                placeholder="搜索组件、属性、键盘行为或示例"
                aria-label="全文搜索"
                .value=${this.query}
                @input=${(event: Event) => { this.query = (event.currentTarget as HTMLInputElement & { value?: string }).value ?? ''; }}
              ></sp-search>
              <sp-button variant="secondary" ?disabled=${!this.store.canUndo} @click=${() => this.store.undo()}>撤销</sp-button>
              <sp-button variant="secondary" ?disabled=${!this.store.canRedo} @click=${() => this.store.redo()}>重做</sp-button>
              <sp-button variant="accent" @click=${() => { this.store.createSnapshot('工具栏保存'); this.flash('版本已保存'); }}>保存版本</sp-button>
              <span class="save-state">本地自动保存 · ${selected?.revision ?? 0} 版</span>
            </div>
          </header>
          <div class="layout">
            <aside class="sidebar" aria-label="组件目录">
              <div class="sidebar-heading">
                <h2>组件目录</h2>
                <sp-action-button size="s" label="新建组件" @click=${() => this.store.addComponent()}>＋</sp-action-button>
              </div>
              <div class="component-list">
                ${filtered.length ? repeat(filtered, (item) => item.id, (item) => html`
                  <button class="component-item" aria-current=${item.id === this.store.state.selectedId ? 'page' : nothing} @click=${() => this.store.select(item.id)}>
                    <span class="item-title">
                      <span>${item.name}</span>
                      <span class="pill ${item.status}">${this.statusLabel(item.status)}</span>
                    </span>
                    <span class="item-meta">${item.category} · ${item.properties.length} 个属性 · ${item.examples.length} 个示例</span>
                  </button>
                `) : html`<div class="search-empty">没有匹配的组件。可尝试属性名、键盘行为或代码文本。</div>`}
              </div>
            </aside>
            <main class="main">${selected ? this.renderEditor(selected) : html`<div class="empty">新建或选择组件开始编辑。</div>`}</main>
            <aside class="inspector" aria-label="预览与检查">
              ${this.renderPreview(selected)}
              ${this.renderValidation(selectedIssues)}
            </aside>
          </div>
          ${this.toast ? html`<sp-toast open variant="positive" timeout="3000">${this.toast}</sp-toast>` : nothing}
          <div class="footer-hint">⌘/Ctrl+Z 撤销 · ⇧⌘/Ctrl+Z 重做 · ⌘/Ctrl+K 搜索 · Alt+1–5 切换面板</div>
        </div>
      </sp-theme>
    `;
  }

  private renderEditor(component: ComponentSpec): TemplateResult {
    return html`
      <div class="title-row">
        <div>
          <h2>${component.name}</h2>
          <p>${component.purpose}</p>
        </div>
        <div class="actions">
          <select aria-label="组件状态" .value=${component.status} @change=${(event: Event) => {
            const result = this.store.setStatus((event.currentTarget as HTMLSelectElement).value as ComponentSpec['status']);
            if (!result.ok) {
              (event.currentTarget as HTMLSelectElement).value = component.status;
              this.flash(result.reason);
            }
          }}>
            <option value="draft">草稿</option>
            <option value="review">待审</option>
            <option value="published" ?disabled=${!!this.store.publishBlocker(component)}>已发布${this.store.publishBlocker(component) ? '（废弃迁移未完成）' : ''}</option>
          </select>
          <sp-button variant="secondary" @click=${() => this.store.createSnapshot('编辑器保存')}>保存快照</sp-button>
          ${this.hasStaleExamples(component) ? html`<sp-button variant="accent" @click=${() => { this.store.migrateExamples(); this.flash('示例已迁移到当前契约'); }}>迁移示例</sp-button>` : nothing}
        </div>
      </div>
      <div class="tabs" role="tablist" aria-label="编辑区域">
        ${this.renderTab('overview', '1 概述')}
        ${this.renderTab('api', '2 属性与状态')}
        ${this.renderTab('accessibility', '3 无障碍')}
        ${this.renderTab('examples', '4 示例')}
        ${this.renderTab('history', '5 版本')}
      </div>
      ${this.tab === 'overview' ? this.renderOverview(component) : nothing}
      ${this.tab === 'api' ? this.renderApi(component) : nothing}
      ${this.tab === 'accessibility' ? this.renderAccessibility(component) : nothing}
      ${this.tab === 'examples' ? this.renderExamples(component) : nothing}
      ${this.tab === 'history' ? this.renderHistory(component) : nothing}
    `;
  }

  private renderTab(tab: EditorTab, label: string): TemplateResult {
    return html`<button class="tab" role="tab" aria-selected=${this.tab === tab} @click=${() => { this.tab = tab; }}>${label}</button>`;
  }

  private renderOverview(component: ComponentSpec): TemplateResult {
    return html`
      <section class="panel" aria-label="组件概述">
        <div class="form-grid">
          <label class="field"><span>组件名称</span><input type="text" .value=${component.name} @change=${(event: Event) => this.store.updateComponent({ name: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field"><span>分类</span><input type="text" .value=${component.category} @change=${(event: Event) => this.store.updateComponent({ category: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field full"><span>用途</span><textarea .value=${component.purpose} @change=${(event: Event) => this.store.updateComponent({ purpose: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>使用规则</span><textarea .value=${component.usage} @change=${(event: Event) => this.store.updateComponent({ usage: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>禁用场景</span><textarea .value=${component.disabledScenarios} @change=${(event: Event) => this.store.updateComponent({ disabledScenarios: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </section>
    `;
  }

  private renderApi(component: ComponentSpec): TemplateResult {
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>属性契约</h2>
          <sp-button size="s" variant="secondary" @click=${() => this.store.addProperty()}>新增属性</sp-button>
        </div>
        <div class="property-list">
          ${component.properties.length ? repeat(component.properties, (item) => item.id, (property) => this.renderProperty(component, property)) : html`<div class="empty">尚未定义属性。</div>`}
        </div>
        <div class="form-grid" style="margin-top: 18px">
          <label class="field full"><span>状态说明</span><textarea .value=${component.states} @change=${(event: Event) => this.store.updateComponent({ states: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>交互签名（修改后会标记关联示例失效）</span><textarea .value=${component.interactionSignature} @change=${(event: Event) => this.store.updateComponent({ interactionSignature: (event.currentTarget as HTMLTextAreaElement).value }, true)}></textarea></label>
        </div>
      </section>
    `;
  }

  private renderProperty(component: ComponentSpec, property: PropertySpec): TemplateResult {
    const record = component.deprecations.find((item) => item.propertyId === property.id);
    const isDeprecating = this.deprecatingId === property.id;
    const total = record?.migrations.length ?? 0;
    const done = record?.migrations.filter((migration) => migration.status === 'migrated').length ?? 0;
    return html`
      <article class="property-card">
        <div class="property-head">
          <strong>${property.name || '未命名属性'}</strong>
          ${record ? (record.status === 'active'
            ? html`<span class="badge ${record.replacementId ? 'deprecated' : 'breaking'}">${record.replacementId ? `废弃中 · ${done}/${total} 已迁移` : `破坏性下线 · ${done}/${total} 已确认`}</span>`
            : html`<span class="badge done">已迁移 · 失效于 ${record.eolVersion}</span>`)
            : nothing}
          ${record?.status === 'active'
            ? html`<sp-action-button size="s" label="取消废弃" @click=${() => { this.deprecatingId = ''; this.store.cancelDeprecation(property.id); this.flash('已取消废弃登记'); }}>取消废弃</sp-action-button>`
            : html`<sp-action-button size="s" label="废弃属性" ?disabled=${!!record} @click=${() => this.openDeprecateForm(component, property)}>废弃</sp-action-button>`}
          <sp-action-button size="s" label="删除属性" ?disabled=${!!record} @click=${() => this.store.removeProperty(property.id)}>删除</sp-action-button>
        </div>
        ${record ? this.renderDeprecationBanner(property.id, record) : nothing}
        ${isDeprecating && !record ? this.renderDeprecateForm(component, property) : nothing}
        <div class="form-grid">
          <label class="field"><span>名称</span><input type="text" .value=${property.name} @change=${(event: Event) => this.store.updateProperty(property.id, { name: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field"><span>类型</span><input type="text" .value=${property.type} @change=${(event: Event) => this.store.updateProperty(property.id, { type: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field"><span>默认值</span><input type="text" .value=${property.defaultValue} @change=${(event: Event) => this.store.updateProperty(property.id, { defaultValue: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="inline"><input type="checkbox" .checked=${property.required} @change=${(event: Event) => this.store.updateProperty(property.id, { required: (event.currentTarget as HTMLInputElement).checked })} /> 必填属性</label>
          <label class="field full"><span>属性说明</span><textarea .value=${property.description} @change=${(event: Event) => this.store.updateProperty(property.id, { description: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </article>
    `;
  }

  private renderDeprecationBanner(propertyId: string, record: DeprecationRecord): TemplateResult {
    const pending = record.migrations.filter((migration) => migration.status === 'pending');
    return html`
      <div class="deprecation-banner ${record.status === 'completed' ? 'completed' : ''}">
        <strong>${record.status === 'completed' ? '废弃迁移已完成' : '属性已登记废弃'}</strong>
        <span>失效版本：<b>${record.eolVersion}</b> · 登记于 ${new Date(record.deprecatedAt).toLocaleString('zh-CN')}${record.completedAt ? ` · 完成于 ${new Date(record.completedAt).toLocaleString('zh-CN')}` : ''}</span>
        <span>替代属性：${record.replacementId
          ? html`<b>${record.replacementName}</b>`
          : html`<b style="color: var(--spectrum-red-800)">无替代，按破坏性变更处理</b>`}</span>
        ${record.reason ? html`<span>废弃原因：${record.reason}</span>` : nothing}
        ${record.status === 'active'
          ? html`<span>迁移进度：${record.migrations.length - pending.length}/${record.migrations.length} 条关联示例已处理。迁移结束前组件不能进入已发布状态。</span>
            ${record.replacementId && pending.length ? html`<sp-button size="s" variant="secondary" @click=${() => { this.store.migrateAllReplaceable(propertyId); this.flash(`已将 ${pending.length} 条示例改写为 ${record.replacementName}`); }}>全部迁移到 ${record.replacementName}</sp-button>` : nothing}`
          : html`<span>旧示例引用已全部迁移并保存了版本快照，属性可安全下线。</span>`}
      </div>
    `;
  }

  private renderDeprecateForm(component: ComponentSpec, property: PropertySpec): TemplateResult {
    const candidates = component.properties.filter((item) => item.id !== property.id);
    return html`
      <div class="deprecation-form" role="group" aria-label="登记属性废弃">
        <strong>废弃 ${property.name}：选择替代属性与失效版本</strong>
        <div class="form-grid">
          <label class="field"><span>替代属性（不选则记为破坏性变更）</span>
            <select .value=${this.deprecateReplacement} @change=${(event: Event) => { this.deprecateReplacement = (event.currentTarget as HTMLSelectElement).value; this.requestUpdate(); }}>
              <option value="">无替代属性 · 破坏性变更</option>
              ${candidates.map((candidate) => html`<option value=${candidate.id}>${candidate.name}（${candidate.type}）</option>`)}
            </select>
          </label>
          <label class="field"><span>失效版本</span><input type="text" .value=${this.deprecateEol} @input=${(event: Event) => { this.deprecateEol = (event.currentTarget as HTMLInputElement).value; }} placeholder=${`r${component.revision + 2}`} /></label>
          <label class="field full"><span>废弃原因（供迁移者理解替代意图）</span><textarea style="min-height: 64px" .value=${this.deprecateReason} @input=${(event: Event) => { this.deprecateReason = (event.currentTarget as HTMLTextAreaElement).value; }}></textarea></label>
        </div>
        <div class="inline">
          <sp-button size="s" variant="accent" @click=${() => {
            this.store.deprecateProperty(property.id, this.deprecateReplacement || null, this.deprecateEol, this.deprecateReason);
            this.deprecatingId = '';
            this.flash(`已登记废弃：${this.deprecateReplacement ? '关联示例可迁移到替代属性' : '标记为破坏性变更，需逐条确认'}`);
          }}>确认废弃并枚举旧引用</sp-button>
          <sp-button size="s" variant="secondary" @click=${() => { this.deprecatingId = ''; this.requestUpdate(); }}>取消</sp-button>
        </div>
      </div>
    `;
  }

  private renderAccessibility(component: ComponentSpec): TemplateResult {
    return html`
      <section class="panel">
        <div class="form-grid">
          <label class="field full"><span>键盘行为</span><textarea .value=${component.keyboardBehavior} @change=${(event: Event) => this.store.updateComponent({ keyboardBehavior: (event.currentTarget as HTMLTextAreaElement).value }, true)}></textarea></label>
          <label class="field full"><span>读屏说明</span><textarea .value=${component.screenReader} @change=${(event: Event) => this.store.updateComponent({ screenReader: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <label class="field full"><span>禁用场景</span><textarea .value=${component.disabledScenarios} @change=${(event: Event) => this.store.updateComponent({ disabledScenarios: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
        </div>
      </section>
    `;
  }

  private renderExamples(component: ComponentSpec): TemplateResult {
    const activeRecords = component.deprecations.filter((record) => record.status === 'active');
    const replaceablePending = activeRecords.some((record) => record.replacementId && record.migrations.some((migration) => migration.status === 'pending'));
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>关联示例</h2>
          <div class="inline">
            ${replaceablePending ? html`<sp-button size="s" variant="accent" @click=${() => { activeRecords.forEach((record) => { if (record.replacementId) this.store.migrateAllReplaceable(record.propertyId); }); this.flash('有替代属性的旧引用已全部迁移'); }}>迁移全部有替代的引用</sp-button>` : nothing}
            <sp-button size="s" variant="secondary" @click=${() => this.store.addExample()}>新增示例</sp-button>
          </div>
        </div>
        ${activeRecords.length ? html`<div class="issue warning"><strong>${activeRecords.length} 个属性正在废弃</strong>下列示例逐条列出旧引用；有替代的可一键改写，无替代的破坏性变更必须人工改代码后逐条确认。全部完成前组件不能发布。</div>` : nothing}
        <div class="example-list">
          ${component.examples.length ? repeat(component.examples, (item) => item.id, (example) => this.renderExample(component, example)) : html`<div class="empty">尚无示例。新增后会追踪属性依赖和版本契约。</div>`}
        </div>
      </section>
    `;
  }

  private openDeprecateForm(component: ComponentSpec, property: PropertySpec) {
    this.deprecatingId = property.id;
    this.deprecateReplacement = '';
    this.deprecateReason = '';
    this.deprecateEol = `r${component.revision + 2}`;
    this.requestUpdate();
  }

  private renderExample(component: ComponentSpec, example: ComponentExample): TemplateResult {
    const migrations = component.deprecations
      .map((record) => ({ record, migration: record.migrations.find((item) => item.exampleId === example.id) }))
      .filter((entry): entry is { record: DeprecationRecord; migration: NonNullable<DeprecationRecord['migrations'][number]> } => !!entry.migration);
    return html`
      <article class="example-card">
        <div class="example-head">
          <strong>${example.title}</strong>
          <span class="pill ${example.stale ? 'review' : 'published'}">${example.stale ? '需要迁移' : `r${example.createdFromRevision}`}</span>
          <sp-action-button size="s" label="复制代码" @click=${() => this.copy(example.code)}>复制</sp-action-button>
          <sp-action-button size="s" label="删除示例" @click=${() => this.store.removeExample(example.id)}>删除</sp-action-button>
        </div>
        ${example.stale ? html`<div class="issue warning"><strong>关联失效</strong>${example.staleReason}</div>` : nothing}
        ${migrations.map(({ record, migration }) => this.renderMigration(record, migration))}
        <div class="form-grid">
          <label class="field full"><span>标题</span><input type="text" .value=${example.title} @change=${(event: Event) => this.store.updateExample(example.id, { title: (event.currentTarget as HTMLInputElement).value })} /></label>
          <label class="field full"><span>代码</span><textarea .value=${example.code} @change=${(event: Event) => this.store.updateExample(example.id, { code: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></label>
          <div class="field full">
            <span>依赖属性</span>
            <div class="inline" style="flex-wrap: wrap">
              ${component.properties.map((property) => html`
                <label class="inline"><input type="checkbox" .checked=${example.propertyIds.includes(property.id)} @change=${(event: Event) => {
                  const values = new Set(example.propertyIds);
                  (event.currentTarget as HTMLInputElement).checked ? values.add(property.id) : values.delete(property.id);
                  this.store.updateExample(example.id, { propertyIds: [...values] });
                }} /> ${property.name}</label>
              `)}
              ${!component.properties.length ? html`<span>当前组件没有属性。</span>` : nothing}
            </div>
          </div>
          <div class="field full"><pre>${example.code}</pre></div>
        </div>
      </article>
    `;
  }

  private renderMigration(record: DeprecationRecord, migration: DeprecationRecord['migrations'][number]): TemplateResult {
    const migrated = migration.status === 'migrated';
    return html`
      <div class="migration-box ${migrated ? 'migrated' : ''}">
        <strong>${migrated ? '✓ ' : ''}旧属性 ${record.propertyName} 的引用${migrated ? '已迁移' : '待迁移'}</strong>
        <span>${migration.note}</span>
        <div class="ref-list">
          ${migration.oldReferences.map((reference) => html`
            <span class="ref-chip" title=${reference.context}>${reference.snippet}</span>
          `)}
        </div>
        ${migration.oldReferences.some((reference) => reference.context) ? html`<span class="ref-context">出处：${migration.oldReferences.map((reference) => reference.context).join('；')}</span>` : nothing}
        ${migrated
          ? html`<span class="ref-context">完成于 ${migration.migratedAt ? new Date(migration.migratedAt).toLocaleString('zh-CN') : ''} · ${record.replacementId ? `已改写为 ${record.replacementName}` : '已人工确认破坏性变更'}</span>`
          : (record.replacementId
            ? html`<sp-button size="s" variant="accent" @click=${() => { this.store.migrateExampleForDeprecation(record.propertyId, migration.exampleId); this.flash(`已将旧引用改写为 ${record.replacementName}`); }}>迁移到 ${record.replacementName}</sp-button>`
            : html`<span class="ref-context">无替代属性：请先在上方代码中移除或改写该用法，再确认破坏性变更。</span>
              <sp-button size="s" variant="accent" @click=${() => { this.store.migrateExampleForDeprecation(record.propertyId, migration.exampleId); this.flash('已确认该破坏性变更迁移'); }}>代码已人工改写，确认迁移</sp-button>`)}
      </div>
    `;
  }

  private renderHistory(component: ComponentSpec): TemplateResult {
    const snapshot = component.snapshots[0];
    const rows = diffAgainstSnapshot(component, snapshot);
    const blocker = this.store.publishBlocker(component);
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>版本与迁移</h2>
          <sp-button size="s" variant="secondary" @click=${() => this.store.createSnapshot('历史面板保存')}>保存当前版本</sp-button>
        </div>
        <p>当前为 r${component.revision}。最近快照：${snapshot ? `r${snapshot.revision} · ${new Date(snapshot.savedAt).toLocaleString('zh-CN')}` : '暂无'}。</p>
        ${blocker ? html`<div class="issue error"><strong>发布门禁未通过</strong>${blocker}</div>` : html`<div class="issue info"><strong>发布门禁已通过</strong>没有进行中的属性废弃迁移，组件可以进入已发布状态。</div>`}
        ${component.deprecations.length ? html`
          <h3>属性废弃记录</h3>
          <div class="deprecation-log">
            ${component.deprecations.map((record) => {
              const done = record.migrations.filter((migration) => migration.status === 'migrated').length;
              return html`<div class="issue ${record.status === 'active' ? (record.replacementId ? 'warning' : 'error') : 'info'}">
                <strong>${record.propertyName} ${record.status === 'active' ? '· 废弃中' : '· 迁移完成'}</strong>
                失效版本 ${record.eolVersion} · ${record.replacementId ? `替代属性 ${record.replacementName}` : '无替代（破坏性变更）'} · 进度 ${done}/${record.migrations.length}<br />
                ${record.reason ? `原因：${record.reason}` : ''}
              </div>`;
            })}
          </div>
        ` : nothing}
        ${snapshot ? html`
          <h3>与最近快照的差异</h3>
          ${rows.length ? html`<div class="diff">${rows.map((row) => html`<div class="diff-row"><b>${row.field}</b><span class="before">- ${row.before || '（空）'}</span><br /><span class="after">+ ${row.after || '（空）'}</span></div>`)}</div>` : html`<div class="issue info">当前内容与最近快照一致。</div>`}
        ` : html`<div class="empty">保存一次版本后即可比较字段、属性和示例变化。废弃登记与迁移完成时会自动保存版本快照。</div>`}
        ${this.hasStaleExamples(component) ? html`<div class="issue warning" style="margin-top: 14px"><strong>检测到待迁移示例</strong>通用迁移只清理已删除属性引用；属性废弃必须在「属性与状态 / 关联示例」中逐条完成。<br /><button @click=${() => this.store.migrateExamples()}>立即执行通用迁移</button></div>` : nothing}
      </section>
    `;
  }

  private renderPreview(component?: ComponentSpec): TemplateResult {
    if (!component) return html`<section class="panel"><h2>预览</h2><p>选择组件后显示主题与密度预览。</p></section>`;
    return html`
      <section class="panel">
        <div class="property-head"><h2>实时预览</h2><button class="tab" @click=${() => { this.previewTheme = this.previewTheme === 'light' ? 'dark' : 'light'; }}>${this.previewTheme === 'light' ? '深色' : '浅色'}</button></div>
        <div class="inline" style="margin-bottom: 10px">
          <label>密度</label>
          <select .value=${this.previewDensity} @change=${(event: Event) => { this.previewDensity = (event.currentTarget as HTMLSelectElement).value as PreviewDensity; }}>
            <option value="compact">紧凑</option>
            <option value="regular">标准</option>
            <option value="spacious">宽松</option>
          </select>
        </div>
        <div class="preview ${this.previewTheme} ${this.previewDensity}">
          ${component.category === 'Forms'
            ? html`<label style="width:100%"><span style="display:block;font-size:12px;margin-bottom:6px">${component.properties.find((item) => item.name === 'label')?.defaultValue ?? '字段标签'}</span><input style="width:100%;padding:10px;border:1px solid #888;border-radius:8px" placeholder="输入内容" /></label>`
            : html`<button class="demo-button">${component.properties.find((item) => item.name === 'label')?.defaultValue ?? component.name}</button>`}
        </div>
      </section>
    `;
  }

  private renderValidation(issues: ValidationIssue[]): TemplateResult {
    return html`
      <section class="panel">
        <div class="property-head">
          <h2>规范检查</h2>
          <sp-button size="s" variant="secondary" @click=${() => { this.showValidation = !this.showValidation; }}>${this.showValidation ? '收起' : '展开'}</sp-button>
        </div>
        ${this.showValidation ? (issues.length ? issues.map((issue) => html`
          <div class="issue ${issue.level}"><strong>${issue.target}</strong>${issue.message}</div>
        `) : html`<div class="issue info"><strong>当前组件通过检查</strong>没有发现属性、示例或无障碍说明问题。</div>`) : nothing}
      </section>
    `;
  }

  private get filteredComponents(): ComponentSpec[] {
    const query = this.query.trim().toLowerCase();
    if (!query) return this.store.state.components;
    return this.store.state.components.filter((component) => JSON.stringify(component).toLowerCase().includes(query));
  }

  private hasStaleExamples(component: ComponentSpec): boolean {
    return component.examples.some((example) => example.stale);
  }

  private statusLabel(status: ComponentSpec['status']): string {
    return { draft: '草稿', review: '待审', published: '已发布' }[status];
  }

  private async copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.flash('代码已复制');
    } catch {
      this.flash('复制失败，请手动选择代码');
    }
  }

  private flash(message: string) {
    this.toast = message;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toast = ''; }, 3000);
  }
}

customElements.define('spec-a11y-workbench', SpecA11yWorkbench);
