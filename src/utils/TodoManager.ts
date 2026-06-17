import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

const AURIX_MD_PATH = join(process.cwd(), 'aurix.md');

export function loadTodos(): TodoItem[] {
  if (!existsSync(AURIX_MD_PATH)) return [];
  
  try {
    const content = readFileSync(AURIX_MD_PATH, 'utf-8');
    const todoSection = content.match(/## Todos\n([\s\S]*?)(?=\n##|$)/);
    if (!todoSection) return [];
    
    const lines = todoSection[1].split('\n').filter(l => l.trim());
    const todos: TodoItem[] = [];
    
    for (const line of lines) {
      const match = line.match(/^(\d+)\.\s*\[([ x])\]\s*(.+)$/);
      if (match) {
        todos.push({
          id: parseInt(match[1]),
          done: match[2] === 'x',
          text: match[3].trim()
        });
      }
    }
    
    return todos;
  } catch {
    return [];
  }
}

export function saveTodos(todos: TodoItem[]): void {
  let content = '';
  
  if (existsSync(AURIX_MD_PATH)) {
    content = readFileSync(AURIX_MD_PATH, 'utf-8');
    // Remove existing Todos section
    content = content.replace(/## Todos\n[\s\S]*?(?=\n##|$)/, '');
  } else {
    content = '# AURIX Session\n\n';
  }
  
  if (todos.length === 0) {
    writeFileSync(AURIX_MD_PATH, content.trim() + '\n', 'utf-8');
    return;
  }
  
  const todoSection = '## Todos\n' + todos.map(t => 
    `${t.id}. [${t.done ? 'x' : ' '}] ${t.text}`
  ).join('\n') + '\n';
  
  writeFileSync(AURIX_MD_PATH, content.trim() + '\n\n' + todoSection, 'utf-8');
}

export function addTodo(text: string): TodoItem {
  const todos = loadTodos();
  const id = todos.length > 0 ? Math.max(...todos.map(t => t.id)) + 1 : 1;
  const newTodo = { id, text, done: false };
  todos.push(newTodo);
  saveTodos(todos);
  return newTodo;
}

export function completeTodo(id: number): boolean {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === id);
  if (!todo) return false;
  todo.done = true;
  saveTodos(todos);
  return true;
}

export function getTodoStats(): { done: number; total: number } {
  const todos = loadTodos();
  return {
    done: todos.filter(t => t.done).length,
    total: todos.length
  };
}
