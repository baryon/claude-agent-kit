/**
 * Web Environment Tools - Database replacements for filesystem tools
 *
 * This module provides database-backed tools to replace CLI's filesystem tools:
 * - DocumentRead → replaces Read
 * - DocumentWrite → replaces Write/Edit
 * - DocumentSearch → replaces Grep
 * - DocumentList → replaces Glob
 */

import type { ToolDefinition, ToolHandler, SchemaLike } from "./types";

// ============================================
// Mock Database Interface
// ============================================

export interface WebDocument {
  id: string;
  path: string;
  content: string;
  type: string;
  language?: string;
  metadata?: Record<string, any>;
}

/**
 * Mock database for documents
 * In production, replace with real database queries
 */
class MockDocumentDatabase {
  private documents = new Map<string, WebDocument>();

  async read(path: string): Promise<WebDocument | null> {
    return this.documents.get(path) || null;
  }

  async write(path: string, content: string, type: string = 'text'): Promise<WebDocument> {
    const doc: WebDocument = {
      id: Math.random().toString(36).slice(2),
      path,
      content,
      type,
    };
    this.documents.set(path, doc);
    return doc;
  }

  async search(query: string): Promise<WebDocument[]> {
    const results: WebDocument[] = [];
    for (const doc of this.documents.values()) {
      if (doc.content.toLowerCase().includes(query.toLowerCase())) {
        results.push(doc);
      }
    }
    return results;
  }

  async list(pathPrefix?: string): Promise<WebDocument[]> {
    const results: WebDocument[] = [];
    for (const doc of this.documents.values()) {
      if (!pathPrefix || doc.path.startsWith(pathPrefix)) {
        results.push(doc);
      }
    }
    return results;
  }

  async delete(path: string): Promise<boolean> {
    return this.documents.delete(path);
  }
}

// Singleton instance
const mockDB = new MockDocumentDatabase();

// ============================================
// DocumentRead Tool (replaces Read)
// ============================================

const documentReadSchema: SchemaLike = {
  parse: (value: any) => {
    if (!value.path && !value.document_id) {
      throw new Error("Either 'path' or 'document_id' is required");
    }
    return value;
  }
};

const documentReadHandler: ToolHandler = async (input: any, ctx) => {
  const doc = await mockDB.read(input.path);

  if (!doc) {
    return {
      content: [
        {
          type: "text",
          text: `Document not found: ${input.path}`
        }
      ],
      isError: true
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `# ${doc.path}\nType: ${doc.type}\n\n${doc.content}`
      }
    ]
  };
};

export const DocumentReadTool: ToolDefinition = {
  name: "document_read",
  description: "Read a document from the database (replaces 'Read' tool in web environment)",
  inputSchema: documentReadSchema,
  handler: documentReadHandler,
  enabled: true,
  annotations: {
    replaces: "Read",
    category: "document"
  }
};

// ============================================
// DocumentWrite Tool (replaces Write/Edit)
// ============================================

const documentWriteSchema: SchemaLike = {
  parse: (value: any) => {
    if (!value.path) {
      throw new Error("'path' is required");
    }
    if (!value.content) {
      throw new Error("'content' is required");
    }
    return value;
  }
};

const documentWriteHandler: ToolHandler = async (input: any, ctx) => {
  const doc = await mockDB.write(input.path, input.content, input.type || 'text');

  return {
    content: [
      {
        type: "text",
        text: `Document saved successfully:\n- Path: ${doc.path}\n- Type: ${doc.type}\n- Size: ${doc.content.length} chars`
      }
    ]
  };
};

export const DocumentWriteTool: ToolDefinition = {
  name: "document_write",
  description: "Create or update a document in the database (replaces 'Write' and 'Edit' tools)",
  inputSchema: documentWriteSchema,
  handler: documentWriteHandler,
  enabled: true,
  annotations: {
    replaces: ["Write", "Edit"],
    category: "document"
  }
};

// ============================================
// DocumentSearch Tool (replaces Grep)
// ============================================

const documentSearchSchema: SchemaLike = {
  parse: (value: any) => {
    if (!value.query) {
      throw new Error("'query' is required");
    }
    return value;
  }
};

