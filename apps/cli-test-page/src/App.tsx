import { useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KanbanBoard } from '@/components/features/KanbanBoard'
import { TaskWizard } from '@/components/features/TaskWizard'
import { MemberTable } from '@/components/features/MemberTable'
import { DocumentViewer } from '@/components/features/DocumentViewer'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { SEED_TASKS, SEED_MEMBERS } from '@/seed-data'
import { LayoutDashboard, KanbanSquare, Users, FileText } from 'lucide-react'
import type { Task, Member } from '@/types'

function App() {
  const [tasks, setTasks] = useLocalStorage<Task[]>('pm-tasks', SEED_TASKS)
  const [members] = useLocalStorage<Member[]>('pm-members', SEED_MEMBERS)
  const [wizardOpen, setWizardOpen] = useLocalStorage<boolean>('pm-wizard-open', false)
  const [activeTab, setActiveTab] = useLocalStorage<string>('pm-active-tab', 'board')

  const handleNewTask = useCallback(
    (taskData: Omit<Task, 'id' | 'order' | 'createdAt'>) => {
      const columnTasks = tasks.filter((t) => t.status === taskData.status)
      const maxOrder = columnTasks.reduce((max, t) => Math.max(max, t.order), -1)
      const newTask: Task = {
        ...taskData,
        id: `task-${Date.now()}`,
        order: maxOrder + 1,
        createdAt: new Date().toISOString(),
      }
      setTasks([...tasks, newTask])
    },
    [tasks, setTasks]
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Project Manager</h1>
              <p className="text-sm text-muted-foreground">
                Manage tasks, team members, and documentation
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3" data-agrune-group="tabs" data-agrune-group-name="Navigation Tabs">
            <TabsTrigger value="board" className="gap-1.5" data-agrune-action="click" data-agrune-name="Board Tab" data-agrune-key="tab-board">
              <KanbanSquare className="h-4 w-4" />
              Board
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-1.5" data-agrune-action="click" data-agrune-name="Members Tab" data-agrune-key="tab-members">
              <Users className="h-4 w-4" />
              Members
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-1.5" data-agrune-action="click" data-agrune-name="Docs Tab" data-agrune-key="tab-docs">
              <FileText className="h-4 w-4" />
              Docs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="board">
            <KanbanBoard
              tasks={tasks}
              onTasksChange={setTasks}
              onNewTask={() => setWizardOpen(true)}
            />
          </TabsContent>

          <TabsContent value="members">
            <MemberTable members={members} />
          </TabsContent>

          <TabsContent value="docs">
            <DocumentViewer />
          </TabsContent>
        </Tabs>
      </main>

      {/* Task Wizard Dialog */}
      <TaskWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        members={members}
        onSubmit={handleNewTask}
      />
    </div>
  )
}

export default App
