import { addTodo, completeTodo, loadTodos, getTodoStats } from '../utils/TodoManager.js';
import type { Tool } from './Registry.js';

export const todoTool: Tool = {
  name: 'todo',
  description: 'Manage a task/todo list. Add, list, complete, or delete tasks. Tasks are saved to aurix.md and displayed in the UI.',
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

    switch (action) {
      case 'add': {
        const text = args.text as string;
        if (!text) return 'Error: provide task text';
        const todo = addTodo(text.trim().slice(0, 100));
        const stats = getTodoStats();
        return `Added #${todo.id}: ${todo.text}\nProgress: ${stats.done}/${stats.total} complete`;
      }

      case 'list': {
        const todos = loadTodos();
        if (todos.length === 0) return 'No tasks. Add one with action "add".';
        const stats = getTodoStats();
        const list = todos.map(t =>
          `${t.done ? '[x]' : '[ ]'} #${t.id}: ${t.text}`
        ).join('\n');
        return `Todos: ${stats.done}/${stats.total} complete\n\n${list}`;
      }

      case 'done': {
        const id = args.id as number;
        if (!id || typeof id !== 'number') return 'Error: valid id required';
        const success = completeTodo(id);
        if (!success) return `Task #${id} not found`;
        const todos = loadTodos();
        const todo = todos.find(t => t.id === id);
        const stats = getTodoStats();
        return `Completed #${id}: ${todo?.text}\nProgress: ${stats.done}/${stats.total} complete`;
      }

      case 'delete': {
        const id = args.id as number;
        const todos = loadTodos();
        const idx = todos.findIndex(t => t.id === id);
        if (idx === -1) return `Task #${id} not found`;
        todos.splice(idx, 1);
        // Re-save without the deleted item
        const { saveTodos } = await import('../utils/TodoManager.js');
        saveTodos(todos);
        return `Deleted #${id}`;
      }

      case 'clear': {
        const todos = loadTodos();
        const count = todos.length;
        const { saveTodos } = await import('../utils/TodoManager.js');
        saveTodos([]);
        return `Cleared ${count} tasks`;
      }

      default:
        return `Unknown action: ${action}. Use: add, list, done, delete, clear`;
    }
  },
};

