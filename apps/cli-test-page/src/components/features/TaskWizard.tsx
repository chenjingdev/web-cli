import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { CheckCircle2, AlertCircle, X, Calendar, Clock, Tag } from 'lucide-react'
import type { Task, TaskStatus, TaskPriority, Member } from '@/types'
import { PRIORITY_COLORS, STATUS_COLORS, AVAILABLE_TAGS, TAG_COLORS } from '@/types'
import { cn } from '@/lib/utils'

interface TaskWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: Member[]
  onSubmit: (task: Omit<Task, 'id' | 'order' | 'createdAt'>) => void
}

interface WizardData {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string
  dueDate: string
  tags: string[]
  estimatedHours: string
}

type WizardErrors = Partial<Record<keyof WizardData, string>>

const STEPS = ['Basic Info', 'Detailed Settings', 'Confirmation/Review'] as const
type StepIndex = 0 | 1 | 2

const INITIAL_DATA: WizardData = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'medium',
  assignee: '',
  dueDate: '',
  tags: [],
  estimatedHours: '',
}

export function TaskWizard({ open, onOpenChange, members, onSubmit }: TaskWizardProps) {
  const [step, setStep] = useState<StepIndex>(0)
  const [errors, setErrors] = useState<WizardErrors>({})
  const [data, setData] = useState<WizardData>({ ...INITIAL_DATA })

  const resetWizard = () => {
    setStep(0)
    setErrors({})
    setData({ ...INITIAL_DATA })
  }

  const validateStep = (currentStep: StepIndex): boolean => {
    const newErrors: WizardErrors = {}

    if (currentStep === 0) {
      if (!data.title.trim()) newErrors.title = 'Task name is required'
      else if (data.title.trim().length > 100)
        newErrors.title = 'Task name must be under 100 characters'
      if (!data.assignee) newErrors.assignee = 'Please select an assignee'
    }

    if (currentStep === 1) {
      if (!data.description.trim()) newErrors.description = 'Description is required'
      if (
        data.estimatedHours &&
        (isNaN(Number(data.estimatedHours)) || Number(data.estimatedHours) < 0)
      ) {
        newErrors.estimatedHours = 'Must be a positive number'
      }
      if (data.estimatedHours && Number(data.estimatedHours) > 999) {
        newErrors.estimatedHours = 'Must be under 1000 hours'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (!validateStep(step)) return
    if (step < 2) setStep((step + 1) as StepIndex)
  }

  const handleBack = () => {
    if (step > 0) setStep((step - 1) as StepIndex)
  }

  const handleSubmit = () => {
    const taskData: Omit<Task, 'id' | 'order' | 'createdAt'> = {
      title: data.title.trim(),
      description: data.description.trim(),
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
    }
    if (data.dueDate) taskData.dueDate = data.dueDate
    if (data.tags.length > 0) taskData.tags = [...data.tags]
    if (data.estimatedHours && Number(data.estimatedHours) > 0) {
      taskData.estimatedHours = Number(data.estimatedHours)
    }

    onSubmit(taskData)
    resetWizard()
    onOpenChange(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) resetWizard()
    onOpenChange(newOpen)
  }

  const toggleTag = (tag: string) => {
    setData((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
    }))
  }

  const progressValue = ((step + 1) / STEPS.length) * 100
  const activeMembers = members.filter((m) => m.status === 'active')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        <Progress value={progressValue} className="h-2" />

        <div className="flex justify-center gap-2 mb-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-1.5">
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                  i < step
                    ? 'bg-primary text-primary-foreground'
                    : i === step
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  'text-xs hidden sm:inline',
                  i === step ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <Separator className="w-6" orientation="horizontal" />}
            </div>
          ))}
        </div>

        <div className="py-4 min-h-[200px]">
          {/* Step 1: Basic Info - Task name, Priority, Status, Assignee */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="task-name">
                  Task Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="task-name"
                  placeholder="Enter task name..."
                  value={data.title}
                  onChange={(e) => {
                    setData({ ...data, title: e.target.value })
                    if (errors.title) setErrors({ ...errors, title: undefined })
                  }}
                  className={errors.title ? 'border-destructive' : ''}
                />
                {errors.title && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.title}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="task-status">Status</Label>
                  <Select
                    value={data.status}
                    onValueChange={(v) => setData({ ...data, status: v as TaskStatus })}
                  >
                    <SelectTrigger id="task-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">To Do</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="in-review">In Review</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="task-priority">Priority</Label>
                  <Select
                    value={data.priority}
                    onValueChange={(v) => setData({ ...data, priority: v as TaskPriority })}
                  >
                    <SelectTrigger id="task-priority">
                      <SelectValue placeholder="Select priority..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-assignee">
                  Assignee <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={data.assignee}
                  onValueChange={(v) => {
                    setData({ ...data, assignee: v })
                    if (errors.assignee) setErrors({ ...errors, assignee: undefined })
                  }}
                >
                  <SelectTrigger
                    id="task-assignee"
                    className={errors.assignee ? 'border-destructive' : ''}
                  >
                    <SelectValue placeholder="Select a team member..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeMembers.map((m) => (
                      <SelectItem key={m.id} value={m.name}>
                        {m.name} ({m.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.assignee && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.assignee}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Detailed Settings - Description, Due Date, Tags, Estimated Hours */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="task-description">
                  Description <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="task-description"
                  placeholder="Describe the task in detail..."
                  rows={3}
                  value={data.description}
                  onChange={(e) => {
                    setData({ ...data, description: e.target.value })
                    if (errors.description) setErrors({ ...errors, description: undefined })
                  }}
                  className={errors.description ? 'border-destructive' : ''}
                />
                {errors.description && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.description}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="task-due-date" className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Due Date
                  </Label>
                  <Input
                    id="task-due-date"
                    type="date"
                    value={data.dueDate}
                    onChange={(e) => setData({ ...data, dueDate: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="task-hours" className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Estimated Hours
                  </Label>
                  <Input
                    id="task-hours"
                    type="number"
                    min="0"
                    max="999"
                    step="0.5"
                    placeholder="e.g. 8"
                    value={data.estimatedHours}
                    onChange={(e) => {
                      setData({ ...data, estimatedHours: e.target.value })
                      if (errors.estimatedHours)
                        setErrors({ ...errors, estimatedHours: undefined })
                    }}
                    className={errors.estimatedHours ? 'border-destructive' : ''}
                  />
                  {errors.estimatedHours && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {errors.estimatedHours}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  Tags / Labels
                </Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-md border bg-muted/30 min-h-[42px]">
                  {AVAILABLE_TAGS.map((tag) => {
                    const isSelected = data.tags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-all cursor-pointer',
                          isSelected
                            ? cn(TAG_COLORS[tag], 'ring-1 ring-offset-1 ring-primary/30')
                            : 'bg-background text-muted-foreground border-border hover:bg-muted',
                        )}
                      >
                        {tag}
                        {isSelected && <X className="h-3 w-3" />}
                      </button>
                    )
                  })}
                </div>
                {data.tags.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {data.tags.length} tag{data.tags.length !== 1 ? 's' : ''} selected
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Confirmation/Review */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground mb-4">
                Review the task details before creating it.
              </p>

              <div className="rounded-lg border p-4 space-y-3">
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    Task Name
                  </span>
                  <p className="font-medium">{data.title}</p>
                </div>
                <Separator />
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    Description
                  </span>
                  <p className="text-sm text-muted-foreground">{data.description}</p>
                </div>
                <Separator />
                <div className="flex gap-4 flex-wrap">
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Status
                    </span>
                    <div className="mt-1">
                      <Badge className={cn(STATUS_COLORS[data.status], 'text-xs')}>
                        {data.status}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Priority
                    </span>
                    <div className="mt-1">
                      <Badge
                        variant="outline"
                        className={cn(PRIORITY_COLORS[data.priority], 'text-xs')}
                      >
                        {data.priority}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Assignee
                    </span>
                    <p className="text-sm font-medium mt-1">{data.assignee}</p>
                  </div>
                </div>
                {(data.dueDate || data.estimatedHours || data.tags.length > 0) && (
                  <>
                    <Separator />
                    <div className="flex gap-4 flex-wrap">
                      {data.dueDate && (
                        <div>
                          <span className="text-xs text-muted-foreground uppercase tracking-wide">
                            Due Date
                          </span>
                          <p className="text-sm font-medium mt-1 flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {new Date(data.dueDate + 'T00:00:00').toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                      )}
                      {data.estimatedHours && (
                        <div>
                          <span className="text-xs text-muted-foreground uppercase tracking-wide">
                            Est. Hours
                          </span>
                          <p className="text-sm font-medium mt-1 flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {data.estimatedHours}h
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {data.tags.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">
                        Tags
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {data.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className={cn('text-xs', TAG_COLORS[tag])}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={handleBack}>
              Back
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={handleNext}>Next</Button>
          ) : (
            <Button onClick={handleSubmit}>Create Task</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
