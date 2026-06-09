export interface IconMeta {
  id: string;
  name: string;
  originalName: string;
  width: number;
  height: number;
  addedAt: number;
  tags: string[];
}

export interface IconItem extends IconMeta {
  dataUrl: string;
}

export interface BatchProgress {
  current: number;
  total: number;
  message: string;
  errors: { id: string; name: string; error: string }[];
  cancelled: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  iconIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SpriteConfig {
  columns: number;
  spacing: number;
  bgColor: string;
  classPrefix: string;
  retina: boolean;
}

export interface IconPosition {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteResult {
  imageDataUrl: string;
  cssCode: string;
  scssCode: string;
  iconPositions: IconPosition[];
  totalWidth: number;
  totalHeight: number;
  cellWidth: number;
  cellHeight: number;
}

export interface SplitConfig {
  rows: number;
  columns: number;
  iconWidth: number;
  iconHeight: number;
  spacing: number;
  padding: number;
}

export interface SplitIcon {
  index: number;
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}
