import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Trash2,
  FolderKanban,
  Download,
  Tag,
  Archive,
  X,
  Check,
  ChevronDown,
  Loader2,
  AlertCircle,
  Square,
} from 'lucide-react';
import JSZip from 'jszip';
import { useAppStore, type BatchOperationCancelToken } from '@/store/useAppStore';
import { useToast } from '@/components/Toast';
import {
  cn,
  dataUrlToBlobWithType,
  getFileExtensionFromDataUrl,
  downloadDataUrl,
} from '@/utils';
import type { IconItem, BatchProgress } from '@/types';

type BatchAction = 'delete' | 'move' | 'export' | 'tag' | 'download' | null;

interface BatchToolbarProps {
  selectedIconIds: Set<string>;
  selectedIcons: IconItem[];
  activeProjectId: string | null;
  onSelectionChange: (ids: Set<string>) => void;
  onRefreshIcons: () => void;
  totalCount: number;
}

function ProgressBar({ progress }: { progress: BatchProgress }) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.current / progress.total) * 100);
  return (
    <div className="flex items-center gap-3 w-full">
      <div className="flex-1 h-2 bg-ink-700 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full transition-all duration-300 rounded-full',
            progress.cancelled ? 'bg-neon-amber' : 'bg-neon-cyan'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-slate-400 min-w-[60px] text-right">
        {progress.current}/{progress.total} ({pct}%)
      </span>
    </div>
  );
}

