import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const maxFileSize = 1_000_000;
const editorialFields = new Set(['title', 'description', 'subtitle']);
const mediaReference = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp|mp4|webm|mov|mp3|wav|ogg|pdf|css|m?js)(?:[?#)\s]|$)/i;
const markdownImage = /!\s*\[[^\]]*\](?:\s*(?:\([^)]*\)|\[[^\]]*\]))?/;
const embeddedMedia = /\b(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|soundcloud\.com)\b/i;
const markup = /<\s*\/?\s*[a-z][^>]*>|<!--|--!?>|{%|{{|}}|%}/i;

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 2_000_000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function readBlob(revision, path, cwd) {
  try {
    const blob = execFileSync('git', ['show', `${revision}:${path}`], {
      cwd,
      encoding: 'buffer',
      maxBuffer: maxFileSize + 1,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (blob.length > maxFileSize) throw new Error('reflection file exceeds the classifier size limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(blob).split(/\r?\n/);
  } catch (error) {
    if (error.status === 128) return undefined;
    throw error;
  }
}

function frontMatter(lines) {
  if (!lines || lines[0] !== '---') return undefined;
  const end = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
  return end < 0 ? undefined : { start: 0, end };
}

function fieldAt(lines, index, range) {
  if (!range || index <= range.start || index >= range.end) return undefined;
  let field;
  let blockScalar = false;
  for (let cursor = range.start + 1; cursor <= index; cursor += 1) {
    const line = lines[cursor];
    const key = /^([A-Za-z][\w-]*):(?:[ \t]*(.*))?$/.exec(line);
    if (key) {
      field = key[1];
      blockScalar = /^[>|](?:[+-]?[1-9]?|[1-9]?[+-]?)?(?:\s+#.*)?$/.test(key[2] ?? '');
      if (cursor === index) return { field, value: key[2] ?? '', blockScalar: false };
      continue;
    }
    if (cursor === index) {
      if (blockScalar && /^\s+/.test(line)) return { field, continuation: true, blockScalar };
      return undefined;
    }
  }
  return undefined;
}

function safeMetadataChange(change, versionLines, versionFrontMatter, isNewFile) {
  const location = fieldAt(versionLines, change.lineNumber - 1, versionFrontMatter);
  if (!location) return false;
  if (location.field === 'revised' && /^revised:\s*(?:null|\d{4}-\d{2}-\d{2})\s*$/.test(change.line)) return true;
  if (editorialFields.has(location.field)) {
    if (location.continuation) return location.blockScalar;
    return !/^\s*(?:[&*!{}\[\]]|<<:)/.test(location.value);
  }
  if (!isNewFile || location.continuation) return false;
  const line = change.line;
  return (location.field === 'layout' && /^layout:\s*reflection\s*$/.test(line)) ||
    (location.field === 'published' && /^published:\s*\d{4}-\d{2}-\d{2}\s*$/.test(line)) ||
    (location.field === 'revised' && /^revised:\s*(?:null|\d{4}-\d{2}-\d{2})\s*$/.test(line)) ||
    (location.field === 'permalink' && /^permalink:\s*\/reflections\/[a-z0-9-]+\/\s*$/.test(line)) ||
    (location.field === 'css_id' && /^css_id:\s*reflection-[a-z0-9-]+\s*$/.test(line));
}

function changedLines(patch) {
  const changes = [];
  let oldLine;
  let newLine;
  for (const line of patch.split(/\r?\n/)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
    } else if (oldLine !== undefined && line.startsWith('+')) {
      changes.push({ line: line.slice(1), lineNumber: newLine, version: 'new' });
      newLine += 1;
    } else if (oldLine !== undefined && line.startsWith('-')) {
      changes.push({ line: line.slice(1), lineNumber: oldLine, version: 'old' });
      oldLine += 1;
    } else if (oldLine !== undefined && line.startsWith(' ')) {
      oldLine += 1;
      newLine += 1;
    } else if (oldLine !== undefined && line.startsWith('\\')) {
      continue;
    } else if (/^(?:Binary files |GIT binary patch)/.test(line)) {
      throw new Error('binary reflection diff');
    }
  }
  if (!changes.length) throw new Error('reflection diff did not contain readable text changes');
  return changes;
}

function imageReferenceLabels(lines) {
  const labels = new Set();
  for (const line of lines ?? []) {
    for (const match of line.matchAll(/!\s*\[([^\]]*)\]\s*\[([^\]]*)\]/g)) {
      labels.add((match[2] || match[1]).trim().toLowerCase());
    }
    for (const match of line.matchAll(/!\s*\[([^\]]+)\](?!\s*(?:\(|\[))/g)) {
      labels.add(match[1].trim().toLowerCase());
    }
  }
  return labels;
}

function changesImageReference(change, oldLines, newLines) {
  const definition = /^\s*\[([^\]]+)\]:/.exec(change.line);
  if (!definition) return false;
  const label = definition[1].trim().toLowerCase();
  return imageReferenceLabels(oldLines).has(label) || imageReferenceLabels(newLines).has(label);
}

function parseChangedFiles(output) {
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const files = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status || !fields[index]) throw new Error('could not parse changed-file statuses');
    const path = fields[index++];
    if (status.startsWith('R') || status.startsWith('C')) {
      if (!fields[index]) throw new Error('could not parse rename/copy status');
      index += 1;
      files.push({ status, path });
    } else {
      files.push({ status, path });
    }
  }
  return files;
}

