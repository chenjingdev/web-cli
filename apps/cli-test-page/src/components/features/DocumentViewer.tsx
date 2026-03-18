import { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FileText, BookOpen, Code, NotebookPen, RefreshCw, ExternalLink, Loader2, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocalStorage } from '@/hooks/useLocalStorage'

interface DocItem {
  id: string
  title: string
  path: string
  icon: React.ReactNode
  description: string
  category: string
}

const DOCS: DocItem[] = [
  {
    id: 'overview',
    title: 'Project Overview',
    path: '/docs/project-overview.html',
    icon: <BookOpen className="h-4 w-4" />,
    description: 'High-level project summary, milestones, and risk assessment',
    category: 'Project',
  },
  {
    id: 'api',
    title: 'API Reference',
    path: '/docs/api-reference.html',
    icon: <Code className="h-4 w-4" />,
    description: 'REST API endpoints, authentication, and rate limits',
    category: 'Technical',
  },
  {
    id: 'getting-started',
    title: 'Getting Started',
    path: '/docs/getting-started.html',
    icon: <FileText className="h-4 w-4" />,
    description: 'Setup guide, quick start tutorial, and keyboard shortcuts',
    category: 'Guide',
  },
  {
    id: 'meeting-notes',
    title: 'Meeting Notes',
    path: '/docs/meeting-notes.html',
    icon: <NotebookPen className="h-4 w-4" />,
    description: 'Sprint planning notes, decisions, and action items',
    category: 'Notes',
  },
]

const CATEGORY_COLORS: Record<string, string> = {
  Project: 'bg-blue-100 text-blue-700',
  Technical: 'bg-purple-100 text-purple-700',
  Guide: 'bg-green-100 text-green-700',
  Notes: 'bg-amber-100 text-amber-700',
}

export function DocumentViewer() {
  const [selectedDocId, setSelectedDocId] = useLocalStorage<string>('pm-selected-doc', DOCS[0].id)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const selectedDoc = DOCS.find((d) => d.id === selectedDocId) ?? DOCS[0]

  const handleSelectDoc = useCallback(
    (doc: DocItem) => {
      if (doc.id !== selectedDocId) {
        setIsLoading(true)
        setHasError(false)
        setSelectedDocId(doc.id)
      }
    },
    [selectedDocId, setSelectedDocId]
  )

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false)
    setHasError(false)
  }, [])

  const handleIframeError = useCallback(() => {
    setIsLoading(false)
    setHasError(true)
  }, [])

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      setIsLoading(true)
      setHasError(false)
      // Force reload by resetting src
      const currentSrc = iframeRef.current.src
      iframeRef.current.src = ''
      requestAnimationFrame(() => {
        if (iframeRef.current) {
          iframeRef.current.src = currentSrc
        }
      })
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileText className="h-6 w-6" />
          Documents
        </h2>
        <p className="text-muted-foreground">
          Browse project documentation. Select a document to view it in the iframe below.
        </p>
      </div>

      {/* Document selector cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {DOCS.map((doc) => (
          <Card
            key={doc.id}
            className={cn(
              'cursor-pointer transition-all hover:shadow-md',
              selectedDoc.id === doc.id
                ? 'ring-2 ring-primary border-primary shadow-sm'
                : 'hover:border-primary/50'
            )}
            onClick={() => handleSelectDoc(doc)}
            data-testid={`doc-card-${doc.id}`}
          >
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {doc.icon}
                  {doc.title}
                </span>
                <Badge variant="secondary" className={cn('text-[10px] px-1.5 py-0', CATEGORY_COLORS[doc.category])}>
                  {doc.category}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-xs text-muted-foreground leading-relaxed">{doc.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Document viewer iframe */}
      <Card className="overflow-hidden">
        {/* Toolbar */}
        <CardHeader className="p-3 bg-muted/50 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {selectedDoc.icon}
              <span className="font-medium">{selectedDoc.title}</span>
              <span className="text-muted-foreground text-xs font-mono">{selectedDoc.path}</span>
              {isLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                title="Refresh document"
                className="h-8 w-8 p-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                title={expanded ? 'Collapse' : 'Expand'}
                className="h-8 w-8 p-0"
              >
                {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(selectedDoc.path, '_blank')}
                className="h-8 gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in new tab
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 relative">
          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Loading document...</span>
              </div>
            </div>
          )}

          {/* Error state */}
          {hasError && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
              <div className="flex flex-col items-center gap-3 text-center">
                <FileText className="h-10 w-10 text-muted-foreground/50" />
                <div>
                  <p className="font-medium">Failed to load document</p>
                  <p className="text-sm text-muted-foreground">
                    Could not load <span className="font-mono">{selectedDoc.path}</span>
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleRefresh}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Try again
                </Button>
              </div>
            </div>
          )}

          {/* Iframe */}
          <iframe
            ref={iframeRef}
            key={selectedDoc.id}
            src={selectedDoc.path}
            title={selectedDoc.title}
            className="w-full border-0"
            style={{ height: expanded ? '80vh' : '500px', transition: 'height 0.2s ease' }}
            sandbox="allow-same-origin"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            data-testid="doc-iframe"
          />
        </CardContent>
      </Card>
    </div>
  )
}
