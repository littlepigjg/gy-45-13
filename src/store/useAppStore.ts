import { create } from 'zustand';
import type { IconMeta, IconItem, Project, SpriteConfig, BatchProgress } from '../types';
import { generateId, iconItemToMeta } from '../utils';
import {
  saveIconDataUrl,
  getIconDataUrl,
  deleteIconBlob,
  deleteIconBulk,
} from '../utils/db';

const STORAGE_KEY = 'css-sprite-tool-data';

type ToastFn = (msg: string) => void;
interface ToastHandlers {
  showSuccess: ToastFn;
  showError: ToastFn;
  showWarning: ToastFn;
  showInfo: ToastFn;
}

let toastHandlers: ToastHandlers = {
  showSuccess: () => {},
  showError: (m) => console.error(m),
  showWarning: (m) => console.warn(m),
  showInfo: (m) => console.info(m),
};

export function setStoreToastHandlers(handlers: ToastHandlers) {
  toastHandlers = handlers;
}

interface PersistedData {
  projects: Project[];
  icons: IconMeta[];
}

export type BatchOperationCancelToken = { cancelled: boolean };

export type ProgressCallback = (progress: BatchProgress) => void;

interface AppState {
  projects: Project[];
  icons: IconMeta[];
  activeProjectId: string | null;
  generatorIcons: IconItem[];
  spriteConfig: SpriteConfig;

  setToastHandlers: (handlers: ToastHandlers) => void;

  addIcons: (icons: IconItem[]) => Promise<void>;
  removeIcon: (id: string) => Promise<void>;
  clearGeneratorIcons: () => void;
  setGeneratorIcons: (icons: IconItem[]) => void;
  updateSpriteConfig: (config: Partial<SpriteConfig>) => void;

  createProject: (name: string, description?: string) => Project;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => void;
  setActiveProject: (id: string | null) => void;
  addIconsToProject: (projectId: string, iconIds: string[]) => void;
  removeIconFromProject: (projectId: string, iconId: string) => void;

  getIconsInProject: (projectId: string) => Promise<{
    items: IconItem[];
    total: number;
    loaded: number;
    failed: number;
  }>;
  getIconItem: (meta: IconMeta) => Promise<IconItem | null>;

  removeIconsBulk: (
    projectId: string,
    iconIds: string[],
    onProgress?: ProgressCallback,
    cancelToken?: BatchOperationCancelToken
  ) => Promise<{ success: number; failed: number; cancelled: boolean }>;

  moveIconsToProject: (
    sourceProjectId: string,
    targetProjectId: string,
    iconIds: string[],
    onProgress?: ProgressCallback,
    cancelToken?: BatchOperationCancelToken
  ) => Promise<{ success: number; failed: number; cancelled: boolean }>;

  addTagsToIcons: (
    iconIds: string[],
    tags: string[],
    onProgress?: ProgressCallback,
    cancelToken?: BatchOperationCancelToken
  ) => Promise<{ success: number; failed: number; cancelled: boolean }>;

  removeIconsFromProjectBulk: (projectId: string, iconIds: string[]) => void;
}

function loadFromStorage(): PersistedData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const icons: IconMeta[] = (parsed.icons || []).map((i: IconMeta) => ({
        ...i,
        tags: i.tags || [],
      }));
      return {
        projects: parsed.projects || [],
        icons,
      };
    }
  } catch {
    toastHandlers.showError('读取本地数据失败');
  }
  return { projects: [], icons: [] };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const BATCH_YIELD_INTERVAL = 20;

function saveToStorage(projects: Project[], icons: IconMeta[]): boolean {
  try {
    const payload = JSON.stringify({ projects, icons });
    localStorage.setItem(STORAGE_KEY, payload);
    return true;
  } catch {
    toastHandlers.showError('本地存储失败，浏览器存储空间可能已满');
    return false;
  }
}

const initialData = loadFromStorage();