function jekyllExcludesLicenses(revision, cwd) {
  let config;
  try {
    config = git(['show', `${revision}:_config.yml`], cwd);
  } catch {
    return false;
  }
  const excludeBlock = /^exclude:\s*\r?\n((?:[ \t]+-[^\r\n]*(?:\r?\n|$))*)/m.exec(config);
  return Boolean(
    excludeBlock?.[1].split(/\r?\n/).some((line) => /^\s+-\s+LICENSES\s*$/.test(line))
  );
}

function classifyFile(file, baseSha, headSha, cwd) {
  if (
    /^LICENSES\/[^/]+$/.test(file.path) &&
    ['A', 'M', 'D'].includes(file.status)
  ) {
    return jekyllExcludesLicenses(headSha, cwd)
      ? undefined
      : 'Jekyll does not explicitly exclude LICENSES';
  }
  if (!['A', 'M'].includes(file.status)) return `unsupported file status ${file.status}`;
  if (!/^_reflections\/[^/]+\.md$/.test(file.path)) return 'changed paths include files outside _reflections/*.md';

  const oldLines = file.status === 'A' ? undefined : readBlob(baseSha, file.path, cwd);
  const newLines = readBlob(headSha, file.path, cwd);
  if (!newLines || (file.status === 'M' && !oldLines)) return 'could not read both versions of the reflection';
  const oldFrontMatter = frontMatter(oldLines);
  const newFrontMatter = frontMatter(newLines);
  if (!newFrontMatter || (file.status === 'M' && !oldFrontMatter)) {
    return 'reflection front matter is missing or ambiguous';
  }

  const patch = git([
    'diff', '--no-ext-diff', '--no-color', '--unified=0',
    `${baseSha}...${headSha}`, '--', file.path
  ], cwd);
  const changes = changedLines(patch);
  for (const change of changes) {
    if (
      markup.test(change.line) ||
      markdownImage.test(change.line) ||
      changesImageReference(change, oldLines, newLines) ||
      mediaReference.test(change.line) ||
      /\/assets\//i.test(change.line) ||
      embeddedMedia.test(change.line)
    ) {
      return 'changed content includes HTML, Liquid, media, or an embed';
    }
    const lines = change.version === 'old' ? oldLines : newLines;
    const range = change.version === 'old' ? oldFrontMatter : newFrontMatter;
    if (change.lineNumber - 1 > range.start && change.lineNumber - 1 < range.end &&
        !safeMetadataChange(change, lines, range, file.status === 'A')) {
      return `changed front matter line ${change.lineNumber} is not limited to editorial metadata or standard new-reflection fields`;
    }
  }
  return undefined;
}

function classifyChanges({ baseSha, headSha, eventName, cwd = process.cwd() }) {
  if (eventName !== 'pull_request') {
    return { skip: false, reason: `${eventName} runs always perform the full baseline`, paths: [] };
  }
  if (!baseSha || !headSha || !/^[0-9a-f]{40}$/i.test(baseSha) || !/^[0-9a-f]{40}$/i.test(headSha)) {
    return { skip: false, reason: 'complete pull request base/head revisions are unavailable', paths: [] };
  }

  let files;
  try {
    files = parseChangedFiles(git([
      'diff', '--find-renames', '--name-status', '-z', `${baseSha}...${headSha}`, '--'
    ], cwd));
  } catch {
    return { skip: false, reason: 'could not determine the complete pull request diff', paths: [] };
  }
  if (!files.length) {
    return { skip: false, reason: 'pull request diff is empty or unavailable', paths: [] };
  }

  for (const file of files) {
    try {
      const reason = classifyFile(file, baseSha, headSha, cwd);
      if (reason) return { skip: false, reason: `${file.path}: ${reason}`, paths: files.map(({ path }) => path) };
    } catch (error) {
      return {
        skip: false,
        reason: `${file.path}: diff classification was uncertain (${error.message})`,
        paths: files.map(({ path }) => path)
      };
    }
  }

  return {
    skip: true,
    reason: 'all changed files are Jekyll-excluded license files or text-only Markdown reflections',
    paths: files.map(({ path }) => path)
  };
}

function writeOutputs(result) {
  const outputs = [
    `skip_measurement=${result.skip}`,
    `skip_reason=${result.reason.replace(/[\r\n]/g, ' ')}`,
    `changed_count=${result.paths.length}`,
    `changed_paths=${JSON.stringify(result.paths)}`
  ].join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, outputs, { flag: 'a' });
  }
  process.stdout.write(`Performance decision: ${result.skip ? 'intentionally skip Lighthouse' : 'run full Lighthouse baseline'}.\n`);
  process.stdout.write(`Reason: ${result.reason}\n`);
  if (result.paths.length) process.stdout.write(`Changed paths: ${result.paths.join(', ')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = classifyChanges({
    baseSha: process.env.PERFORMANCE_BASE_SHA,
    headSha: process.env.PERFORMANCE_HEAD_SHA,
    eventName: process.env.PERFORMANCE_EVENT_NAME,
    cwd: process.cwd()
  });
  writeOutputs(result);
}

export { classifyChanges, parseChangedFiles };
