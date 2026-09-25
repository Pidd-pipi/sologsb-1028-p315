export type ComponentStatus = 'draft' | 'review' | 'published';
export type PreviewTheme = 'light' | 'dark';
export type PreviewDensity = 'compact' | 'regular' | 'spacious';

export interface PropertySpec {
  id: string;
  name: string;
  type: string;
  required: boolean;
  defaultValue: string;
  description: string;
}

export interface ComponentExample {
  id: string;
  title: string;
  code: string;
  propertyIds: string[];
  stale: boolean;
  staleReason: string;
  createdFromRevision: number;
}

/** 示例中一处对旧属性的引用：snippet 为命中片段，context 为所在代码行或来源说明。 */
export interface DeprecationReference {
  snippet: string;
  context: string;
}

/** 单条关联示例针对某次废弃的迁移状态。 */
export interface DeprecationMigration {
  exampleId: string;
  exampleTitle: string;
  oldReferences: DeprecationReference[];
  status: 'pending' | 'migrated';
  note: string;
  migratedAt?: string;
}

/**
 * 属性废弃记录。
 * replacementId 为空表示没有合适替代，按破坏性变更处理，需要维护者逐条人工确认。
 * 记录随本地草稿持久化；属性在迁移完成并下线后 removed=true，记录仍保留备查。
 */
export interface DeprecationRecord {
  propertyId: string;
  propertyName: string;
  replacementId: string | null;
  replacementName: string | null;
  eolVersion: string;
  reason: string;
  deprecatedAt: string;
  baseRevision: number;
  status: 'active' | 'completed';
  removed: boolean;
  migrations: DeprecationMigration[];
  completedAt?: string;
}

export interface ComponentSpec {
  id: string;
  name: string;
  category: string;
  status: ComponentStatus;
  purpose: string;
  usage: string;
  properties: PropertySpec[];
  deprecations: DeprecationRecord[];
  states: string;
  keyboardBehavior: string;
  screenReader: string;
  disabledScenarios: string;
  interactionSignature: string;
  examples: ComponentExample[];
  revision: number;
  updatedAt: string;
  snapshots: ComponentSnapshot[];
}

export interface ComponentSnapshot {
  revision: number;
  savedAt: string;
  reason: string;
  component: Omit<ComponentSpec, 'snapshots'>;
}

export interface WorkspaceState {
  components: ComponentSpec[];
  selectedId: string;
}

export interface ValidationIssue {
  id: string;
  level: 'error' | 'warning' | 'info';
  componentId: string;
  target: string;
  message: string;
  field: 'properties' | 'examples' | 'keyboard' | 'screenReader';
}

export interface DiffRow {
  field: string;
  before: string;
  after: string;
}
