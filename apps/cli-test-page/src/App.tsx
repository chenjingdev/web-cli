import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  getWebCliBrowserStatus,
  requestWebCliAgentStart,
  requestWebCliAgentStop,
  subscribeWebCliBrowserStatus,
} from '@webcli-dom/browser-client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KanbanBoard } from '@/components/features/KanbanBoard'
import { TaskWizard } from '@/components/features/TaskWizard'
import { MemberTable } from '@/components/features/MemberTable'
import { DocumentViewer } from '@/components/features/DocumentViewer'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { SEED_TASKS, SEED_MEMBERS } from '@/seed-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Bot,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  LoaderCircle,
  PauseCircle,
  PlayCircle,
  Users,
} from 'lucide-react'
import type { Task, Member } from '@/types'

function App() {
  const [tasks, setTasks] = useLocalStorage<Task[]>('pm-tasks', SEED_TASKS)
  const [members] = useLocalStorage<Member[]>('pm-members', SEED_MEMBERS)
  const [wizardOpen, setWizardOpen] = useLocalStorage<boolean>('pm-wizard-open', false)
  const [activeTab, setActiveTab] = useLocalStorage<string>('pm-active-tab', 'board')
  const [agentControlPending, setAgentControlPending] = useState(false)
  const [agentControlError, setAgentControlError] = useState<string | null>(null)
  const browserStatus = useSyncExternalStore(
    subscribeWebCliBrowserStatus,
    getWebCliBrowserStatus,
    getWebCliBrowserStatus,
  )

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

  const handleAgentControl = useCallback(async () => {
    if (!browserStatus.sessionId || !browserStatus.active || agentControlPending) {
      return
    }

    setAgentControlPending(true)
    setAgentControlError(null)
    try {
      if (browserStatus.agentStopped) {
        await requestWebCliAgentStart()
      } else {
        await requestWebCliAgentStop()
      }
    } catch (error) {
      setAgentControlError(error instanceof Error ? error.message : String(error))
    } finally {
      setAgentControlPending(false)
    }
  }, [
    agentControlPending,
    browserStatus.active,
    browserStatus.agentStopped,
    browserStatus.sessionId,
  ])

  const connectionBadgeVariant =
    browserStatus.state === 'unavailable' || browserStatus.state === 'denied'
      ? 'destructive'
      : browserStatus.active
        ? 'default'
        : 'secondary'
  const connectionLabel = browserStatus.active
    ? '세션 연결됨'
    : browserStatus.sessionId
      ? '세션 대기중'
      : '세션 없음'
  const agentBadgeVariant = browserStatus.agentStopped
    ? 'destructive'
    : browserStatus.agentActive
      ? 'default'
      : 'outline'
  const agentLabel = browserStatus.agentStopped
    ? '수동 정지됨'
    : browserStatus.agentActive
      ? '에이전트 작업 중'
      : '에이전트 대기'
  const agentButtonLabel = browserStatus.agentStopped ? '에이전트 재개' : '에이전트 정지'
  const agentButtonDesc = browserStatus.agentStopped
    ? '수동 정지된 에이전트 제어를 재개'
    : '현재 세션의 에이전트 제어를 수동 정지'
  const canControlAgent =
    Boolean(browserStatus.sessionId) && browserStatus.active && !agentControlPending

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-center gap-3">
              <LayoutDashboard className="h-6 w-6 text-primary" />
              <div>
                <h1 className="text-xl font-bold tracking-tight">Project Manager</h1>
                <p className="text-sm text-muted-foreground">
                  Manage tasks, team members, and documentation
                </p>
              </div>
            </div>

            <div
              className="w-full rounded-2xl border bg-background/80 px-4 py-3 shadow-sm md:max-w-sm"
              data-webcli-group="webcli-controls"
              data-webcli-group-name="웹클리 제어"
              data-webcli-group-desc="세션 상태 확인 및 에이전트 정지 제어"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Bot className="h-4 w-4 text-primary" />
                    WebCLI Agent Control
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={connectionBadgeVariant}>{connectionLabel}</Badge>
                    <Badge variant={agentBadgeVariant}>{agentLabel}</Badge>
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant={browserStatus.agentStopped ? 'default' : 'destructive'}
                  onClick={() => void handleAgentControl()}
                  disabled={!canControlAgent}
                  data-webcli-action="click"
                  data-webcli-name={agentButtonLabel}
                  data-webcli-desc={agentButtonDesc}
                >
                  {agentControlPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : browserStatus.agentStopped ? (
                    <PlayCircle className="h-4 w-4" />
                  ) : (
                    <PauseCircle className="h-4 w-4" />
                  )}
                  {agentButtonLabel}
                </Button>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                {agentControlError
                  ? agentControlError
                  : canControlAgent
                    ? '사람이 즉시 제어를 끊어야 할 때 여기서 정지할 수 있습니다.'
                    : '현재 활성 세션이 연결되면 정지 버튼을 사용할 수 있습니다.'}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList
            className="grid w-full max-w-md grid-cols-3"
            data-webcli-group="main-tabs"
            data-webcli-group-name="메인 탭 네비게이션"
            data-webcli-group-desc="페이지 간 이동 탭"
          >
            <TabsTrigger
              value="board"
              className="gap-1.5"
              data-webcli-action="click"
              data-webcli-name="Board 탭"
              data-webcli-desc="칸반 보드 페이지로 이동"
            >
              <KanbanSquare className="h-4 w-4" />
              Board
            </TabsTrigger>
            <TabsTrigger
              value="members"
              className="gap-1.5"
              data-webcli-action="click"
              data-webcli-name="Members 탭"
              data-webcli-desc="팀 멤버 페이지로 이동"
            >
              <Users className="h-4 w-4" />
              Members
            </TabsTrigger>
            <TabsTrigger
              value="docs"
              className="gap-1.5"
              data-webcli-action="click"
              data-webcli-name="Docs 탭"
              data-webcli-desc="문서 페이지로 이동"
            >
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
