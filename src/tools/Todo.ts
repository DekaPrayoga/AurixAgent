import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';

const TODO_FILE = path.join(os.homedir(), '.aurix', 'todos.json');

interface TodoItem {
  id: number;
  text: string;
  done: boolean;
  createdAt: string;
}

function loadTodos(): TodoItem[] {
  try {
    if (fs.existsSync(TODO_FILE)) {
      return JSON.parse(fs.readFileSync(TODO_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveTodos(todos: TodoItem[]): void {
  const dir = path.dirname(TODO_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
}

export const todoTool: Tool = {
  name: 'todo',
  description: 'Manage a task/todo list. Add, list, complete, or delete tasks. Tasks are persisted across sessions.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: add, list, done, delete, clear',
      },
      text: {
        type: 'string',
        description: 'Task text (for add)',
      },
      id: {
        type: 'number',
        description: 'Task ID (for done/delete)',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;
    const todos = loadTodos();

    switch (action) {
      case 'add': {
        const text = args.text as string;
        if (!text) return 'Error: provide task text';
        const id = todos.length > 0 ? Math.max(...todos.map(t => t.id)) + 1 : 1;
        todos.push({ id, text, done: false, createdAt: new Date().toISOString() });
        saveTodos(todos);
        return `Added #${id}: ${text}`;
      }

      case 'list': {
        if (todos.length === 0) return 'No tasks. Add one with action "add".';
        return todos.map(t =>
          `${t.done ? '[x]' : '[ ]'} #${t.id}: ${t.text}`
        ).join('\n');
      }

      case 'done': {
        const id = args.id as number;
        const task = todos.find(t => t.id === id);
        if (!task) return `Task #${id} not found`;
        task.done = true;
        saveTodos(todos);
        return `Completed #${id}: ${task.text}`;
      }

      case 'delete': {
        const id = args.id as number;
        const idx = todos.findIndex(t => t.id === id);
        if (idx === -1) return `Task #${id} not found`;
        const removed = todos.splice(idx, 1)[0];
        saveTodos(todos);
        return `Deleted #${id}: ${removed.text}`;
      }

      case 'clear': {
        const count = todos.length;
        saveTodos([]);
        return `Cleared ${count} tasks`;
      }

      default:
        return `Unknown action: ${action}. Use: add, list, done, delete, clear`;
    }
  },
};
