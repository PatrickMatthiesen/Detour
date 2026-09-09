import { describe, expect, it } from 'vitest';
import { taskGroup, taskStatus } from './checklist';
import type { Task } from '../types';
const task: Task = {id:'a',title:'Task',completed:false,scope:'trip'};
describe('checklist dates and groups',()=>{
  it('infers legacy scopes from departure while honoring explicit grouping',()=>{
    expect(taskGroup({...task,dueDate:'2026-09-29'},'2026-09-30')).toBe('before');
    expect(taskGroup({...task,dueDate:'2026-09-30'},'2026-09-30')).toBe('during');
    expect(taskGroup({...task,scope:'before',dueDate:'2026-10-01'},'2026-09-30')).toBe('before');
  });
  it('keeps completed tasks out of reminder and overdue states',()=>{
    expect(taskStatus({...task,completed:true,dueDate:'2026-01-01',reminderAt:'2026-01-01T00:00:00Z'},new Date(2026,8,9))).toBe('done');
  });
  it('distinguishes today from overdue at local midnight',()=>{
    const now=new Date(2026,8,9,0,0);
    expect(taskStatus({...task,dueDate:'2026-09-09'},now)).toBe('today');
    expect(taskStatus({...task,dueDate:'2026-09-08'},now)).toBe('overdue');
  });
  it('compares explicit reminder offsets as instants',()=>{
    const now=new Date('2026-09-09T12:00:00Z');
    expect(taskStatus({...task,reminderAt:'2026-09-09T14:00:00+02:00'},now)).toBe('reminder');
    expect(taskStatus({...task,reminderAt:'2026-09-09T14:01:00+02:00'},now)).toBe('open');
  });
});
