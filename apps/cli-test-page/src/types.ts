export type TaskStatus = 'todo' | 'in-progress' | 'in-review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string
  order: number
  createdAt: string
  dueDate?: string
  tags?: string[]
  estimatedHours?: number
}

export const AVAILABLE_TAGS = [
  'bug',
  'feature',
  'enhancement',
  'documentation',
  'design',
  'testing',
  'urgent',
  'refactor',
] as const

export const TAG_COLORS: Record<string, string> = {
  bug: 'bg-red-100 text-red-700 border-red-200',
  feature: 'bg-blue-100 text-blue-700 border-blue-200',
  enhancement: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  documentation: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  design: 'bg-purple-100 text-purple-700 border-purple-200',
  testing: 'bg-green-100 text-green-700 border-green-200',
  urgent: 'bg-orange-100 text-orange-700 border-orange-200',
  refactor: 'bg-gray-100 text-gray-700 border-gray-200',
}

export interface Member {
  id: string
  name: string
  email: string
  role: 'admin' | 'developer' | 'designer' | 'qa'
  status: 'active' | 'inactive'
  joinedAt: string
  avatar: string
}

export interface ProjectData {
  tasks: Task[]
  members: Member[]
}

export const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'in-review', label: 'In Review' },
  { id: 'done', label: 'Done' },
]

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-red-100 text-red-800',
}

export const STATUS_COLORS: Record<TaskStatus, string> = {
  'todo': 'bg-gray-100 text-gray-700',
  'in-progress': 'bg-blue-100 text-blue-700',
  'in-review': 'bg-purple-100 text-purple-700',
  'done': 'bg-green-100 text-green-700',
}

export const ROLE_COLORS: Record<Member['role'], string> = {
  admin: 'bg-red-100 text-red-700',
  developer: 'bg-blue-100 text-blue-700',
  designer: 'bg-purple-100 text-purple-700',
  qa: 'bg-green-100 text-green-700',
}
