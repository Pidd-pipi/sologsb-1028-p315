import { createInitialState } from './data';
import type {
  ComponentSnapshot,
  ComponentSpec,
  DeprecationMigration,
  DeprecationRecord,
  DeprecationReference,
  ValidationIssue,
  WorkspaceState
} from './types';

const STORAGE_KEY = 'sologsb-1028-workspace-v1';

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const signature = (component: ComponentSpec) => `${component.properties.map((item) => `${item.name}:${item.required}`).join('|')}::${component.interactionSignature}`;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 属性名到模板中常见的 kebab-case 形式：helpText -> help-text。 */
const toKebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** 扫描示例代码中对旧属性名（camelCase 与 kebab-case 两种形式）的引用。 */
function collectReferences(code: string, propertyName: string, declared: boolean): DeprecationReference[] {
  const references: DeprecationReference[] = [];
  const seen = new Set<string>();
  const push = (snippet: string, context: string) => {
    const key = `${snippet}@@${context}`;
    if (!seen.has(key)) {
      seen.add(key);
      references.push({ snippet, context });
    }
  };
  const names = [...new Set([propertyName.trim(), toKebab(propertyName.trim())].filter(Boolean))];
  if (names.length) {
    const matcher = new RegExp(`(?:[^\\w-]|^)(?:[\\w:.-]*?)(${names.map(escapeRegExp).join('|')})(?:[\\w-]*)`, 'g');
    for (const line of code.split('\n')) {
      for (const match of line.matchAll(matcher)) {
        push(match[0].trim(), line.trim());
      }
    }
  }
  if (declared && !references.length) push(propertyName, '依赖属性清单（代码中未出现文本引用）');
  return references;
}

/** 把代码中的旧属性引用改写为替代属性（同时处理 camelCase 与 kebab-case）。 */
function renameInCode(code: string, oldName: string, newName: string): string {
  return code
    .replace(new RegExp(`\\b${escapeRegExp(toKebab(oldName))}\\b`, 'g'), toKebab(newName))
    .replace(new RegExp(`\\b${escapeRegExp(oldName)}\\b`, 'g'), newName);
}

export class SpecStore extends EventTarget {
  state: WorkspaceState;
  private undoStack: WorkspaceState[] = [];
  private redoStack: WorkspaceState[] = [];
  private lastAction = '';

  constructor() {
    super();
    this.state = this.normalize(this.load());
  }

  get selected(): ComponentSpec | undefined {
    return this.state.components.find((item) => item.id === this.state.selectedId);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get lastUndoLabel() { return this.lastAction; }

  select(id: string) {
    if (!this.state.components.some((item) => item.id === id)) return;
    this.state = { ...this.state, selectedId: id };
    this.persist(false);
    this.emit();
  }

  addComponent() {
    const id = uid('component');
    const component: ComponentSpec = {
      id,
      name: 'Untitled component',
      category: 'Uncategorised',
      status: 'draft',
      purpose: '说明该组件解决的用户问题。',
      usage: '说明何时使用、何时不要使用。',
      properties: [],
      deprecations: [],
      states: 'default、hover、focus-visible、disabled。',
      keyboardBehavior: '记录 Tab、Enter、Space、方向键和 Esc 等行为。',
      screenReader: '记录角色、名称、状态和动态播报。',
      disabledScenarios: '记录不应使用该组件的场景。',
      interactionSignature: '',
      examples: [],
      revision: 1,
      updatedAt: new Date().toISOString(),
      snapshots: []
    };
    this.commit('新建组件', (state) => {
      state.components.unshift(component);
      state.selectedId = id;
    });
  }

  updateComponent(patch: Partial<ComponentSpec>, markExamplesStale = false) {
    const selected = this.selected;
    if (!selected) return;
    // status 变更必须走 setStatus，避免绕过废弃迁移的发布门禁。
    if ('status' in patch && patch.status !== selected.status) return;
    this.commit('编辑组件', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      Object.assign(target, patch, { updatedAt: new Date().toISOString() });
      if (markExamplesStale) {
        target.examples.forEach((example) => {
          example.stale = true;
          example.staleReason = '组件交互或属性契约已修改，示例需要重新验证。';
        });
      }
    });
  }

