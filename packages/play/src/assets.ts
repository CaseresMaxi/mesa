import { boardTransform, collectAssets, renderAsset, type ResolvedAsset } from '@mesa/art';
import type { GamePack } from '@mesa/core';
import { packFileUrl } from './packSource.ts';

/** Cache de assets del pack como URLs (data: para SVG generados, archivo para overrides). */
let cacheKey: GamePack | null = null;
let byId = new Map<string, ResolvedAsset>();
const urls = new Map<string, string>();

export function assetUrl(pack: GamePack, id: string): string | null {
  if (cacheKey !== pack) {
    cacheKey = pack;
    byId = new Map(collectAssets(pack).map((a) => [a.id, a]));
    urls.clear();
  }
  const hit = urls.get(id);
  if (hit) return hit;
  const a = byId.get(id);
  if (!a) return null;
  const url = a.file ? packFileUrl(pack.pack.id, a.file) : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderAsset(pack, a))}`;
  urls.set(id, url);
  return url;
}

export function invalidateAssets() {
  cacheKey = null;
}

export const BOARD_W = 1600;
export const BOARD_H = 1200;
export const boardXY = (pack: GamePack) => boardTransform(pack, BOARD_W, BOARD_H, 110);