export default function BatchToolbar({
  selectedIconIds,
  selectedIcons,
  activeProjectId,
  onSelectionChange,
  onRefreshIcons,
  totalCount,
}: BatchToolbarProps) {
  const toast = useToast();
  const cancelTokenRef = useRef<BatchOperationCancelToken | null>(null);
  const [activeAction, setActiveAction] = useState<BatchAction>(null);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState('');
  const [showTagDialog, setShowTagDialog] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const {
    projects,
    removeIconsBulk,
    moveIconsToProject,
    addTagsToIcons,
  } = useAppStore();

  const otherProjects = projects.filter((p) => p.id !== activeProjectId);
  const selectedCount = selectedIconIds.size;

  useEffect(() => {
    if (selectedCount === 0) {
      setActiveAction(null);
      setShowMoveDialog(false);
      setShowTagDialog(false);
      setProgress(null);
      setIsRunning(false);
    }
  }, [selectedCount]);

  const handleCancel = useCallback(() => {
    if (cancelTokenRef.current) {
      cancelTokenRef.current.cancelled = true;
    }
  }, []);

  const resetState = useCallback(() => {
    setActiveAction(null);
    setProgress(null);
    setIsRunning(false);
    cancelTokenRef.current = null;
  }, []);

  const createCancelToken = (): BatchOperationCancelToken => {
    const token = { cancelled: false };
    cancelTokenRef.current = token;
    return token;
  };

  const handleProgress = useCallback((p: BatchProgress) => {
    setProgress({ ...p });
  }, []);

  const handleSelectAll = () => {
    if (selectedCount === totalCount) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(selectedIcons.map((i) => i.id)));
    }
  };

  const handleClearSelection = () => {
    onSelectionChange(new Set());
  };

  const handleDelete = async () => {
    if (!activeProjectId || selectedCount === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedCount} 个图标吗？此操作不可恢复。`)) return;

    setActiveAction('delete');
    setIsRunning(true);
    const token = createCancelToken();
    const ids = Array.from(selectedIconIds);

    try {
      const result = await removeIconsBulk(activeProjectId, ids, handleProgress, token);
      if (result.cancelled) {
        toast.showWarning(`已取消删除，已删除 ${result.success} 个图标`);
      } else if (result.failed > 0) {
        toast.showWarning(`删除完成：成功 ${result.success} 个，失败 ${result.failed} 个`);
      } else {
        toast.showSuccess(`已删除 ${result.success} 个图标`);
      }
      onRefreshIcons();
      onSelectionChange(new Set());
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      toast.showError(`删除失败：${msg}`);
    } finally {
      resetState();
    }
  };

  const handleConfirmMove = async () => {
    if (!activeProjectId || !targetProjectId || selectedCount === 0) return;

    setShowMoveDialog(false);
    setActiveAction('move');
    setIsRunning(true);
    const token = createCancelToken();
    const ids = Array.from(selectedIconIds);

    try {
      const targetProject = projects.find((p) => p.id === targetProjectId);
      const result = await moveIconsToProject(
        activeProjectId,
        targetProjectId,
        ids,
        handleProgress,
        token
      );
      if (result.cancelled) {
        toast.showWarning(`已取消移动，已移动 ${result.success} 个图标`);
      } else if (result.failed > 0) {
        toast.showWarning(`移动完成：成功 ${result.success} 个，失败 ${result.failed} 个`);
      } else {
        toast.showSuccess(`已移动 ${result.success} 个图标到 "${targetProject?.name}"`);
      }
      onRefreshIcons();
      onSelectionChange(new Set());
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      toast.showError(`移动失败：${msg}`);
    } finally {
      resetState();
      setTargetProjectId('');
    }
  };

  const handleConfirmTag = async () => {
    const tags = tagInput
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0 || selectedCount === 0) return;

    setShowTagDialog(false);
    setActiveAction('tag');
    setIsRunning(true);
    const token = createCancelToken();
    const ids = Array.from(selectedIconIds);

    try {
      const result = await addTagsToIcons(ids, tags, handleProgress, token);
      if (result.cancelled) {
        toast.showWarning(`已取消，已为 ${result.success} 个图标添加标签`);
      } else if (result.failed > 0) {
        toast.showWarning(`添加完成：成功 ${result.success} 个，失败 ${result.failed} 个`);
      } else {
        toast.showSuccess(`已为 ${result.success} 个图标添加 ${tags.length} 个标签`);
      }
      onRefreshIcons();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      toast.showError(`添加标签失败：${msg}`);
    } finally {
      resetState();
      setTagInput('');
    }
  };

  const handleDownload = async () => {
    if (selectedCount === 0) return;

    setActiveAction('download');
    setIsRunning(true);
    const token = createCancelToken();
    const total = selectedIcons.length;
    const errors: BatchProgress['errors'] = [];
    let success = 0;
    let failed = 0;

    try {
      for (let i = 0; i < selectedIcons.length; i++) {
        if (token.cancelled) {
          setProgress({
            current: i,
            total,
            message: `已取消（完成 ${i}/${total}）`,
            errors,
            cancelled: true,
          });
          break;
        }

        const icon = selectedIcons[i];
        try {
          const ext = getFileExtensionFromDataUrl(icon.dataUrl);
          downloadDataUrl(icon.dataUrl, `${icon.name}.${ext}`);
          success++;
        } catch (e) {
          failed++;
          errors.push({
            id: icon.id,
            name: icon.name,
            error: e instanceof Error ? e.message : '未知错误',
          });
        }

        setProgress({
          current: i + 1,
          total,
          message: `正在下载 ${icon.name} (${i + 1}/${total})`,
          errors,
          cancelled: false,
        });

        if ((i + 1) % 5 === 0) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      if (token.cancelled) {
        toast.showWarning(`已取消下载，已下载 ${success} 个图标`);
      } else if (failed > 0) {
        toast.showWarning(`下载完成：成功 ${success} 个，失败 ${failed} 个`);
      } else {
        toast.showSuccess(`已下载 ${success} 个图标`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      toast.showError(`下载失败：${msg}`);
    } finally {
      resetState();
    }
  };

  const handleExportZip = async () => {
    if (selectedCount === 0) return;

    setActiveAction('export');
    setIsRunning(true);
    const token = createCancelToken();
    const total = selectedIcons.length;
    const errors: BatchProgress['errors'] = [];
    let success = 0;
    let failed = 0;
    const zip = new JSZip();

    try {
      for (let i = 0; i < selectedIcons.length; i++) {
        if (token.cancelled) {
          setProgress({
            current: i,
            total,
            message: `已取消（完成 ${i}/${total}）`,
            errors,
            cancelled: true,
          });
          break;
        }

        const icon = selectedIcons[i];
        try {
          const ext = getFileExtensionFromDataUrl(icon.dataUrl);
          const blob = dataUrlToBlobWithType(icon.dataUrl);
          const filename = `${icon.name}.${ext}`;
          zip.file(filename, blob);
          success++;
        } catch (e) {
          failed++;
          errors.push({
            id: icon.id,
            name: icon.name,
            error: e instanceof Error ? e.message : '未知错误',
          });
        }

        setProgress({
          current: i + 1,
          total,
          message: `正在打包 ${icon.name} (${i + 1}/${total})`,
          errors,
          cancelled: false,
        });
      }

      if (!token.cancelled && success > 0) {
        setProgress({
          current: total,
          total,
          message: '正在生成 ZIP 文件...',
          errors,
          cancelled: false,
        });

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `icons-${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      if (token.cancelled) {
        toast.showWarning(`已取消导出，已打包 ${success} 个图标`);
      } else if (failed > 0) {
        toast.showWarning(`导出完成：成功 ${success} 个，失败 ${failed} 个`);
      } else {
        toast.showSuccess(`已导出 ${success} 个图标到 ZIP`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      toast.showError(`导出 ZIP 失败：${msg}`);
    } finally {
      resetState();
    }
  };

  const actionLabels: Record<Exclude<BatchAction, null>, string> = {
    delete: '批量删除',
    move: '批量移动',
    export: '批量导出 ZIP',
    tag: '批量添加标签',
    download: '批量下载原图',
  };

  if (selectedCount === 0) return null;

  return (
    <div className="border-b border-ink-700/50 bg-gradient-to-r from-neon-cyan/5 via-neon-cyan/10 to-neon-cyan/5 px-4 py-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="chip bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 font-semibold text-sm px-3 py-1">
            已选 {selectedCount} / {totalCount}
          </span>
          <button
            onClick={handleClearSelection}
            className="btn-ghost btn !px-2 !py-1 text-xs"
            title="取消选择"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleSelectAll}
            className="btn-ghost btn !px-2.5 !py-1 text-xs"
          >
            {selectedCount === totalCount ? '取消全选' : '全选'}
          </button>
        </div>

        {!isRunning && !showMoveDialog && !showTagDialog && (
          <>
            <div className="w-px h-6 bg-ink-600" />

            <button
              onClick={handleDelete}
              className="btn btn-danger !py-1.5 text-xs"
              title="删除选中的图标"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </button>

            <button
              onClick={() => {
                setShowMoveDialog(true);
                if (otherProjects.length > 0) {
                  setTargetProjectId(otherProjects[0].id);
                }
              }}
              disabled={otherProjects.length === 0}
              className={cn(
                'btn !py-1.5 text-xs',
                otherProjects.length === 0
                  ? 'bg-ink-700 text-slate-500 cursor-not-allowed'
                  : 'btn-secondary'
              )}
              title={otherProjects.length === 0 ? '没有其他项目可移动' : '移动到另一个项目'}
            >
              <FolderKanban className="w-3.5 h-3.5" />
              移动到
            </button>

            <button
              onClick={handleExportZip}
              className="btn btn-secondary !py-1.5 text-xs"
              title="导出为 ZIP 压缩包"
            >
              <Archive className="w-3.5 h-3.5" />
              导出 ZIP
            </button>

            <button
              onClick={() => setShowTagDialog(true)}
              className="btn btn-secondary !py-1.5 text-xs"
              title="为选中图标添加标签"
            >
              <Tag className="w-3.5 h-3.5" />
              添加标签
            </button>

            <button
              onClick={handleDownload}
              className="btn btn-secondary !py-1.5 text-xs"
              title="下载所有选中图标的原图"
            >
              <Download className="w-3.5 h-3.5" />
              下载原图
            </button>
          </>
        )}

        {showMoveDialog && !isRunning && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <span className="text-sm text-slate-300 flex items-center gap-1.5">
              <FolderKanban className="w-4 h-4 text-neon-cyan" />
              移动到项目：
            </span>
            <div className="relative">
              <select
                value={targetProjectId}
                onChange={(e) => setTargetProjectId(e.target.value)}
                className="input !py-1.5 text-xs pr-8 appearance-none cursor-pointer min-w-[160px]"
              >
                {otherProjects.length === 0 ? (
                  <option value="">暂无其他项目</option>
                ) : (
                  otherProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.iconIds.length})
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            </div>
            <button
              onClick={handleConfirmMove}
              disabled={!targetProjectId}
              className={cn(
                'btn !py-1.5 text-xs',
                targetProjectId ? 'btn-primary' : 'bg-ink-700 text-slate-500 cursor-not-allowed'
              )}
            >
              <Check className="w-3.5 h-3.5" />
              确认
            </button>
            <button
              onClick={() => {
                setShowMoveDialog(false);
                setTargetProjectId('');
              }}
              className="btn btn-secondary !py-1.5 text-xs"
            >
              <X className="w-3.5 h-3.5" />
              取消
            </button>
          </div>
        )}

        {showTagDialog && !isRunning && (
          <div className="flex items-center gap-2 animate-in fade-in duration-200">
            <span className="text-sm text-slate-300 flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-neon-cyan" />
              添加标签（逗号/空格分隔）：
            </span>
            <input
              autoFocus
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmTag();
                if (e.key === 'Escape') {
                  setShowTagDialog(false);
                  setTagInput('');
                }
              }}
              placeholder="如: ui, logo, icon"
              className="input !py-1.5 text-xs min-w-[220px]"
            />
            <button
              onClick={handleConfirmTag}
              disabled={!tagInput.trim()}
              className={cn(
                'btn !py-1.5 text-xs',
                tagInput.trim() ? 'btn-primary' : 'bg-ink-700 text-slate-500 cursor-not-allowed'
              )}
            >
              <Check className="w-3.5 h-3.5" />
              确认
            </button>
            <button
              onClick={() => {
                setShowTagDialog(false);
                setTagInput('');
              }}
              className="btn btn-secondary !py-1.5 text-xs"
            >
              <X className="w-3.5 h-3.5" />
              取消
            </button>
          </div>
        )}

        {isRunning && progress && activeAction && (
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              {progress.cancelled ? (
                <Square className="w-4 h-4 text-neon-amber" />
              ) : (
                <Loader2 className="w-4 h-4 text-neon-cyan animate-spin" />
              )}
              <span className="text-sm text-slate-200 whitespace-nowrap">
                {actionLabels[activeAction]}
              </span>
              <span className="text-xs text-slate-500 truncate max-w-[200px]">
                {progress.message}
              </span>
            </div>
            <div className="flex-1 min-w-[120px] max-w-md">
              <ProgressBar progress={progress} />
            </div>
            {!progress.cancelled && (
              <button
                onClick={handleCancel}
                className="btn btn-secondary !py-1 text-xs shrink-0"
              >
                <Square className="w-3.5 h-3.5" />
                取消
              </button>
            )}
            {progress.errors.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-neon-amber shrink-0" title={progress.errors.map((e) => `${e.name}: ${e.error}`).join('\n')}>
                <AlertCircle className="w-3.5 h-3.5" />
                {progress.errors.length} 错误
              </div>
            )}
          </div>
        )}
      </div>

      {progress && progress.errors.length > 0 && !isRunning && (
        <div className="mt-2 p-2 bg-rose-500/5 border border-rose-500/20 rounded-lg">
          <div className="text-xs text-rose-400 font-medium mb-1.5 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {progress.errors.length} 个操作失败：
          </div>
          <div className="text-[11px] text-slate-400 font-mono space-y-0.5 max-h-20 overflow-y-auto">
            {progress.errors.slice(0, 5).map((e, i) => (
              <div key={i}>
                • {e.name}: {e.error}
              </div>
            ))}
            {progress.errors.length > 5 && (
              <div className="text-slate-500">...还有 {progress.errors.length - 5} 个错误</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
