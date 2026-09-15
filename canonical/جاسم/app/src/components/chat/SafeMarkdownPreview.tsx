import type { ReactNode } from 'react';
import { safePresentationExternalUrl } from '@workspace/jasim-runtime-contract';

interface SafeMarkdownPreviewProps {
  text: string;
}

function safeExternalHref(value: string): string | null {
  return safePresentationExternalUrl(value, ['https:', 'http:']);
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="px-1.5 py-0.5 rounded bg-slate-700/80 text-sky-300 text-xs font-mono border border-slate-600/50">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key} className="text-slate-100">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = linkMatch ? safeExternalHref(linkMatch[2]) : null;
      if (linkMatch && href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            {linkMatch[1]}
          </a>,
        );
      } else if (linkMatch) {
        nodes.push(<span key={key}>{linkMatch[1]}</span>);
      } else {
        nodes.push(token);
      }
    }
    cursor = match.index + token.length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

export function SafeMarkdownPreview({ text }: SafeMarkdownPreviewProps) {
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let lineIndex = 0;
  let codeBlock: string[] | null = null;
  let codeKey = 0;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (codeBlock) {
        blocks.push(
          <pre key={`code-${codeKey++}`} className="bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-x-auto my-2">
            <code className="text-xs font-mono text-slate-300 leading-relaxed">{codeBlock.join('\n')}</code>
          </pre>,
        );
        codeBlock = null;
      } else {
        codeBlock = [];
      }
      lineIndex += 1;
      continue;
    }

    if (codeBlock) {
      codeBlock.push(line);
      continue;
    }

    const key = `line-${lineIndex++}`;
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const Heading = heading[1].length === 1 ? 'h1' : heading[1].length === 2 ? 'h2' : 'h3';
      const className =
        Heading === 'h1'
          ? 'text-xl font-bold text-slate-100 mt-4 mb-2'
          : Heading === 'h2'
            ? 'text-lg font-bold text-slate-100 mt-4 mb-2'
            : 'text-base font-bold text-slate-100 mt-3 mb-1';
      blocks.push(<Heading key={key} className={className}>{renderInline(heading[2], key)}</Heading>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      blocks.push(
        <div key={key} className="ml-4 text-slate-300 list-disc">
          <span className="mr-1">•</span>{renderInline(line.replace(/^\s*[-*]\s+/, ''), key)}
        </div>,
      );
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const numbered = /^\s*(\d+)\.\s+(.+)$/.exec(line);
      blocks.push(
        <div key={key} className="ml-4 text-slate-300">
          {numbered?.[1]}. {numbered ? renderInline(numbered[2], key) : null}
        </div>,
      );
    } else if (/^\s*>\s?/.test(line)) {
      blocks.push(
        <blockquote key={key} className="border-l-2 border-slate-600 pl-3 text-slate-400 italic my-2">
          {renderInline(line.replace(/^\s*>\s?/, ''), key)}
        </blockquote>,
      );
    } else if (/^\s*---+\s*$/.test(line)) {
      blocks.push(<hr key={key} className="border-slate-700 my-3" />);
    } else if (line.trim()) {
      blocks.push(<div key={key} className="mb-2">{renderInline(line, key)}</div>);
    } else {
      blocks.push(<div key={key} className="h-2" aria-hidden="true" />);
    }
  }

  if (codeBlock) {
    blocks.push(
      <pre key={`code-${codeKey}`} className="bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-x-auto my-2">
        <code className="text-xs font-mono text-slate-300 leading-relaxed">{codeBlock.join('\n')}</code>
      </pre>,
    );
  }

  return <div className="text-sm leading-relaxed">{blocks}</div>;
}