  /** 尝试切换状态；存在未完成的属性废弃迁移时，组件不能进入已发布状态。 */
  setStatus(status: ComponentSpec['status']): { ok: boolean; reason: string } {
    const selected = this.selected;
    if (!selected) return { ok: false, reason: '未选择组件。' };
    if (status === 'published') {
      const blocker = this.publishBlocker(selected);
      if (blocker) return { ok: false, reason: blocker };
    }
    this.commit('更新组件状态', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (target) {
        target.status = status;
        target.updatedAt = new Date().toISOString();
      }
    });
    return { ok: true, reason: '' };
  }

  /** 返回阻止发布的原因；为空表示可以发布。 */
  publishBlocker(component: ComponentSpec): string {
    const active = component.deprecations.find((item) => item.status === 'active');
    if (!active) return '';
    const remaining = active.migrations.filter((migration) => migration.status === 'pending').length;
    const total = active.migrations.length;
    const scope = total
      ? `关联示例迁移 ${total - remaining}/${total}，${remaining} 条仍引用旧属性 ${active.propertyName}。`
      : `属性 ${active.propertyName} 已登记废弃，等待处理。`;
    return active.replacementId
      ? `属性 ${active.propertyName} 正在废弃（替代属性 ${active.replacementName ?? '?'}），${scope}迁移结束前不能发布。`
      : `属性 ${active.propertyName} 标记为破坏性下线（无替代属性），${scope}逐条确认迁移结束前不能发布。`;
  }

  addProperty() {
    const selected = this.selected;
    if (!selected) return;
    this.commit('新增属性', (state) => {
      state.components.find((item) => item.id === selected.id)?.properties.push({
        id: uid('property'),
        name: 'newProperty',
        type: 'string',
        required: false,
        defaultValue: '',
        description: '描述该属性对开发者和用户的影响。'
      });
    });
  }

  updateProperty(propertyId: string, patch: Partial<ComponentSpec['properties'][number]>) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (target && property) Object.assign(property, patch);
    });
  }

  removeProperty(propertyId: string) {
    const selected = this.selected;
    if (!selected) return;
    const active = selected.deprecations.find((item) => item.propertyId === propertyId && item.status === 'active');
    if (active) return;
    this.commit('删除属性', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      target.properties = target.properties.filter((item) => item.id !== propertyId);
      // 若该属性曾被选为其他废弃记录的替代属性，废弃退化为破坏性变更。
      target.deprecations.forEach((record) => {
        if (record.replacementId === propertyId) {
          record.replacementId = null;
          record.replacementName = null;
        }
      });
      target.examples.forEach((example) => {
        if (example.propertyIds.includes(propertyId) || example.code.includes(property.name)) {
          example.stale = true;
          example.staleReason = `属性 ${property.name} 已删除，示例代码或说明仍可能引用它。`;
        }
      });
    });
  }

  /**
   * 登记属性废弃：选择替代属性（或标记为破坏性变更）与失效版本。
   * 自动保存废弃前版本快照，并逐条枚举关联示例对旧属性的引用。
   */
  deprecateProperty(propertyId: string, replacementId: string | null, eolVersion: string, reason: string) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('登记属性废弃', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const property = target?.properties.find((item) => item.id === propertyId);
      if (!target || !property) return;
      if (target.deprecations.some((item) => item.propertyId === propertyId && item.status === 'active')) return;
      const replacement = replacementId ? target.properties.find((item) => item.id === replacementId && item.id !== propertyId) ?? null : null;

      const migrations: DeprecationMigration[] = target.examples.map((example) => {
        const declared = example.propertyIds.includes(propertyId);
        const oldReferences = collectReferences(example.code, property.name, declared);
        return {
          exampleId: example.id,
          exampleTitle: example.title,
          oldReferences,
          status: 'pending' as const,
          note: replacement
            ? `迁移到替代属性 ${replacement.name}`
            : '无替代属性，需人工改写或移除该用法（破坏性变更）'
        };
      }).filter((migration) => migration.oldReferences.length > 0);

      const record: DeprecationRecord = {
        propertyId,
        propertyName: property.name,
        replacementId: replacement ? replacement.id : null,
        replacementName: replacement ? replacement.name : null,
        eolVersion: eolVersion.trim() || `r${target.revision + 2}`,
        reason: reason.trim(),
        deprecatedAt: new Date().toISOString(),
        baseRevision: target.revision,
        status: migrations.length ? 'active' : 'completed',
        removed: false,
        migrations
      };
      if (!migrations.length) record.completedAt = record.deprecatedAt;
      target.deprecations.unshift(record);

      target.examples.forEach((example) => {
        if (migrations.some((migration) => migration.exampleId === example.id)) {
          example.stale = true;
          example.staleReason = replacement
            ? `属性 ${property.name} 计划在 ${record.eolVersion} 失效，请改用 ${replacement.name}。`
            : `属性 ${property.name} 计划在 ${record.eolVersion} 下线，且无替代属性，属于破坏性变更。`;
        }
      });

      target.snapshots = [this.buildSnapshot(target, `属性 ${property.name} 废弃前快照`), ...target.snapshots].slice(0, 12);
      target.updatedAt = new Date().toISOString();
    });
  }

  /** 取消尚未完成的废弃登记，并恢复对应示例的失效标记。 */
  cancelDeprecation(propertyId: string) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('取消属性废弃', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      const index = target.deprecations.findIndex((item) => item.propertyId === propertyId && item.status === 'active');
      if (index < 0) return;
      const [record] = target.deprecations.splice(index, 1);
      target.examples.forEach((example) => {
        if (record.migrations.some((migration) => migration.exampleId === example.id)) {
          example.stale = false;
          example.staleReason = '';
        }
      });
      target.updatedAt = new Date().toISOString();
    });
  }

  /**
   * 逐条迁移示例：有替代属性时自动改写依赖与代码文本；
   * 无替代时由维护者人工改写代码后确认破坏性变更。
   */
  migrateExampleForDeprecation(propertyId: string, exampleId: string, note = '') {
    const selected = this.selected;
    if (!selected) return;
    this.commit('迁移单条废弃示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      const record = target.deprecations.find((item) => item.propertyId === propertyId && item.status === 'active');
      const migration = record?.migrations.find((item) => item.exampleId === exampleId);
      const example = target.examples.find((item) => item.id === exampleId);
      if (!record || !migration || !example || migration.status !== 'pending') return;

      if (record.replacementId) {
        const replacement = target.properties.find((item) => item.id === record.replacementId);
        if (replacement) {
          if (!example.propertyIds.includes(replacement.id)) {
            example.propertyIds = [...example.propertyIds.filter((id) => id !== record.propertyId), replacement.id];
          } else {
            example.propertyIds = example.propertyIds.filter((id) => id !== record.propertyId);
          }
          example.code = renameInCode(example.code, record.propertyName, replacement.name);
        }
      } else {
        example.propertyIds = example.propertyIds.filter((id) => id !== record.propertyId);
      }

      migration.status = 'migrated';
      migration.note = note.trim() || migration.note;
      migration.migratedAt = new Date().toISOString();

      // 该示例在所有活跃废弃记录下都没有待处理迁移时，才清除失效标记。
      const stillPending = target.deprecations.some(
        (dep) => dep.status === 'active' && dep.migrations.some((m) => m.exampleId === example.id && m.status === 'pending')
      );
      if (!stillPending) {
        example.stale = false;
        example.staleReason = '';
      }
      example.createdFromRevision = target.revision;

      this.completeRecordIfDone(target, record);
      target.updatedAt = new Date().toISOString();
    });
  }

  /** 一键迁移当前废弃记录下所有有替代属性的示例；无替代的破坏性变更仍需逐条确认。 */
  migrateAllReplaceable(propertyId: string) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('批量迁移废弃示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      const record = target.deprecations.find((item) => item.propertyId === propertyId && item.status === 'active');
      if (!record || !record.replacementId) return;
      const replacement = target.properties.find((item) => item.id === record.replacementId);
      if (!replacement) return;
      record.migrations.filter((migration) => migration.status === 'pending').forEach((migration) => {
        const example = target.examples.find((item) => item.id === migration.exampleId);
        if (!example) return;
        example.propertyIds = [...example.propertyIds.filter((id) => id !== record.propertyId), replacement.id]
          .filter((id, index, all) => all.indexOf(id) === index);
        example.code = renameInCode(example.code, record.propertyName, replacement.name);
        migration.status = 'migrated';
        migration.migratedAt = new Date().toISOString();
        example.createdFromRevision = target.revision;
      });
      target.examples.forEach((example) => {
        if (!target.deprecations.some((dep) => dep.status === 'active' && dep.migrations.some((m) => m.exampleId === example.id && m.status === 'pending'))) {
          example.stale = false;
          example.staleReason = '';
        }
      });
      this.completeRecordIfDone(target, record);
      target.updatedAt = new Date().toISOString();
    });
  }

  addExample() {
    const selected = this.selected;
    if (!selected) return;
    const exampleId = uid('example');
    this.commit('新增示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      target.examples.push({
        id: exampleId,
        title: '新示例',
        code: `<${target.name.toLowerCase().replaceAll(' ', '-')}>示例</${target.name.toLowerCase().replaceAll(' ', '-')}>`,
        propertyIds: [],
        stale: false,
        staleReason: '',
        createdFromRevision: target.revision
      });
    });
  }

  updateExample(exampleId: string, patch: Partial<ComponentSpec['examples'][number]>) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('编辑示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      const example = target?.examples.find((item) => item.id === exampleId);
      if (example) Object.assign(example, patch);
    });
  }

  removeExample(exampleId: string) {
    const selected = this.selected;
    if (!selected) return;
    this.commit('删除示例', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      target.examples = target.examples.filter((item) => item.id !== exampleId);
      target.deprecations.forEach((record) => {
        record.migrations = record.migrations.filter((migration) => migration.exampleId !== exampleId);
      });
      target.deprecations.filter((record) => record.status === 'active').forEach((record) => this.completeRecordIfDone(target, record));
    });
  }

  createSnapshot(reason = '手动版本') {
    const selected = this.selected;
    if (!selected) return;
    this.commit('创建版本快照', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      target.snapshots.unshift(this.buildSnapshot(target, reason));
      target.snapshots = target.snapshots.slice(0, 12);
      target.revision += 1;
      target.updatedAt = new Date().toISOString();
    });
  }

  migrateExamples() {
    const selected = this.selected;
    if (!selected) return;
    this.commit('迁移示例到当前版本', (state) => {
      const target = state.components.find((item) => item.id === selected.id);
      if (!target) return;
      const activePropertyIds = new Set(target.properties.map((item) => item.id));
      target.examples.forEach((example) => {
        example.propertyIds = example.propertyIds.filter((id) => activePropertyIds.has(id));
        example.createdFromRevision = target.revision;
      });
      // 通用迁移不能绕过废弃流程：仍有未完成废弃迁移的示例继续保持失效。
      target.examples.forEach((example) => {
        const stillPending = target.deprecations.some(
          (record) => record.status === 'active' && record.migrations.some((migration) => migration.exampleId === example.id && migration.status === 'pending')
        );
        if (!stillPending) {
          example.stale = false;
          example.staleReason = '';
        }
      });
      target.interactionSignature = signature(target).split('::')[1] ?? target.interactionSignature;
      target.revision += 1;
      target.updatedAt = new Date().toISOString();
    });
  }

  validate(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const component of this.state.components) {
      const names = new Map<string, number>();
      component.properties.forEach((property) => names.set(property.name.trim(), (names.get(property.name.trim()) ?? 0) + 1));
      for (const [name, count] of names) {
        if (name && count > 1) {
          issues.push({ id: `${component.id}-duplicate-${name}`, level: 'error', componentId: component.id, target: component.name, message: `属性名称 ${name} 重复。`, field: 'properties' });
        }
      }
      const contractChanged = component.examples.some((example) => example.createdFromRevision < component.revision);
      component.examples.forEach((example) => {
        const missingReferences = example.propertyIds.filter((id) => !component.properties.some((property) => property.id === id));
        if (example.stale || missingReferences.length) {
          issues.push({ id: `${component.id}-${example.id}-stale`, level: 'warning', componentId: component.id, target: example.title, message: example.staleReason || '示例引用了已删除属性。', field: 'examples' });
        }
        if (!example.code.trim()) {
          issues.push({ id: `${component.id}-${example.id}-empty`, level: 'error', componentId: component.id, target: example.title, message: '示例代码不能为空。', field: 'examples' });
        }
      });
      if (!component.keyboardBehavior.trim()) {
        issues.push({ id: `${component.id}-keyboard`, level: 'error', componentId: component.id, target: component.name, message: '缺少键盘行为说明。', field: 'keyboard' });
      }
      if (!component.screenReader.trim()) {
        issues.push({ id: `${component.id}-screenreader`, level: 'error', componentId: component.id, target: component.name, message: '缺少读屏说明。', field: 'screenReader' });
      }
      if (contractChanged && component.examples.length) {
        issues.push({ id: `${component.id}-contract`, level: 'info', componentId: component.id, target: component.name, message: '属性契约或交互签名发生变化，建议创建快照并迁移示例。', field: 'properties' });
      }
      const blocker = this.publishBlocker(component);
      if (blocker) {
        issues.push({ id: `${component.id}-deprecation-blocker`, level: 'error', componentId: component.id, target: component.name, message: blocker, field: 'properties' });
      }
      component.deprecations.filter((record) => record.status === 'active' && !record.replacementId).forEach((record) => {
        issues.push({
          id: `${component.id}-${record.propertyId}-breaking`,
          level: 'warning',
          componentId: component.id,
          target: record.propertyName,
          message: `属性 ${record.propertyName} 无替代属性，按破坏性变更处理，需在失效版本 ${record.eolVersion} 前逐条人工迁移。`,
          field: 'properties'
        });
      });
    }
    return issues;
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.state));
    this.state = this.normalize(previous);
    this.persist(false);
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.state));
    this.state = this.normalize(next);
    this.persist(false);
    this.emit();
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.state = createInitialState();
    this.persist(false);
    this.emit();
  }

  /** 记录下所有示例迁移完成时收尾：标记完成、升版本并保存完成快照。 */
  private completeRecordIfDone(target: ComponentSpec, record: DeprecationRecord) {
    if (record.status !== 'active' || record.migrations.some((migration) => migration.status === 'pending')) return;
    record.status = 'completed';
    record.completedAt = new Date().toISOString();
    target.revision += 1;
    target.snapshots = [this.buildSnapshot(target, `属性 ${record.propertyName} 废弃迁移完成`), ...target.snapshots].slice(0, 12);
  }

  private buildSnapshot(target: ComponentSpec, reason: string): ComponentSnapshot {
    const { snapshots: _ignored, ...component } = clone(target);
    return {
      revision: target.revision,
      savedAt: new Date().toISOString(),
      reason,
      component: { ...component, revision: target.revision }
    };
  }

  /** 兼容旧版本本地草稿：补齐 deprecations 字段。 */
  private normalize(state: WorkspaceState): WorkspaceState {
    state.components.forEach((component) => {
      if (!Array.isArray(component.deprecations)) component.deprecations = [];
    });
    return state;
  }

  private commit(label: string, mutator: (state: WorkspaceState) => void) {
    const before = clone(this.state);
    const next = clone(this.state);
    mutator(next);
    this.undoStack.push(before);
    this.undoStack = this.undoStack.slice(-40);
    this.redoStack = [];
    this.lastAction = label;
    this.state = next;
    this.persist();
    this.emit();
  }

  private load(): WorkspaceState {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved) as WorkspaceState;
    } catch {
      // A corrupted local draft falls back to the bundled demo data.
    }
    return createInitialState();
  }

  private persist(_notify = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  private emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }
}
