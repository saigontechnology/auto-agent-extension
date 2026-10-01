import type { Anchor, FeedbackItem, FeedbackKind, Flow, PageContext, Viewport } from './types';

export type ItemInput = {
  kind: FeedbackKind;
  comment: string;
  context: PageContext;
  anchor?: Anchor;
  textEdit?: { before: string; after: string };
  flow?: Flow;
};

export type ItemEnv = { id: string; now: Date; viewport: Viewport };

export function currentEnv(view: Window): ItemEnv {
  return {
    id: crypto.randomUUID(),
    now: new Date(),
    viewport: { width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio },
  };
}

export function createItem(input: ItemInput, env: ItemEnv): FeedbackItem {
  const { context } = input;
  return {
    id: env.id,
    buildId: context.buildId,
    kind: input.kind,
    comment: input.comment.trim(),
    page: { url: context.url, path: context.path, title: context.title },
    ...(input.anchor ? { anchor: input.anchor } : {}),
    ...(input.textEdit ? { textEdit: input.textEdit } : {}),
    ...(input.flow ? { flow: input.flow } : {}),
    viewport: env.viewport,
    createdAt: env.now.toISOString(),
  };
}