export const useAppStore = create<AppState>((set, get) => ({
  projects: initialData.projects,
  icons: initialData.icons,
  activeProjectId: initialData.projects[0]?.id || null,
  generatorIcons: [],
  spriteConfig: {
    columns: 5,
    spacing: 4,
    bgColor: 'transparent',
    classPrefix: 'sprite',
    retina: false,
  },

  setToastHandlers: (handlers) => {
    setStoreToastHandlers(handlers);
  },

  addIcons: async (items) => {
    if (items.length === 0) return;
    const metas: IconMeta[] = items.map(iconItemToMeta);

    try {
      for (const item of items) {
        await saveIconDataUrl(item.id, item.dataUrl);
      }
    } catch (err) {
      toastHandlers.showError('保存图片到本地数据库失败');
      throw err;
    }

    set((state) => {
      const newIcons = [...state.icons, ...metas];
      saveToStorage(state.projects, newIcons);
      return { icons: newIcons };
    });
    toastHandlers.showSuccess(`已保存 ${items.length} 个图标`);
  },

  removeIcon: async (id) => {
    try {
      await deleteIconBlob(id);
    } catch {
      toastHandlers.showError('删除图片数据失败');
    }

    set((state) => {
      const newIcons = state.icons.filter((i) => i.id !== id);
      const newProjects = state.projects.map((p) => ({
        ...p,
        iconIds: p.iconIds.filter((iid) => iid !== id),
      }));
      saveToStorage(newProjects, newIcons);
      return { icons: newIcons, projects: newProjects };
    });
  },

  clearGeneratorIcons: () => set({ generatorIcons: [] }),

  setGeneratorIcons: (icons) => set({ generatorIcons: icons }),

  updateSpriteConfig: (config) =>
    set((state) => ({
      spriteConfig: { ...state.spriteConfig, ...config },
    })),

  createProject: (name, description = '') => {
    const project: Project = {
      id: generateId(),
      name,
      description,
      iconIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((state) => {
      const newProjects = [...state.projects, project];
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects, activeProjectId: project.id };
    });
    toastHandlers.showSuccess(`项目 "${name}" 已创建`);
    return project;
  },

  deleteProject: async (id) => {
    const state = get();
    const project = state.projects.find((p) => p.id === id);
    const projectIconIds = new Set(project?.iconIds || []);
    const newProjects = state.projects.filter((p) => p.id !== id);
    const remainingProjectIconIds = new Set(
      newProjects.flatMap((p) => p.iconIds)
    );
    const orphanedIds = [...projectIconIds].filter(
      (iid) => !remainingProjectIconIds.has(iid)
    );

    if (orphanedIds.length > 0) {
      try {
        await deleteIconBulk(orphanedIds);
      } catch {
        toastHandlers.showError('清理图片数据失败');
      }
    }

    set((s) => {
      const newIcons = s.icons.filter((i) => !orphanedIds.includes(i.id));
      saveToStorage(newProjects, newIcons);
      return {
        projects: newProjects,
        icons: newIcons,
        activeProjectId:
          s.activeProjectId === id ? newProjects[0]?.id || null : s.activeProjectId,
      };
    });
    toastHandlers.showInfo('项目已删除');
  },

  renameProject: (id, name) => {
    set((state) => {
      const newProjects = state.projects.map((p) =>
        p.id === id ? { ...p, name, updatedAt: Date.now() } : p
      );
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects };
    });
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  addIconsToProject: (projectId, iconIds) => {
    set((state) => {
      const newProjects = state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              iconIds: [...new Set([...p.iconIds, ...iconIds])],
              updatedAt: Date.now(),
            }
          : p
      );
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects };
    });
  },

  removeIconFromProject: (projectId, iconId) => {
    set((state) => {
      const newProjects = state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              iconIds: p.iconIds.filter((id) => id !== iconId),
              updatedAt: Date.now(),
            }
          : p
      );
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects };
    });
  },

  getIconItem: async (meta) => {
    try {
      const dataUrl = await getIconDataUrl(meta.id);
      if (!dataUrl) {
        toastHandlers.showWarning(`图标 "${meta.name}" 数据缺失`);
        return null;
      }
      return { ...meta, dataUrl };
    } catch {
      toastHandlers.showError(`加载图标 "${meta.name}" 失败`);
      return null;
    }
  },

  getIconsInProject: async (projectId) => {
    const state = get();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return { items: [], total: 0, loaded: 0, failed: 0 };
    const metaMap = new Map(state.icons.map((i) => [i.id, i]));
    const metas = project.iconIds
      .map((id) => metaMap.get(id))
      .filter((m): m is IconMeta => !!m);

    const items: IconItem[] = [];
    let failed = 0;
    for (const meta of metas) {
      const item = await get().getIconItem(meta);
      if (item) items.push(item);
      else failed++;
    }
    if (failed > 0) {
      toastHandlers.showWarning(`成功加载 ${items.length} 个图标，${failed} 个加载失败`);
    }
    return { items, total: metas.length, loaded: items.length, failed };
  },

  removeIconsFromProjectBulk: (projectId, iconIds) => {
    const idSet = new Set(iconIds);
    set((state) => {
      const newProjects = state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              iconIds: p.iconIds.filter((id) => !idSet.has(id)),
              updatedAt: Date.now(),
            }
          : p
      );
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects };
    });
  },

  removeIconsBulk: async (projectId, iconIds, onProgress, cancelToken) => {
    const total = iconIds.length;
    const errors: BatchProgress['errors'] = [];
    let success = 0;
    let failed = 0;
    const state = get();
    const metaMap = new Map(state.icons.map((i) => [i.id, i]));

    for (let i = 0; i < iconIds.length; i++) {
      if (cancelToken?.cancelled) {
        onProgress?.({
          current: i,
          total,
          message: `已取消（完成 ${i}/${total}）`,
          errors,
          cancelled: true,
        });
        return { success, failed, cancelled: true };
      }

      const id = iconIds[i];
      const meta = metaMap.get(id);
      const name = meta?.name || id;

      try {
        await deleteIconBlob(id);
        success++;
      } catch (e) {
        failed++;
        errors.push({
          id,
          name,
          error: e instanceof Error ? e.message : '未知错误',
        });
      }

      onProgress?.({
        current: i + 1,
        total,
        message: `正在删除 ${name} (${i + 1}/${total})`,
        errors,
        cancelled: false,
      });

      if ((i + 1) % BATCH_YIELD_INTERVAL === 0) {
        await sleep(0);
      }
    }

    const idSet = new Set(iconIds);
    set((s) => {
      const remainingProjectIconIds = new Set(
        s.projects
          .filter((p) => p.id !== projectId)
          .flatMap((p) => p.iconIds)
      );
      const orphanedIds = iconIds.filter((iid) => !remainingProjectIconIds.has(iid));
      const newIcons = s.icons.filter((ic) => !orphanedIds.includes(ic.id));
      const newProjects = s.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              iconIds: p.iconIds.filter((id) => !idSet.has(id)),
              updatedAt: Date.now(),
            }
          : p
      );
      saveToStorage(newProjects, newIcons);
      return { icons: newIcons, projects: newProjects };
    });

    return { success, failed, cancelled: false };
  },

  moveIconsToProject: async (sourceProjectId, targetProjectId, iconIds, onProgress, cancelToken) => {
    const total = iconIds.length;
    const errors: BatchProgress['errors'] = [];
    let success = 0;
    let failed = 0;
    const state = get();
    const metaMap = new Map(state.icons.map((i) => [i.id, i]));

    const idSet = new Set(iconIds);
    const targetState = get();
    const targetProject = targetState.projects.find((p) => p.id === targetProjectId);
    if (!targetProject) {
      return { success: 0, failed: total, cancelled: false };
    }

    for (let i = 0; i < iconIds.length; i++) {
      if (cancelToken?.cancelled) {
        onProgress?.({
          current: i,
          total,
          message: `已取消（完成 ${i}/${total}）`,
          errors,
          cancelled: true,
        });
        return { success, failed, cancelled: true };
      }

      const id = iconIds[i];
      const meta = metaMap.get(id);
      const name = meta?.name || id;

      try {
        success++;
      } catch (e) {
        failed++;
        errors.push({
          id,
          name,
          error: e instanceof Error ? e.message : '未知错误',
        });
      }

      onProgress?.({
        current: i + 1,
        total,
        message: `正在移动 ${name} (${i + 1}/${total})`,
        errors,
        cancelled: false,
      });

      if ((i + 1) % BATCH_YIELD_INTERVAL === 0) {
        await sleep(0);
      }
    }

    set((s) => {
      const mergedIds = [...new Set([...targetProject.iconIds, ...iconIds])];
      const newProjects = s.projects.map((p) => {
        if (p.id === sourceProjectId) {
          return {
            ...p,
            iconIds: p.iconIds.filter((id) => !idSet.has(id)),
            updatedAt: Date.now(),
          };
        }
        if (p.id === targetProjectId) {
          return {
            ...p,
            iconIds: mergedIds,
            updatedAt: Date.now(),
          };
        }
        return p;
      });
      saveToStorage(newProjects, s.icons);
      return { projects: newProjects };
    });

    return { success, failed, cancelled: false };
  },

  addTagsToIcons: async (iconIds, tags, onProgress, cancelToken) => {
    const total = iconIds.length;
    const errors: BatchProgress['errors'] = [];
    let success = 0;
    let failed = 0;
    const state = get();
    const metaMap = new Map(state.icons.map((i) => [i.id, i]));

    for (let i = 0; i < iconIds.length; i++) {
      if (cancelToken?.cancelled) {
        onProgress?.({
          current: i,
          total,
          message: `已取消（完成 ${i}/${total}）`,
          errors,
          cancelled: true,
        });
        return { success, failed, cancelled: true };
      }

      const id = iconIds[i];
      const meta = metaMap.get(id);
      const name = meta?.name || id;

      try {
        if (!meta) throw new Error('图标不存在');
        success++;
      } catch (e) {
        failed++;
        errors.push({
          id,
          name,
          error: e instanceof Error ? e.message : '未知错误',
        });
      }

      onProgress?.({
        current: i + 1,
        total,
        message: `正在添加标签到 ${name} (${i + 1}/${total})`,
        errors,
        cancelled: false,
      });

      if ((i + 1) % BATCH_YIELD_INTERVAL === 0) {
        await sleep(0);
      }
    }

    const idSet = new Set(iconIds);
    const tagSet = new Set(tags.map((t) => t.trim()).filter(Boolean));
    set((s) => {
      const newIcons = s.icons.map((ic) => {
        if (!idSet.has(ic.id)) return ic;
        const mergedTags = [...new Set([...(ic.tags || []), ...tagSet])];
        return { ...ic, tags: mergedTags };
      });
      saveToStorage(s.projects, newIcons);
      return { icons: newIcons };
    });

    return { success, failed, cancelled: false };
  },
}));

export { generateId };
