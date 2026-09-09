import type { Task } from '../types';

export function taskGroup(task: Task, departure: string): 'before' | 'during' {
  if (task.scope === 'before' || task.scope === 'during') return task.scope;
  return task.dueDate && task.dueDate.slice(0, 10) >= departure ? 'during' : 'before';
}
export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function taskStatus(task: Task, now: Date): 'done' | 'overdue' | 'today' | 'reminder' | 'open' {
  if (task.completed) return 'done';
  const due = task.dueDate?.slice(0,10);
  if (due && due < localDate(now)) return 'overdue';
  if (due === localDate(now)) return 'today';
  if (task.reminderAt && new Date(task.reminderAt).getTime() <= now.getTime()) return 'reminder';
  return 'open';
}
