/**
 * CLI Tools Registration Simulation
 *
 * In the real SDK, CLI tools are registered in cli.js and their names
 * are sent to SDK via the init message. SDK doesn't have their implementation,
 * only receives the tool list and forwards tool calls to CLI.
 */

import type { CliToolDefinition } from "./types";

/**
 * Simulates CLI registering all built-in tools
 * In real SDK, this comes from CLI's init message (stdout)
 *
 * These tools are implemented in cli.js:
 * - Skill tool: cli.js:2757-2850
 * - SlashCommand tool: cli.js:~2850+
 * - Read, Write, Edit, etc.: various locations in cli.js
 */
export function getBuiltinCliTools(): CliToolDefinition[] {
  return [
    { name: "Task", description: "Launch specialized agents for complex tasks" },
    { name: "Bash", description: "Execute bash commands" },
    { name: "Glob", description: "Find files by patterns" },
    { name: "Grep", description: "Search code with regex" },
    { name: "ExitPlanMode", description: "Exit plan mode" },
    { name: "Read", description: "Read files" },
    { name: "Edit", description: "Edit files" },
    { name: "Write", description: "Write files" },
    { name: "NotebookEdit", description: "Edit Jupyter notebooks" },
    { name: "WebFetch", description: "Fetch web content" },
    { name: "TodoWrite", description: "Manage todo lists" },
    { name: "WebSearch", description: "Search the web" },
    { name: "BashOutput", description: "Get background bash output" },
    { name: "KillShell", description: "Kill background shell" },
    { name: "Skill", description: "Execute skills" },
    { name: "SlashCommand", description: "Execute slash commands" },
    { name: "AskUserQuestion", description: "Ask user questions" }
  ];
}

/**
 * Simulates available skills loaded from ~/.claude/skills/
 * In real SDK, this comes from CLI's init message
 *
 * CLI loads skills at startup from:
 * - User skills: ~/.claude/skills/
 * - Plugin skills: ~/.claude/plugins/{plugin}/skills/
 */
export function getAvailableSkills(): Array<{ name: string; description: string }> {
  return [
    { name: "algorithmic-art", description: "Creating algorithmic art using p5.js" },
    { name: "canvas-design", description: "Create beautiful visual art" },
    { name: "xlsx", description: "Spreadsheet creation and editing" },
    { name: "pdf", description: "PDF manipulation" },
    { name: "docx", description: "Document creation and editing" },
    { name: "pptx", description: "Presentation creation and editing" }
  ];
}

/**
 * Simulates available slash commands loaded from .claude/commands/
 * In real SDK, this comes from CLI's init message
 */
export function getAvailableSlashCommands(): Array<{ name: string; description: string }> {
  return [
    { name: "brainstorm", description: "Interactive requirements discovery" },
    { name: "test", description: "Execute tests with coverage analysis" },
    { name: "cleanup", description: "Clean up code and remove dead code" },
    { name: "design", description: "Design system architecture" },
    { name: "implement", description: "Feature and code implementation" },
    { name: "analyze", description: "Comprehensive code analysis" }
  ];
}
