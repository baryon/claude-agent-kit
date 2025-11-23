/**
 * Web Tools Types - Database-based tools for multi-tenant SaaS
 */

export interface ToolContext {
  userId: string;
  orgId?: string;
  sessionId: string;
  signal: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// ============================================
// Document Tools
// ============================================

export interface DocumentReadInput {
  path?: string;
  document_id?: string;
}

export interface DocumentWriteInput {
  path: string;
  content: string;
  type?: 'code' | 'markdown' | 'json' | 'text';
  language?: string;
  project_id?: string;
}

export interface DocumentSearchInput {
  query: string;
  type?: string;
  project_id?: string;
  limit?: number;
}

export interface DocumentListInput {
  project_id?: string;
  type?: string;
  path_prefix?: string;
  limit?: number;
}

export interface DocumentDeleteInput {
  document_id?: string;
  path?: string;
}

// ============================================
// Code Execution Tools
// ============================================

export interface CodeExecuteInput {
  language: 'javascript' | 'python' | 'typescript' | 'sql';
  code: string;
  timeout?: number;
  context?: Record<string, any>;
}

export interface CodeExecuteOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

// ============================================
// Task Management Tools
// ============================================

export interface TaskCreateInput {
  tasks: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    active_form: string;
    project_id?: string;
  }>;
}

export interface TaskUpdateInput {
  task_id: string;
  status?: 'pending' | 'in_progress' | 'completed';
  content?: string;
  active_form?: string;
}

export interface TaskListInput {
  project_id?: string;
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface TaskDeleteInput {
  task_id: string;
}

// ============================================
// Skill Tools
// ============================================

export interface SkillCreateInput {
  name: string;
  description: string;
  content: string;
  visibility?: 'private' | 'org' | 'public';
}

export interface SkillUpdateInput {
  skill_id: string;
  description?: string;
  content?: string;
  visibility?: 'private' | 'org' | 'public';
}

export interface SkillListInput {
  visibility?: 'private' | 'org' | 'public';
}

// ============================================
// Project Tools
// ============================================

export interface ProjectCreateInput {
  name: string;
  description?: string;
}

export interface ProjectListInput {
  org_wide?: boolean;
}

// ============================================
// Collaboration Tools
// ============================================

export interface ShareResourceInput {
  resource_type: 'document' | 'skill' | 'project';
  resource_id: string;
  share_with_user_id?: string;
  share_with_org?: boolean;
  permission: 'read' | 'write';
}

export interface CollaboratorListInput {
  resource_type: 'document' | 'skill' | 'project';
  resource_id: string;
}

// ============================================
// Search and Discovery Tools
// ============================================

export interface GlobalSearchInput {
  query: string;
  types?: Array<'document' | 'skill' | 'task'>;
  limit?: number;
}

export interface RecentActivityInput {
  limit?: number;
  resource_type?: string;
}

// ============================================
// Tool Registry
// ============================================

export interface WebTool {
  name: string;
  description: string;
  inputSchema: any;  // Zod schema
  handler: (input: any, context: ToolContext) => Promise<ToolResult>;
  permissions?: string[];  // Required permissions
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
}

export interface ToolExecutionLog {
  id: string;
  user_id: string;
  session_id: string;
  tool_name: string;
  input: any;
  output?: any;
  error?: string;
  duration_ms: number;
  created_at: Date;
}
