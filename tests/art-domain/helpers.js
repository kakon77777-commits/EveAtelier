import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';

export async function writeSubject(path, { width = 16, height = 16 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const data = Buffer.alloc(width * height * 4, 255);
  for (let y = 3; y < height - 3; y += 1) {
    for (let x = 4; x < width - 4; x += 1) {
      const offset = ((y * width) + x) * 4;
      data[offset] = 40;
      data[offset + 1] = 80;
      data[offset + 2] = 140;
      data[offset + 3] = 255;
    }
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(path);
  return path;
}

export async function writeOverlay(path, { width = 4, height = 4 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 220;
    data[(index * 4) + 1] = 30;
    data[(index * 4) + 2] = 30;
    data[(index * 4) + 3] = 255;
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(path);
  return path;
}

export function projectRecord(createdAt = '2026-09-11T01:00:00+08:00') {
  return {
    schema: 'eve-atelier-art-project/v1',
    projectId: 'project:synthetic:v02',
    canonicalName: 'Synthetic v0.2 project',
    workspaceId: 'workspace:synthetic:v02',
    assetNamespace: 'asset:synthetic:v02',
    semanticScope: 'project-local',
    createdAt,
    status: 'ACTIVE',
  };
}

export function documentRecord(createdAt = '2026-09-11T01:00:00+08:00') {
  return {
    schema: 'eve-atelier-art-document/v1',
    documentId: 'document:synthetic:v02',
    projectId: 'project:synthetic:v02',
    documentType: 'RASTER_ILLUSTRATION',
    colorSpace: 'srgb',
    canvasExtent: { width: 16, height: 16 },
    promotionPolicy: 'human_required',
    createdAt,
    status: 'ACTIVE',
  };
}

export function sourceTarget(snapshot, overrides = {}) {
  return {
    schema: 'eve-atelier-art-operator-target/v1',
    targetId: 'target:synthetic:source',
    targetKind: 'DOCUMENT_VERSION',
    projectId: snapshot.document.projectId,
    documentId: snapshot.document.documentId,
    versionId: snapshot.currentVersion.versionId,
    componentId: null,
    expectedCurrentVersionId: snapshot.currentVersion.versionId,
    expectedDocumentRevision: snapshot.documentRevision,
    expectedCanvasRevision: null,
    ...overrides,
  };
}
