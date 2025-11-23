/**
 * Database types for Web Multi-Tenant SaaS
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  org_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Organization {
  id: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  created_at: Date;
}

export interface Document {
  id: string;
  user_id: string;
  org_id?: string;
  project_id?: string;
  name: string;
  type: 'code' | 'markdown' | 'json' | 'text';
  content: string;
  language?: string;
  path: string;  // 虚拟路径: /project/src/index.ts
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Skill {
  id: string;
  user_id: string;
  org_id?: string;
  name: string;
  description: string;
  content: string;  // SKILL.md 内容
  visibility: 'private' | 'org' | 'public';
  created_at: Date;
  updated_at: Date;
}

export interface Task {
  id: string;
  user_id: string;
  project_id?: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  active_form: string;
  created_at: Date;
  updated_at: Date;
}

export interface Project {
  id: string;
  user_id: string;
  org_id?: string;
  name: string;
  description?: string;
  created_at: Date;
}

export interface DocumentShare {
  id: string;
  document_id: string;
  shared_with_user_id: string;
  permission: 'read' | 'write';
  created_at: Date;
}

export interface SkillShare {
  id: string;
  skill_id: string;
  shared_with_user_id: string;
  permission: 'read' | 'write';
  created_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  org_id?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  last_activity: Date;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata?: Record<string, any>;
  created_at: Date;
}
