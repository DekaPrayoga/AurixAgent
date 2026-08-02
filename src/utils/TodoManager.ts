import type { SessionTodo as TodoItem } from '../agent/SessionState.js';
import { loadSessionTodos, saveSessionTodos } from '../agent/SessionState.js';

export type { TodoItem };

let activeSessionId = 'default';

export function setActiveTodoSession(sessionId: string): void {
  activeSessionId = sessionId || 'default';
}

export function getActiveTodoSession(): string {
  return activeSessionId;
}

export function loadTodos(sessionId = activeSessionId): TodoItem[] {
  return loadSessionTodos(sessionId);
}

export function saveTodos(todos: TodoItem[], sessionId = activeSessionId): void {
  saveSessionTodos(sessionId, todos);
}

export function addTodo(text: string, sessionId = activeSessionId): TodoItem {
  const todos = loadTodos(sessionId);
  const id = todos.length > 0 ? Math.max(...todos.map((todo) => todo.id)) + 1 : 1;
  const todo = { id, text, done: false };
  todos.push(todo);
  saveTodos(todos, sessionId);
  return todo;
}

export function completeTodo(id: number, sessionId = activeSessionId): boolean {
  const todos = loadTodos(sessionId);
  const todo = todos.find((item) => item.id === id);
  if (!todo) return false;
  todo.done = true;
  saveTodos(todos, sessionId);
  return true;
}

export function getTodoStats(sessionId = activeSessionId): { done: number; total: number } {
  const todos = loadTodos(sessionId);
  return { done: todos.filter((todo) => todo.done).length, total: todos.length };
}