const documentSearchHandler: ToolHandler = async (input: any, ctx) => {
  const docs = await mockDB.search(input.query);

  if (docs.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No documents found matching: "${input.query}"`
        }
      ]
    };
  }

  const results = docs.map((doc, i) => {
    // Find the matching line
    const lines = doc.content.split('\n');
    const matchingLine = lines.find(line =>
      line.toLowerCase().includes(input.query.toLowerCase())
    );

    return `${i + 1}. **${doc.path}** (${doc.type})
   ${matchingLine || '(match in content)'}`;
  }).join('\n\n');

  return {
    content: [
      {
        type: "text",
        text: `Found ${docs.length} documents:\n\n${results}`
      }
    ]
  };
};

export const DocumentSearchTool: ToolDefinition = {
  name: "document_search",
  description: "Search documents by content (replaces 'Grep' tool in web environment)",
  inputSchema: documentSearchSchema,
  handler: documentSearchHandler,
  enabled: true,
  annotations: {
    replaces: "Grep",
    category: "search"
  }
};

// ============================================
// DocumentList Tool (replaces Glob)
// ============================================

const documentListSchema: SchemaLike = {
  parse: (value: any) => value
};

const documentListHandler: ToolHandler = async (input: any, ctx) => {
  const docs = await mockDB.list(input.path_prefix);

  if (docs.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "No documents found."
        }
      ]
    };
  }

  const list = docs.map(doc => `- ${doc.path} (${doc.type})`).join('\n');

  return {
    content: [
      {
        type: "text",
        text: `Found ${docs.length} documents:\n\n${list}`
      }
    ]
  };
};

export const DocumentListTool: ToolDefinition = {
  name: "document_list",
  description: "List all documents (replaces 'Glob' tool in web environment)",
  inputSchema: documentListSchema,
  handler: documentListHandler,
  enabled: true,
  annotations: {
    replaces: "Glob",
    category: "document"
  }
};

// ============================================
// CodeExecute Tool (replaces Bash)
// ============================================

const codeExecuteSchema: SchemaLike = {
  parse: (value: any) => {
    if (!value.code) {
      throw new Error("'code' is required");
    }
    return value;
  }
};

const codeExecuteHandler: ToolHandler = async (input: any, ctx) => {
  // Simple mock execution - in production, use a real sandbox
  const language = input.language || 'javascript';

  // Mock execution result
  const mockResult = {
    javascript: `// Executed JavaScript code\n// Output: [mock result]`,
    python: `# Executed Python code\n# Output: [mock result]`,
    typescript: `// Executed TypeScript code\n// Output: [mock result]`
  };

  return {
    content: [
      {
        type: "text",
        text: `Code executed successfully (${language}):\n\n${mockResult[language as keyof typeof mockResult] || 'Executed'}`
      }
    ]
  };
};

export const CodeExecuteTool: ToolDefinition = {
  name: "code_execute",
  description: "Execute code in a sandboxed environment (replaces 'Bash' tool)",
  inputSchema: codeExecuteSchema,
  handler: codeExecuteHandler,
  enabled: true,
  annotations: {
    replaces: "Bash",
    category: "execution"
  }
};

// ============================================
// Export all web tools
// ============================================

export const WEB_TOOLS: ToolDefinition[] = [
  DocumentReadTool,
  DocumentWriteTool,
  DocumentSearchTool,
  DocumentListTool,
  CodeExecuteTool,
];

/**
 * Get the system prompt explaining web tools
 */
export function getWebToolsSystemPrompt(): string {
  return `
# Web Environment Tools

You are operating in a **web environment** where files are stored in a database, not a filesystem.

## Available Tools

### Document Management
- **document_read**: Read a document from the database
  - Use this instead of "Read"
  - Input: { path: "/path/to/file" }

- **document_write**: Create or update a document
  - Use this instead of "Write" or "Edit"
  - Input: { path: "/path/to/file", content: "..." }

- **document_list**: List all documents
  - Use this instead of "Glob"
  - Input: { path_prefix: "/path/" } (optional)

- **document_search**: Search document content
  - Use this instead of "Grep"
  - Input: { query: "search term" }

### Code Execution
- **code_execute**: Execute code in a sandbox
  - Use this instead of "Bash"
  - Input: { language: "javascript", code: "..." }

## Important Notes
- All documents are stored in a **database**, not files
- Paths are virtual (e.g., /project/src/index.ts)
- Use **document_*** tools for file operations
- Use **code_execute** for running code

## Examples

Read a file:
\`\`\`
document_read({ path: "/project/README.md" })
\`\`\`

Search for code:
\`\`\`
document_search({ query: "function login" })
\`\`\`

Create a file:
\`\`\`
document_write({
  path: "/project/src/auth.ts",
  content: "export function login() { ... }"
})
\`\`\`
`;
}

/**
 * Get mock database instance (for testing/demo)
 */
export function getMockDatabase(): MockDocumentDatabase {
  return mockDB;
}
